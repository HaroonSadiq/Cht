import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../../lib/db';
import { issueSession, setSessionCookie } from '../../lib/auth';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Bad request' });

  const { email, password } = parsed.data;
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = await issueSession(user.id);
  setSessionCookie(res, token);

  return res.status(200).json({ id: user.id, email: user.email, name: user.name });
}
