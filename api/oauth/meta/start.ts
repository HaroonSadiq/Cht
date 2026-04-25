// Kick off Meta OAuth — redirects the business owner to Facebook's consent screen.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from '../../../lib/auth';
import crypto from 'node:crypto';
import { redis } from '../../../lib/redis';

const META_SCOPES = [
  'pages_show_list',
  'pages_messaging',           // DM API
  'pages_manage_metadata',     // subscribe webhooks per page
  'pages_manage_engagement',   // reply to / hide comments
  'pages_read_engagement',     // read comments + post info
  'instagram_basic',
  'instagram_manage_messages', // IG DM
  'instagram_manage_comments', // IG comment reply (IG comment-to-DM)
  'business_management',
].join(',');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const state = crypto.randomBytes(24).toString('base64url');
  await redis.set(`oauth:${state}`, userId, { ex: 600 }); // 10 min

  const params = new URLSearchParams({
    client_id:     process.env.META_APP_ID!,
    redirect_uri:  process.env.META_REDIRECT_URI!,
    response_type: 'code',
    scope:         META_SCOPES,
    state,
  });

  const url = `https://www.facebook.com/v20.0/dialog/oauth?${params}`;
  res.status(302).setHeader('Location', url).end();
}
