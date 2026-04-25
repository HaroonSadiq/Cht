// Combined OAuth handler: start (kick off consent) + callback (exchange code).
// /api/oauth/meta/start  → redirect to Meta consent
// /api/oauth/meta/callback → exchange + persist encrypted tokens

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { db } from '../../../lib/db';
import { redis } from '../../../lib/redis';
import { encryptToken } from '../../../lib/crypto';
import { requireUser } from '../../../lib/auth';
import { newIntegrationId } from '../../../lib/events';

const META_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_manage_engagement',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_manage_messages',
  'instagram_manage_comments',
  'business_management',
].join(',');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const step = (Array.isArray(req.query.step) ? req.query.step[0] : req.query.step) ?? '';
  if (step === 'start')    return start(req, res);
  if (step === 'callback') return callback(req, res);
  return res.status(404).json({ error: `Unknown OAuth step: ${step}` });
}

async function start(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const state = crypto.randomBytes(24).toString('base64url');
  await redis.set(`oauth:${state}`, userId, { ex: 600 });

  const params = new URLSearchParams({
    client_id:     process.env.META_APP_ID!,
    redirect_uri:  process.env.META_REDIRECT_URI!,
    response_type: 'code',
    scope:         META_SCOPES,
    state,
  });
  res.status(302).setHeader('Location', `https://www.facebook.com/v20.0/dialog/oauth?${params}`).end();
}

async function callback(req: VercelRequest, res: VercelResponse) {
  const code  = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!code || !state) return res.status(400).send('Missing code/state');

  const userId = await redis.get<string>(`oauth:${state}`);
  await redis.del(`oauth:${state}`);
  if (!userId) return res.status(400).send('Invalid or expired state');

  const workspace = await db.workspace.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: 'asc' } });
  if (!workspace) return res.status(400).send('No workspace for user');

  // Short-lived token
  const tokenUrl = new URL('https://graph.facebook.com/v20.0/oauth/access_token');
  tokenUrl.search = new URLSearchParams({
    client_id:     process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri:  process.env.META_REDIRECT_URI!,
    code,
  }).toString();
  const tokenJson = await fetch(tokenUrl).then((r) => r.json()) as any;
  if (tokenJson.error) return res.status(400).json(tokenJson);

  // Exchange to long-lived (~60d)
  const llUrl = new URL('https://graph.facebook.com/v20.0/oauth/access_token');
  llUrl.search = new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:         process.env.META_APP_ID!,
    client_secret:     process.env.META_APP_SECRET!,
    fb_exchange_token: tokenJson.access_token,
  }).toString();
  const llJson = await fetch(llUrl).then((r) => r.json()) as any;
  const userToken: string = llJson.access_token ?? tokenJson.access_token;

  // Enumerate pages + their IG accounts
  const pagesJson = await fetch(`https://graph.facebook.com/v20.0/me/accounts?access_token=${encodeURIComponent(userToken)}`).then((r) => r.json()) as any;
  const pages: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string } }> = pagesJson.data ?? [];

  for (const p of pages) {
    const igRes = await fetch(`https://graph.facebook.com/v20.0/${p.id}?fields=instagram_business_account&access_token=${encodeURIComponent(p.access_token)}`).then((r) => r.json()) as any;
    if (igRes?.instagram_business_account?.id) p.instagram_business_account = igRes.instagram_business_account;
  }

  for (const page of pages) {
    const enc = encryptToken(page.access_token);
    await db.connectedAccount.upsert({
      where: { workspaceId_platform_platformAccountId: { workspaceId: workspace.id, platform: 'facebook', platformAccountId: page.id } },
      update: {
        accessTokenEncrypted: enc,
        displayName: page.name,
        status: 'active',
        webhookSubscribed: true,
        webhookConfig: {
          callback_url: `${process.env.APP_URL ?? ''}/api/webhooks/meta`,
          verify_token: process.env.META_VERIFY_TOKEN ?? '',
          subscribed_fields: ['messages','messaging_postbacks','message_deliveries','feed'],
        } as any,
        connectedAt: new Date(),
      },
      create: {
        integrationId: newIntegrationId('facebook'),
        workspaceId: workspace.id,
        platform: 'facebook',
        platformAccountId: page.id,
        displayName: page.name,
        accessTokenEncrypted: enc,
        scopes: ['pages_messaging','pages_manage_metadata','pages_manage_engagement','pages_read_engagement'],
        webhookSubscribed: true,
        webhookConfig: {
          callback_url: `${process.env.APP_URL ?? ''}/api/webhooks/meta`,
          verify_token: process.env.META_VERIFY_TOKEN ?? '',
          subscribed_fields: ['messages','messaging_postbacks','message_deliveries','feed'],
        } as any,
      },
    });
    await subscribePageToWebhooks(page.id, page.access_token, ['messages','messaging_postbacks','messaging_optins','message_deliveries','feed'])
      .catch((e) => console.error('[oauth] FB subscribe failed', page.id, e));

    if (page.instagram_business_account) {
      await db.connectedAccount.upsert({
        where: { workspaceId_platform_platformAccountId: { workspaceId: workspace.id, platform: 'instagram', platformAccountId: page.instagram_business_account.id } },
        update: { accessTokenEncrypted: enc, displayName: page.name, status: 'active', webhookSubscribed: true },
        create: {
          integrationId: newIntegrationId('instagram'),
          workspaceId: workspace.id,
          platform: 'instagram',
          platformAccountId: page.instagram_business_account.id,
          displayName: page.name,
          accessTokenEncrypted: enc,
          scopes: ['instagram_manage_messages','instagram_manage_comments','instagram_basic'],
          webhookSubscribed: true,
          webhookConfig: {
            callback_url: `${process.env.APP_URL ?? ''}/api/webhooks/meta`,
            verify_token: process.env.META_VERIFY_TOKEN ?? '',
            subscribed_fields: ['messages','messaging_postbacks','comments'],
          } as any,
        },
      });
      await subscribePageToWebhooks(page.id, page.access_token, ['messages','messaging_postbacks','comments'])
        .catch((e) => console.error('[oauth] IG subscribe failed', page.id, e));
    }
  }

  res.status(302).setHeader('Location', `${process.env.APP_URL ?? '/'}/dashboard?connected=meta`).end();
}

async function subscribePageToWebhooks(pageId: string, pageToken: string, fields: string[]): Promise<void> {
  const r = await fetch(`https://graph.facebook.com/v20.0/${pageId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ subscribed_fields: fields.join(','), access_token: pageToken }),
  });
  if (!r.ok) throw new Error(`subscribed_apps ${r.status}: ${await r.text()}`);
}
