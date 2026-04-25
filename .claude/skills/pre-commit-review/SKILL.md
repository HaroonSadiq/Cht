---
name: pre-commit-review
description: Backtest a code change against the existing codebase before it's committed — run available tooling (tests, linters, type-checkers, security scanners, build) and layer Claude's logical review on top to surface bugs, regressions, security issues, performance problems, and code-quality concerns. Use this skill whenever the user is about to commit, push, merge, deploy, open a PR, or otherwise ship a change — and whenever they ask for a "code review", "review my changes", "check this before I commit", "is this safe to ship", "look this over", "diff review", "pre-commit check", "find bugs in this", "what could go wrong with this change", or paste a diff/patch and ask if it's good. Also use when the user describes a change they made or are about to make and wants a sanity check, or when they explicitly ask Claude to be skeptical and find problems. Works for any language, any stack — the skill detects what tooling the project has and uses it. Does NOT fire on "help me write this function" (that's generation) or "why is this broken" (that's debugging an actual error) — only on review-of-existing-or-proposed-changes requests.
---

# Pre-Commit Review

A skill for thoroughly reviewing code changes before they ship. Combines **automated tooling** (tests, lint, types, security scanners) with **Claude's logical review** on the diff itself.

## What this skill is for

The user has written, or is about to write, or is showing Claude a change they're considering committing. Their question is some flavor of: *"Is this good? What's wrong with it? What could break?"*

Claude's job is to **act as a skeptical, thorough reviewer** — find real problems, classify them by severity, and explain them clearly. Not to rubber-stamp. If the change is clean, say so concisely; don't fabricate concerns to seem thorough.

## The four flaw categories

Every finding fits in one of these. The references go deep on each:

1. **Bugs and regressions** — `references/bugs-and-regressions.md`
2. **Security** — `references/security.md`
3. **Performance** — `references/performance.md`
4. **Code quality** — `references/code-quality.md`

Plus tooling detection and invocation: `references/tooling.md`.

## The workflow

Walk these steps in order. **Do not skip steps**, but skip *items within a step* that don't apply (e.g., no test suite to run).

### Step 1 — Identify the change set

Before reviewing anything, know exactly what's being reviewed:

- If the user shared a **diff or patch** in chat → that's the change set.
- If the user shared **before/after snippets** → that's the change set; treat the "after" as the proposed state.
- If there's a **git repo available** in the environment → run `git diff` (vs. the base branch if specified, else `HEAD~1` or `--staged`) to see what's changed.
- If the user just described a change without code → ask for the actual diff or files. Don't review prose descriptions of changes; you'll miss everything.

State what you're reviewing back to the user before going further: *"I'm reviewing 3 files: `src/auth.ts`, `src/db.ts`, and `tests/auth.test.ts`. Going to run the available checks first, then read through the changes."* This catches misunderstandings early.

### Step 2 — Detect available tooling

Read `references/tooling.md` to figure out what to run. Quick version: look at the project files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, etc.) and any CI config (`.github/workflows/*`, `.gitlab-ci.yml`, `Makefile`) to see what the project itself runs. **Use the project's own scripts** when available (`npm test`, `make check`) — they encode the team's expected commands.

If no tooling is configured, skip Step 3 and go straight to Step 4. Don't invent tools that aren't there. Don't install new tools without permission.

### Step 3 — Run the available tools

Invoke them in this order, capturing all output:

1. **Type checker / compiler** (`tsc`, `mypy`, `cargo check`, `go build`) — fastest, catches the most.
2. **Linter** (`eslint`, `ruff`, `clippy`, `golangci-lint`) — catches obvious issues.
3. **Tests** (`npm test`, `pytest`, `cargo test`, `go test ./...`) — catches regressions.
4. **Security scanner** if available (`npm audit`, `pip-audit`, `cargo audit`, `bandit`, `gosec`).
5. **Build** if it's a real project (final integration check).

Run each independently — a failing linter shouldn't stop you from running the tests. Capture full output, not just exit codes; a passing exit code can still have warnings worth surfacing.

If a step takes too long or hangs, stop it cleanly and note it ("test suite was killed after 60s; recommend the user run it locally"). Don't get stuck.

### Step 4 — Claude's logical review

Now read the actual diff line by line. Tools won't catch logic errors, missing edge cases, security holes that aren't pattern-matched, or "this works but is bad."

For each changed file, walk through the references:

- `references/bugs-and-regressions.md` — read with the diff in mind.
- `references/security.md` — same.
- `references/performance.md` — same.
- `references/code-quality.md` — same.

For each finding, note:
- **File and line(s)** the finding refers to.
- **What** the finding is, in one sentence.
- **Why** it matters, in one or two sentences (concrete consequence, not "best practice").
- **Severity** (see below).
- **Suggested fix**, if obvious. If not obvious, say so — don't pad.

Read **enough surrounding context** to confirm a finding is real. A function call that *looks* unsafe might be guarded one frame up. Open the calling files when needed; don't review snippets in isolation.

### Step 5 — Aggregate and report

Combine tooling output and Claude's findings into one structured report. Format below.

## Severity classification

Use exactly these four levels. Be honest — over-flagging makes the report useless.

| Severity | Meaning | Examples |
|---|---|---|
| **BLOCKING** | Will break production or expose users to harm. Do not commit until fixed. | Hardcoded secret, broken auth check, SQL injection, test suite failing, type error, regression that breaks an existing feature. |
| **HIGH** | Real bug or risk that should be fixed before shipping, but might survive a deploy without immediate disaster. | Edge case that throws on empty input, missing rate limit on a new endpoint, N+1 query in a hot path, missing index for a new query. |
| **MEDIUM** | Worth addressing but reasonable to ship and fix in a follow-up. | Test coverage missing for a new branch, slightly awkward error handling, naming inconsistency that will confuse future readers. |
| **LOW** | Nit, style, or matter-of-taste. Surface but don't dwell. | Could simplify this, prefer this naming, missing a comment that would help. |

If you're uncertain about severity, err one notch lower. Reviewers who cry wolf get ignored.

## Report format

Use this exact structure:

```markdown
## Pre-commit review: <short description of the change>

**Reviewed:** <file count> files, <+N / -M> lines.
**Tooling run:** <list, e.g. "tsc, eslint, vitest, npm audit">. <"All passed" | "<N> failed">.

### Tooling results

<For each tool that ran, one block:>

**<tool name>** — <pass/fail/N warnings>
<key output, especially failures. Truncate noise. Always show file:line for failures.>

### Findings

<One section per severity level that has findings, in order BLOCKING → HIGH → MEDIUM → LOW. Skip levels with zero findings.>

#### BLOCKING (N)

1. **<one-line summary>** — `path/to/file.ts:LINE`
   <2–3 sentences explaining what's wrong and why it matters>
   **Suggested fix:** <concrete change, or "see explanation above" if it's nontrivial>

<...>

### Summary

<One paragraph: overall verdict ("ship it after fixing BLOCKING and HIGH" / "ship it" / "don't ship; significant rework needed"), and the one or two most important things the user should know.>
```

If everything is clean: skip the Findings section entirely and write a short Summary that says so. Don't manufacture findings.

## Things to always do

- **State what you're reviewing first.** A diff, a set of files, a paste — name it before going further.
- **Run tools before reading code.** Tooling failures are the cheapest, highest-confidence findings. Don't waste the user's time on a deep logical review of code that doesn't compile.
- **Cite specific lines.** "`src/auth.ts:42`" — never "somewhere in the auth code."
- **Read context.** Don't flag a finding without checking the surrounding 20 lines and the obvious callers/callees. Many "bugs" disappear when you see the guard one frame up.
- **Distinguish certainty levels.** "This will throw on empty input" (certain) vs. "this *might* leak a connection on the error path — worth checking" (uncertain). Both are useful; don't pretend uncertainty is certainty.
- **Skip categories that don't apply.** A docs-only change doesn't need a security review.
- **Quote the offending code** in findings, especially if it spans non-obvious lines. Makes the finding self-contained.

## Things to never do

- **Don't auto-fix without permission.** This is a review skill, not a refactor skill. Surface, explain, suggest. If the user wants the fix applied, they'll ask.
- **Don't fabricate findings** to seem thorough. A clean diff is a fine report.
- **Don't lecture about style** the project doesn't enforce. If they've got Prettier with their own config, don't suggest different brace placement. Match the project's standards.
- **Don't run destructive tools** — anything that modifies the working tree, force-pushes, drops databases, hits production endpoints, or sends real network requests. If a "test" is actually an integration test that hits prod, refuse to run it.
- **Don't install new dependencies** without asking. The project has whatever it has; work with that.
- **Don't claim a tool ran** if you couldn't actually run it. Say it was skipped and why.
- **Don't review the prose** of commit messages or PR descriptions unless asked. Focus on the code.
- **Don't quote the user back to themselves.** If they explained the change, acknowledge it briefly; don't restate it as if it's news.

## Calibration

A common failure mode is **over-flagging on small changes**. A one-line bugfix doesn't need 12 nitpicks. Calibrate the depth of review to the size and risk of the change:

- **One-line typo fix or rename:** a 30-second review. Run the tools. Confirm the change does what it claims. Move on.
- **Single function change:** read the function, its callers, its tests. Look for the things in the references that apply.
- **Multi-file refactor:** full workflow above, with extra attention to API boundaries and missed call sites.
- **Schema migration, auth change, security-sensitive area:** maximum scrutiny. Every reference applies.

Match the depth to the diff. Don't write a novel about a typo.

## When the user pushes back

The user might disagree with a finding ("that's intentional" / "that's not a bug because…"). When that happens:

- If they're right, **say so plainly**. "You're right — I missed the guard on line 12. Withdrawing that finding." Don't pretend you meant something else.
- If you still think it's a real concern, **explain your reasoning concretely** and let them decide. Don't get stubborn or cave just because they pushed.
- If the disagreement is about taste (style, naming), **defer to them**. It's their codebase.

## Reference files

- `references/bugs-and-regressions.md` — logic errors, edge cases, async/concurrency mistakes, contract changes, missed call sites, broken invariants.
- `references/security.md` — secrets, injection, authn/authz, crypto, deps, logging, file paths, deserialization, CSRF, CORS, headers.
- `references/performance.md` — algorithmic complexity, N+1, memory leaks, blocking I/O, unbounded resources, hot-path regressions.
- `references/code-quality.md` — tests, complexity, duplication, naming, dead code, comments, magic numbers.
- `references/tooling.md` — how to detect what's in a project and what to run; per-language quick reference; how to honor project config.
