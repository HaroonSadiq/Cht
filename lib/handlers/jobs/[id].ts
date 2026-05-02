// GET /api/jobs/[id] — full job envelope per the JSON contract:
// { integration, event, automation, queue }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import type { EventEnvelope, IntegrationSummary, NormalizedEvent } from '@/lib/events';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const userId = await requireUser(req, res);
  if (!userId) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const job = await db.job.findFirst({
    where: { id, connectedAccount: { workspace: { ownerId: userId } } },
    include: { connectedAccount: { include: { workspace: true } } },
  });
  if (!job) return res.status(404).json({ error: 'Not found' });

  const a = job.connectedAccount;
  const payload = job.payload as { event?: NormalizedEvent };

  const envelope: EventEnvelope = {
    integration: a ? ({
      platform:           a.platform === 'instagram' ? 'instagram' : a.platform === 'tiktok' ? 'tiktok' : 'facebook',
      integration_id:     a.integrationId,
      workspace_id:       a.workspace.slug,
      page_id:            a.platformAccountId,
      page_name:          a.displayName,
      status:             a.status === 'active' ? 'connected' : (a.status as any),
      webhook_subscribed: a.webhookSubscribed,
      created_at:         a.connectedAt.toISOString(),
    } as IntegrationSummary) : (null as any),

    event: payload.event ?? ({} as any),

    automation: job.matchedFlowId ? {
      trigger:          payload.event?.type ?? 'message_received',
      matched_flow_id:  job.matchedFlowId,
      execution_status: job.status === 'completed' ? 'queued' : (job.status === 'failed' ? 'failed' : 'queued'),
    } : undefined,

    queue: {
      queue_name: job.queueName,
      job_id:     job.id,
      status:     job.status,
    },
  };

  return res.status(200).json(envelope);
}
