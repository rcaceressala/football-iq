export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { frames, numeroCamiseta } = req.body

  if (!frames || !Array.isArray(frames) || frames.length === 0) {
    return res.status(400).json({ error: 'Se requieren frames del video' })
  }
  if (!numeroCamiseta) {
    return res.status(400).json({ error: 'Número de camiseta requerido' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' })
  }

  // Construir bloques de imagen para la API de Claude Vision
  const imageBlocks = frames.map(frame => {
    const base64Data = frame.replace(/^data:image\/\w+;base64,/, '')
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: base64Data
      }
    }
  })

  const textBlock = {
    type: 'text',
    text: `Analiza al jugador con camiseta número ${numeroCamiseta} en estos ${frames.length} frames de video de fútbol.

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
    {
      "nombre": "nombre del ejercicio",
      "objetivo": "qué aspecto concreto mejora",
      "descripcion": "cómo realizarlo paso a paso en 2-3 frases"
    },
    {
      "nombre": "nombre del ejercicio",
      "objetivo": "qué aspecto concreto mejora",
      "descripcion": "cómo realizarlo paso a paso en 2-3 frases"
    },
    {
      "nombre": "nombre del ejercicio",
      "objetivo": "qué aspecto concreto mejora",
      "descripcion": "cómo realizarlo paso a paso en 2-3 frases"
    }
  ]
}

Si el jugador no es claramente visible en los frames, indícalo en el resumen y ofrece un análisis general del equipo.`
  }

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
Tu especialidad es el análisis frame a frame: posicionamiento en el campo, movimiento sin balón, timing defensivo y ofensivo, cobertura de espacios, presión al portador, toma de decisiones, técnica individual y comunicación táctica.
Identificas a cada jugador por su número de camiseta y analizas ÚNICAMENTE sus acciones y comportamiento táctico.
Eres específico, técnico y siempre das feedback accionable. Nunca genérico.
Responde SIEMPRE en español con terminología técnica futbolística precisa.
DEVUELVE ÚNICAMENTE JSON VÁLIDO. Sin markdown, sin texto previo ni posterior, sin bloques de código.`,
        messages: [
          {
            role: 'user',
            content: [...imageBlocks, textBlock]
          }
        ]
      })
    })

    if (!response.ok) {
      const err = await response.json()
      console.error('[analyze-video] Anthropic error:', err)
      return res.status(response.status).json({ error: err.error?.message || 'Error en Anthropic API' })
    }

    const data = await response.json()
    const raw = (data.content?.[0]?.text || '{}').trim()

    // Limpiar posible markdown wrapper
    const jsonStr = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    let analisis
    try {
      analisis = JSON.parse(jsonStr)
    } catch (parseErr) {
      console.error('[analyze-video] JSON parse error. Raw:', raw)
      return res.status(500).json({ error: 'Error al parsear la respuesta del coach IA.' })
    }

    return res.status(200).json({ analisis })

  } catch (err) {
    console.error('[analyze-video] Error:', err)
    return res.status(500).json({ error: 'Error al analizar el video: ' + err.message })
  }
}
