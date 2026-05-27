import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import ffmpegPath from 'ffmpeg-static'

// Body ahora es mínimo: solo { videoUrl, numeroCamiseta }
// El video viaja directo de cliente a Supabase Storage — nunca por esta función
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb'
    }
  }
}

// ── Diagnóstico de arranque del módulo ───────────────────────────────────────
console.log('[analyze-video] MODULE LOAD')
console.log('[analyze-video] ffmpegPath:', ffmpegPath)
if (ffmpegPath) {
  const exists = fs.existsSync(ffmpegPath)
  console.log('[analyze-video] binary exists:', exists)
  if (exists) {
    const v = spawnSync(ffmpegPath, ['-version'], { encoding: 'utf8', timeout: 8000 })
    console.log('[analyze-video] ffmpeg version:', (v.stdout || v.stderr || '').split('\n')[0])
    if (v.error) console.error('[analyze-video] ffmpeg -version error:', v.error.message)
  }
} else {
  console.error('[analyze-video] CRÍTICO: ffmpeg-static devolvió null')
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  console.log('[analyze-video] REQUEST', {
    method: req.method,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    videoUrl: req.body?.videoUrl?.slice(0, 80),
    numeroCamiseta: req.body?.numeroCamiseta
  })

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Guardias ────────────────────────────────────────────────────────────────
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    console.error('[analyze-video] ffmpeg no disponible:', ffmpegPath)
    return res.status(500).json({
      error: 'ffmpeg no disponible en el servidor. Verifica que ffmpeg-static está instalado.',
      debug: { ffmpegPath, platform: process.platform, arch: process.arch }
    })
  }

  const { videoUrl, numeroCamiseta } = req.body || {}

  if (!videoUrl || typeof videoUrl !== 'string') {
    return res.status(400).json({ error: 'videoUrl requerida (URL pública de Supabase Storage)' })
  }
  if (!numeroCamiseta) {
    return res.status(400).json({ error: 'numeroCamiseta requerido' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' })
  }

  const tmpId  = crypto.randomBytes(8).toString('hex')
  const tmpDir = path.join(os.tmpdir(), `fiq-${tmpId}`)

  try {
    fs.mkdirSync(tmpDir, { recursive: true })

    // ── PASO 1: Descargar video desde Supabase Storage ───────────────────────
    console.log('[analyze-video] PASO 1 — descargando desde:', videoUrl.slice(0, 100))
    let videoBuffer
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 55000)
      const videoRes = await fetch(videoUrl, { signal: ctrl.signal })
      clearTimeout(timer)

      if (!videoRes.ok) {
        throw new Error(`HTTP ${videoRes.status} al descargar el video desde Storage`)
      }
      videoBuffer = Buffer.from(await videoRes.arrayBuffer())
      console.log(`[analyze-video] PASO 1 OK — ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB descargados`)
    } catch (e) {
      console.error('[analyze-video] PASO 1 FAIL:', e.message)
      throw new Error('Error descargando video desde Supabase Storage: ' + e.message)
    }

    const videoPath = path.join(tmpDir, 'input.mp4')
    fs.writeFileSync(videoPath, videoBuffer)

    // ── PASO 2: Obtener duración ──────────────────────────────────────────────
    let duration
    try {
      duration = getVideoDuration(videoPath)
      console.log(`[analyze-video] PASO 2 OK — duración: ${duration.toFixed(2)}s`)
    } catch (e) {
      console.error('[analyze-video] PASO 2 FAIL:', e.message)
      throw e
    }

    // ── PASO 3: Extraer 8 frames con ffmpeg ───────────────────────────────────
    const NUM_FRAMES = 8
    try {
      extractFrames(videoPath, tmpDir, NUM_FRAMES, duration)
      console.log('[analyze-video] PASO 3 OK')
    } catch (e) {
      console.error('[analyze-video] PASO 3 FAIL:', e.message)
      throw e
    }

    // ── PASO 4: Leer JPEGs como base64 ───────────────────────────────────────
    let imageBlocks
    try {
      const frameFiles = fs.readdirSync(tmpDir)
        .filter(f => /^frame_\d+\.jpg$/.test(f))
        .sort()
      console.log(`[analyze-video] PASO 4 — frames en disco:`, frameFiles)

      if (frameFiles.length === 0) throw new Error('ffmpeg no generó frames')

      imageBlocks = frameFiles.slice(0, NUM_FRAMES).map(fname => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: fs.readFileSync(path.join(tmpDir, fname)).toString('base64')
        }
      }))
      console.log(`[analyze-video] PASO 4 OK — ${imageBlocks.length} frames listos`)
    } catch (e) {
      console.error('[analyze-video] PASO 4 FAIL:', e.message)
      throw e
    }

    // ── PASO 5: Claude Vision ─────────────────────────────────────────────────
    console.log('[analyze-video] PASO 5 — llamando Claude con', imageBlocks.length, 'frames')
    let analisis
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          system: `Eres un analista táctico experto en fútbol de alto rendimiento con 20 años de experiencia analizando video.
Tu especialidad es el análisis frame a frame: posicionamiento, movimiento sin balón, timing, cobertura de espacios, presión, toma de decisiones, técnica individual.
Identificas al jugador por su número de camiseta y analizas ÚNICAMENTE sus acciones.
Eres específico, técnico y accionable. Nunca genérico.
Responde SIEMPRE en español con terminología técnica futbolística.
DEVUELVE ÚNICAMENTE JSON VÁLIDO sin markdown.`,
          messages: [{
            role: 'user',
            content: [
              ...imageBlocks,
              {
                type: 'text',
                text: `Analiza al jugador con camiseta número ${numeroCamiseta} en estos ${imageBlocks.length} frames de video de fútbol.

Devuelve EXCLUSIVAMENTE JSON válido sin markdown:
{
  "jugador": "Camiseta #${numeroCamiseta}",
  "resumen": "síntesis ejecutiva en 2-3 frases",
  "fortalezas": ["fortaleza concreta 1", "fortaleza 2", "fortaleza 3"],
  "areas_mejora": ["área concreta 1", "área 2", "área 3"],
  "ejercicios": [
    {"nombre": "nombre", "objetivo": "qué mejora", "descripcion": "cómo realizarlo"},
    {"nombre": "nombre", "objetivo": "qué mejora", "descripcion": "cómo realizarlo"},
    {"nombre": "nombre", "objetivo": "qué mejora", "descripcion": "cómo realizarlo"}
  ]
}`
              }
            ]
          }]
        })
      })

      if (!response.ok) {
        const errText = await response.text()
        console.error('[analyze-video] PASO 5 Anthropic error:', response.status, errText.slice(0, 200))
        throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 150)}`)
      }

      const claudeData = await response.json()
      const raw = (claudeData.content?.[0]?.text || '{}').trim()
      console.log('[analyze-video] PASO 5 raw (80 chars):', raw.slice(0, 80))

      const jsonStr = raw
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()

      analisis = JSON.parse(jsonStr)
      console.log('[analyze-video] PASO 5 OK — jugador:', analisis.jugador)
    } catch (e) {
      console.error('[analyze-video] PASO 5 FAIL:', e.message)
      throw e
    }

    return res.status(200).json({ analisis })

  } catch (err) {
    console.error('[analyze-video] ERROR FINAL:', err.message)
    return res.status(500).json({ error: err.message })
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getVideoDuration(videoPath) {
  const r = spawnSync(ffmpegPath, ['-i', videoPath], { encoding: 'utf8', timeout: 15000 })
  const out = r.stderr || ''
  console.log('[analyze-video] ffmpeg probe stderr (150):', out.slice(0, 150))
  const m = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
  if (!m) throw new Error('ffmpeg no pudo leer la duración — verifica que el archivo sea un MP4 válido')
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])
}

function extractFrames(videoPath, outputDir, numFrames, duration) {
  const fps  = (numFrames / duration).toFixed(8)
  const args = [
    '-i', videoPath,
    '-vf', `fps=${fps},scale=960:-2:flags=fast_bilinear`,
    '-frames:v', String(numFrames),
    '-q:v', '3',
    '-f', 'image2',
    path.join(outputDir, 'frame_%03d.jpg')
  ]
  console.log('[analyze-video] ffmpeg extractFrames args:', args.join(' '))

  const r = spawnSync(ffmpegPath, args, { timeout: 120000, encoding: 'utf8' })
  console.log('[analyze-video] ffmpeg exit status:', r.status)
  if (r.error) throw r.error
  if (r.stderr) console.log('[analyze-video] ffmpeg stderr (last 300):', r.stderr.slice(-300))

  const created = fs.readdirSync(outputDir).filter(f => /^frame_/.test(f))
  if (created.length === 0) {
    throw new Error(`ffmpeg no extrajo frames (exit ${r.status}). Stderr: ${(r.stderr || '').slice(-200)}`)
  }
  console.log('[analyze-video] frames creados:', created.length)
}
