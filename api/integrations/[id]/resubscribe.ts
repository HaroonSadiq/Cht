// POST /api/integrations/[id]/resubscribe — re-subscribe this page to webhook
// fields. Use when Meta drops the subscription, or after permission changes.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/auth';
import { decryptToken } from '../../../lib/crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const userId = await requireUser(req, res);
  if (!userId) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const account = await db.connectedAccount.findFirst({
    where: { id, workspace: { ownerId: userId } },
  });
  if (!account) return res.status(404).json({ error: 'Integration not found' });

  const token  = decryptToken(account.accessTokenEncrypted);
  const fields = account.platform === 'instagram'
    ? ['messages','messaging_postbacks','comments']
    : ['messages','messaging_postbacks','message_deliveries','feed'];

  const body = new URLSearchParams({
    subscribed_fields: fields.join(','),
    access_token: token,
  });
  const r = await fetch(`https://graph.facebook.com/v20.0/${account.platformAccountId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(502).json({ error: 'meta_error', detail: j });

  await db.connectedAccount.update({
    where: { id: account.id },
    data:  {
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
