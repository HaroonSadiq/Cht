import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../../lib/db';
import { issueSession, setSessionCookie } from '../../lib/auth';
import { newWorkspaceSlug } from '../../lib/events';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(120),
  name: z.string().min(1).max(80).optional(),
  workspaceName: z.string().min(1).max(80).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const parsed = Body.safeParse(req.body);
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
