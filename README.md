# Football IQ — Coach cognitivo élite

El primer coach de inteligencia táctica diseñado para el jugador.

## Deploy en Vercel (3 pasos)

### 1. Sube a GitHub
```bash
git init
git add .
git commit -m "Football IQ v1.0"
git remote add origin https://github.com/TU_USUARIO/football-iq.git
git push -u origin main
```

### 2. Conecta Vercel
1. Ve a vercel.com → New Project
2. Importa tu repositorio de GitHub
3. Click Deploy (sin cambiar nada)

### 3. Configura la API Key
En Vercel → Settings → Environment Variables:
```
ANTHROPIC_API_KEY = sk-ant-...tu-key...
```

> ⚠️ IMPORTANTE: La API key se usa directamente desde el browser en esta versión MVP.
> Para producción real, crear un backend proxy en /api/chat

## Estructura del proyecto

```
football-iq/
├── index.html      ← Landing page
├── app.html        ← App completa (coach + esquemas + físico)
├── vercel.json     ← Config de rutas
├── package.json    ← Metadata
└── README.md       ← Este archivo
```

## URLs después del deploy

- `/` → Landing page
- `/app` → App del coach

## Stack

- Frontend: HTML + CSS + JS puro (sin frameworks)
- IA: Claude API (Anthropic Sonnet)
- Deploy: Vercel (estático)
- DB: Pendiente → Supabase (Fase 2)

## Próximos pasos

1. ✅ Deploy en Vercel
2. ⏳ Supabase — auth + perfiles persistentes  
3. ⏳ Memoria de errores entre sesiones
4. ⏳ Arquitectura multi-agente
5. 🔮 Análisis de video (Fase 2)
