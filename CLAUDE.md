# CLAUDE.md

Guidance for AI coding agents working in this repository.

## What this repo is

QA automation for a web app and its API, kept apart from the app and run against deployed
environments (staging, prod). The tests, data and skill shipped here are a demo: the public
landing of edplay.ai on a phone (environment `demo`: no `credentials`, so no login and no data;
`device: Pixel 7`; its tests in `tests/demo`, which no other environment runs; `pnpm demo`).
The app-specific engine code (the API client, setups, resources, cleanup gateways and
`auth.setup.ts`) is that of an e-learning app at `*.example.com`, for an environment that signs in.

End-to-end tests are written in YAML (`tests/**/*.test.yaml`) and run by Playwright Test through
a TypeScript engine (`engine/`). `e2e.config.yaml` holds environments, tiers, run profiles, safety
and cleanup settings. `docs/guide.md` documents the test format.

`.github/workflows/` (GitHub Actions) and `bitbucket-pipelines.yml` both run the scripts in `ci/`: `ci/run.sh` (install → wait for the deploy →
playwright), `ci/validate.sh` (every push/PR), `ci/sweep.sh` (scheduled cleanup),
`ci/wait-for-deploy.ts`, `ci/notify-slack.mts` and `ci/ingest.mts` (dependency-free, run by plain
`node`: keep their imports type-only; `notify-slack.mts` knows both CIs through `CI_PROVIDERS`).
The Playwright image tag (in both CIs and in the console's `Dockerfile`) must equal
`@playwright/test` in package.json: `pnpm validate` checks them all.

`console/` is the QA Console (docs/guide.md → QA Console): a web app that starts runs, shows them live,
stops, retries and cleans up after them — on a developer's machine (`local` mode) or for the team
on a server (`server` mode). `console/server` (NestJS on Express, its own package.json),
`console/shared` (the HTTP contract and the run reducer), `console/web` (Vue 3 + Vite + Tailwind +
shadcn-vue, its own package.json, not installed in CI).

`hermes/` holds the `qa-*` Hermes Agent skills (agent-driven exploratory checks) and their
shared contract `hermes/qa-shared.md`; `hermes/install.sh` symlinks them into `~/.hermes`.
A skill is written as `hermes/skills/<name>/skill.yaml` (what it does: steps, screenshots,
report, PASS/FAIL; schema `engine/skill-schema.ts`) and filled into the Markdown base every skill
shares, `hermes/skill-template.md`: `pnpm skills` writes its `SKILL.md`, the file Hermes reads.
Never edit a `SKILL.md` by hand; `pnpm validate` fails while one is out of date. The templates the
QA console starts a skill from are `hermes/skill-templates/<id>.yaml` (docs/guide.md → Skills).
Keep them free of personal data and machine paths: use `~/.hermes/…` and `~/nemo-output/…`.
`hermes/qa-mark.js` is the helper an agent loads into the page to mark what is wrong before a
screenshot (`qaMark`; the shared contract → Marking what is wrong): one JavaScript expression,
which `pnpm validate` parses; the console links it into each check's home beside the contract
(`SHARED_FILES` in `agent-run.mts`), `hermes/install.sh` into `~/.hermes`.
What a skill creates is titled with `QA_DATA_PREFIX` when it is set (the console's agent checks,
whose Clean up deletes it); the shared contract says how. A console check's HOME is an agent home,
not the account's: a skill builds paths from `$HOME` and hands `vision_analyze` only paths its
`browser_exec` printed.

## Commands (repo root)

```bash
pnpm install
pnpm exec playwright test                          # default profile (smoke) on staging
E2E_PROFILE=post-deploy pnpm exec playwright test  # all tiers
pnpm validate                                      # offline: config, tests, templates, schemas, skills
pnpm typecheck && pnpm format:check                # engine code
pnpm schema                                        # regenerate editor JSON Schemas
pnpm skills                                        # write each Hermes skill's SKILL.md from its skill.yaml
pnpm new <tier> <path> ["Suite"]                   # new test from a scaffold
pnpm sweep --env staging [--apply]                 # leftover test data
pnpm console:setup && pnpm console                 # QA Console → http://127.0.0.1:7357
pnpm console:check                                 # server types (Nest) + web app: vue-tsc + build
pnpm console:docker                                # server console in Docker → http://127.0.0.1:7359
# The console image: the Dockerfile at the root (console/deploy: reference manifests for Kubernetes)
```

Packages: pnpm 10 (`npm install -g pnpm@latest-10`, no `packageManager`
field). Three projects, each with its own `pnpm-lock.yaml`: the root (the tests), `console/server`
and `console/web` (and a skill's `scripts` folder, when one has it). Never add a
`pnpm-workspace.yaml`: with one at the root, `pnpm install` in a sub-folder installs into the root.
Script arguments go without `--` (pnpm passes it on). The server console installs a commit's
packages from its `pnpm-lock.yaml` (`console/server/workspaces/deps-cache.ts`, store
`<data dir>/pnpm-store`) and reads its Playwright from `@playwright/test`: pnpm keeps
`playwright-core` out of the top `node_modules`.

## Writing tests

- Tests are YAML only. Never add a TypeScript spec per test; `engine/yaml.spec.ts` turns every
  YAML test into a Playwright test.
- Every test file declares `tier` (smoke | regression | ai). Smoke is read-only: no setup that
  creates data and no `track` step, because smoke also runs as the scheduled prod monitor.
- A flow used by more than one test becomes a template in `templates/` (`${params.x}` inside).
- Data a test creates is named with `${test.data_title}`; data created through the UI is
  registered with `- track: { kind, title }` so it is cleaned up.
- Every test ends with the error check (`error_monitor` in the config). Accept a known error with
  an `ignore` regex; never switch `auto_check` off to get a test green.
- Reach a page by its route (`goto: /dashboard/quizzes`), not by sidebar labels: the sidebar is
  regrouped often. Click through the UI only when the click is what the test checks.
- Never add waits or retries for the API rate limit (429): the engine waits it out (docs/guide.md →
  API rate limit).
- After changing a step, setup, template or the tiers: `pnpm schema` (validate fails while the
  schemas are stale).

## Engine code (TypeScript)

- `strict`; never `any`; no `as` type assertions except narrowing `unknown` after a runtime
  check; no non-null assertions (`!`).
- Interfaces start with `I` and live in `engine/types/index.ts`; explicit return types on exported
  functions; no `enum` (use `as const` arrays and derived types).
- Descriptive names — no single-letter or abbreviated variables; braces on every `if`.
- Dispatch by type through registries and strategy maps (steps, setups, resource gateways), not
  chains of inline conditionals.
- A step that only looks at the page (no click, typing or data) sets `observesOnly: true`, so a
  rate-limit replay may run it again; anything else must not.
- Validate anything external (YAML files, API responses) with zod, and make errors point at
  `file:line`.
- Format with Prettier (`pnpm format`).

## QA Console code (`console/`)

- The engine code rules above apply here too. Web-only types live in `console/web/src/types.ts`.
- A run's events are `engine/reporters/live-events.ts`. A new event needs the schema, the reducer
  (`console/shared/reducer.ts`; its `never` check fails until the event is handled) and, if it
  shows, the web app. A change older consoles can't read bumps `engine/console-protocol.json`:
  the hosted console runs only commits whose protocol version it knows.
- What differs between a developer's machine and the server comes from `QA_CONSOLE_*` settings,
  read and checked once at start in `console/server/config.ts` (zod; a console set up wrong does
  not start). What depends on the mode is a strategy map keyed by it (`MODES` there, `SHUTDOWNS`
  in `main.ts`), never `if (mode === …)`. Fixed values stay in `console/server/settings.ts`.
- The server is a NestJS application (`app.module.ts`, started by `main.ts`). The domain services
  (RunManager, SseHub, CiSource, IngestService, workspaces, runners, access) are plain classes
  that know nothing of Nest; `core/core.module.ts` builds them, and the rest injects them (by
  class, or by a token in `core/tokens.ts`). Each feature is a module with a controller
  (`runs/`, `ci/`, `ingest/`, `events/`, `files/`, `system/`, `auth/`, `web/` last: its
  catch-all answers the GETs nothing else does); controllers stay thin and call the services.
  Cross-cutting HTTP rules live once: `common/request.middleware.ts` (Host, Origin, JSON body,
  who sends it, audit), `common/access.guard.ts` (the role of each route),
  `common/console-exception.filter.ts` (`{error}` answers). Request bodies are validated with
  the shared zod schemas through `ZodBodyPipe`, not class-validator DTOs.
- It runs from source through SWC (`@swc-node/register`; `console/server/tsconfig.json`), not
  tsx: Nest's dependency injection needs the decorator metadata tsx does not emit. Its code is
  CommonJS (the engine it imports uses `__dirname`); Nest itself is ESM, loaded with Node's
  `require(esm)`. Do not move the server to a `dist/` build: `E2E_ROOT` comes from `__dirname`.
- A server console signs people in (`console/server/auth/`, docs/guide.md → Sign-in and roles). Every
  route declares its access with `@Access("open" | <role>)` (AccessGuard refuses one that does
  not); a route acting on an environment or reading its files also calls `requireOnEnvironment`
  (prod takes an operator). The rule lives once in `console/shared/access.ts`: the server
  enforces it, the web app greys out what a role cannot do. Never keep the IdP token, and never
  let secrets reach the audit log.
- Where a run's tests come from is its workspace (`console/server/workspaces/strategies.ts`): the
  working tree (local) or a snapshot of the run's commit (server). Read a run's files, list its
  tests and build its environment through the workspace, never from `E2E_ROOT` directly; branch
  code gets `runnerEnvironment()` only, never the console's own environment.
- Branch code (runs and listings of tests) runs as its environment's runner
  (`console/server/runners.ts`, `QA_CONSOLE_RUNNERS`): start it with `IPreparedRun.playwright()` or
  `IRunners.node()`, never `process.execPath` directly, and give every folder it writes in to its
  runner with `share()`. The console's own code (cleanups and their login) runs as the console.
- An agent check (docs/guide.md → Agent checks, `console/server/agents/`) is a run whose process is
  `agents/agent-run.mts` instead of Playwright: Hermes runs a skill of the run's commit and the
  file turns its stream into the same live events. What differs per kind of run is an `IRunKind`
  (`kinds` in `run-manager.ts`: tests | agent), never an `if`. It runs as the environment's runner
  and keeps imports type-only (plain `node`). Never hand Hermes the QA account's variables or the
  model key in its environment: the password goes into Hermes's vault, the key into
  `.hermes/.env` for the check's length only. The models and their providers are `AGENT_MODELS`
  and `AGENT_PROVIDERS` (`console/server/settings.ts`): a provider is a row there (Hermes's
  `--provider`, the variable Hermes reads its key from, the console setting holding it) plus that
  setting in `config.ts`, never an `if` on the provider; a model is offered only while the console
  has its provider's key. CI queues the checks an environment lists
  (`agent_checks` in `e2e.config.yaml`) through `POST /api/ingest/agent-checks`
  (`RunManager.queueAgentChecks`); every check counts towards the day's spend limit
  (`agents/spend-ledger.ts`).
- Skills (docs/guide.md → Skills, Skill store; `console/server/skills/`) come from the run's commit (repo)
  and the console's store (`createSkillStore`): given `QA_CONSOLE_SKILLS_*`, the skill store, an
  S3 bucket every console shares (`skill-registry.ts`: mirrored in `<data dir>/skills-registry`
  and read from there, synced every minute and after a write; a version's file before the
  meta.json naming it; written by every console with a key that may write), else by mode the
  working tree or `<data dir>/skills`. A store says what it is (`kind`), whether this console may
  write it (`readOnly`), whether its skill wins over the repo's of the same name (`wins`: the
  skill store's does) and which skills this console may delete (`removable`: a working copy's
  only while git does not keep them); use those, never the mode. Deleting is a POST
  (`/api/skills/<name>/delete`), like every change: the Origin check and the audit log take it. A stored skill's
  versions never change once written; its meta.json also names the version promoted to prod, and
  an environment's `skill_channel` picks the version its checks run (`versionOn`). A check
  records the skill's origin and version (`agent.skillOrigin`, `agent.skillVersion`), and
  `launch()` writes that version's `SKILL.md` into the run's folder (`stored-skill/`), which
  `agent-run.mts` links into Hermes's skills: never into the working tree or the snapshot, and
  never let a check read the store itself. `pnpm skills:migrate` / `skills:pull`
  (`console/server/scripts/`) move skills into the store and write its skills for Hermes by hand;
  only skills that run Playwright scripts stay in `hermes/skills`. A skill.yaml is read with
  `parseSkillSource` (engine) plus `skill-lint.ts`, and a `SKILL.md` is only ever written by
  `renderSkill`, as `pnpm skills` does. `POST /api/skills/check` changes nothing and stays out
  of the audit log. Every way of making a skill in the web app ends in a skill.yaml text that the
  server checks: the form's draft becomes one in `console/web/src/lib/skill-draft.ts` (and back),
  and the pages share `useSkillEditor` and `SkillCheckPanel`. A problem names its place by `path`
  (the form's field) and line (the file); one found by its place in the text gets its path from
  `pathAt` (`engine/yaml-document.ts`).
- Skill templates (`hermes/skill-templates/<id>.yaml`: `label`, `about`, `skill`;
  `skillTemplateFileSchema`) are what the console offers to start a skill from; `pnpm validate`
  reads each and makes its `SKILL.md`. `[[…]]` (`TEMPLATE_PLACEHOLDER`, which may span a folded
  line) marks where the author's words go, and the console refuses a skill that still has one.
- Run files (reports, traces, attachments, screenshots) are written by branch code: serve them only
  through `console/server/files/run-files.ts`, which hands them to `QA_CONSOLE_FILES_URL` with a
  ticket when it is set. That origin answers nothing else and is never an allowed Origin.
- The HTTP contract is `console/shared/api.ts` (zod). The web app checks every answer with it;
  never type a response by hand. The server's packages are in `console/server/package.json`
  (the root ones, zod and yaml among them, come from the root); add none to the root for it.
- Something a test should tell the people watching (like the rate limit or a lost session) is a
  notice: `engine/notices.ts`, a kind in `NOTICE_KINDS`, a banner in `RunNotices.vue`.
- Web: Vue 3 `<script setup>`, Tailwind with the tokens of `console/web/src/style.css` — the only
  colours are the status tones pass, fail, flaky, run, stop, idle — and shadcn-vue components only
  (`pnpm dlx shadcn-vue@latest add <name>` in `console/web`; they import `cn` and `@lucide/vue`).
- CI comes from Bitbucket through `console/server/sources/` with `QA_CONSOLE_BITBUCKET_REPOSITORY` and `QA_CONSOLE_BITBUCKET_TOKEN`
  (`envSetting` reads it from `.env`; it never reaches the web app or the tests). Bitbucket
  allows about 1,000 requests an hour: poll only while a page is open, cache what cannot change
  (finished logs and reports), and count every request through `BitbucketApi`.
- After changing `console/server` or `console/web`: `pnpm console:check`. Never run `pnpm install`
  at the root (or `ci/validate.sh`) while a console is running: it replaces the node_modules the
  console runs from.

## Safety

- Never delete or edit data the tests did not create. Deletion goes through
  `engine/cleanup/guard.ts`: the live title must start with `safety.data_prefix`, must not be in
  `safety.protected_titles`, and the test user must own the record.
- Never complete a payment or enter card details; never publish to real learners.
- Credentials only from the environment, the git-ignored `.env` or Bitbucket secured variables.
  `.auth/`, traces and reports contain session tokens: never commit them.
- Prod runs the same tiers as staging (full parity); `allowed_tiers` in `e2e.config.yaml`
  restricts an environment.

## Git

- `develop` = tests for staging, `main` = tests for prod; a release merges `develop` into `main`.
