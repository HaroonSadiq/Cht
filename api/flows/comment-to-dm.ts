// Comment-to-DM convenience endpoint.
// One client, one page, one keyword, one DM message. Strictly per-tenant.
// If the same client already has an active flow on this page using the same
// keyword, we refuse to create — keywords are unique per (client, page).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { resolveOwnedAccount, normalizeKeywords, findKeywordConflicts } from '../../lib/tenancy';

const Body = z.object({
  connectedAccountId: z.string().uuid(),
  keyword:     z.string().min(1).max(80),
  dmText:      z.string().min(1).max(2000),
  publicReply: z.string().max(1000).optional(),
  postIds:     z.array(z.string()).optional(),  // omit / empty = all posts
  name:        z.string().min(1).max(120).optional(),
  matchType:   z.enum(['exact', 'contains', 'keyword_any']).default('contains'),
  activate:    z.boolean().default(true),
  // Default 3-day validity per the brief; null disables the auto-expire.
  validityDays: z.union([z.number().int().min(1).max(365), z.null()]).default(3),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const userId = await requireUser(req, res);
  if (!userId) return;

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
  const data = parsed.data;

  // ─── Tenancy guard: this user must own this integration ────────
  const account = await resolveOwnedAccount({ userId, connectedAccountId: data.connectedAccountId });
  if (!account) return res.status(404).json({ error: 'Integration not found for this client' });
  if (account.platform !== 'facebook' && account.platform !== 'instagram') {
    return res.status(400).json({ error: 'Comment-to-DM is supported on Facebook and Instagram only' });
  }

  // ─── Per-client keyword uniqueness ─────────────────────────────
  // Two active flows on the SAME page can't share a keyword (they'd both fire).
  // Different clients on different pages CAN reuse the same keyword — they have
  // separate audiences, so no conflict.
  const keywords = normalizeKeywords([data.keyword]);
  if (data.activate) {
    const conflicts = await findKeywordConflicts({
      connectedAccountId: account.id,
      keywords,
    });
    if (conflicts.length) {
      return res.status(409).json({
        error: 'keyword_already_in_use',
        message: `Your page "${account.displayName}" already has an active flow using this keyword.`,
        conflicts,
      });
    }
  }

  const flowName = data.name ?? `Comment-to-DM · "${data.keyword}"`;
  const validUntilAt =
    data.validityDays === null
      ? null
      : new Date(Date.now() + data.validityDays * 86_400_000);

  const flow = await db.$transaction(async (tx) => {
    const f = await tx.flow.create({
      data: {
        connectedAccountId: account.id,
        name: flowName,
        triggerType: 'comment',
        triggerConfig: {
          patterns:    [data.keyword],
          match_type:  data.matchType,
          channel:     'comment',
          post_ids:    data.postIds && data.postIds.length ? data.postIds : 'all',
          public_reply: data.publicReply ?? null,
        } as any,
        keywords,
        isActive: data.activate,
        priority: 100,
        validUntilAt,
      },
    });

    await tx.flowStep.create({
      data: {
        flowId: f.id,
        stepType: 'send_message',
        config: { content: { text: data.dmText } } as any,
        position: { x: 0, y: 0 } as any,
        nextStepId: null,
      },
    });

    return f;
  });

  return res.status(201).json({
    id: flow.id,
    name: flow.name,
    isActive: flow.isActive,
    keywords: flow.keywords,
    scope: {
      // make tenancy explicit in the response so the caller can verify
      workspace_id:   account.workspaceId,
      integration_id: account.id,
      platform:       account.platform,
      page_id:        account.platformAccountId,
      page_name:      account.displayName,
    },
    triggerConfig: flow.triggerConfig,
    validity: {
      valid_from_at:  flow.validFromAt.toISOString(),
      valid_until_at: flow.validUntilAt?.toISOString() ?? null,
      valid_for_days: data.validityDays,
      expires_in_seconds: flow.validUntilAt
        ? Math.max(0, Math.floor((flow.validUntilAt.getTime() - Date.now()) / 1000))
        : null,
    },
    note: data.activate
      ? `Live on "${account.displayName}" for ${data.validityDays ?? 'unlimited'} days. When YOUR audience comments "${data.keyword}", they get YOUR DM.`
      : 'Created in draft. Toggle isActive=true to start receiving triggers.',
  });
}
