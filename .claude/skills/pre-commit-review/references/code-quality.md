# Code Quality

The lowest-stakes category — most findings here are MEDIUM or LOW. The user's codebase has its own style; respect it. The job is to flag things that will hurt the *next person* to read this code, not to enforce your preferences.

## Tests — the highest-yield code-quality concern

Tests are the only category here that's often HIGH severity. Code that lacks tests for the change is much more likely to regress.

### What to look for

- **New code with no test changes.** Every new function, branch, or behavior should have a test exercising it. If the diff touches `src/` but not `tests/` or equivalent, ask why.
- **New branches without coverage** — even if the file has tests, a new `if` arm needs its own case. Coverage tooling can confirm if available.
- **Test deletions or skips** without an explanation. `it.skip`, `xit`, `@pytest.mark.skip` added with no comment or referenced ticket.
- **Weakened assertions** — `expect(result).toBeTruthy()` where the previous version checked a specific value. Tests that pass when behavior is wrong are anti-tests.
- **Tests that test the implementation, not the behavior** — e.g., asserting a private method was called rather than the observable outcome. Brittle.
- **Mocks that match too loosely** — `expect(mock).toHaveBeenCalled()` instead of `toHaveBeenCalledWith(...)`. Passes for almost any change.
- **Test data that doesn't match production reality** — every user has full data, every list has a happy length, no nulls anywhere. Real tests need empty/missing/edge cases.
- **Tests that depend on each other** — `test_b` only passes if `test_a` ran first. A reordering or filter run will surface this; flag if visible.
- **Network or filesystem in unit tests** without mocking — slow, flaky, often a sign the code under test isn't decomposed well.

### Test quality questions to apply

For each new test, check:
1. Does it fail if the change isn't applied? (Run the diff backwards mentally — would the test still pass?)
2. Does it cover the failure modes, not just the happy path?
3. Is the assertion specific enough that an unrelated bug couldn't make it pass?

## Complexity

Cyclomatic complexity creeping up isn't itself a problem, but functions that grow during a change often become hard to maintain. Watch for:

- **Functions over ~50 lines** that just got longer.
- **Nesting deeper than 3 levels** introduced by the change.
- **Conditional chains** (`if/else if/else if/...`) that should probably be a lookup or polymorphism.
- **Functions doing two things** introduced by the change — easy refactor, often worth flagging if it's noticeable.

The fix is usually extraction. Don't suggest extraction unless the resulting code would be clearly cleaner; sometimes a long function is honest.

## Duplication

- **Copy-pasted blocks** within the same diff — often indicates a missed abstraction.
- **Logic copied from elsewhere in the codebase** with minor changes — might be intentional (avoiding shared abstraction), might be a missed reuse opportunity. Flag and let the user judge.
- **Type definitions duplicated** in multiple files where one shared definition would do.

Don't aggressively dedupe — premature abstraction is a real cost. Flag duplication when (a) the blocks are non-trivial and (b) they'd plausibly need to change together.

## Naming

Subjective, but some things are clearly worth flagging:

- **Names that don't match what the function/variable does.** A function called `getUser` that also writes a log entry has a side effect not in its name — flag it.
- **Inconsistent naming** within the change — `userId` in one place, `user_id` in another, `uid` in a third, all referring to the same thing.
- **Single-letter or cryptic names** in non-trivial code. `i, j, k` in loops is fine; `x, y, z` for domain objects isn't.
- **Negated names** that get double-negated in conditions — `isNotEmpty` checked as `!isNotEmpty`. Use `isEmpty` and check `!isEmpty(...)`.
- **Booleans named ambiguously** — `flag`, `state` (without context), `enabled` when it's a number of something.

If the project has a naming convention (camelCase vs. snake_case, etc.), respect it; don't suggest a different one.

## Dead code

- **Commented-out code** added in the diff — should almost never be committed; that's what version control is for.
- **Unused imports** introduced.
- **Unused variables / parameters** introduced.
- **Conditions that can never be true** given the surrounding code — `if (x === 'a' && x === 'b')`.
- **Unreachable branches after a `return` / `throw`**.
- **Functions defined but never called** added in the diff.

Many of these are caught by linters. Flag any the linter missed, especially commented-out code.

## Comments and documentation

- **Public APIs without documentation** — exported functions, types, components. Especially if the function's behavior isn't obvious from its signature.
- **Comments contradicting the code** — comment says "returns null on error" but code throws. Either comment is stale or code regressed.
- **`TODO`/`FIXME`/`XXX` added** without an associated issue number or owner.
- **Comments explaining *what* instead of *why*.** `// increment i` is noise; `// retry once with a fresh token if the cache returns 401` is worth keeping.
- **Outdated comments** in the function being changed but not updated.

Don't insist every line have a comment — clean code is often self-documenting. Flag the cases where future readers will be confused.

## Magic numbers and strings

- **Numeric literals with no name** in non-obvious contexts — `if (status === 7)` (what's 7?), `setTimeout(fn, 86400000)` (one day in ms — name it).
- **Repeated string literals** that should be constants — error codes, status names, route paths.
- **Configuration values hardcoded** that should come from env / config — timeouts, limits, URLs.

## Error handling quality

Distinct from the *bug* of error handling (covered in `bugs-and-regressions.md`), this is about the *quality* of error handling:

- **Generic error types** thrown where a specific one would help callers — `throw new Error("bad input")` vs. a typed `ValidationError`.
- **Error messages without context** — `throw new Error("not found")` doesn't say what wasn't found or why.
- **Catch-then-rethrow** without adding context — usually fine to remove.
- **Errors logged at the wrong level** — info-level for a real failure, error-level for an expected condition.

## Style consistency

If the project uses formatters/linters that catch style automatically, **assume style is handled** and don't flag it. The exceptions:

- **Inconsistent style within the change itself** even where the linter allows both — pick one.
- **Style that the linter clearly should have caught but didn't** — the user might want to know their tooling is out of sync.

## Logging

- **Logs added at debug level for things that should be info, or vice versa.**
- **Log messages without enough context** — `logger.info("done")` tells the operator nothing.
- **Sensitive data in logs** — covered in `references/security.md`, but flag here too.
- **Log spam** — a `console.log` inside a per-event handler that will run thousands of times.
- **Inconsistent log structure** — sometimes JSON, sometimes plain string.

## Type safety (when applicable)

- **`any` introduced** where a real type was used or could be inferred (TypeScript).
- **`@ts-ignore` / `# type: ignore`** without an explanatory comment.
- **Type assertions** (`as Foo`) that hide real type problems.
- **Stringly-typed enums** — `status: string` with implicit set of values vs. a literal union or enum.

## File structure and organization

- **Massive new file** introduced (>500 lines) — usually a sign of a missed module boundary.
- **New code in a file that doesn't fit** — putting controller logic in a model file, etc.
- **Circular imports** introduced — sign of misallocated responsibilities.
- **Public API broadened** — exporting things that should stay module-private.

## Migration / commit hygiene

- **Multiple unrelated changes in one commit/diff.** Flag if reviewing across what should clearly be separate concerns; offer to suggest splitting.
- **Generated files committed** that shouldn't be (`dist/`, `build/`).
- **`.env` or local config** committed — covered in security.md, flag there at BLOCKING.
- **Lock file changes inconsistent with manifest changes** — covered in security.md.

## What not to flag

Be calibrated. These are *not* worth flagging:

- **Style preferences** the project doesn't enforce.
- **"Best practices" without a specific consequence** — "you should add a comment here" without a reason.
- **Tabs vs. spaces, semicolons, brace placement** — the formatter handles these.
- **Variable names that are fine but you'd have picked differently.**
- **Functions that could be slightly shorter.**
- **Tests that could be slightly more thorough** when coverage is reasonable.

## Severity guidance

- **HIGH**: New code with no tests for non-trivial logic; tests being deleted or skipped without justification; weakened assertions.
- **MEDIUM**: Significant complexity introduced, duplication that will hurt, missing documentation on public API, magic numbers in non-obvious places.
- **LOW**: Naming, comments, minor style, dead code that the linter would also catch.

Code quality findings are usually advisory. Be helpful, not pedantic.
