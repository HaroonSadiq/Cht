// QStash — event-driven worker invocation.
//
// Replaces the 5-min cron with sub-second worker triggers.
// Webhook ingest publishes a "drain" message; QStash POSTs /api/worker;
// worker drains the Redis queues and exits.
//
// GitHub Actions cron remains as a safety-net (every 5 min) so a QStash
// outage can't strand jobs.
//
// Required env vars (Upstash console → QStash):
//   QSTASH_TOKEN                    — REST API token, used for publish()
//   QSTASH_CURRENT_SIGNING_KEY      — current key, used to verify incoming POSTs
//   QSTASH_NEXT_SIGNING_KEY         — next key (for rotation grace period)

import crypto from 'node:crypto';

const QSTASH_API = 'https://qstash.upstash.io/v2/publish';

export async function publishDrain(workerUrl: string): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    // Don't crash the webhook just because QStash isn't configured —
    // the GitHub Actions cron will still pick up the work.
    console.warn('[qstash] QSTASH_TOKEN missing; skipping publish');
    return;
  }
  try {
    const r = await fetch(`${QSTASH_API}/${encodeURIComponent(workerUrl)}`, {
      method: 'POST',
      headers: {
        'authorization':       `Bearer ${token}`,
        'content-type':        'application/json',
        // Deduplicate near-simultaneous webhook bursts (one drain is enough).
        'upstash-deduplication-id': `drain:${Math.floor(Date.now() / 5000)}`,
        // Built-in retries with exponential backoff.
        'upstash-retries':     '3',
      },
      body: JSON.stringify({ trigger: 'webhook', at: new Date().toISOString() }),
    });
    if (!r.ok) console.warn('[qstash] publish failed', r.status, await r.text());
  } catch (e) {
    console.warn('[qstash] publish threw', e);
  }
}

// Verify a QStash-signed POST. QStash signs with JWT (HS256) using the
// signing key; the upstash-signature header carries the JWT.
export function verifyQStashSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next    = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!current && !next) return false;

  const parts = signatureHeader.split('.');
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  const tryKey = (key: string): boolean => {
    const expected = crypto.createHmac('sha256', key).update(signingInput).digest();
    const provided = b64urlDecode(sigB64);
    if (provided.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(provided, expected)) return false;
    // Body integrity: payload.body is base64url of sha256 of the raw body.
    try {
      const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
      const bodyHash = crypto.createHash('sha256').update(rawBody).digest();
      const claimed  = b64urlDecode(payload.body ?? '');
      if (claimed.length !== bodyHash.length) return false;
      if (!crypto.timingSafeEqual(claimed, bodyHash)) return false;
      // Expiry check
      if (payload.exp && Date.now() / 1000 > payload.exp) return false;
      return true;
    } catch { return false; }
  };

  return (current ? tryKey(current) : false) || (next ? tryKey(next) : false);
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}
