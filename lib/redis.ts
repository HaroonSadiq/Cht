import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// ─── Queue helpers ─────────────────────────────────────────
export const QUEUE_INBOUND  = 'q:inbound';    // unprocessed webhook events
export const QUEUE_OUTBOUND = 'q:outbound';   // rate-limited send queue

export type InboundJob = {
  idempotencyKey: string;
  platform: 'facebook' | 'instagram' | 'messenger' | 'tiktok';
  receivedAt: number;
  payload: unknown;
};

export type OutboundJob = {
  contactId: string;
  connectedAccountId: string;
  content: unknown;
  scheduledFor?: number;
  // For comment-to-DM: the comment_id that opens the conversation
  // (used when contact has no PSID yet — first DM ever).
  recipientCommentId?: string;
};

export type CommentReplyJob = {
  connectedAccountId: string;
  commentId: string;
  text: string;
};

export const QUEUE_COMMENT_REPLY = 'q:comment_reply';
export async function enqueueCommentReply(job: CommentReplyJob): Promise<number> {
  return redis.lpush(QUEUE_COMMENT_REPLY, JSON.stringify(job));
}

export async function enqueueInbound(job: InboundJob): Promise<number> {
  return redis.lpush(QUEUE_INBOUND, JSON.stringify(job));
}

export async function dequeueInbound(max = 10): Promise<InboundJob[]> {
  const raws = await redis.rpop(QUEUE_INBOUND, max);
  if (!raws) return [];
  const list = Array.isArray(raws) ? raws : [raws];
  return list.map((r) => (typeof r === 'string' ? JSON.parse(r) : r)) as InboundJob[];
}

export async function enqueueOutbound(job: OutboundJob): Promise<number> {
  return redis.lpush(QUEUE_OUTBOUND, JSON.stringify(job));
}

// ─── Idempotency (seen-set with TTL) ───────────────────────
export async function markSeen(key: string, ttlSec = 86400): Promise<boolean> {
  const result = await redis.set(`seen:${key}`, '1', { nx: true, ex: ttlSec });
  return result === 'OK';
}

// ─── Rate limiting (token bucket) ──────────────────────────
export async function checkRateLimit(
  key: string,
  maxPerWindow: number,
  windowSec: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const k = `rl:${key}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSec);
  return { allowed: n <= maxPerWindow, remaining: Math.max(0, maxPerWindow - n) };
}
