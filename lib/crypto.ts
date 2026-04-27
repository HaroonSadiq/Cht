import crypto from 'node:crypto';

// ─── Webhook signature verification (Meta) ─────────────────
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const secret = process.env.META_WEBHOOK_SECRET;
  if (!secret) throw new Error('META_WEBHOOK_SECRET is not set');

  const expected = 'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  // Constant-time compare
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─── Token encryption at rest (AES-256-GCM) ────────────────
// Uses an envelope scheme: random IV per payload, authenticated ciphertext.
function getKey(): Buffer {
  const b64 = process.env.ENCRYPTION_KEY;
  if (!b64) throw new Error('ENCRYPTION_KEY is not set');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (base64-encoded)');
  return key;
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptToken(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

// ─── Constant-time token compare for cron secret ───────────
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ─── Facebook signed_request (data deletion callback) ──────
// Format:  base64url(signature) "." base64url(json_payload)
// The signature is HMAC-SHA256(payload_string, app_secret).
// Returns the decoded payload object on success, or null on bad signature.
export interface FacebookSignedRequest {
  algorithm: string;
  user_id: string;
  issued_at?: number;
  expires?: number;
  [key: string]: unknown;
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function parseFacebookSignedRequest(
  signed: string,
  appSecret: string,
): FacebookSignedRequest | null {
  if (!signed || !appSecret) return null;
  const parts = signed.split('.');
  if (parts.length !== 2) return null;
  const [encodedSig, encodedPayload] = parts;

  const sig = base64urlDecode(encodedSig);
  const expected = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(base64urlDecode(encodedPayload).toString('utf8'));
    if (payload?.algorithm !== 'HMAC-SHA256') return null;
    return payload as FacebookSignedRequest;
  } catch {
    return null;
  }
}
