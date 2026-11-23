# Contributing to nemo

Thanks for helping. Bug reports, ideas, docs fixes, new steps and setups, console features and
agent-check skills are all welcome. This page says how to get set up, what a good change looks
like, and what to check before you open a pull request.

## Before you start

- **A bug or an idea:** open an [issue](https://github.com/miroslaws8/nemo/issues/new/choose)
  first, so we can agree on the shape of a larger change before you write it.
- **A security problem:** do not open a public issue. Report it privately through
  **Security** → **Report a vulnerability**.
- **A small fix** (a typo, a clearer error message, a missing doc line): a pull request is enough.

## Set up

Node.js 24 and pnpm 10 (`npm install -g pnpm@latest-10`).

```bash
git clone https://github.com/miroslaws8/nemo.git && cd nemo
pnpm install
pnpm exec playwright install chromium
pnpm console:setup          # only for work on the QA Console
```

There is no workspace file on purpose: the root, `console/server`, `console/web` and the
`scripts` of two Hermes skills each have their own `pnpm-lock.yaml`. Install in the folder you
change, and do not add a `pnpm-workspace.yaml`.

## Branches

- `develop` is where work lands; `main` follows it on each release.
- Branch off `develop` and open your pull request against `develop`.
- Keep a pull request to one change. Refactors go in their own pull request, apart from
  behaviour changes.

## Making a change

### Engine and console code (TypeScript)

- `strict`, never `any`; no `as` assertions except narrowing `unknown` after a runtime check; no
  non-null assertions (`!`).
- Interfaces start with `I` and live in `engine/types/index.ts` (web-only types in
  `console/web/src/types.ts`); explicit return types on exported functions; no `enum`.
- Descriptive names, braces on every `if`.
- Dispatch by type through registries and strategy maps (steps, setups, resource gateways, the
  console's modes and run kinds), not chains of conditionals.
- Validate anything external (YAML files, API responses, settings) with zod, with errors that
  point at `file:line`.
- Format with Prettier: `pnpm format`.

[CLAUDE.md](CLAUDE.md) has the full set of conventions, including the QA Console's architecture
(NestJS modules, the HTTP contract in `console/shared/api.ts`, access rules, workspaces and
runners).

### Tests (YAML)

- Tests are YAML only: never add a TypeScript spec per test.
- Every test file declares its `tier`. `smoke` is read-only: no setup that creates data, no
  `track` step.
- Name the data a test creates with `${test.data_title}`, and register data created through the
  UI with `- track: { kind, title }`, so it is cleaned up.
- Reach a page by its route (`goto: /dashboard/quizzes`), not by clicking through menus, unless
  the click is what the test checks.
- Never add waits or retries for API rate limits (429): the engine waits them out.
- Never switch the error check off to get a test green; accept a known error with an `ignore`
  regex in `e2e.config.yaml`.

### What else to update

| You changed | Also do |
|---|---|
| a step, setup, template or the tiers | `pnpm schema` (validate fails while the editor schemas are stale) |
| a skill's `skill.yaml` or `hermes/skill-template.md` | `pnpm skills` (never edit a `SKILL.md` by hand) |
| a live event (`engine/reporters/live-events.ts`) | the reducer in `console/shared/reducer.ts`; bump `engine/console-protocol.json` if older consoles can't read it |
| `@playwright/test` | the Playwright image tag in `Dockerfile`, `bitbucket-pipelines.yml` and `.github/workflows/` |
| behaviour people use | the docs: `README.md`, `docs/guide.md` or `console/deploy/README.md` |

## Checks

Run these before you push; the `Validate` workflow runs the same on every pull request:

```bash
pnpm typecheck && pnpm format:check && pnpm validate
pnpm console:check          # if you changed console/
bash ci/validate.sh         # everything CI checks, in one go
```

`pnpm validate` is offline: it needs no app, no credentials and no browser. A change to the
example tests can also be run against your own environment (`pnpm exec playwright test`), but
pull requests are never required to.

## Commits and pull requests

- Write commit messages in the imperative, saying what changes and why: `Wait for the deploy
  before the smoke tier`, not `fixes`.
- In the pull request, say what changed, why, and how you checked it. Screenshots help for
  anything in the console.
- Never commit credentials, `.env`, `.auth/`, `reports/` or `test-results/`: they hold
  passwords and session tokens. Keep personal data, real hosts and machine paths out of tests,
  templates and skills (use `example.com`, `~/.hermes/…` and `~/nemo-output/…`).

## License

nemo is licensed under the [Apache License, Version 2.0](LICENSE). By contributing, you agree
that your contributions are licensed under the same terms (section 5 of the license).
