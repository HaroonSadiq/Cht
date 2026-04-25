// Meta OAuth callback — exchanges code for long-lived token, enumerates pages,
// persists connected accounts (integrations) encrypted.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../lib/db';
import { redis } from '../../../lib/redis';
import { encryptToken } from '../../../lib/crypto';
import { newIntegrationId } from '../../../lib/events';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code  = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!code || !state) return res.status(400).send('Missing code/state');

  const userId = await redis.get<string>(`oauth:${state}`);
  await redis.del(`oauth:${state}`);
  if (!userId) return res.status(400).send('Invalid or expired state');

  // Resolve the active workspace for this user (first owned).
  const workspace = await db.workspace.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: 'asc' } });
  if (!workspace) return res.status(400).send('No workspace for user');

  // 1. Short-lived user access token
  const tokenUrl = new URL('https://graph.facebook.com/v20.0/oauth/access_token');
  tokenUrl.search = new URLSearchParams({
    client_id:     process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri:  process.env.META_REDIRECT_URI!,
    code,
  }).toString();
  const tokenRes = await fetch(tokenUrl);
  const tokenJson = await tokenRes.json() as any;
  if (!tokenRes.ok) return res.status(400).json(tokenJson);

  // 2. Exchange for long-lived (~60d) token
  const llUrl = new URL('https://graph.facebook.com/v20.0/oauth/access_token');
  llUrl.search = new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:         process.env.META_APP_ID!,
    client_secret:     process.env.META_APP_SECRET!,
    fb_exchange_token: tokenJson.access_token,
  }).toString();
  const llRes = await fetch(llUrl);
  const llJson = await llRes.json() as any;

  const userToken: string = llJson.access_token ?? tokenJson.access_token;

  // 3. Fetch the user's pages (each page has its own token)
  const pagesRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?access_token=${encodeURIComponent(userToken)}`);
  const pagesJson = await pagesRes.json() as any;
  const pages: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string } }> = pagesJson.data ?? [];

  // Also ask which pages have an IG Business Account linked
  for (const p of pages) {
    const igRes = await fetch(`https://graph.facebook.com/v20.0/${p.id}?fields=instagram_business_account&access_token=${encodeURIComponent(p.access_token)}`);
    const igJson = await igRes.json() as any;
    if (igJson?.instagram_business_account?.id) p.instagram_business_account = igJson.instagram_business_account;
  }

  // 4. Upsert connected_accounts rows + subscribe each page to webhooks
  for (const page of pages) {
    const enc = encryptToken(page.access_token);

    await db.connectedAccount.upsert({
      where: {
        workspaceId_platform_platformAccountId: {
          workspaceId: workspace.id, platform: 'facebook', platformAccountId: page.id,
        },
      },
      update: {
        accessTokenEncrypted: enc,
        displayName: page.name,
        status: 'active',
        webhookSubscribed: true,
        webhookConfig: {
          callback_url: `${process.env.APP_URL ?? ''}/api/webhooks/meta`,
          verify_token: process.env.META_VERIFY_TOKEN ?? '',
          subscribed_fields: ['messages','messaging_postbacks','message_deliveries','feed'],
        },
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
        },
      },
    });

    // Subscribe THIS page to the webhook fields we care about — without this,
    // Meta never delivers DM or comment events to /api/webhooks/meta.
    await subscribePageToWebhooks(page.id, page.access_token, [
      'messages',
      'messaging_postbacks',
      'messaging_optins',
      'message_deliveries',
      'feed',                 // ← comments on posts (powers comment-to-DM)
    ]).catch((e) => console.error('[oauth] FB subscribe failed', page.id, e));

    if (page.instagram_business_account) {
      await db.connectedAccount.upsert({
        where: {
          workspaceId_platform_platformAccountId: {
            workspaceId: workspace.id, platform: 'instagram', platformAccountId: page.instagram_business_account.id,
          },
        },
        update: {
          accessTokenEncrypted: enc,
          displayName: page.name,
          status: 'active',
          webhookSubscribed: true,
        },
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
          },
        },
      });

      // IG subscriptions are attached to the *Page* token, fields differ.
      await subscribePageToWebhooks(page.id, page.access_token, [
        'messages',
        'messaging_postbacks',
        'comments',           // ← IG comments (powers IG comment-to-DM)
      ]).catch((e) => console.error('[oauth] IG subscribe failed', page.id, e));
    }
  }

  // Redirect to dashboard
  res.status(302).setHeader('Location', `${process.env.APP_URL ?? '/'}/dashboard?connected=meta`).end();
}

// Tell Meta to start delivering events for this page to our webhook.
async function subscribePageToWebhooks(pageId: string, pageToken: string, fields: string[]): Promise<void> {
  const url = `https://graph.facebook.com/v20.0/${pageId}/subscribed_apps`;
  const body = new URLSearchParams({
    subscribed_fields: fields.join(','),
    access_token: pageToken,
  });
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`subscribed_apps ${r.status}: ${JSON.stringify(j)}`);
  }
}
