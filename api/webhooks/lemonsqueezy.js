import crypto from 'crypto';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function planFromVariant(variantId) {
  const v = String(variantId);
  if (v === String(process.env.LEMON_VARIANT_ID_PRO))  return 'pro';
  if (v === String(process.env.LEMON_VARIANT_ID_TEAM)) return 'team';
  return null;
}

async function upsertSubscription(row) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/subscriptions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([row]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase upsert fallo (${res.status}): ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let rawBody;
  try { rawBody = await readRawBody(req); }
  catch (e) { return res.status(400).json({ error: 'No se pudo leer el cuerpo' }); }

  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  const signature = req.headers['x-signature'];
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const valid = typeof signature === 'string'
    && signature.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return res.status(401).json({ error: 'Firma invalida' });

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return res.status(400).json({ error: 'JSON invalido' }); }

  const eventName  = payload?.meta?.event_name;
  const customData = payload?.meta?.custom_data || {};
  const data       = payload?.data;
  const attrs      = data?.attributes || {};

  const lifecycle = ['subscription_created','subscription_updated','subscription_cancelled','subscription_resumed','subscription_expired','subscription_paused','subscription_unpaused'];
  if (!lifecycle.includes(eventName)) return res.status(200).json({ ignored: eventName || 'unknown' });

  const plan = planFromVariant(attrs.variant_id);
  if (!plan) {
    console.error('[LS webhook] variant no mapeada:', attrs.variant_id, '| evento:', eventName);
    return res.status(200).json({ warning: 'variant no mapeada' });
  }

  const row = {
    id: data.id,
    customer_id: attrs.customer_id,
    variant_id: attrs.variant_id,
    plan,
    status: attrs.status,
    renews_at: attrs.renews_at || null,
    ends_at: attrs.ends_at || null,
    trial_ends_at: attrs.trial_ends_at || null,
    updated_at: new Date().toISOString(),
  };
  if (customData.user_id) row.user_id = customData.user_id;

  try { await upsertSubscription(row); }
  catch (e) {
    console.error('[LS webhook] error al guardar:', e.message);
    return res.status(500).json({ error: 'Error al guardar' });
  }
  return res.status(200).json({ ok: true, event: eventName });
}
