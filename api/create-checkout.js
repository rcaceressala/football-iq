export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers['authorization']?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Falta token de sesion' })

  const { variant_id, user_id } = req.body ?? {}
  if (!variant_id || !user_id) return res.status(400).json({ error: 'variant_id y user_id requeridos' })

  const apiKey = process.env.LEMON_API_KEY
  const storeId = process.env.LEMON_STORE_ID

  const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json'
    },
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: { custom: { user_id } }
        },
        relationships: {
          store: { data: { type: 'stores', id: String(storeId) } },
          variant: { data: { type: 'variants', id: String(variant_id) } }
        }
      }
    })
  })

  const json = await response.json()
  if (!response.ok) return res.status(500).json({ error: 'Error creando checkout', details: json })

  return res.status(200).json({ url: json.data?.attributes?.url })
}
