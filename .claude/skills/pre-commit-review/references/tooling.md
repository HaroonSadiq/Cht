# Tooling

How to figure out what tools the project has and run them. The principle: **use what the project already uses**. The team chose those tools; their CI runs those tools; the user expects those tools.

## Detection workflow

Walk through these checks in order.

### 1. Read the project's own scripts

The single best signal of what to run.

- **`package.json` `scripts`** — `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Whatever's there is what the project runs.
- **`Makefile`** — `make check`, `make test`, `make lint`. Common in C/C++/Go/multi-language repos.
- **`pyproject.toml` `[tool.poetry.scripts]` or `[project.scripts]`** — Python project commands.
- **`Justfile`** — modern alternative to Make. `just check`, `just test`.
- **`composer.json`** for PHP, **`Rakefile`** for Ruby, **`build.gradle`** / **`pom.xml`** for JVM.

If any of these define a "check" / "verify" / "ci" / "lint" / "test" target, run that. It's curated for this project.

### 2. Read the CI config

If no project-level scripts exist, the CI config tells you what the team runs on every PR:

- `.github/workflows/*.yml`
- `.gitlab-ci.yml`
- `.circleci/config.yml`
- `azure-pipelines.yml`
- `bitbucket-pipelines.yml`
- `Jenkinsfile`

Read the steps. Reproduce the meaningful ones locally.

### 3. Detect by manifest / lockfile

If neither of the above, fall back to language detection:

| File present | Language | Default tools |
|---|---|---|
| `package.json` | Node.js / TypeScript | `tsc`, `eslint`, `prettier`, test runner from `scripts` |
| `pyproject.toml`, `requirements.txt`, `setup.py` | Python | `ruff`, `mypy`, `pytest` (if installed) |
| `Cargo.toml` | Rust | `cargo check`, `cargo clippy`, `cargo test`, `cargo audit` (if installed) |
| `go.mod` | Go | `go vet`, `go build ./...`, `go test ./...`, `golangci-lint` (if installed) |
| `Gemfile` | Ruby | `rubocop`, `rspec` / `minitest` |
| `pom.xml`, `build.gradle` | Java / Kotlin | `mvn verify`, `gradle check` |
| `composer.json` | PHP | `phpstan`, `phpunit` |
| `mix.exs` | Elixir | `mix compile`, `mix test`, `mix credo` |
| `Package.swift` | Swift | `swift build`, `swift test` |

### 4. Honor existing config

Configuration files mean "this is how we run this." Don't override.

- **`.eslintrc*`, `eslint.config.js`** — linter rules.
- **`tsconfig.json`** — TypeScript settings, strictness.
- **`pyproject.toml` `[tool.ruff]` / `[tool.mypy]`** — Python linter/typechecker config.
- **`.prettierrc*`** — formatter config.
- **`rust-toolchain.toml`** — Rust toolchain version.
- **`.tool-versions`** (asdf) — pinned versions.

If you see `--strict` or stricter-than-default settings, those represent intent. Don't relax them.

## Per-language quick reference

For each language, the order to run things in (fastest to slowest):

### Node.js / TypeScript

```bash
# 1. Type check
npx tsc --noEmit

# 2. Lint
npx eslint <changed files>
# or for the whole project: npm run lint

# 3. Format check (if Prettier is configured)
npx prettier --check <changed files>

# 4. Tests (use the project's command)
npm test
# or: npx vitest run, npx jest, etc.

# 5. Security audit
npm audit --audit-level=high

# 6. Build (if applicable)
npm run build
```

Run `tsc` against changed files only when possible — full project typecheck can be slow. Use `--incremental` if a `.tsbuildinfo` exists.

### Python

```bash
# 1. Lint (also catches many type-adjacent issues)
ruff check <changed files>

# 2. Type check
mypy <changed files>

# 3. Format check
ruff format --check <changed files>
# or: black --check

# 4. Tests
pytest
# scope to changed area: pytest tests/<changed module>

# 5. Security
bandit -r <changed dirs>
pip-audit
```

If the project uses a different tool (`pylint` instead of `ruff`, `pyright` instead of `mypy`), match that.

### Go

```bash
# 1. Build / vet
go vet ./...
go build ./...

# 2. Lint (if configured)
golangci-lint run

# 3. Tests
go test -race ./...

# 4. Security
gosec ./...
govulncheck ./...
```

Always run `-race` on tests — Go's race detector catches real concurrency bugs.

### Rust

```bash
# 1. Compile check
cargo check --all-targets

# 2. Lint
cargo clippy --all-targets -- -D warnings

# 3. Format check
cargo fmt --check

# 4. Tests
cargo test

# 5. Security
cargo audit
```

If `clippy` complains about a lint that's been allowed in code (`#[allow(clippy::...)]`), respect the existing allow.

### Java / Kotlin

```bash
# Maven projects:
mvn verify          # compile, test, and many checks

# Gradle:
./gradlew check     # compile, test, lint
./gradlew build     # plus packaging
```

`verify` / `check` typically already includes tests, lint, and static analysis if configured.

### Ruby

```bash
bundle exec rubocop <changed files>
bundle exec rspec   # or rake test for minitest
bundle audit
```

### PHP

```bash
vendor/bin/phpstan analyse <changed paths>
vendor/bin/phpunit
composer audit
```

## Running tools safely

### What's safe to run

- **Read-only checks**: type checking, linting, format checking, security scanning.
- **Tests** — usually safe, *but* see below.
- **Build commands** — usually safe.

### What to NOT run without permission

- **Tests that hit a real database, real APIs, real cloud services.** Look for `INTEGRATION_TEST=1`, `E2E=1`, or test files named `*.integration.*`, `*.e2e.*`. These can mutate real data, send real emails, charge real money.
- **Tests against production credentials.** Check for env vars like `PROD_DB_URL`, `PROD_API_KEY` in test setup.
- **`git push`, `git commit`, `git rebase`** — never as part of a review.
- **`npm install`, `pip install`, `cargo install`** — don't change deps to make tools work.
- **Migrations against any database.**
- **Anything marked "destructive" in the project's own scripts** (e.g., `npm run reset-db`).

When in doubt, ask the user before running.

### Capturing output

- Capture **both stdout and stderr** — many tools write to stderr.
- Capture exit codes — a tool can exit 0 with warnings, or exit non-0 with useful output.
- Truncate noisy output before showing the user — focus on the meaningful failures and counts.

## Interpreting results

### Tooling pass = no findings in that category? No.

A passing typecheck doesn't mean no logic bugs. A passing test suite doesn't mean the code is correct (only that the asserted things still hold). A clean linter doesn't mean the code is good. **Tooling is a floor, not a ceiling**.

After running tools, always do the logical review.

### Tooling fail = blocking?

Usually yes. Specifically:

- **Type error**: BLOCKING. If the code doesn't type-check, it's broken.
- **Test failure**: BLOCKING. The test was passing before; it's not now.
- **Lint warning** (not error): MEDIUM unless the warning is in the security category.
- **Lint error**: depends — if the project's CI fails on it, BLOCKING.
- **Format error**: LOW — it's mechanical to fix.
- **Security audit HIGH/CRITICAL**: HIGH or BLOCKING.
- **Security audit LOW/MEDIUM**: MEDIUM.

If a test was already failing on the base branch (not introduced by this diff), note that but don't blame the diff.

### Flaky tests

If a test passes one run and fails the next, note it and move on. Flag flakiness as a quality concern but don't insist it's a regression unless you have evidence.

## When no tooling is available

If the project has no test suite, no linter, and no type checker:

- Note this in the report: "No automated tooling found. Review is based on reading the diff alone."
- Suggest *one* concrete piece of tooling that would help most ("This project has no tests — consider adding a test framework so future changes can be validated automatically"). Don't dump a long list.
- Lean harder on the logical review.

## When tooling is misconfigured

Sometimes the project's own commands fail not because of the diff, but because the environment isn't set up — missing env vars, missing services, etc.

- **Distinguish the failure mode** in the report. "The test command failed because `DATABASE_URL` is not set in this environment, not because the code is broken."
- Suggest the user run it themselves locally.
- Don't claim a finding the tool didn't actually validate.

## When tooling takes too long

Some test suites take 20 minutes. Don't block the review on them:

- **Set a timeout** (60–90s for most checks; longer only if the user signals a long-running suite is expected).
- If it times out: report what completed and note the rest was skipped.
- Suggest the user run the full suite locally before merging.

## Honoring project velocity

The user might already know about a finding ("yeah, that lint warning is pre-existing, ignore it"). When the tool surfaces a pre-existing issue not introduced by the diff:

- **Note it briefly** but don't treat it as introduced by this change.
- Compare against `main` / the base branch where possible — `git stash; <run tools>; git stash pop` to confirm the warning is new.

If you can't tell whether a warning is new or pre-existing, flag it but caveat the uncertainty.
