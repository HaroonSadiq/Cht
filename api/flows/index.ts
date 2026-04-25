import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { resolveOwnedAccount, normalizeKeywords, findKeywordConflicts } from '../../lib/tenancy';

const CreateFlow = z.object({
  connectedAccountId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  triggerType: z.enum(['keyword','comment','story_reply','story_mention','new_follow','ref_url','manual','scheduled','ai_intent']),
  triggerConfig: z.record(z.unknown()).default({}),
  priority: z.number().int().min(0).max(1000).default(100),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    // Optional filter: ?connectedAccountId=... scopes to a single integration.
    const cid = typeof req.query.connectedAccountId === 'string' ? req.query.connectedAccountId : undefined;
    const flows = await db.flow.findMany({
      where: {
        connectedAccount: { workspace: { ownerId: userId } },
        ...(cid && { connectedAccountId: cid }),
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, name: true, isActive: true, priority: true,
        triggerType: true, triggerConfig: true, keywords: true,
        connectedAccountId: true, createdAt: true, updatedAt: true,
        _count: { select: { steps: true, runs: true } },
      },
    });
    return res.status(200).json(flows);
  }

  if (req.method === 'POST') {
    const parsed = CreateFlow.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

    // Tenancy guard
    const account = await resolveOwnedAccount({ userId, connectedAccountId: parsed.data.connectedAccountId });
    if (!account) return res.status(404).json({ error: 'Integration not found for this client' });

    // Extract keywords from triggerConfig.patterns for the per-page keyword index.
    const patterns = (parsed.data.triggerConfig as any)?.patterns;
    const keywords = normalizeKeywords(patterns);

    // Per-client keyword uniqueness check (only for keyword/comment triggers).
    const needsUniqCheck = ['keyword', 'comment'].includes(parsed.data.triggerType);
    if (needsUniqCheck && keywords.length) {
      const conflicts = await findKeywordConflicts({
        connectedAccountId: account.id,
        keywords,
      });
      if (conflicts.length) {
        return res.status(409).json({
          error: 'keyword_already_in_use',
          message: `Your page "${account.displayName}" already has an active flow using one of these keywords.`,
          conflicts,
        });
      }
    }

    const flow = await db.flow.create({
      data: {
        connectedAccountId: account.id,
        name: parsed.data.name,
        description: parsed.data.description,
        triggerType: parsed.data.triggerType,
        triggerConfig: parsed.data.triggerConfig as any,
        keywords,
        priority: parsed.data.priority,
        isActive: false, // always off by default — owner toggles after review
      },
    });
    return res.status(201).json({
      ...flow,
      scope: {
        workspace_id:   account.workspaceId,
        integration_id: account.id,
        page_id:        account.platformAccountId,
        page_name:      account.displayName,
      },
    });
  }

  res.status(405).json({ error: 'Method Not Allowed' });
}
