// Minimal session auth: signed JWT in httpOnly cookie.
import { SignJWT, jwtVerify } from 'jose';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const COOKIE_NAME = 'fb_session';

function key() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set');
  return new TextEncoder().encode(s);
}

export async function issueSession(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key());
}

export async function getSession(req: VercelRequest): Promise<{ userId: string } | null> {
  const cookie = req.headers.cookie ?? '';
  const match = cookie.match(/fb_session=([^;]+)/);
  if (!match) return null;
  try {
    const { payload } = await jwtVerify(match[1], key());
    return { userId: String(payload.sub) };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: VercelResponse, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 3600}${secure}`);
}

export function clearSessionCookie(res: VercelResponse) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
}

export async function requireUser(req: VercelRequest, res: VercelResponse): Promise<string | null> {
  const s = await getSession(req);
  if (!s) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  return s.userId;
}
