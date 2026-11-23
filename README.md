# nemo

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Validate](https://github.com/miroslaws8/nemo/actions/workflows/validate.yml/badge.svg)](https://github.com/miroslaws8/nemo/actions/workflows/validate.yml)

End-to-end QA for web apps that runs against your deployed environments: tests written in
**YAML** and run by **Playwright Test**, a **QA Console** to start, watch, stop and retry runs,
and **agent checks** in which an LLM agent explores the app like a tester and reports
PASS / FAIL with screenshots.

Built at [Edplay](https://edplay.ai), where it tests Edplay's own apps, and shared as open
source for everyone who tests web apps.

```yaml
suite: Landing on a phone
tier: smoke                       # read-only: also the scheduled prod monitor
tests:
  - name: the menu opens and leads to the pricing
    steps:
      - goto: /
      - click: { button: Open menu }
      - click: { role: link, name: Pricing, in: dialog }
      - expect_url: { matches: "/pricing/?([?#]|$)" }
      - expect_visible: { css: h1 }
      - expect_fits_width: true   # nothing scrolls sideways on the phone
```

## Why

- **Tests without code.** A test is a YAML file; `engine/yaml.spec.ts` turns each one into a
  Playwright test. Data-driven tests (`each:`), reusable templates, tags and editor
  autocompletion from JSON Schemas come with it.
- **Safe on real environments.** Everything a test creates is titled with a prefix and cleaned
  up afterwards through gateways you write for your app's records; deletion re-reads each record
  and refuses anything the test user does not own or that is protected. A sweeper removes what a
  failed run left behind.
- **Phones and public sites.** An environment can run as a device (`device: Pixel 7`) and
  without an account; `expect_fits_width` fails a page that scrolls sideways.
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
git clone https://github.com/miroslaws8/nemo.git && cd nemo
pnpm install
pnpm exec playwright install chromium
pnpm validate                       # offline: config, tests, templates, schemas, skills
pnpm demo                           # the demo: edplay.ai's landing on a phone, no .env needed
pnpm report                         # its HTML report: each step and its screenshot
```

The demo (`tests/demo/`, environment `demo` in `e2e.config.yaml`) is a public site tested signed
out on an emulated Pixel 7: the home page, the mobile menu, the FAQ and six pages, each checked
for errors and for scrolling sideways.

Point it at your app:

1. **`e2e.config.yaml`** — your environments (`base_url`, `api_url`, the sign-in origin, a
   `device` to test as a phone), tiers, profiles and safety settings. See
   [Configuration](docs/guide.md#configuration--e2econfigyaml).
2. **`.env`** (git-ignored; start from `cp .env.example .env`) — the QA account of each
   environment, by its `credentials` name (a public site needs none):
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

A new test from a scaffold: `pnpm new smoke home "Home page"`.

## Adapting it to your app

The engine, the console and the skill framework are generic. What ships besides them is a demo:
`tests/demo/`, `data/demo-pages.yaml`, `templates/demo/` and the skill `qa-landing-mobile`, a
public landing on a phone. For your own app you write:

| Part | Ships, generic | You write for your app |
|---|---|---|
| Tests | the format, steps, tiers, templates, scaffolds, signed-out and phone environments | `tests/`, `data/`, `templates/` |
| Sign-in | the login project for an email + password form (`login` in `e2e.config.yaml`), `QA_<ENV>_*` credentials | a sign-in of another kind: `engine/auth.setup.ts` |
| Test data | the API client, the registry, cleanup guard, sweeper, data prefix | setups (`engine/setups/`), one cleanup gateway per kind of record (`engine/cleanup/gateways.ts`), who the test user is (`engine/cleanup/test-user.ts`) |
| Agent checks | the console's runner, the skill format and linter, `hermes/skill-template.md`, `hermes/skill-templates/` | `hermes/skills/`, the environments in `hermes/qa-shared.md` |
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

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) for the setup, the
conventions and the checks to run. Open pull requests against `develop`.

## Security

- Credentials come only from the environment, the git-ignored `.env` or your CI's secrets.
  `.auth/`, `reports/` and `test-results/` hold session tokens: never commit them.
- Run the tests against environments and accounts set aside for testing: a QA account in a
  workspace of its own, not real users' data.
- Report a vulnerability privately through GitHub's **Security** → **Report a vulnerability**,
  not in a public issue.

## License

Copyright 2026 miroslaws8. Licensed under the [Apache License, Version 2.0](LICENSE); see
also [NOTICE](NOTICE). Originally developed at [Edplay](https://edplay.ai).
