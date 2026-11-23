# myqa

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Validate](https://github.com/miroslaws8/nemo/actions/workflows/validate.yml/badge.svg)](https://github.com/miroslaws8/nemo/actions/workflows/validate.yml)

End-to-end QA for web apps that runs against your deployed environments: tests written in
**YAML** and run by **Playwright Test**, a **QA Console** to start, watch, stop and retry runs,
and **agent checks** in which an LLM agent explores the app like a tester and reports
PASS / FAIL with screenshots.

```yaml
suite: Quiz — take it as a learner
tier: regression
setup: [quiz]                     # created through the API, deleted after the test
tests:
  - name: answers every question and sees the score
    steps:
      - goto: ${quiz.player_url}
      - click: { button: Start Quiz }
      - repeat:                   # one round per question
          until: { text: Quiz Completed }
          steps:
            - click: { role: radio, nth: 0 }
            - click: { button: Check answer }
            - click: { button: Continue }
      - expect_visible: { text: "${quiz.questions} of ${quiz.questions} right" }
```

## Why

- **Tests without code.** A test is a YAML file; `engine/yaml.spec.ts` turns each one into a
  Playwright test. Data-driven tests (`each:`), reusable templates, tags and editor
  autocompletion from JSON Schemas come with it.
- **Safe on real environments.** Everything a test creates is titled with a prefix and cleaned
  up afterwards; deletion re-reads each record and refuses anything the test user does not own or
  that is protected. A sweeper removes what a failed run left behind.
- **Tiers and profiles.** `smoke` (read-only, also the prod monitor), `regression` (creates data)
  and `ai` (spends credits, so it runs only after a green smoke tier), combined into profiles
  such as `post-deploy`.
- **Fails on what users would see.** Every test ends with an error check: API 5xx/401/403
  responses, error toasts and alerts, error pages, a redirect to the login page. Known, accepted
  errors are listed as regexes. API rate limits (429) are waited out, not reported.
- **A console for the team.** Start runs, watch each step live with its screenshot, stop, retry
  the failed tests, clean up, follow CI runs. Locally with no sign-in, or as a server with OAuth
  sign-in, roles (viewer, runner, operator), guarded environments and an audit log.
- **Agent checks.** [Hermes Agent](https://github.com/NousResearch/hermes-agent) follows a
  written skill in a real browser with an OpenAI or Anthropic model, marks what is wrong on its
  screenshots, and reports what it spent, within a daily budget.

## How it works

```
tests/**/*.test.yaml ─┐
templates/            ├─► engine/ (YAML → Playwright Test) ─► reports/ (HTML, traces, JUnit)
data/                 │     steps · setups · cleanup · error monitor
e2e.config.yaml ──────┘
                             ▲                    ▲
          ci/ + .github/workflows/        console/ (QA Console: NestJS + Vue)
          bitbucket-pipelines.yml               │
                                                └─► hermes/ skills → agent checks (Hermes Agent)
```

## Quick start

Requirements: Node.js 24 and pnpm 10 (`npm install -g pnpm@latest-10`).

```bash
git clone https://github.com/miroslaws8/nemo.git myqa && cd myqa
pnpm install
pnpm exec playwright install chromium
pnpm validate                       # offline: config, tests, templates, schemas, skills
```

Point it at your app:

1. **`e2e.config.yaml`** — your environments (`base_url`, `api_url`, the sign-in origin), tiers,
   profiles and safety settings. See [Configuration](docs/guide.md#configuration--e2econfigyaml).
2. **`.env`** (git-ignored) — the QA account of each environment, by its `credentials` name:
   ```bash
   QA_STAGE_EMAIL=qa@example.com
   QA_STAGE_PASSWORD=…
   ```
3. **Run:**
   ```bash
   pnpm exec playwright test                          # the default profile (smoke) on staging
   E2E_PROFILE=post-deploy pnpm exec playwright test  # every tier
   pnpm report                                        # the HTML report: each step and its screenshot
   pnpm ui                                            # Playwright's UI mode
   ```
4. **The QA Console:**
   ```bash
   pnpm console:setup && pnpm console                 # → http://127.0.0.1:7357
   ```

A new test from a scaffold: `pnpm new regression quizzes/take-quiz "Quiz — take"`.

## Adapting it to your app

The engine, the console and the skill framework are generic. The tests, data, templates and
skills in this repository are a **worked example** against an e-learning app (courses, quizzes,
learning paths, AI-generated course assets) at `*.example.com`. Keep what fits, replace the rest:

| Part | Generic | Example-specific: replace for your app |
|---|---|---|
| Tests | the format, steps, tiers, templates, scaffolds | `tests/`, `data/`, `templates/` |
| Sign-in | the session handling, `QA_<ENV>_*` credentials | the login form in `engine/auth.setup.ts` |
| Test data | registry, cleanup guard, sweeper, data prefix | the API client and records (`engine/api-client.ts`, `api-schemas.ts`), setups (`engine/setups/`), cleanup gateways (`engine/cleanup/gateways.ts`), asset steps (`engine/steps/assets.ts`) |
| Agent checks | the console's runner, the skill format and linter, `hermes/skill-template.md` | `hermes/skills/`, the environments in `hermes/qa-shared.md` |
| Console sign-in | OAuth 2 authorization code with PKCE, roles, audit | the IdP's "who am I" call (`/api/auth`, `console/server/auth/`) |

Steps, setups and cleanup gateways are registries: a new one is a file plus one line in its
`index.ts` ([Adding a step](docs/guide.md#adding-a-step)).

## Project layout

| Path | What it is |
|---|---|
| `engine/` | the TypeScript engine: loader, runner, steps, setups, cleanup, error monitor, scripts (`validate`, `new`, `sweep`, `ui`) |
| `tests/`, `templates/`, `data/`, `scaffolds/` | YAML tests, reusable blocks of steps, test data, new-test scaffolds |
| `e2e.config.yaml` | environments, tiers, profiles, safety, cleanup, error monitor, sweeper |
| `schema/` | JSON Schemas for editor autocompletion (`pnpm schema` writes them) |
| `console/` | the QA Console: `server` (NestJS), `web` (Vue 3 + Vite + Tailwind), `shared` (the HTTP contract), `deploy` (Kubernetes reference) |
| `hermes/` | agent skills for Hermes Agent, their shared contract and template |
| `ci/` | CI scripts: run, validate, sweep, wait for a deploy, Slack, live ingest into the console |
| `.github/workflows/`, `bitbucket-pipelines.yml` | CI on GitHub Actions and on Bitbucket Pipelines |

## Documentation

- [Guide](docs/guide.md) — the full reference:
  [CI](docs/guide.md#ci-github-actions) ·
  [Run](docs/guide.md#run) ·
  [QA Console](docs/guide.md#qa-console) ·
  [Agent checks](docs/guide.md#agent-checks) ·
  [Configuration](docs/guide.md#configuration--e2econfigyaml) ·
  [A test file](docs/guide.md#a-test-file) ·
  [Steps](docs/guide.md#steps) ·
  [Setups](docs/guide.md#setups) ·
  [Test data and cleanup](docs/guide.md#test-data-and-cleanup) ·
  [Templates](docs/guide.md#templates--reusable-blocks-of-steps) ·
  [Hermes agent skills](docs/guide.md#hermes-agent-skills)
- [Deploying the QA Console on Kubernetes](console/deploy/README.md)
- [CLAUDE.md](CLAUDE.md) — conventions for AI coding agents working in this repository (and a
  good summary of the architecture for people too)

## Contributing

Issues and pull requests are welcome. Before you open a pull request:

```bash
pnpm typecheck && pnpm format:check && pnpm validate   # the engine, tests and schemas
pnpm console:check                                     # if you changed console/
```

The `Validate` workflow runs the same checks on every pull request. Code conventions (strict
TypeScript, no `any`, registries instead of conditionals, zod for anything external) are in
[CLAUDE.md](CLAUDE.md). `main` holds the tests for prod and `develop` those for staging; open
pull requests against `develop`.

## Security

- Credentials come only from the environment, the git-ignored `.env` or your CI's secrets.
  `.auth/`, `reports/` and `test-results/` hold session tokens: never commit them.
- Run the tests against environments and accounts set aside for testing: a QA account in a
  workspace of its own, not real users' data.
- Report a vulnerability privately through GitHub's **Security** → **Report a vulnerability**,
  not in a public issue.

## License

Copyright 2026 miroslaws8. Licensed under the [Apache License, Version 2.0](LICENSE); see
also [NOTICE](NOTICE).
