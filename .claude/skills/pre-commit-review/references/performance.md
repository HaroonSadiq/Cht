# Performance

The category most prone to noise. Most code doesn't need to be fast, and premature optimization is real. **Only flag perf concerns when the path is hot, the regression is meaningful, or the change introduces unbounded resource use.**

## Where performance actually matters

Before flagging, ask: *will this code run hot enough for this to matter?*

**Hot paths (worth scrutinizing):**

- Request handlers, especially auth middleware and anything in the request hot path.
- Database queries — every query is hot relative to non-DB code.
- Loops over user-provided collections of unknown size.
- Anything called per-message, per-row, per-event in a stream/queue/webhook.
- Browser render paths and re-render triggers.
- Cron jobs that touch large tables.
- WebSocket handlers, especially broadcast logic.

**Cold paths (don't sweat micro-optimizations):**

- One-time startup code.
- Admin tools and scripts.
- Test setup.
- CLI commands run by humans, not in production loops.

A slow function in a cold path is fine. A 10× slowdown in a request handler is not.

## Algorithmic complexity changes

The highest-impact category — a change from O(n) to O(n²) on a path that handles user-provided collections is a real bug.

### Patterns to flag

- **Nested loops where there used to be a single loop** — confirm the inner one isn't constant-time.
- **`.includes()` / `.indexOf()` / `array.find` inside a loop** — O(n) inside O(n) = O(n²). Use a `Set`/`Map`.
- **`Array.prototype.sort()` added inside a loop** — sorting on every iteration.
- **Linear search for membership** when the collection is large — switch to a hash structure.
- **Recursive function** without memoization where subproblems overlap (classic naive Fibonacci).
- **Repeated `JSON.parse(JSON.stringify(...))`** for cloning — O(n) per call, often called in loops.

### Reading complexity from a diff

For each new loop, ask:
1. What's it iterating over? Bounded constant or user-controlled length?
2. What's inside? Constant work, another loop, an I/O call?
3. What's the realistic max size in production?

A nested loop over arrays of length 5 is fine. A nested loop over arrays that can be thousands of elements is a problem.

## N+1 queries (and the broader "I/O in a loop" problem)

The single most common backend perf bug.

### What it looks like

```ts
for (const user of users) {
  const orders = await db.query('SELECT * FROM orders WHERE user_id = $1', [user.id]);
  // ...
}
```

10 users → 11 queries. 1000 users → 1001 queries. Usually a 10–100× slowdown vs. one query.

### Variants to spot

- **ORM lazy loads in a loop** — `users.forEach(u => u.orders)` triggering a query per user.
- **HTTP calls in a loop** without parallelization or batching.
- **Cache lookups in a loop** when a multi-get / pipeline exists.
- **Re-querying the same data** inside a loop body — the query result doesn't depend on the loop variable.

### The fix to suggest

Single query with `WHERE user_id IN (...)`, joined by application code; or a JOIN; or a `Promise.all`/`asyncio.gather` for parallelization (only if the I/O is independent).

## Memory issues

### Memory leaks

- **Event listeners** added but never removed (browser, Node.js EventEmitter, WebSocket).
- **`useEffect`** without cleanup that subscribes/listens.
- **Long-lived caches** with no size bound or eviction (Map / dict / object).
- **Closures holding references** to large objects after they should be GC'd — especially in event handlers and timers.
- **Goroutine/thread leaks** in Go/Java — launched without a way to terminate.
- **Streams not properly closed** on the error path.

### Excessive memory use

- **Loading the whole table into memory** for processing — paginate or stream.
- **Large arrays built then immediately filtered** — `.map().filter().reduce()` chains create intermediate arrays. Usually fine; in hot paths and very large collections, fuse them.
- **String concatenation in a loop** in some languages (Java pre-StringBuilder, Python before `"".join`) — quadratic memory and time.
- **Deep cloning** when a shallow copy or even no copy would suffice.

## Blocking I/O

In single-threaded async runtimes (Node, Python asyncio, browsers), blocking the event loop blocks everything.

### Patterns to flag

- **Synchronous file I/O** in a request handler: `fs.readFileSync`, `open(...).read()` (Python sync).
- **Synchronous network calls** in async code.
- **CPU-heavy work** on the event loop (cryptography, JSON parse of MB-scale payloads, regex with catastrophic backtracking).
- **`while(true)` loops** in async code without `await` somewhere — starves other work.

### Browser-specific

- Long synchronous tasks (`>50ms`) on the main thread → jank, unresponsive UI. Move to a Web Worker.
- Layout thrashing — alternating reads (`offsetHeight`) and writes (`style.x`) in a loop.

## Database and query performance

When the diff touches DB code:

### Schema and indexing

- **New query pattern, no supporting index.** A `WHERE col1 = ? AND col2 = ?` query with no index on `(col1, col2)` is a full scan.
- **Index dropped or modified** without checking what queries used it.
- **Adding a column with a default to a large table** — locks the table on some DBs; consider a backfill migration.
- **`SELECT *`** added in a hot path — fetches columns the code doesn't use, including potentially large ones.
- **`ORDER BY` without an index** — sort on every query. Fine for small results; bad for paginated unbounded queries.
- **`LIMIT` without `ORDER BY`** — returns nondeterministic rows. Often a bug, sometimes a perf concern when the DB picks a bad plan.
- **`OFFSET` for deep pagination** — `OFFSET 100000` scans 100k rows. Use cursor pagination on hot paths.

### Transactions

- **Long transactions** holding locks — slow code inside `BEGIN ... COMMIT`.
- **`SELECT ... FOR UPDATE`** added in a hot path — serializes contention.
- **N+1 inside a transaction** — multiplied cost.

### Connection management

- **New code that opens its own connection** instead of using the pool — exhausts connections under load.
- **Long-held connection** for a slow operation — depletes the pool.

## Frontend / React-specific

When changes touch React components:

- **Inline objects/arrays/functions in JSX props** to memoized children — defeats memoization.
- **`useEffect` dependencies missing** — stale closures, common bug + perf issue.
- **`useEffect` dependencies overspecified** — re-runs on every render.
- **Large lists rendered without virtualization** — DOM with 10k nodes is slow.
- **State lifted higher than needed** — every change re-renders the whole tree.
- **`key` prop** as array index when the list reorders — re-renders all items.
- **Heavy work in render** — should be in `useMemo`, an effect, or moved out.

## Network and bundle size

- **New large dependency** for a small feature — bundle size impact (`bundlephobia.com` for JS).
- **Importing entire library** when a single function is needed (`import _ from 'lodash'` vs. `import map from 'lodash/map'`).
- **Synchronous imports** of code that should be lazy-loaded (admin-only features, etc.).
- **Inlining large assets** (images, fonts) that should be served separately and cached.

## Caching changes

- **Cache invalidation logic added** — does it cover all the writes that could stale the cache?
- **Cache key changes** — old cached entries are now orphaned (memory) or read by new code expecting new shape (bugs).
- **TTL changed** — confirm the new TTL is appropriate for the data freshness requirements.
- **Negative caching** — caching "not found" can mask real fixes.

## Resource exhaustion patterns

### Things that should always have bounds

- **Queues** — without a max size, a producer outpacing the consumer fills memory until OOM.
- **Retries** — without a max attempts and exponential backoff cap, a flapping dependency hammers itself.
- **Concurrent operations** — `Promise.all` over an unbounded list of HTTP calls melts the network. Use a concurrency limiter.
- **Recursion depth** — runaway recursion is a stack overflow.
- **Cache size** — see "Memory issues".
- **Log volume** — `console.log` inside a per-event handler can flood log infrastructure.

### Timeouts

Every external call should have a timeout. New code making HTTP/DB/cache calls without a timeout: flag it.

## Hot-path regressions

When a function in a hot path is changed:

- **New work added per call** — flag if it's nontrivial (a query, a remote call, a JSON parse).
- **A cheap check replaced by an expensive one** — e.g., regex replaced with a more "robust" parser.
- **Allocation inside a tight loop** — minor in most languages, real in others (Go, Rust on resource-constrained targets).

## When in doubt: measure or defer

Performance findings are only useful if they're real. If you're uncertain whether a change is fast enough:

- **Suggest a benchmark or profiling step** rather than insisting it's slow.
- **Quantify the concern**: "If `users` is typically <10, this is fine. If it can be thousands, this becomes O(n²) and slow."
- **Defer to evidence** the user has — if they've profiled and this isn't hot, accept it.

## Severity guidance

- **BLOCKING**: New unbounded loop on a hot path that can cause production outages or DoS. Connection-pool-exhausting patterns. Memory leak that grows per-request.
- **HIGH**: Clear N+1 in a request handler, complexity regression on user-provided input, missing index on a new query pattern.
- **MEDIUM**: Inefficient code in a path that's not hot but might become hot, missing `useMemo` on a known-expensive computation.
- **LOW**: Micro-optimizations, "this could be slightly faster," cosmetic perf improvements.

Most perf findings should be MEDIUM or LOW. Reserve HIGH/BLOCKING for things that will actually hurt production.
