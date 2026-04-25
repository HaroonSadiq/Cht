// Canonical event envelope — matches the JSON contract for the platform.
// Every webhook payload from Meta/TikTok is normalized into this shape
// before it goes anywhere downstream (queue, DB, dispatcher).

export type Platform = 'facebook' | 'instagram' | 'messenger' | 'tiktok';

export type EventType =
  | 'message_received'
  | 'message_delivered'
  | 'message_read'
  | 'postback'
  | 'comment_added'
  | 'story_reply'
  | 'follow';

export interface NormalizedEvent {
  event_id:  string;
  type:      EventType;
  timestamp: number;          // unix seconds
  platform:  Platform;

  sender:    { user_id: string; name?: string };
  recipient: { page_id: string };

  message?:  { message_id?: string; text?: string; attachments?: unknown[] };
  comment?:  { comment_id: string; post_id: string; text: string };
  postback?: { payload: string; title?: string };
}

export interface AutomationDecision {
  trigger:           EventType;
  matched_flow_id:   string | null;
  execution_status:  'queued' | 'skipped' | 'failed';
}

export interface QueueRef {
  queue_name: string;
  job_id:     string;
  status:     'waiting' | 'running' | 'completed' | 'failed' | 'retrying';
}

export interface IntegrationSummary {
  platform:           Platform;
  integration_id:     string;
  workspace_id:       string;
  page_id:            string;
  page_name:          string | null;
  status:             'connected' | 'expired' | 'revoked';
  webhook_subscribed: boolean;
  created_at:         string;
}

export interface WebhookConfig {
  verify_token:      string;
  callback_url:      string;
  subscribed_fields: string[];
}

// The full envelope returned/logged for every event we accept
export interface EventEnvelope {
  integration: IntegrationSummary;
  webhook?:    WebhookConfig;
  event:       NormalizedEvent;
  automation?: AutomationDecision;
  queue?:      QueueRef;
}

// ───────────────────────────────────────────────────────────
// Normalize a raw Meta webhook entry into one or more events.
// One Meta payload can carry several entries × multiple messages/changes.
// ───────────────────────────────────────────────────────────
export function normalizeMetaPayload(payload: any, platform: Platform): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const entry of payload?.entry ?? []) {
    const pageId = entry.id as string;

    // DM events
    for (const m of entry.messaging ?? []) {
      const ts = (m.timestamp ?? Date.now()) / 1000 | 0;
      const senderId = m.sender?.id;
      if (!senderId) continue;

      if (m.message) {
        out.push({
          event_id:  m.message.mid ?? `evt_${ts}_${Math.random().toString(36).slice(2, 8)}`,
          type:      'message_received',
          timestamp: ts,
          platform,
          sender:    { user_id: senderId, name: m.sender?.name },
          recipient: { page_id: pageId },
          message: {
            message_id:  m.message.mid,
            text:        m.message.text,
            attachments: m.message.attachments ?? [],
          },
        });
      } else if (m.delivery) {
        out.push({
          event_id: `dlv_${ts}_${senderId}`,
          type: 'message_delivered',
          timestamp: ts, platform,
          sender: { user_id: senderId },
          recipient: { page_id: pageId },
        });
      } else if (m.read) {
        out.push({
          event_id: `rd_${ts}_${senderId}`,
          type: 'message_read',
          timestamp: ts, platform,
          sender: { user_id: senderId },
          recipient: { page_id: pageId },
        });
      } else if (m.postback) {
        out.push({
          event_id: m.postback.mid ?? `pb_${ts}_${senderId}`,
          type: 'postback',
          timestamp: ts, platform,
          sender: { user_id: senderId },
          recipient: { page_id: pageId },
          postback: { payload: m.postback.payload, title: m.postback.title },
        });
      }
    }

    // Comment events (FB feed + IG comments)
    for (const c of entry.changes ?? []) {
      const v = c.value ?? {};
      const isFbComment = c.field === 'feed' && v.item === 'comment' && v.verb === 'add';
      const isIgComment = c.field === 'comments';
      if (!isFbComment && !isIgComment) continue;

      const ts = (v.created_time ?? entry.time ?? Date.now() / 1000) | 0;
      const fromId = v.from?.id ?? v.from?.username;
      if (!fromId) continue;

      out.push({
        event_id:  v.comment_id ?? v.id ?? `cmt_${ts}_${fromId}`,
        type:      'comment_added',
        timestamp: ts,
        platform,
        sender:    { user_id: fromId, name: v.from?.name },
        recipient: { page_id: pageId },
        comment: {
          comment_id: v.comment_id ?? v.id,
          post_id:    v.post_id ?? v.media?.id ?? v.parent_id ?? '',
          text:       v.message ?? v.text ?? '',
        },
      });
    }
  }
  return out;
}

export function newJobId(): string {
  return `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function newEventId(): string {
  return `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function newIntegrationId(platform: Platform): string {
  const prefix = platform === 'facebook' ? 'fb' : platform === 'instagram' ? 'ig' : platform.slice(0, 2);
  return `${prefix}_int_${Math.random().toString(36).slice(2, 10)}`;
}

export function newWorkspaceSlug(): string {
  return `ws_${Math.random().toString(36).slice(2, 8)}`;
}
