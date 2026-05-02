// Adapter that lets Vercel-style serverless handlers
// (`(req: VercelRequest, res: VercelResponse) => void`) run inside a
// Next.js App Router Route Handler.
//
// We don't rewrite the existing /api/*.ts handlers — they're imported
// as library functions and invoked here against synthesized req/res
// objects. Behavior stays bit-for-bit identical to how Vercel ran
// them before the Next.js migration: same body-parsing semantics,
// same Set-Cookie headers, same async-iterator support for raw-body
// reads (used by the Meta webhook's HMAC verification).

import { NextRequest, NextResponse } from 'next/server';

type LegacyHandler = (req: any, res: any) => Promise<unknown> | unknown;

function parseCookies(cookieHeader: string): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const pair of cookieHeader.split(/;\s*/)) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) { out[pair] = ''; continue; }
    out[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
  }
  return out;
}

function tryParseJson(text: string): unknown {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

function flattenSearchParams(sp: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(Array.from(sp.keys()))) {
    const all = sp.getAll(key);
    out[key] = all.length === 1 ? all[0] : all;
  }
  return out;
}

export async function adapt(
  req: NextRequest,
  legacy: LegacyHandler,
  routeParams: Record<string, string | string[]> = {},
): Promise<Response> {
  // ─── Read raw body once ─────────────────────────────────
  const rawBuf =
    req.method === 'GET' || req.method === 'HEAD'
      ? Buffer.alloc(0)
      : Buffer.from(await req.arrayBuffer());

  const ct = (req.headers.get('content-type') || '').toLowerCase();
  let parsedBody: unknown = undefined;
  if (rawBuf.length > 0) {
    if (ct.includes('application/json')) {
      parsedBody = tryParseJson(rawBuf.toString('utf8'));
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      parsedBody = Object.fromEntries(new URLSearchParams(rawBuf.toString('utf8')));
    } else {
      // Leave as undefined — handlers that need raw bytes use the
      // async-iterator path below.
      parsedBody = undefined;
    }
  }

  // ─── Build the fake VercelRequest ───────────────────────
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => { headers[key] = value; });

  const fakeReq: any = {
    method: req.method,
    url: req.url,
    headers,
    cookies: parseCookies(req.headers.get('cookie') || ''),
    body: parsedBody,
    query: { ...flattenSearchParams(req.nextUrl.searchParams), ...routeParams },
    // Async-iterable so handlers like the Meta webhook can read
    // the raw body bytes for HMAC verification.
    [Symbol.asyncIterator]: async function* () {
      if (rawBuf.length) yield rawBuf;
    },
  };

  // ─── Build the fake VercelResponse ──────────────────────
  let statusCode = 200;
  const resHeaders = new Headers();
  let bodyOut: BodyInit | null = null;
  let ended = false;

  const sendHeaderRaw = (key: string, value: string | number | string[]) => {
    if (Array.isArray(value)) {
      resHeaders.delete(key);
      for (const v of value) resHeaders.append(key, String(v));
    } else {
      resHeaders.set(key, String(value));
    }
  };

  const writeBody = (payload: unknown, defaultContentType?: string) => {
    if (defaultContentType && !resHeaders.has('content-type')) {
      resHeaders.set('content-type', defaultContentType);
    }
    if (payload === undefined || payload === null) {
      bodyOut = null;
    } else if (typeof payload === 'string') {
      bodyOut = payload;
    } else if (payload instanceof Uint8Array || payload instanceof Buffer) {
      bodyOut = payload as unknown as BodyInit;
    } else {
      // Object — JSON stringify
      if (!resHeaders.has('content-type')) {
        resHeaders.set('content-type', 'application/json; charset=utf-8');
      }
      bodyOut = JSON.stringify(payload);
    }
    ended = true;
  };

  const fakeRes: any = {
    statusCode,
    status(code: number) { statusCode = code; fakeRes.statusCode = code; return fakeRes; },
    setHeader(key: string, value: string | number | string[]) { sendHeaderRaw(key, value); return fakeRes; },
    getHeader(key: string) {
      const v = resHeaders.get(key);
      return v === null ? undefined : v;
    },
    removeHeader(key: string) { resHeaders.delete(key); return fakeRes; },
    appendHeader(key: string, value: string | string[]) {
      if (Array.isArray(value)) { for (const v of value) resHeaders.append(key, v); }
      else { resHeaders.append(key, value); }
      return fakeRes;
    },
    json(payload: unknown) { writeBody(payload, 'application/json; charset=utf-8'); return fakeRes; },
    send(payload: unknown) { writeBody(payload); return fakeRes; },
    end(payload?: unknown) { writeBody(payload); return fakeRes; },
    redirect(...args: unknown[]) {
      // status + url, or just url
      if (typeof args[0] === 'number') {
        statusCode = args[0] as number;
        sendHeaderRaw('location', String(args[1]));
      } else {
        statusCode = 302;
        sendHeaderRaw('location', String(args[0]));
      }
      ended = true;
      return fakeRes;
    },
  };

  // ─── Run the legacy handler ────────────────────────────
  try {
    await legacy(fakeReq, fakeRes);
  } catch (err) {
    console.error('[adapter] legacy handler threw', err);
    if (!ended) {
      statusCode = 500;
      bodyOut = JSON.stringify({ error: 'internal_error' });
      resHeaders.set('content-type', 'application/json; charset=utf-8');
    }
  }

  return new NextResponse(bodyOut, { status: statusCode, headers: resHeaders });
}
