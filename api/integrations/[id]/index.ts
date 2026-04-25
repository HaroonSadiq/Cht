// GET    /api/integrations/[id] — full detail of one integration
// PATCH  /api/integrations/[id] — pause/resume (status: active|revoked)
// DELETE /api/integrations/[id] — disconnect: revoke webhook + delete row

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/auth';
import { decryptToken } from '../../../lib/crypto';

const PatchBody = z.object({
  status: z.enum(['active', 'revoked']).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const account = await db.connectedAccount.findFirst({
    where: { id, workspace: { ownerId: userId } },
    include: { workspace: true, _count: { select: { flows: true, contacts: true } } },
  });
  if (!account) return res.status(404).json({ error: 'Integration not found' });

  if (req.method === 'GET') {
    return res.status(200).json({
      integration: {
        platform:           account.platform,
        integration_id:     account.integrationId,
        workspace_id:       account.workspace.slug,
        page_id:            account.platformAccountId,
        page_name:          account.displayName,
        status:             account.status === 'active' ? 'connected' : account.status,
        webhook_subscribed: account.webhookSubscribed,
        scopes:             account.scopes,
        connected_at:       account.connectedAt.toISOString(),
        token_expires_at:   account.tokenExpiresAt?.toISOString() ?? null,
      },
      webhook: account.webhookConfig,
      counts: { flows: account._count.flows, contacts: account._count.contacts },
    });
  }

  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    const updated = await db.connectedAccount.update({
      where: { id: account.id },
      data:  parsed.data,
    });
    return res.status(200).json({ id: updated.id, status: updated.status });
  }

  if (req.method === 'DELETE') {
    // Best-effort unsubscribe webhook on Meta's side; ignore failures so the
    // user can always remove a stale integration locally.
    try {
      const token = decryptToken(account.accessTokenEncrypted);
      await fetch(`https://graph.facebook.com/v20.0/${account.platformAccountId}/subscribed_apps?access_token=${encodeURIComponent(token)}`, { method: 'DELETE' });
    } catch (e) { console.warn('[disconnect] unsubscribe failed', e); }

    await db.connectedAccount.delete({ where: { id: account.id } });
    return res.status(204).end();
  }

  return res.status(405).end();
}
