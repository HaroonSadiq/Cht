// GET /api/auth/me — returns current user + their first workspace.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../lib/db';
import { getSession } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const s = await getSession(req);
  if (!s) return res.status(401).json({ error: 'Unauthorized' });

  const user = await db.user.findUnique({
    where: { id: s.userId },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  if (!user) return res.status(401).json({ error: 'User not found' });

  const workspace = await db.workspace.findFirst({
    where: { ownerId: user.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, slug: true, name: true },
  });

  return res.status(200).json({ user, workspace });
}
