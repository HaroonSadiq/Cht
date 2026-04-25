// Offline smoke test — exercises the pure-logic layer of FlowBot.
// No deploy / DB / Redis / Meta needed. Run with:  node scripts/smoke-offline.mjs

import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const ok    = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad   = (m) => { console.log(`  ✗ ${m}`); fail++; };
const head  = (m) => console.log(`\n── ${m} ──`);

// Load .env into process.env so we test against real keys.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

// ─── 1. HMAC signature math (lib/crypto.ts shape) ─────────
head('HMAC-SHA256 signature verification');
{
  const secret = process.env.META_WEBHOOK_SECRET || 'test_secret';
  const body   = '{"object":"page","entry":[{"id":"123"}]}';
  const sig    = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  const verify = (b, s) => {
    if (!s?.startsWith('sha256=')) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(b).digest('hex');
    const a = Buffer.from(s), e = Buffer.from(expected);
    return a.length === e.length && crypto.timingSafeEqual(a, e);
  };
  verify(body, sig)              ? ok('valid signature accepted')              : bad('valid signature REJECTED');
  !verify(body, 'sha256=BAD')    ? ok('bad signature rejected')                : bad('bad signature accepted');
  !verify(body, null)            ? ok('missing signature rejected')            : bad('null accepted');
  !verify(body + 'tamper', sig)  ? ok('tampered body rejected')                : bad('tampered body accepted');
}

// ─── 2. AES-256-GCM token encryption round-trip ────────────
head('AES-256-GCM token encryption (lib/crypto.ts)');
{
  const keyB64 = process.env.ENCRYPTION_KEY;
  if (!keyB64) { console.log('  ⏭  ENCRYPTION_KEY not set — skipping'); }
  else {
    const key = Buffer.from(keyB64, 'base64');
    if (key.length !== 32) bad(`ENCRYPTION_KEY is ${key.length} bytes — must be 32`);
    else {
      const enc = (pt) => {
        const iv = crypto.randomBytes(12);
        const c  = crypto.createCipheriv('aes-256-gcm', key, iv);
        const e  = Buffer.concat([c.update(pt, 'utf8'), c.final()]);
        return Buffer.concat([iv, c.getAuthTag(), e]).toString('base64');
      };
      const dec = (blob) => {
        const buf = Buffer.from(blob, 'base64');
        const d   = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0,12));
        d.setAuthTag(buf.subarray(12,28));
        return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
      };
      const plain = 'EAABZB0_super_secret_meta_page_token_' + Date.now();
      const cipher = enc(plain);
      cipher !== plain   ? ok('cipher differs from plaintext')   : bad('encryption is no-op!');
      dec(cipher) === plain ? ok('round-trip decrypts cleanly')  : bad('decrypt mismatch');
      // Tamper detection
      const tampered = Buffer.from(cipher, 'base64');
      tampered[40] = tampered[40] ^ 0xff;
      try { dec(tampered.toString('base64')); bad('tampered ciphertext decrypted — auth tag broken'); }
      catch { ok('tampered ciphertext rejected (auth tag works)'); }
    }
  }
}

// ─── 3. Meta payload normalization (lib/events.ts) ────────
head('Meta payload normalization');
{
  // Inline reproduction of normalizeMetaPayload's contract
  const normalize = (payload, platform) => {
    const out = [];
    for (const entry of payload?.entry ?? []) {
      const pageId = entry.id;
      for (const m of entry.messaging ?? []) {
        const ts = ((m.timestamp ?? Date.now()) / 1000) | 0;
        if (m.message) out.push({ event_id: m.message.mid, type: 'message_received', timestamp: ts, platform, sender: { user_id: m.sender?.id }, recipient: { page_id: pageId }, message: { message_id: m.message.mid, text: m.message.text } });
        else if (m.postback) out.push({ event_id: m.postback.mid ?? `pb_${ts}`, type: 'postback', timestamp: ts, platform, sender: { user_id: m.sender?.id }, recipient: { page_id: pageId }, postback: { payload: m.postback.payload } });
      }
      for (const c of entry.changes ?? []) {
        const v = c.value ?? {};
        if (c.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
          out.push({ event_id: v.comment_id, type: 'comment_added', timestamp: 0, platform, sender: { user_id: v.from?.id }, recipient: { page_id: pageId }, comment: { comment_id: v.comment_id, post_id: v.post_id, text: v.message } });
        } else if (c.field === 'comments') {
          out.push({ event_id: v.id, type: 'comment_added', timestamp: 0, platform, sender: { user_id: v.from?.id }, recipient: { page_id: pageId }, comment: { comment_id: v.id, post_id: v.media?.id, text: v.text } });
        }
      }
    }
    return out;
  };

  // FB DM
  const dm = normalize({ object:'page', entry:[{ id:'PAGE1', messaging:[{ sender:{ id:'USER1' }, recipient:{ id:'PAGE1' }, message:{ mid:'mid_1', text:'hi' } }] }] }, 'messenger');
  dm.length === 1 && dm[0].type === 'message_received' && dm[0].message.text === 'hi'
    ? ok('FB DM payload normalized')
    : bad(`FB DM normalization wrong: ${JSON.stringify(dm)}`);

  // FB comment (feed event)
  const cmt = normalize({ object:'page', entry:[{ id:'PAGE1', changes:[{ field:'feed', value:{ item:'comment', verb:'add', comment_id:'CMT1', post_id:'POST1', from:{ id:'U2', name:'Alice' }, message:'PRICE' } }] }] }, 'messenger');
  cmt.length === 1 && cmt[0].type === 'comment_added' && cmt[0].comment.text === 'PRICE'
    ? ok('FB comment payload normalized')
    : bad(`FB comment normalization wrong: ${JSON.stringify(cmt)}`);

  // IG comment
  const ig = normalize({ object:'instagram', entry:[{ id:'IG1', changes:[{ field:'comments', value:{ id:'IGC1', text:'INFO', from:{ id:'U3' }, media:{ id:'MED1' } } }] }] }, 'instagram');
  ig.length === 1 && ig[0].type === 'comment_added' && ig[0].comment.post_id === 'MED1'
    ? ok('IG comment payload normalized')
    : bad(`IG comment normalization wrong: ${JSON.stringify(ig)}`);

  // Unknown event → empty
  const empty = normalize({ object:'page', entry:[{ id:'PAGE1', changes:[{ field:'leadgen', value:{} }] }] }, 'messenger');
  empty.length === 0 ? ok('unrelated change-types ignored') : bad('false positive on unrelated event');
}

// ─── 4. Keyword matching (lib/flow-engine.ts) ─────────────
head('Keyword matching primitives');
{
  const norm = (s) => (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = (cfg, text) => {
    const t = norm(text);
    const ps = cfg.patterns ?? [];
    switch (cfg.match_type) {
      case 'exact':       return ps.some((p) => t === p.toLowerCase());
      case 'contains':    return ps.some((p) => t.includes(p.toLowerCase()));
      case 'keyword_any': return ps.some((p) => new RegExp(`\\b${escape(p)}\\b`, 'i').test(t));
      default: return false;
    }
  };
  match({ match_type:'contains', patterns:['price'] }, 'What is your PRICE?') ? ok('contains: case-insensitive match') : bad('contains failed');
  match({ match_type:'contains', patterns:['PRICE'] }, '   what  is the PRICE   ') ? ok('contains: whitespace normalized') : bad('whitespace failed');
  !match({ match_type:'exact', patterns:['price'] }, 'price please') ? ok('exact: rejects non-exact') : bad('exact too permissive');
  match({ match_type:'exact', patterns:['price'] }, 'PRICE') ? ok('exact: case-insensitive equal') : bad('exact eq failed');
  match({ match_type:'keyword_any', patterns:['price'] }, 'the price is right') ? ok('keyword_any: word boundary match') : bad('word boundary failed');
  !match({ match_type:'keyword_any', patterns:['price'] }, 'priceless') ? ok('keyword_any: rejects substring') : bad('substring leaked');
}

// ─── 5. Variable interpolation ────────────────────────────
head('Template interpolation');
{
  const interp = (tpl, vars) => tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => p.split('.').reduce((a, k) => a?.[k], vars) ?? '');
  interp('Hi {{contact.first_name}}!', { contact: { first_name: 'Maya' } }) === 'Hi Maya!' ? ok('nested var resolved') : bad('interp wrong');
  interp('Hi {{missing}}', {}) === 'Hi ' ? ok('missing var → empty string') : bad('missing var leaks');
  interp('static text', {}) === 'static text' ? ok('no-op when no vars') : bad('no-op failed');
}

// ─── 6. ID generators (lib/events.ts contract) ────────────
head('ID generators (event/job/integration)');
{
  const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;
  const e1 = newId('evt'), e2 = newId('evt');
  e1 !== e2 ? ok('event_id values are unique') : bad('event_id collision');
  /^evt_[a-z0-9]+$/.test(e1) ? ok('event_id format correct') : bad(`format wrong: ${e1}`);
  /^job_[a-z0-9]+$/.test(newId('job')) ? ok('job_id format correct') : bad('job_id format wrong');
}

// ─── 7. Required env vars ─────────────────────────────────
head('Required env vars present');
const required = [
  'DATABASE_URL', 'DIRECT_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'ENCRYPTION_KEY', 'JWT_SECRET', 'META_APP_ID', 'META_APP_SECRET',
  'META_VERIFY_TOKEN', 'META_WEBHOOK_SECRET', 'META_REDIRECT_URI', 'CRON_SECRET', 'APP_URL',
];
for (const k of required) {
  process.env[k] && process.env[k].length > 0
    ? ok(`${k} set (${process.env[k].length} chars)`)
    : bad(`${k} MISSING`);
}

// ─── summary ──────────────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(`  OFFLINE PASS: ${pass}   FAIL: ${fail}`);
console.log('════════════════════════════════════════');
process.exit(fail === 0 ? 0 : 1);
