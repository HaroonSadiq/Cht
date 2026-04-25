// POST /api/flows/[id]/extend  body: { days?: number, until?: ISO datetime }
// Extends the validity window of an existing flow. Tenant-scoped.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/auth';

const Body = z.object({
  days:  z.number().int().min(1).max(365).optional(),
  until: z.string().datetime().optional(),
}).refine((b) => b.days || b.until, { message: 'Provide either `days` or `until`' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const userId = await requireUser(req, res);
  if (!userId) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  // Tenant scope: must own this flow
  const flow = await db.flow.findFirst({
    where: { id, connectedAccount: { workspace: { ownerId: userId } } },
  });
  if (!flow) return res.status(404).json({ error: 'Flow not found' });

  let newUntil: Date;
  if (parsed.data.until) {
    newUntil = new Date(parsed.data.until);
  } else {
    // Extend from MAX(now, currentValidUntil) so calling extend on an expired
    // flow gives a fresh window, not one that ended in the past.
    const base = flow.validUntilAt && flow.validUntilAt > new Date() ? flow.validUntilAt : new Date();
    newUntil = new Date(base.getTime() + (parsed.data.days! * 86_400_000));
  }

  const updated = await db.flow.update({
    where: { id: flow.id },
    data:  { validUntilAt: newUntil, isActive: true }, // re-activate if it had auto-expired
  });

  return res.status(200).json({
    id: updated.id,
    isActive: updated.isActive,
    valid_until_at: updated.validUntilAt?.toISOString() ?? null,
    expires_in_seconds: updated.validUntilAt
      ? Math.max(0, Math.floor((updated.validUntilAt.getTime() - Date.now()) / 1000))
      : null,
  });
}
