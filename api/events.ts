// GET /api/events?integrationId=...&take=50 — recent message_events feed
// for the dashboard "live activity" panel. Tenant-scoped.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../lib/db';
import { requireUser } from '../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const userId = await requireUser(req, res);
  if (!userId) return;

  const integrationId = typeof req.query.integrationId === 'string' ? req.query.integrationId : undefined;
  const take = Math.min(parseInt(String(req.query.take ?? '50'), 10) || 50, 200);

  const events = await db.messageEvent.findMany({
    where: {
      contact: {
        connectedAccount: {
          workspace: { ownerId: userId },
          ...(integrationId && { id: integrationId }),
        },
      },
    },
    orderBy: { receivedAt: 'desc' },
    take,
    select: {
      id: true, direction: true, channel: true, messageText: true, receivedAt: true,
      contact: { select: { id: true, displayName: true, platformContactId: true } },
      flowRun: { select: { id: true, flowId: true, status: true } },
    },
  });

  return res.status(200).json({
    events: events.map((e) => ({
      id: e.id,
      direction: e.direction,
      channel:   e.channel,
      text:      e.messageText,
      received_at: e.receivedAt.toISOString(),
      contact:   e.contact,
      flow_run:  e.flowRun,
    })),
  });
}
