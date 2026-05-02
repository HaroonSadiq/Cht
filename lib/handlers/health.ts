// GET /api/health — DB + Redis + Bus liveness check.
// Public; safe to expose.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '@/lib/db';
import { redis } from '@/lib/redis';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const checks: Record<string, { ok: boolean; ms: number; error?: string }> = {};

  const t1 = Date.now();
  try { await db.$queryRaw`SELECT 1`;            checks.db    = { ok: true,  ms: Date.now() - t1 }; }
  catch (e: any) {                                checks.db    = { ok: false, ms: Date.now() - t1, error: String(e?.message ?? e) }; }

  const t2 = Date.now();
  try { await redis.ping();                       checks.redis = { ok: true,  ms: Date.now() - t2 }; }
  catch (e: any) {                                checks.redis = { ok: false, ms: Date.now() - t2, error: String(e?.message ?? e) }; }

  const ok = Object.values(checks).every((c) => c.ok);
  return res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', checks, at: new Date().toISOString() });
}
