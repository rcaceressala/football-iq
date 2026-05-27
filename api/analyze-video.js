import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import ffmpegPath from 'ffmpeg-static'

// Aumentar límite: video 50MB → base64 ~67MB → margen hasta 75MB
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '75mb'
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { videoBase64, numeroCamiseta } = req.body

  if (!videoBase64) {
    return res.status(400).json({ error: 'Video requerido (videoBase64)' })
  }
  if (!numeroCamiseta) {
    return res.status(400).json({ error: 'Número de camiseta requerido' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' })
  }

  // Directorio temporal único para este request
  const tmpId = crypto.randomBytes(8).toString('hex')
  const tmpDir = path.join(os.tmpdir(), `fiq-${tmpId}`)

  try {
    fs.mkdirSync(tmpDir, { recursive: true })

    // ── 1. Decodificar base64 y guardar video en disco ──────────────────────
    const base64Data = videoBase64.replace(/^data:video\/[^;]+;base64,/, '')
    const videoBuffer = Buffer.from(base64Data, 'base64')
    const videoPath = path.join(tmpDir, 'input.mp4')
    fs.writeFileSync(videoPath, videoBuffer)
    console.log(`[analyze-video] Video guardado: ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`)

    // ── 2. Obtener duración con ffmpeg ──────────────────────────────────────
    const duration = getVideoDuration(videoPath)
    console.log(`[analyze-video] Duración: ${duration.toFixed(2)}s`)

    // ── 3. Extraer 8 frames uniformemente distribuidos ──────────────────────
    const NUM_FRAMES = 8
    extractFrames(videoPath, tmpDir, NUM_FRAMES, duration)

    // ── 4. Leer los JPEGs generados por ffmpeg ──────────────────────────────
    const frameFiles = fs.readdirSync(tmpDir)
      .filter(f => /^frame_\d+\.jpg$/.test(f))
      .sort()

    console.log(`[analyze-video] Frames extraídos: ${frameFiles.length}`)

    if (frameFiles.length === 0) {
      throw new Error('ffmpeg no generó ningún frame')
    }

    const imageBlocks = frameFiles.slice(0, NUM_FRAMES).map(fname => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: fs.readFileSync(path.join(tmpDir, fname)).toString('base64')
      }
    }))

    // ── 5. Llamar a Claude Vision ───────────────────────────────────────────
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
Tu especialidad es el análisis frame a frame: posicionamiento en el campo, movimiento sin balón, timing defensivo y ofensivo, cobertura de espacios, presión al portador, toma de decisiones y técnica individual.
Identificas al jugador por su número de camiseta y analizas ÚNICAMENTE sus acciones y comportamiento táctico.
Eres específico, técnico y accionable. Nunca genérico.
Responde SIEMPRE en español con terminología técnica futbolística precisa.
DEVUELVE ÚNICAMENTE JSON VÁLIDO. Sin markdown, sin texto previo ni posterior, sin bloques de código.`,
        messages: [{
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: `Analiza al jugador con camiseta número ${numeroCamiseta} en estos ${imageBlocks.length} frames extraídos con ffmpeg del video de fútbol.

Devuelve EXCLUSIVAMENTE JSON válido sin markdown con esta estructura exacta:
{
  "jugador": "Camiseta #${numeroCamiseta}",
  "resumen": "síntesis ejecutiva en 2-3 frases del rendimiento general del jugador",
  "fortalezas": [
    "fortaleza táctica/técnica concreta y específica 1",
    "fortaleza concreta 2",
    "fortaleza concreta 3"
  ],
  "areas_mejora": [
    "área de mejora concreta y accionable 1",
    "área concreta 2",
    "área concreta 3"
  ],
  "ejercicios": [
    {"nombre": "nombre del ejercicio", "objetivo": "qué aspecto concreto mejora", "descripcion": "cómo realizarlo en 2-3 frases"},
    {"nombre": "nombre del ejercicio", "objetivo": "qué aspecto concreto mejora", "descripcion": "cómo realizarlo en 2-3 frases"},
    {"nombre": "nombre del ejercicio", "objetivo": "qué aspecto concreto mejora", "descripcion": "cómo realizarlo en 2-3 frases"}
  ]
}

Si el jugador no es claramente visible, indícalo en el resumen y analiza al equipo en general.`
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error?.message || 'Error en Anthropic API')
    }

    const claudeData = await response.json()
    const raw = (claudeData.content?.[0]?.text || '{}').trim()
    const jsonStr = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    let analisis
    try {
      analisis = JSON.parse(jsonStr)
    } catch (parseErr) {
      console.error('[analyze-video] JSON parse error. Raw:', raw.slice(0, 200))
      throw new Error('Error al parsear la respuesta del coach IA')
    }

    return res.status(200).json({ analisis })

  } catch (err) {
    console.error('[analyze-video] Error:', err.message)
    return res.status(500).json({ error: err.message })
  } finally {
    // Limpiar archivos temporales
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Obtiene la duración del video en segundos usando ffmpeg.
 * ffmpeg -i sin output siempre retorna código 1, pero escribe info en stderr.
 */
function getVideoDuration(videoPath) {
  const result = spawnSync(ffmpegPath, ['-i', videoPath], {
    encoding: 'utf8',
    timeout: 15000
  })
  // La info siempre está en stderr (comportamiento normal de ffmpeg)
  const output = result.stderr || ''
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
  if (!match) {
    throw new Error('No se pudo leer la duración del video. Verifica que el archivo sea válido.')
  }
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3])
}

/**
 * Extrae numFrames frames distribuidos uniformemente con ffmpeg.
 * fps=N/DURACION → exactamente N frames a lo largo del video.
 * scale=960:-2 → máx 960px ancho, altura par proporcional.
 */
function extractFrames(videoPath, outputDir, numFrames, duration) {
  const fps = (numFrames / duration).toFixed(8)

  const result = spawnSync(ffmpegPath, [
    '-i', videoPath,
    '-vf', `fps=${fps},scale=960:-2:flags=fast_bilinear`,
    '-frames:v', String(numFrames),
    '-q:v', '3',          // calidad JPEG (1=mejor, 31=peor) — 3 es alta calidad
    '-f', 'image2',
    path.join(outputDir, 'frame_%03d.jpg')
  ], {
    timeout: 120000,      // 2 min máx para videos largos
    encoding: 'utf8'
  })

  if (result.error) {
    throw result.error
  }

  // ffmpeg puede retornar != 0 incluso en éxito; verificar que creó archivos
  const created = fs.readdirSync(outputDir).filter(f => /^frame_/.test(f))
  if (created.length === 0) {
    const stderr = (result.stderr || '').split('\n').slice(-8).join('\n')
    throw new Error(`ffmpeg no extrajo frames.\n${stderr}`)
  }
}
