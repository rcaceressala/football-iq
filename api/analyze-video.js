import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import ffmpegPath from 'ffmpeg-static'

// ── Configuración del body parser ────────────────────────────────────────────
// sizeLimit: video 50 MB → base64 ≈ 67 MB → margen con 75 MB
// IMPORTANTE: este config es respetado por Vercel's Node.js builder
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '75mb'
    }
  }
}

// ── Diagnóstico de arranque ──────────────────────────────────────────────────
// Se ejecuta una vez al cargar el módulo (no por cada request)
console.log('[analyze-video] MODULE LOAD — ffmpegPath:', ffmpegPath)
if (ffmpegPath) {
  const exists = fs.existsSync(ffmpegPath)
  console.log('[analyze-video] ffmpeg binary exists:', exists)
  if (exists) {
    // Verificar que el binario es ejecutable corriendo ffmpeg -version
    const vCheck = spawnSync(ffmpegPath, ['-version'], { encoding: 'utf8', timeout: 8000 })
    const firstLine = (vCheck.stdout || vCheck.stderr || '').split('\n')[0]
    console.log('[analyze-video] ffmpeg -version:', firstLine || '(sin output)')
    if (vCheck.error) {
      console.error('[analyze-video] ffmpeg -version ERROR:', vCheck.error.message)
    }
  }
} else {
  console.error('[analyze-video] CRÍTICO: ffmpeg-static devolvió null — binario no disponible para esta plataforma')
}

// ── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // ── Log de cada request ────────────────────────────────────────────────────
  console.log('[analyze-video] REQUEST', {
    method: req.method,
    contentType: req.headers['content-type'],
    contentLength: req.headers['content-length'],
    bodyIsObject: typeof req.body === 'object' && req.body !== null,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    videoBase64Len: req.body?.videoBase64?.length ?? 0,
    numeroCamiseta: req.body?.numeroCamiseta
  })

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Guardia: ffmpeg disponible ─────────────────────────────────────────────
  if (!ffmpegPath) {
    console.error('[analyze-video] ffmpegPath es null')
    return res.status(500).json({
      error: 'ffmpeg no disponible en este entorno serverless. Verifica que ffmpeg-static está instalado.',
      debug: { ffmpegPath, platform: process.platform, arch: process.arch }
    })
  }
  if (!fs.existsSync(ffmpegPath)) {
    console.error('[analyze-video] binario ffmpeg no encontrado en:', ffmpegPath)
    return res.status(500).json({
      error: `Binario ffmpeg no encontrado: ${ffmpegPath}`,
      debug: { ffmpegPath, platform: process.platform }
    })
  }

  // ── Guardia: body ──────────────────────────────────────────────────────────
  if (!req.body || typeof req.body !== 'object') {
    console.error('[analyze-video] req.body inválido, tipo:', typeof req.body)
    return res.status(400).json({
      error: 'Body del request no recibido o no es JSON. Verifica Content-Type y sizeLimit.',
      debug: { bodyType: typeof req.body, contentLength: req.headers['content-length'] }
    })
  }

  const { videoBase64, numeroCamiseta } = req.body

  if (!videoBase64 || typeof videoBase64 !== 'string' || videoBase64.length < 100) {
    console.error('[analyze-video] videoBase64 inválido, longitud:', videoBase64?.length ?? 0)
    return res.status(400).json({
      error: 'Video requerido. El campo videoBase64 está vacío o es inválido.',
      debug: { videoBase64Length: videoBase64?.length ?? 0 }
    })
  }
  if (!numeroCamiseta) {
    return res.status(400).json({ error: 'Número de camiseta requerido' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[analyze-video] ANTHROPIC_API_KEY no configurada')
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en variables de entorno' })
  }

  const tmpId = crypto.randomBytes(8).toString('hex')
  const tmpDir = path.join(os.tmpdir(), `fiq-${tmpId}`)

  try {
    fs.mkdirSync(tmpDir, { recursive: true })
    console.log('[analyze-video] tmpDir creado:', tmpDir)

    // ── PASO 1: Decodificar base64 → Buffer → disco ──────────────────────────
    let videoBuffer
    try {
      const base64Data = videoBase64.replace(/^data:video\/[^;]+;base64,/, '')
      videoBuffer = Buffer.from(base64Data, 'base64')
      const sizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1)
      console.log(`[analyze-video] PASO 1 OK — video decodificado: ${sizeMB} MB`)
    } catch (e) {
      console.error('[analyze-video] PASO 1 FAIL — error decodificando base64:', e.message)
      throw new Error('Error al decodificar el video base64: ' + e.message)
    }

    const videoPath = path.join(tmpDir, 'input.mp4')
    try {
      fs.writeFileSync(videoPath, videoBuffer)
      const stat = fs.statSync(videoPath)
      console.log(`[analyze-video] PASO 1 OK — archivo guardado: ${(stat.size / 1024 / 1024).toFixed(1)} MB en ${videoPath}`)
    } catch (e) {
      console.error('[analyze-video] PASO 1 FAIL — error escribiendo archivo:', e.message)
      throw new Error('Error al guardar el video en disco: ' + e.message)
    }

    // ── PASO 2: Obtener duración con ffmpeg ───────────────────────────────────
    let duration
    try {
      duration = getVideoDuration(videoPath)
      console.log(`[analyze-video] PASO 2 OK — duración: ${duration.toFixed(2)}s`)
    } catch (e) {
      console.error('[analyze-video] PASO 2 FAIL — getVideoDuration:', e.message)
      throw e
    }

    // ── PASO 3: Extraer frames con ffmpeg ─────────────────────────────────────
    const NUM_FRAMES = 8
    try {
      extractFrames(videoPath, tmpDir, NUM_FRAMES, duration)
      console.log('[analyze-video] PASO 3 OK — frames extraídos')
    } catch (e) {
      console.error('[analyze-video] PASO 3 FAIL — extractFrames:', e.message)
      throw e
    }

    // ── PASO 4: Leer JPEGs del disco ──────────────────────────────────────────
    let imageBlocks
    try {
      const frameFiles = fs.readdirSync(tmpDir)
        .filter(f => /^frame_\d+\.jpg$/.test(f))
        .sort()
      console.log(`[analyze-video] PASO 4 — archivos en tmpDir:`, frameFiles)

      if (frameFiles.length === 0) {
        throw new Error('ffmpeg no generó ningún frame JPEG en ' + tmpDir)
      }

      imageBlocks = frameFiles.slice(0, NUM_FRAMES).map(fname => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: fs.readFileSync(path.join(tmpDir, fname)).toString('base64')
        }
      }))
      console.log(`[analyze-video] PASO 4 OK — ${imageBlocks.length} frames listos para Claude`)
    } catch (e) {
      console.error('[analyze-video] PASO 4 FAIL:', e.message)
      throw e
    }

    // ── PASO 5: Llamar a Claude Vision ────────────────────────────────────────
    console.log('[analyze-video] PASO 5 — llamando Claude Vision con', imageBlocks.length, 'frames')
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
  "resumen": "síntesis ejecutiva en 2-3 frases del rendimiento general",
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
        const errBody = await response.text()
        console.error('[analyze-video] PASO 5 FAIL — Anthropic HTTP', response.status, errBody.slice(0, 200))
        throw new Error(`Anthropic API error ${response.status}: ${errBody.slice(0, 150)}`)
      }

      const claudeData = await response.json()
      const raw = (claudeData.content?.[0]?.text || '{}').trim()
      console.log('[analyze-video] PASO 5 — raw Claude response (100 chars):', raw.slice(0, 100))

      const jsonStr = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim()

      analisis = JSON.parse(jsonStr)
      console.log('[analyze-video] PASO 5 OK — análisis generado, jugador:', analisis.jugador)

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
  const result = spawnSync(ffmpegPath, ['-i', videoPath], {
    encoding: 'utf8',
    timeout: 15000
  })
  // ffmpeg siempre retorna exit code 1 cuando no hay output definido
  // La información de duración siempre va a stderr
  const output = result.stderr || ''
  console.log('[analyze-video] ffmpeg probe stderr (200 chars):', output.slice(0, 200))

  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
  if (!match) {
    console.error('[analyze-video] Duration no encontrado en stderr. spawnSync error:', result.error?.message)
    throw new Error('ffmpeg no pudo leer la duración del video. Verifica que el archivo sea MP4 válido.')
  }
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3])
}

function extractFrames(videoPath, outputDir, numFrames, duration) {
  const fps = (numFrames / duration).toFixed(8)
  console.log(`[analyze-video] extractFrames — fps=${fps}, duration=${duration.toFixed(2)}s, output=${outputDir}`)

  const args = [
    '-i', videoPath,
    '-vf', `fps=${fps},scale=960:-2:flags=fast_bilinear`,
    '-frames:v', String(numFrames),
    '-q:v', '3',
    '-f', 'image2',
    path.join(outputDir, 'frame_%03d.jpg')
  ]
  console.log('[analyze-video] ffmpeg args:', args.join(' '))

  const result = spawnSync(ffmpegPath, args, {
    timeout: 120000,
    encoding: 'utf8'
  })

  console.log('[analyze-video] ffmpeg extractFrames status:', result.status)
  if (result.error) {
    console.error('[analyze-video] ffmpeg extractFrames spawnSync error:', result.error.message)
    throw result.error
  }
  if (result.stderr) {
    console.log('[analyze-video] ffmpeg extractFrames stderr (last 300):', result.stderr.slice(-300))
  }

  const created = fs.readdirSync(outputDir).filter(f => /^frame_/.test(f))
  console.log('[analyze-video] frames creados:', created.length, created)

  if (created.length === 0) {
    const lastStderr = (result.stderr || '').split('\n').slice(-8).join('\n')
    throw new Error(`ffmpeg no extrajo frames (exit ${result.status}).\nÚltimas líneas: ${lastStderr}`)
  }
}
