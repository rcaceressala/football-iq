import crypto from 'crypto'

export const config = { api: { bodyParser: false } }

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const PLAN_MAP = { '1713741': 'pro', '1713749': 'team' }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const rawBody = await getRawBody(req)
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET
  const sig = req.headers['x-signature']
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  if (hmac !== sig) return res.status(401).json({ error: 'Invalid signature' })

  const { meta, data } = JSON.parse(rawBody.toString())
  const event = meta?.event_name
  const userId = meta?.custom_data?.user_id
  if (!userId) return res.status(400).json({ error: 'user_id requerido' })

  const attrs = data?.attributes
  const variantId = String(attrs?.variant_id ?? '')

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (['subscription_created', 'subscription_updated', 'subscription_resumed'].includes(event)) {
    await fetch(`${supabaseUrl}/rest/v1/subscriptions`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        user_id: userId,
        customer_id: String(attrs?.customer_id ?? ''),
        variant_id: variantId,
        plan: PLAN_MAP[variantId] ?? 'unknown',
        status: attrs?.status,
        renews_at: attrs?.renews_at ?? null,
        ends_at: attrs?.ends_at ?? null,
        trial_ends_at: attrs?.trial_ends_at ?? null,
        updated_at: new Date().toISOString()
      })
    })
  } else if (['subscription_cancelled', 'subscription_expired'].includes(event)) {
    await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: attrs?.status,
        ends_at: attrs?.ends_at ?? null,
        updated_at: new Date().toISOString()
      })
    })
  }

  return res.status(200).json({ received: true })
}
