// Combined auth handler: signup / signin / signout / me.
// One Vercel function handles all four to fit the Hobby 12-function cap.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  issueSession, setSessionCookie, clearSessionCookie, getSession,
} from '@/lib/auth';
import { newWorkspaceSlug } from '@/lib/events';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = (Array.isArray(req.query.action) ? req.query.action[0] : req.query.action) ?? '';
  switch (action) {
    case 'signup':  return signup(req, res);
    case 'signin':  return signin(req, res);
    case 'signout': return signout(req, res);
    case 'me':      return me(req, res);
    default:        return res.status(404).json({ error: `Unknown auth action: ${action}` });
  }
}

const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(120),
  name: z.string().min(1).max(80).optional(),
  workspaceName: z.string().min(1).max(80).optional(),
});

async function signup(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const parsed = SignupBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const { email, password, name, workspaceName } = parsed.data;
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, passwordHash, name } });
    const ws = await tx.workspace.create({
      data: {
        slug: newWorkspaceSlug(),
        name: workspaceName ?? `${name ?? email.split('@')[0]}'s workspace`,
        ownerId: user.id,
      },
    });
    return { user, ws };
  });

  const token = await issueSession(result.user.id);
  setSessionCookie(res, token);
  return res.status(200).json({
    user: { id: result.user.id, email: result.user.email, name: result.user.name },
    workspace: { id: result.ws.id, slug: result.ws.slug, name: result.ws.name },
  });
}

const SigninBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

async function signin(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const parsed = SigninBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Bad request' });

  const { email, password } = parsed.data;
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = await issueSession(user.id);
  setSessionCookie(res, token);
  return res.status(200).json({ id: user.id, email: user.email, name: user.name });
}

async function signout(_req: VercelRequest, res: VercelResponse) {
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}

// Combined "me" — returns user + first workspace + workspace counts in one
// call, so the dashboard doesn't need a separate /api/workspaces/me hop.
async function me(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const s = await getSession(req);
  if (!s) return res.status(401).json({ error: 'Unauthorized' });

  const user = await db.user.findUnique({
    where: { id: s.userId },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  if (!user) return res.status(401).json({ error: 'User not found' });

  const workspace = await db.workspace.findFirst({
    where: { ownerId: user.id },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { connectedAccounts: true, tags: true } } },
  });

  return res.status(200).json({
    user,
    workspace: workspace ? {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      created_at: workspace.createdAt.toISOString(),
      counts: { integrations: workspace._count.connectedAccounts, tags: workspace._count.tags },
    } : null,
  });
}
