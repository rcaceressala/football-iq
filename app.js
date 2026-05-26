import { registrarJugador, loginJugador, logoutJugador, getJugadorActual } from './auth.js'
import { consultarCoach, registrarError, getErrores } from './coach.js'

// Configura tu API key en el backend, nunca en el frontend
const OPENAI_KEY = ''

let jugadorActual = null
let modoActual = 'analisis'

// Inicializar app
window.addEventListener('load', async () => {
  jugadorActual = await getJugadorActual()
  if (jugadorActual) mostrarCoach()
})

// Auth tabs
window.mostrarTab = (tab) => {
  document.getElementById('form-login').classList.toggle('oculto', tab !== 'login')
  document.getElementById('form-registro').classList.toggle('oculto', tab !== 'registro')
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('activo'))
  event.target.classList.add('activo')
}

// Login
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault()
  const email = document.getElementById('login-email').value
  const pass = document.getElementById('login-pass').value
  try {
    await loginJugador(email, pass)
    jugadorActual = await getJugadorActual()
    mostrarCoach()
  } catch (err) {
    document.getElementById('auth-msg').textContent = err.message
  }
})

// Registro
document.getElementById('form-registro').addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await registrarJugador({
      email: document.getElementById('reg-email').value,
      nombre: document.getElementById('reg-nombre').value,
      posicion: document.getElementById('reg-posicion').value,
      formato: document.getElementById('reg-formato').value,
      nivel: document.getElementById('reg-nivel').value
    })
    document.getElementById('auth-msg').textContent = '¡Registrado! Revisa tu email para confirmar.'
  } catch (err) {
    document.getElementById('auth-msg').textContent = err.message
  }
})

// Modos del coach
document.querySelectorAll('.modo-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.modo-btn').forEach(b => b.classList.remove('activo'))
    btn.classList.add('activo')
    modoActual = btn.dataset.modo
  })
})

// Enviar mensaje
document.getElementById('btn-enviar').addEventListener('click', async () => {
  const msg = document.getElementById('input-msg').value.trim()
  if (!msg || !jugadorActual) return

  agregarMensaje('tú', msg)
  document.getElementById('input-msg').value = ''
  agregarMensaje('coach', '...')

  try {
    const respuesta = await consultarCoach({
      jugador_id: jugadorActual.id,
      modo: modoActual,
      mensaje_usuario: msg,
      openaiApiKey: OPENAI_KEY
    })
    const msgs = document.querySelectorAll('.msg-coach')
    msgs[msgs.length - 1].textContent = respuesta

    if (modoActual === 'errores') {
      await registrarError(jugadorActual.id, msg)
      cargarErrores()
    }
  } catch (err) {
    console.error(err)
  }
})

function agregarMensaje(quien, texto) {
  const div = document.createElement('div')
  div.className = quien === 'tú' ? 'msg-user' : 'msg-coach'
  div.textContent = texto
  document.getElementById('mensajes').appendChild(div)
  div.scrollIntoView()
}

async function cargarErrores() {
  const errores = await getErrores(jugadorActual.id)
  const lista = document.getElementById('lista-errores')
  lista.innerHTML = errores.map(e =>
    `<li>${e.error_texto} <span class="badge">${e.frecuencia}x</span></li>`
  ).join('')
  document.getElementById('panel-errores').classList.remove('oculto')
}

function mostrarCoach() {
  document.getElementById('pantalla-auth').classList.add('oculto')
  document.getElementById('pantalla-coach').classList.remove('oculto')
  document.getElementById('saludo').textContent = `Hola, ${jugadorActual?.nombre || 'jugador'} ⚽`
}

window.logout = async () => {
  await logoutJugador()
  location.reload()
}