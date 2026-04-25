# Bugs and Regressions

The category that catches the most real damage. Tooling catches some of these (type errors, lint warnings); a careful read of the diff catches the rest.

## Read the diff with these questions in mind

For every change, ask:

1. **What contract changed?** Function signature, return shape, thrown exceptions, side effects, performance characteristics. Did all callers get updated?
2. **What invariant might have broken?** "This list is always non-empty," "this map always contains key X after init," "this state transition only goes A→B→C." Diffs that touch the invariant-establishing code without touching the invariant-relying code are the classic regression source.
3. **What edge cases does this code see in production that the diff doesn't address?** Empty input, single-element input, very large input, null/undefined, special characters, Unicode, dates around DST transitions, concurrency.
4. **What used to be tested and isn't anymore?** Test deletions, `.skip` calls, weakened assertions.

## High-yield bug patterns

### Off-by-one and boundary errors

- Loops that change from `<` to `<=` or vice versa.
- Slicing with `n` vs `n+1` vs `n-1`.
- Pagination changes — does the last page work? does an empty result work?
- "Inclusive on both ends" vs "exclusive on the right" — which does this function expect, and which is the caller passing?

### Null, undefined, missing, empty

- Optional chaining (`?.`) added in some places but not others — does the code below assume it's defined now?
- A function that used to return `T` now returns `T | null` — every caller needs a check.
- An empty array `[]` vs. `null` vs. `undefined` — coerce to the same thing or you get bugs at the boundary.
- `if (x)` where `x` could be `0`, `""`, or `false` legitimately. Use `x != null` or explicit comparison.

### Async, promises, callbacks

- Missing `await` — `async` function called as if it were sync. Result is a Promise, not the value. The next line operates on a Promise.
- `Promise.all` over `for await` — fine for parallel, broken if the operations have ordering dependencies or shared rate limits.
- Errors swallowed in `.catch()` with no rethrow or log.
- A `try/catch` around an `await` that's actually around the function call (synchronous part) — the rejection is uncaught.
- Callbacks passed to APIs that expect `(err, data)` getting called with the wrong shape.
- Race conditions: two parallel updates to the same record without locking or optimistic concurrency.

### Concurrency and ordering

- Code assuming events arrive in the order they were sent. Networks reorder. Queues sometimes do.
- Idempotency: if this handler runs twice on the same input, what happens? In webhooks especially.
- Shared mutable state (module-level variables, singletons) being mutated from a request handler.
- Locks acquired in different orders in different code paths → deadlock.

### State machine and lifecycle

- New state added but transitions out of it weren't defined → contact stuck.
- A guard/precondition removed without realizing what it protected.
- Initialization order: B is now constructed before A, but A depended on side effects of B's constructor.
- Cleanup paths: error happens after resource acquired, before it's released.

### Contract changes that miss call sites

- Function renamed or signature changed in `lib/`, but a call in `scripts/` or `tests/` or a generated client wasn't updated.
- A type widened (e.g., field becomes optional) — a downstream function that used to enforce non-null no longer does.
- An enum value renamed/removed — does the database have rows with the old value? Does a config file mention it?
- Default value changed — every caller relying on the old default is silently affected.

### Type coercion / mixed types

- String concatenation when one side is sometimes a number → `"5" + 3 = "53"` vs `5 + 3 = 8`.
- JSON numbers vs strings — IDs that should be strings represented as numbers in JS lose precision past 2^53.
- Date parsing across timezones — `new Date("2024-01-15")` is UTC midnight; `new Date("2024-01-15T00:00:00")` is local. Different days for many users.
- Boolean coercion of strings — `"false"` is truthy.

### Data integrity and migrations

- Schema change without a backfill — existing rows have NULL where the code expects a value.
- New required field added — old code paths that insert without it now fail.
- Renamed column with no backwards-compat shim — running both old and new code (rolling deploy) breaks.
- Index changed/dropped without checking what queries used it — silent perf regression.
- Constraint added — existing data violates it, migration fails on production volume.

### Test regressions

- A test that was checking *X happened* now checks *something happened* (weakened assertion).
- A `describe.skip` or `it.skip` added without a comment or ticket explaining why.
- New code with no tests at all — at minimum, every new branch needs coverage.
- Mocks that match too loosely — `expect(mock).toHaveBeenCalled()` instead of `toHaveBeenCalledWith(specific args)`.

### Error handling

- New code path that throws but isn't documented in the function's contract.
- `catch (e) { console.log(e) }` — the error is logged but execution continues with broken state.
- Re-throwing a generic `Error` and losing the original stack/cause.
- Returning `null` for "not found" but `throw` for "permission denied" — callers that just check `null` will silently surface auth bugs as "not found".

## Reading the diff like a reviewer

For every changed function, hold these in your head:

- **Who calls it?** Search the codebase. (Use `grep -rn` or the IDE's find-references.)
- **Who does it call?** Did any of those change in this diff too?
- **What were its inputs in production yesterday?** Check tests and recent logs/issues if available.
- **What's the narrowest change that achieves the user's goal?** If the diff does more than that, ask why.

## Specific patterns by language family

### TypeScript / JavaScript

- `any` introduced where a real type existed before.
- `as` cast (especially `as unknown as T`) — bypasses the type system; high suspicion.
- `// @ts-ignore` / `// @ts-expect-error` — investigate the underlying issue.
- `Object.assign({}, ...)` overwrite order surprises.
- Mutating function parameters — caller's reference changes too.
- Class field assignment in constructor vs. inline — initialization order around `super()`.

### Python

- Mutable default argument (`def f(x=[]):`) — shared across calls.
- `is` vs `==` for comparison (use `is` only for `None`, `True`, `False`, and identity).
- `except:` or `except Exception:` swallowing too broadly.
- Generator exhausted by an early consumer; second consumer gets nothing.
- f-string vs `format` vs `%` mixed — usually fine, but watch escape semantics.

### Go

- `err` ignored or shadowed (`if err := f(); err != nil {}` then later `err` refers to outer).
- Goroutine leaks: launched without a way to stop it, or waiting on a channel that never closes.
- `for _, v := range slice` capturing `&v` — same address every iteration (pre-Go 1.22).
- Nil interface ≠ nil pointer wrapped in interface — common subtle bug.

### Rust

- `.unwrap()` / `.expect()` added in code paths that aren't proven infallible.
- `Clone` added to silence borrow checker — sometimes the right call, sometimes hiding a design issue.
- `unsafe` blocks — every one needs a safety comment justifying it.
- Drop order changes when refactoring struct fields.

### Java / Kotlin

- `equals()` without `hashCode()` (or vice versa).
- `==` vs `.equals()` for objects.
- Resources without try-with-resources (Java) or `use {}` (Kotlin).
- Nullable types in Kotlin being asserted with `!!` — every one is a potential NPE.

## When in doubt

If something feels off but you can't articulate why, **say so**. "Line 47 looks suspicious — `cache.get(key)` is called twice and I'm not sure if `key` could change between calls. Worth a closer look." Honest uncertainty is more useful than confident wrongness or silence.
