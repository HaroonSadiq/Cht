import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../lib/db';
import { requireUser } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;

  if (req.method !== 'GET') return res.status(405).end();

  const take = Math.min(parseInt(String(req.query.take ?? '50'), 10) || 50, 200);
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;

  const contacts = await db.contact.findMany({
    where: {
      connectedAccount: { workspace: { ownerId: userId } },
      ...(q && { displayName: { contains: q, mode: 'insensitive' } }),
    },
    orderBy: [{ lastInboundAt: { sort: 'desc', nulls: 'last' } }],
    take,
    include: {
      connectedAccount: { select: { platform: true, displayName: true } },
      contactTags: { include: { tag: true } },
    },
  });

  return res.status(200).json(contacts);
}
