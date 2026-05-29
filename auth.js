import { supabase } from './supabaseClient.js'

// Registro de jugador
export async function registrarJugador({ email, password, nombre, posicion, formato, nivel }) {
  // 1. Crear usuario en Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({ email, password })
  if (authError) throw authError

  if (!authData.session) {
    // Email confirmation required — profile will be created after confirmation
    return null
  }

  // 2. Insertar perfil en tabla jugadores (solo si hay sesión activa)
  const { data, error } = await supabase.from('jugadores').insert([{
    id: authData.session.user.id,
    email,
    nombre,
    posicion,
    formato,
    nivel
  }])
  if (error) throw error
  return data
}

// Login
export async function loginJugador(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

// Logout
export async function logoutJugador() {
  await supabase.auth.signOut()
}

// Obtener jugador actual
export async function getJugadorActual() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase.from('jugadores').select('*').eq('id', user.id).single()
  return data
}