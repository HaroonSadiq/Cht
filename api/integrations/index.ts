// GET /api/integrations — returns the user's connected platforms
// in the exact JSON contract shape: { integration, webhook }.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import type { IntegrationSummary, WebhookConfig } from '../../lib/events';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const userId = await requireUser(req, res);
  if (!userId) return;

  const accounts = await db.connectedAccount.findMany({
    where: { workspace: { ownerId: userId } },
    include: { workspace: true },
    orderBy: { connectedAt: 'desc' },
  });

  const out = accounts.map((a) => {
    const integration: IntegrationSummary = {
      platform:           a.platform === 'instagram' ? 'instagram' : a.platform === 'tiktok' ? 'tiktok' : 'facebook',
      integration_id:     a.integrationId,
      workspace_id:       a.workspace.slug,
      page_id:            a.platformAccountId,
      page_name:          a.displayName,
      status:             a.status === 'active' ? 'connected' : a.status,
      webhook_subscribed: a.webhookSubscribed,
      created_at:         a.connectedAt.toISOString(),
    };
    const webhook = a.webhookConfig as unknown as WebhookConfig;
    // `id` is the canonical UUID — needed by /api/flows/comment-to-dm.
    return { id: a.id, integration, webhook };
  });

  return res.status(200).json(out);
}
