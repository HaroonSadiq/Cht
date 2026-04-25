// POST /api/auth/signout — clear the session cookie.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearSessionCookie } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
