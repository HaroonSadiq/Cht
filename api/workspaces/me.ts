// GET /api/workspaces/me — first owned workspace + counts (cards on dashboard).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../lib/db';
import { requireUser } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const userId = await requireUser(req, res);
  if (!userId) return;

  const workspace = await db.workspace.findFirst({
    where: { ownerId: userId },
    include: {
      _count: { select: { connectedAccounts: true, tags: true } },
    },
  });
  if (!workspace) return res.status(404).json({ error: 'No workspace' });

  return res.status(200).json({
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    created_at: workspace.createdAt.toISOString(),
    counts: {
      integrations: workspace._count.connectedAccounts,
      tags:         workspace._count.tags,
    },
  });
}
