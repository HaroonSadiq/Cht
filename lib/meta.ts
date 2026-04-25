// Meta Graph API client — send messages across FB Messenger / Instagram,
// and reply to public comments. Powers the comment-to-DM growth tool.

import { decryptToken } from './crypto';

const GRAPH = 'https://graph.facebook.com/v20.0';

export type OutboundContent =
  | { text: string }
  | { attachment: { type: 'image' | 'video' | 'template'; payload: unknown } };

export type SendResult =
  | { ok: true; messageId: string; raw: unknown }
  | { ok: false; error: string; code?: number; raw?: unknown };

// ───────────────────────────────────────────────────────────
// Send a DM. Recipient can be a PSID (regular reply) OR a
// comment_id (first DM to a commenter — opens the conversation
// from a public comment, allowed within 7 days of the comment).
// ───────────────────────────────────────────────────────────
export async function sendMessage(opts: {
  platform: 'facebook' | 'instagram' | 'messenger';
  platformAccountId: string;        // page ID / IG user ID
  accessTokenEncrypted: string;
  recipientId?: string;             // PSID / IG-scoped ID
  recipientCommentId?: string;      // OR: open the convo from a comment
  content: OutboundContent;
  messagingType?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';
  tag?: string;
}): Promise<SendResult> {
  if (!opts.recipientId && !opts.recipientCommentId) {
    return { ok: false, error: 'Either recipientId or recipientCommentId is required' };
  }

  const token = decryptToken(opts.accessTokenEncrypted);

  const recipient: Record<string, string> = opts.recipientCommentId
    ? { comment_id: opts.recipientCommentId }
    : { id: opts.recipientId! };

  const body: Record<string, unknown> = {
    recipient,
    message: opts.content,
    messaging_type: opts.messagingType ?? 'RESPONSE',
  };
  if (opts.tag) body.tag = opts.tag;

  const url = `${GRAPH}/${opts.platformAccountId}/messages?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => null);

  if (!res.ok || (raw as any)?.error) {
    return {
      ok: false,
      error: (raw as any)?.error?.message ?? `HTTP ${res.status}`,
      code:  (raw as any)?.error?.code,
      raw,
    };
  }

  return { ok: true, messageId: (raw as any).message_id ?? '', raw };
}

// ───────────────────────────────────────────────────────────
// Public reply to a comment — appears as a sub-comment on the post.
// Endpoint: POST /{comment-id}/comments  with  message=<text>
// Requires `pages_manage_engagement` permission (FB) or
// `instagram_manage_comments` (IG).
// ───────────────────────────────────────────────────────────
export async function replyToComment(opts: {
  commentId: string;
  accessTokenEncrypted: string;
  text: string;
}): Promise<SendResult> {
  const token = decryptToken(opts.accessTokenEncrypted);

  const url = `${GRAPH}/${opts.commentId}/comments?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: opts.text }),
  });
  const raw = await res.json().catch(() => null);

  if (!res.ok || (raw as any)?.error) {
    return {
      ok: false,
      error: (raw as any)?.error?.message ?? `HTTP ${res.status}`,
      code:  (raw as any)?.error?.code,
      raw,
    };
  }

  return { ok: true, messageId: (raw as any).id ?? '', raw };
}

// ───────────────────────────────────────────────────────────
// Hide / delete spam comments (optional moderation step)
// ───────────────────────────────────────────────────────────
export async function hideComment(opts: {
  commentId: string;
  accessTokenEncrypted: string;
  hide: boolean;
}): Promise<SendResult> {
  const token = decryptToken(opts.accessTokenEncrypted);
  const url = `${GRAPH}/${opts.commentId}?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ is_hidden: opts.hide }),
  });
  const raw = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, raw };
  return { ok: true, messageId: '', raw };
}

// Check 24-hour messaging window compliance before sending outside RESPONSE type
export function isWithin24hWindow(lastInboundAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  const diffMs = Date.now() - lastInboundAt.getTime();
  return diffMs <= 24 * 60 * 60 * 1000;
}
