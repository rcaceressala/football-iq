async function getUserFromToken(accessToken) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user || !user.id) return null;
  return { id: user.id, email: user.email || '' };
}
function variantForPlan(plan) {
  if (plan === 'pro')  return process.env.LEMON_VARIANT_ID_PRO;
  if (plan === 'team') return process.env.LEMON_VARIANT_ID_TEAM;
  return null;
}
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const authHeader = req.headers['authorization'] || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Falta token de sesion' });
  const user = await getUserFromToken(accessToken);
  if (!user) return res.status(401).json({ error: 'Sesion invalida' });
  const plan = req.body?.plan;
  const variantId = variantForPlan(plan);
  if (!variantId) return res.status(400).json({ error: "Plan invalido (usa 'pro' o 'team')" });
  const payload = {
    data: {
      type: 'checkouts',
      attributes: { checkout_data: { email: user.email, custom: { user_id: user.id } } },
      relationships: {
        store:   { data: { type: 'stores',   id: String(process.env.LEMON_STORE_ID) } },
        variant: { data: { type: 'variants', id: String(variantId) } },
      },
    },
  };
  let lsRes;
  try {
    lsRes = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}` },
      body: JSON.stringify(payload),
    });
  } catch (e) { return res.status(502).json({ error: 'No se pudo contactar a Lemon Squeezy' }); }
  if (!lsRes.ok) { const t = await lsRes.text(); console.error('[create-checkout] LS', lsRes.status, t); return res.status(502).json({ error: 'Lemon Squeezy rechazo el checkout' }); }
  const data = await lsRes.json();
  const url = data?.data?.attributes?.url;
  if (!url) return res.status(502).json({ error: 'Checkout sin URL' });
  return res.status(200).json({ url });
}
