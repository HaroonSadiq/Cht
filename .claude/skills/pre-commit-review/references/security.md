# Security

The category where false negatives are most expensive. Be paranoid, but be specific — a vague "this looks insecure" without a concrete attack is noise.

## The first scan: never let these ship

These are **always BLOCKING** if found in a diff:

### Hardcoded secrets

API keys, tokens, passwords, private keys, OAuth client secrets, database credentials, encryption keys committed in plaintext anywhere — source files, configs, fixtures, tests, comments, even README.

What to look for:
- String literals matching: `sk_live_`, `sk-`, `xox[bp]-`, `AKIA`, `ghp_`, `glpat-`, `Bearer eyJ` (JWT), `-----BEGIN`, long base64-looking strings near words like `key`, `token`, `secret`, `password`.
- `.env` files committed (check `.gitignore`).
- Connection strings with credentials inline (`postgres://user:password@host`).
- Test fixtures with real-looking credentials (often forgotten leftovers from "let me just hardcode it for now").

If found: **BLOCKING**. The remediation isn't just "remove it from the diff" — the secret is now in git history, must be rotated immediately. Say this explicitly in the finding.

### Authentication / authorization missing or broken

- A new endpoint with no auth check.
- An auth check that runs on a wrong field (`req.user.id == params.id` where `params.id` is attacker-controlled, but the check doesn't verify the resource actually belongs to the user).
- `requireAdmin` / `requireAuth` / similar middleware removed from a route.
- `if (user.role)` (truthy check on role string) instead of comparing to a specific role.
- A function that accepts a `userId` parameter from the request without verifying it matches the authenticated user.

### Direct object reference / IDOR

- Endpoint reads/writes a resource by ID from the URL or body, but doesn't verify the authenticated user owns that resource.
- `SELECT * FROM orders WHERE id = $1` — should be `WHERE id = $1 AND user_id = $2`.

### SQL injection

- Any string-concatenated SQL: `` `SELECT * FROM users WHERE name = '${name}'` ``.
- `query(`...${userInput}...`)` template strings going into a raw query method.
- ORM `.raw()` / `.query()` calls with interpolated values.
- Dynamic table or column names from user input — parameterization doesn't fix this; need an allowlist.

If parameterized queries are used (`$1`, `?`, named params), it's safe. If not, **BLOCKING**.

### Command injection

- `exec(`command ${input}`)`, `spawn('sh', ['-c', input])`, `os.system(...)`, `Runtime.exec(stringConcat)`.
- Use the array form of `spawn` with arguments separate from the command, or an explicit allowlist.

### Path traversal

- `fs.readFile(path.join(baseDir, userInput))` — `userInput = "../../../etc/passwd"` escapes baseDir.
- Fix: resolve and check the result is still inside the intended directory.

### Server-side request forgery (SSRF)

- `fetch(userProvidedUrl)` from server code with no allowlist or scheme check.
- Especially dangerous: webhooks, image proxies, URL preview generators, "import from URL" features.
- Block private IP ranges, file://, internal hostnames; ideally allowlist domains.

### Insecure deserialization

- `pickle.loads(userInput)` (Python) — RCE.
- `JSON.parse` on untrusted input is fine; `eval` on untrusted input is not.
- Java: `ObjectInputStream.readObject` from untrusted source — historically RCE.
- YAML: `yaml.load` (unsafe) vs. `yaml.safe_load`.

### Cross-site scripting (XSS)

- `innerHTML = userInput` in browser code.
- React: `dangerouslySetInnerHTML` with unsanitized user input.
- Server-rendering user-supplied HTML without escaping.
- Backticks or string concatenation building HTML in any language.

### Secrets in logs / errors

- `console.log(req.headers)` — likely contains the Authorization header.
- `logger.error(`failed for user ${JSON.stringify(user)}`)` — user object often contains password hash or PII.
- Error responses that include stack traces to the client in production.

## Crypto-related findings

- **Hardcoded key/IV** — must come from a secret manager or be randomly generated per use.
- **Weak algorithms** — MD5, SHA-1 for security purposes (file integrity is fine; password hashing is not). DES. RC4.
- **ECB mode** — almost never the right choice. GCM is the modern default.
- **Static IVs** in CBC/CTR — defeats the purpose of an IV.
- **`Math.random()`** for security purposes — use `crypto.randomBytes` / `secrets` module / `OsRng`.
- **Password storage with plain hash** (`sha256(password)`) instead of `bcrypt`/`scrypt`/`argon2`.
- **Missing constant-time comparison** for tokens/HMACs — `===` leaks timing.
- **JWT issues**: `none` algorithm accepted, secret too short, no expiry check, signature not verified.

## Dependencies and supply chain

When the diff modifies `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, etc.:

- **Run the audit tool** (`npm audit`, `pip-audit`, `cargo audit`, etc.) — surface any HIGH or CRITICAL vulnerabilities.
- **Check for typo-squats** — packages with names suspiciously close to popular ones (`lodahs`, `reqeusts`).
- **New top-level deps**: who maintains it? Is it actively updated? When was the last release?
- **Pinning** — exact version (`1.2.3`) vs. semver range (`^1.2.3`). New deps in security-sensitive paths should be pinned.
- **Lock file changes** — diff in `package-lock.json` / `poetry.lock` should match the manifest changes; unrelated lock changes are suspicious.

## Authn/authz patterns to verify

When auth code is touched at all, walk through:

1. **Where is the user identity established?** Session cookie? Bearer token? Verify the verification step is correct (signature checked, not expired, issuer valid).
2. **Where is authorization decided?** It should be at the entry to each protected operation, not "earlier in the request."
3. **What's the default?** Default-deny is correct. Default-allow with explicit deny is fragile — easy to miss a path.
4. **Does the check use the authenticated identity, not request input?** `currentUser.id`, not `req.body.userId`.
5. **For multi-tenant systems**, every query touching tenant-scoped data has a tenant filter — `WHERE org_id = $1` on every read and write.

## Sensitive data handling

- **PII in logs** — emails, phone numbers, addresses, full names in log lines.
- **PII in URL query strings** — they end up in access logs, browser history, referer headers. Use POST bodies for sensitive data.
- **PII in error messages** returned to the client.
- **Tokens/secrets in URL query strings** — same problem, plus they get cached.
- **Storing more than necessary** — retention policy on `message_text`, IP addresses, etc.

## CSRF and CORS

- **State-changing endpoints (POST/PUT/DELETE) without CSRF protection** in a cookie-auth context. Modern frameworks usually have this on by default — verify it wasn't disabled.
- **CORS `Access-Control-Allow-Origin: *`** combined with cookies (`credentials: true`) — browsers block this combination, but a misconfiguration that "works" is suspicious.
- **Reflected `Origin` header** — `Access-Control-Allow-Origin: <whatever the request sent>` defeats CORS.
- **Subdomain wildcards** (`*.example.com`) when subdomains can be hosted by users.

## Web security headers

When responses or middleware are touched:

- `Content-Security-Policy` — added or relaxed? `unsafe-inline` / `unsafe-eval` / `*` are red flags.
- `X-Frame-Options` / `frame-ancestors` — clickjacking protection.
- `Strict-Transport-Security` on HTTPS endpoints.
- `X-Content-Type-Options: nosniff`.

## Webhook handlers (relevant to many projects)

- **Signature verification** — every webhook from an external service should verify the signature on the raw body, in constant time. Skipping this is how third parties spoof events to your backend.
- **Idempotency** — replays should not double-execute.
- **Rate limiting** on the public endpoint.

## File upload

- **MIME type / extension checks alone** are bypassable. Validate by content where possible.
- **Storing uploads in a path served by the web server** without sanitizing the filename → path traversal, content-type confusion.
- **Image processing libraries** (ImageMagick, etc.) — historically a source of RCE; verify versions are current and processing happens in a sandbox if possible.
- **Size limits** — both per-file and per-request. Without them, DoS is trivial.

## Things that look like findings but aren't

Don't waste the user's time on:

- **HTTPS warnings on `localhost`** in dev configs.
- **Hardcoded test credentials** in test fixtures clearly marked as such (`testPassword123`) — flag if uncertain, but don't insist.
- **`any` types in tests** that mock complex objects.
- **A function that takes user input and uses it in a query** when the surrounding code already validates and parameterizes — read the surrounding code before flagging.

## Severity guidance for security findings

- **BLOCKING**: secrets in code, missing auth on a real endpoint, SQL/command injection in a real path, broken crypto on user data, RCE-class deserialization.
- **HIGH**: missing CSRF on a state-changing endpoint, CORS misconfig allowing credentialed cross-origin reads, weak hash for passwords, `npm audit` HIGH+ on a touched dep.
- **MEDIUM**: missing security headers, PII in non-production logs, dependency at outdated version with no known CVE.
- **LOW**: defensive coding improvements ("could also validate this here"), nit-level header tweaks.

When uncertain whether something is exploitable, describe the precondition and let the user judge: "This is exploitable if `req.params.id` is ever attacker-controlled — which it is on this route."
