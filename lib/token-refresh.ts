// Token refresh — extends Meta long-lived Page tokens before they expire.
// Without this, Page tokens silently die ~60 days after OAuth, breaking
// every customer's automation. Worker phase calls refreshExpiringTokens().

import { db } from './db';
import { decryptToken, encryptToken } from './crypto';
import { redis } from './redis';

const REFRESH_WINDOW_DAYS = 7;
const PER_RUN_LIMIT = 25;
const REFRESH_GUARD_KEY = 'token-refresh:last-run';
const REFRESH_GUARD_TTL_SEC = 6 * 3600;

export interface RefreshResult {
  scanned:   number;
  refreshed: number;
  failed:    number;
  skipped:   number;
  errors:    Array<{ accountId: string; error: string }>;
}

// Returns true if we should run this tick (rate-limited to once per 6 hours).
export async function shouldRefreshNow(): Promise<boolean> {
  const last = await redis.get<string>(REFRESH_GUARD_KEY);
  if (last) return false;
  await redis.set(REFRESH_GUARD_KEY, new Date().toISOString(), { ex: REFRESH_GUARD_TTL_SEC });
  return true;
}

export async function refreshExpiringTokens(): Promise<RefreshResult> {
  const result: RefreshResult = { scanned: 0, refreshed: 0, failed: 0, skipped: 0, errors: [] };

  const cutoff = new Date(Date.now() + REFRESH_WINDOW_DAYS * 86400 * 1000);
  const candidates = await db.connectedAccount.findMany({
    where: {
      status: 'active',
      platform: { in: ['facebook', 'instagram'] },
      // Either we never recorded an expiry (legacy rows) or it's within the refresh window.
      OR: [
        { tokenExpiresAt: null },
        { tokenExpiresAt: { lt: cutoff } },
      ],
    },
    take: PER_RUN_LIMIT,
    orderBy: { tokenExpiresAt: { sort: 'asc', nulls: 'first' } },
  });

  for (const account of candidates) {
    result.scanned++;
    try {
      const currentToken = decryptToken(account.accessTokenEncrypted);
      const refreshed = await exchangeForLongLived(currentToken);
      if (!refreshed) {
        result.skipped++;
        continue;
      }

      const newExpiry = refreshed.expiresInSec
        ? new Date(Date.now() + refreshed.expiresInSec * 1000)
        : null;

      await db.connectedAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEncrypted: encryptToken(refreshed.token),
          tokenExpiresAt: newExpiry,
        },
      });
      result.refreshed++;
    } catch (e: any) {
      result.failed++;
      const message = String(e?.message ?? e);
      result.errors.push({ accountId: account.id, error: message });
      // Surface to the user via status so the dashboard can show a banner.
      // We only flip to 'expired' if the error is unambiguous (token invalidated)
      // — transient network errors should not lock the account out.
      if (/OAuthException|expired|invalid/i.test(message)) {
        await db.connectedAccount.update({
          where: { id: account.id },
          data: { status: 'expired' },
        });
      }
    }
  }

  return result;
}

interface ExchangeResult { token: string; expiresInSec: number | null }

async function exchangeForLongLived(currentToken: string): Promise<ExchangeResult | null> {
  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error('META_APP_ID or META_APP_SECRET missing');

  const url = new URL('https://graph.facebook.com/v20.0/oauth/access_token');
  url.search = new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:         appId,
    client_secret:     appSecret,
    fb_exchange_token: currentToken,
  }).toString();

  const r = await fetch(url, { method: 'GET' });
  const j: any = await r.json().catch(() => ({}));

  if (!r.ok || j?.error) {
    const msg = j?.error?.message ?? `HTTP ${r.status}`;
    throw new Error(`fb_exchange_token failed: ${msg}`);
  }
  if (!j.access_token) return null;
  return {
    token:        j.access_token,
    expiresInSec: typeof j.expires_in === 'number' ? j.expires_in : null,
  };
}
