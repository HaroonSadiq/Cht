// Catch-all integrations router. Routes:
//   GET    /api/integrations                                — list
//   GET    /api/integrations/:id                            — detail
//   PATCH  /api/integrations/:id                            — pause/resume
//   DELETE /api/integrations/:id                            — disconnect
//   GET    /api/integrations/:id/posts                      — page posts
//   GET    /api/integrations/:id/metrics                    — counters + rollups
//   POST   /api/integrations/:id/resubscribe                — resubscribe webhook

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db } from '../../lib/db';
import { redis } from '../../lib/redis';
import { requireUser } from '../../lib/auth';
import { decryptToken } from '../../lib/crypto';
import type { IntegrationSummary, WebhookConfig } from '../../lib/events';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const path = (req.query.path as string[] | undefined) ?? [];

  // /api/integrations
  if (path.length === 0) {
    if (req.method !== 'GET') return res.status(405).end();
    return list(userId, res);
  }

  const id = path[0];
  const sub = path[1];

  if (!sub) {
    // /api/integrations/:id
    return crud(userId, id, req, res);
  }

  switch (sub) {
    case 'posts':       return posts(userId, id, req, res);
    case 'metrics':     return metrics(userId, id, req, res);
    case 'resubscribe': return resubscribe(userId, id, req, res);
    default:            return res.status(404).json({ error: `Unknown sub-path: ${sub}` });
  }
}

async function list(userId: string, res: VercelResponse) {
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
    return { id: a.id, integration, webhook: a.webhookConfig as unknown as WebhookConfig };
  });
  return res.status(200).json(out);
}

const PatchBody = z.object({ status: z.enum(['active', 'revoked']).optional() });

async function crud(userId: string, id: string, req: VercelRequest, res: VercelResponse) {
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
    const updated = await db.connectedAccount.update({ where: { id: account.id }, data: parsed.data });
    return res.status(200).json({ id: updated.id, status: updated.status });
  }

  if (req.method === 'DELETE') {
    try {
      const token = decryptToken(account.accessTokenEncrypted);
      await fetch(`https://graph.facebook.com/v20.0/${account.platformAccountId}/subscribed_apps?access_token=${encodeURIComponent(token)}`, { method: 'DELETE' });
    } catch (e) { console.warn('[disconnect] unsubscribe failed', e); }
    await db.connectedAccount.delete({ where: { id: account.id } });
    return res.status(204).end();
  }

  return res.status(405).end();
}

async function posts(userId: string, id: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const account = await db.connectedAccount.findFirst({ where: { id, workspace: { ownerId: userId } } });
  if (!account) return res.status(404).json({ error: 'Integration not found' });
  if (account.platform !== 'facebook' && account.platform !== 'instagram') {
    return res.status(400).json({ error: 'Posts list is FB/IG only' });
  }

  const token = decryptToken(account.accessTokenEncrypted);
  const limit = Math.min(parseInt(String(req.query.limit ?? '25'), 10) || 25, 100);
  const url = account.platform === 'facebook'
    ? `https://graph.facebook.com/v20.0/${account.platformAccountId}/posts?fields=id,message,created_time,permalink_url&limit=${limit}&access_token=${encodeURIComponent(token)}`
    : `https://graph.facebook.com/v20.0/${account.platformAccountId}/media?fields=id,caption,timestamp,permalink&limit=${limit}&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(502).json({ error: 'meta_error', detail: j });
  return res.status(200).json({ posts: (j as any).data ?? [] });
}

async function metrics(userId: string, id: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const account = await db.connectedAccount.findFirst({ where: { id, workspace: { ownerId: userId } } });
  if (!account) return res.status(404).json({ error: 'Integration not found' });

  const counters = await redis.hgetall<Record<string, string>>(`metrics:integration:${account.integrationId}`);
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
    rollups_24h: { active_flows: activeFlows, contacts_total: contacts, inbound_events: recentInbound, outbound_sent: recentOutbound },
  });
}

async function resubscribe(userId: string, id: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const account = await db.connectedAccount.findFirst({ where: { id, workspace: { ownerId: userId } } });
  if (!account) return res.status(404).json({ error: 'Integration not found' });

  const token  = decryptToken(account.accessTokenEncrypted);
  const fields = account.platform === 'instagram'
    ? ['messages','messaging_postbacks','comments']
    : ['messages','messaging_postbacks','message_deliveries','feed'];
  const r = await fetch(`https://graph.facebook.com/v20.0/${account.platformAccountId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ subscribed_fields: fields.join(','), access_token: token }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(502).json({ error: 'meta_error', detail: j });

  await db.connectedAccount.update({
    where: { id: account.id },
    data: {
      webhookSubscribed: true,
      webhookConfig: {
        callback_url: `${process.env.APP_URL ?? ''}/api/webhooks/meta`,
        verify_token: process.env.META_VERIFY_TOKEN ?? '',
        subscribed_fields: fields,
      } as any,
    },
  });
  return res.status(200).json({ ok: true, subscribed_fields: fields });
}
