import { supabase } from './supabaseClient.js'

// Enviar mensaje al coach y guardar sesión
export async function consultarCoach({ jugador_id, modo, mensaje_usuario, openaiApiKey }) {
  // Llamada a OpenAI
  const prompt = buildPrompt(modo, mensaje_usuario)

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiApiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Eres Football IQ, un coach de fútbol inteligente especializado en análisis táctico y mejora de jugadores.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7
    })
  })

  const json = await res.json()
  const respuesta = json.choices[0].message.content

  // Guardar sesión en Supabase
  const { error } = await supabase.from('sesiones').insert([{
    jugador_id,
    modo,
    mensaje_usuario,
    respuesta_coach: { texto: respuesta }
  }])
  if (error) throw error

  return respuesta
}

// Registrar o incrementar error detectado
export async function registrarError(jugador_id, error_texto) {
  const { data: existing } = await supabase
    .from('errores')
    .select('*')
    .eq('jugador_id', jugador_id)
    .eq('error_texto', error_texto)
    .single()

  if (existing) {
    await supabase.from('errores')
      .update({ frecuencia: existing.frecuencia + 1, ultima_vez: new Date() })
      .eq('id', existing.id)
  } else {
    await supabase.from('errores').insert([{ jugador_id, error_texto }])
  }
}

// Obtener historial de sesiones
export async function getHistorial(jugador_id) {
  const { data } = await supabase
    .from('sesiones')
    .select('*')
    .eq('jugador_id', jugador_id)
    .order('created_at', { ascending: false })
    .limit(20)
  return data
}

// Obtener errores frecuentes
export async function getErrores(jugador_id) {
  const { data } = await supabase
    .from('errores')
    .select('*')
    .eq('jugador_id', jugador_id)
    .order('frecuencia', { ascending: false })
  return data
}

function buildPrompt(modo, mensaje) {
  const modos = {
    'analisis': `Analiza la siguiente situación táctica de un jugador: ${mensaje}`,
    'entrenamiento': `Diseña un plan de entrenamiento para: ${mensaje}`,
    'errores': `Identifica y explica los errores tácticos en: ${mensaje}`,
    'partido': `Analiza este partido o jugada: ${mensaje}`
  }
  return modos[modo] || mensaje
}