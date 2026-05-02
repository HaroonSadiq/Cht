// TikTok webhook ingress — limited API surface. Currently: comment events +
// TikTok Shop CS messages. Signature header: `TikTok-Signature`.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { enqueueInbound, markSeen } from '@/lib/redis';

export const config = { api: { bodyParser: false } };

async function readRaw(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

function verifyTikTokSignature(raw: string, header: string | null): boolean {
  if (!header) return false;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const raw = await readRaw(req);
  const sig = req.headers['tiktok-signature'];

  if (!verifyTikTokSignature(raw, Array.isArray(sig) ? sig[0] : sig ?? null)) {
    return res.status(401).send('Invalid signature');
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return res.status(400).send('Bad JSON'); }

  const idempotencyKey = payload?.event_id ?? `tt:${Date.now()}:${Math.random()}`;
  const fresh = await markSeen(idempotencyKey);
  if (!fresh) return res.status(200).send('OK');

  await enqueueInbound({
    idempotencyKey,
    platform: 'tiktok',
    receivedAt: Date.now(),
    payload,
  });

  return res.status(200).send('OK');
}
