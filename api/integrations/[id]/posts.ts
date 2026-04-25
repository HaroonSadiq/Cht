// GET /api/integrations/[id]/posts — list this page's recent posts so the
// dashboard can let the owner pick which posts a comment trigger applies to.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/auth';
import { decryptToken } from '../../../lib/crypto';

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
  if (account.platform !== 'facebook' && account.platform !== 'instagram') {
    return res.status(400).json({ error: 'Posts list is supported on Facebook and Instagram only' });
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
