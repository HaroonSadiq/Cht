// GET /api/integrations/[id]/metrics — read counters maintained by the
// analytics consumer on the event bus, plus aggregate flow counts from DB.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../lib/db';
import { redis } from '../../../lib/redis';
import { requireUser } from '../../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const userId = await requireUser(req, res);
  if (!userId) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const account = await db.connectedAccount.findFirst({
    where: { id, workspace: { ownerId: userId } },
  });
  if (!account) return res.status(404).json({ error: 'Integration not found' });

  // Live counters from the analytics consumer (HINCRBY)
  const counters = await redis.hgetall<Record<string, string>>(`metrics:integration:${account.integrationId}`);

  // DB rollups
  const since24h = new Date(Date.now() - 86_400_000);
  const [activeFlows, contacts, recentInbound, recentOutbound] = await Promise.all([
    db.flow.count({ where: { connectedAccountId: account.id, isActive: true } }),
    db.contact.count({ where: { connectedAccountId: account.id } }),
    db.messageEvent.count({ where: { connectedAccountId: account.id, direction: 'inbound',  receivedAt: { gte: since24h } } }),
    db.messageEvent.count({ where: { connectedAccountId: account.id, direction: 'outbound', receivedAt: { gte: since24h } } }),
  ]);

  return res.status(200).json({
    integration_id: account.integrationId,
    counters: counters ?? {},
    rollups_24h: {
      active_flows:     activeFlows,
      contacts_total:   contacts,
      inbound_events:   recentInbound,
      outbound_sent:    recentOutbound,
    },
  });
}
