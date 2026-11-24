# Guide

The full reference: CI, running tests, the QA Console, configuration, the test format, steps,
setups, cleanup, templates and the Hermes agent skills. Start with the [README](../README.md).

## Branches and releases

- `main` holds the tests for what runs on **prod**; `develop` the tests for what runs on
  **staging** — the same split as the app's.
- A test for a new feature goes to `develop` together with the feature.
- When the app is released to prod, merge `develop` into `main` here as well, so prod is tested
  against its own features only.

## CI (GitHub Actions)

`.github/workflows/` runs the same scripts in `ci/` as the Bitbucket pipelines below, on the same
Playwright image (`pnpm validate` checks its version in every workflow too).

| Workflow | Started by | What it runs |
|---|---|---|
| `Validate` (`validate.yml`) | every push to `main` / `develop`, every pull request | `ci/validate.sh` (no browser run) |
| `E2E` (`e2e.yml`) | the app's deploys through the API, or Run workflow | `ci/run.sh` on `environment` with `profile`; tests from `develop` (staging) or `main` (prod), or the `ref` given |
| `E2E` on its schedule | hourly, once `E2E_SCHEDULES` is `true` | profile `smoke` on prod (the prod monitor) |
| `Sweep test data` (`sweep.yml`) | daily once `E2E_SCHEDULES` is `true`, or Run workflow | `ci/sweep.sh`: leftover test data on staging and prod |

- **Secrets** (Settings → Secrets and variables → Actions): `QA_STAGE_EMAIL`,
  `QA_STAGE_PASSWORD`, `QA_PROD_EMAIL`, `QA_PROD_PASSWORD`, `QA_AI_OPENAI_KEY` /
  `QA_AI_ANTHROPIC_KEY` (the [AI judge](#ai)'s models, once a test uses `ai_check`), and
  `SLACK_WEBHOOK_URL` (optional).
  **Variable** `E2E_SCHEDULES=true` turns the schedules on; without it they are skipped, so a fork
  without an app to test stays quiet.
- An `E2E` job runs in the GitHub environment named like the test environment (`staging`,
  `prod`): give `prod` required reviewers there to guard it, and keep its secrets there if you
  like.
- The app's deploy pipeline starts a run once its deploy is out; `ci/wait-for-deploy.ts` waits
  until the expected build serves:
  ```bash
  gh workflow run e2e.yml -R <owner>/<repo> -f environment=staging \
    -f expect_frontend_build=<tag> -f expect_api_build=<tag>
  ```
  (or `POST /repos/<owner>/<repo>/actions/workflows/e2e.yml/dispatches` with a token that may
  run workflows).
- Results: the job's Slack message on failure (on success too after a prod deploy), and the HTML
  report, traces and results in the run's artifact `e2e-<env>-<run>` (14 days).
- Not on GitHub Actions yet: the QA console's CI tab, CI runs live (`ci/ingest.mts`) and the
  scheduled agent checks. The console reads Bitbucket Pipelines only.

## CI (Bitbucket Pipelines)

`bitbucket-pipelines.yml` runs the tests against the deployed environments; the scripts are in `ci/`.

| Pipeline | Started by | What it runs |
|---|---|---|
| `custom: e2e-staging` | the app's staging deploys (branch `develop`), or Run pipeline | profile `post-deploy` (or `smoke`) on staging |
| `custom: e2e-prod` | prod deploys (branch `main`), or Run pipeline | profile `post-deploy` on prod; a green run is reported too |
| `custom: e2e-prod-monitor` | a Schedule on `main` | profile `smoke` on prod |
| `custom: e2e-sweep` | a daily Schedule on `main` | deletes leftover test data on staging and prod |
| `custom: agent-checks-staging` / `agent-checks-prod` | a Schedule (`develop` / `main`) | has the QA console run the environment's agent checks (QA Console → Agent checks) |
| every push / pull request | automatically | Validate (no browser run); a PR can also run staging by hand |

- Before the tests, `ci/wait-for-deploy.ts` waits (up to 15 minutes) until the frontend's
  `/version.json` and the API's `/api/health` report the build passed in
  `E2E_EXPECT_FRONTEND_BUILD` / `E2E_EXPECT_API_BUILD`. If a newer build is already serving, the
  run is skipped: that build's own run tests it.
- Results: the pipeline's Tests tab (JUnit), the HTML report in the artifacts, and a Slack
  message for every failure (`ci/notify-slack.mts`).
- Secured repository variables: `QA_STAGE_EMAIL`, `QA_STAGE_PASSWORD`,
  `QA_PROD_EMAIL`, `QA_PROD_PASSWORD` (the QA accounts), `QA_AI_OPENAI_KEY` /
  `QA_AI_ANTHROPIC_KEY` (the [AI judge](#ai)'s models, once a test uses `ai_check`) and
  `SLACK_WEBHOOK_URL`.
- The app's deploy pipelines start a run with `atlassian/trigger-pipeline` (`REPOSITORY: nemo`,
  `CUSTOM_PIPELINE_NAME: e2e-staging` or `e2e-prod`, the expected build in `PIPELINE_VARIABLES`),
  using a repository access token of nemo with Pipelines write access.
- After a deploy it tested, an e2e step has the QA console run the environment's agent checks
  (`node ci/ingest.mts agents --after-deploy` in its after-script; the prod monitor runs none).
  For checks on a schedule too, add a Schedule per environment in Bitbucket: the repository's
  **Pipelines** → **Schedules** (top right) → **New schedule**, branch `develop` with the pipeline
  `agent-checks-staging` (or `main` with `agent-checks-prod`), hourly, daily or weekly; the
  pipeline must be in that branch's `bitbucket-pipelines.yml`. Both need the console's repository
  variables (CI runs live, below).

## Run

Packages install with pnpm 10: `npm install -g pnpm@latest-10`
(or `brew install pnpm`). A script's arguments go straight after its name, without `--` (pnpm
hands it on to the script): `pnpm sweep --env staging`.

```bash
pnpm install                                                     # once
pnpm exec playwright test                                        # default profile (smoke) on staging
E2E_PROFILE=post-deploy pnpm exec playwright test                # everything, as after a deploy
E2E_ENV=prod E2E_PROFILE=smoke pnpm exec playwright test         # another environment
E2E_PROFILE=post-deploy pnpm exec playwright test --grep "Hero"  # narrow a profile by name or @tag
pnpm exec playwright test --list                                 # what would run, without running it
pnpm report                                                      # HTML report: each step + its screenshot
pnpm ui                                                          # UI mode: watch, stop and re-run tests live
pnpm ui --profile post-deploy                                    # …with every tier (--env prod needs --confirm prod)
pnpm validate                                                    # offline check of config, tests, templates, schemas, skills
pnpm skills                                                      # Hermes skills: each SKILL.md from its skill.yaml
pnpm new regression orders/checkout "Order — check out"          # new test file from the tier's scaffold
pnpm sweep --env staging                                         # list leftover test data (dry run)
pnpm sweep --env staging --apply                                 # …and delete it
pnpm sweep --env staging --run <run id>                          # one run's data, whatever its age
pnpm typecheck && pnpm format:check                              # engine code checks (pnpm format fixes)
```


## QA Console

A web app to start runs, watch them as they go, stop and retry them, and look at earlier ones:
on this Mac (`local` mode), or for the team on a server (`server` mode: people sign in with their
app account; see Console settings and Sign-in and roles below).

```bash
pnpm console:setup       # once, and after package changes: the server's and the web app's packages, and the web build
pnpm console             # → http://127.0.0.1:7357 (another port: pnpm console --port 7400)
pnpm console:dev         # next to pnpm console: the web app with hot reload, http://127.0.0.1:7358
pnpm console:check       # the server's types and the web app's (vue-tsc), and a build of the web app
pnpm --dir console/server start:dev         # instead of pnpm console: restarts on server changes
```

The server (`console/server`) is a NestJS application with its own `package.json`, run from source
through SWC; the web app (`console/web`) is Vue 3. Both read the same HTTP contract
(`console/shared/api.ts`). The console keeps everything in files (`reports/runs/`, or the data
folder of a server console), no database.

- **A run** is `pnpm exec playwright test` with a folder of its own, `reports/runs/<run id>/`
  (`QA_CONSOLE_DATA_DIR`; see `E2E_RUN_DIR` above): its events, log, HTML report, traces and the
  latest screenshot of each test. The console keeps the newest 30 runs (`QA_CONSOLE_KEEP_RUNS`)
  and deletes the older folders.
- **While it goes:** the counts, what each worker runs now (the test, its YAML step with
  `file:line`, the last screenshot), every test with its steps, errors next to the YAML they point
  at, and the log.
- **One run or cleanup per environment at a time:** every one there uses the same QA account.
  Another run on that environment waits in a queue, a cleanup is refused until the environment is
  free; at most two runs go at once (`QA_CONSOLE_MAX_ACTIVE_RUNS`).
- **Stop** lets the tests delete their data first (`cleanup.on_interrupt`). After 3 minutes, or
  with **Force stop**, the browsers are killed; **Clean up** then removes what the run left (the
  same as `pnpm sweep --run <run id>`).
- **Retry:** the failed tests (of a stopped run: the ones that did not finish), all tests again,
  or one test. A retry is a new run that links to the one it repeats; a retry of AI tests can
  skip the smoke tier they wait for.
- **Banners:** the API's rate limit (429: the run waits it out and goes on, slower) and the QA
  account's session ending — someone logged out of the account, which ends all of its sessions,
  so the tests that follow fail. Keep the QA account logged in while tests run. The tests report
  both as they happen (`engine/notices.ts`).
- **Prod** (`guarded: true`) asks for its name before a run, a retry or a cleanup.
- **When the console stops:** on this Mac runs are processes of their own: they keep going, and
  the console follows them again when it starts. In `server` mode it stops them first (as **Stop**
  does, so the tests delete their data), takes no new work meanwhile and exits once they are done;
  a second Ctrl+C or SIGTERM kills them at once. Queued runs wait for the next start.
- The console answers only at its own address (the Host) and takes changes only from its own
  pages (the Origin).
- **CI** (the CI tab): the Bitbucket pipelines `e2e-staging`, `e2e-prod`, `e2e-prod-monitor` and
  `e2e-sweep` — their status and steps, the log while they go, and once a step is over its test
  report with the failed tests and their errors. **Stop**, **Run again** (the same pipeline and
  profile, testing what is deployed now instead of waiting for a deploy) and **Clean up**
  (`pnpm sweep --run <build number>`). The header and the New run dialog say when CI is
  running on an environment: both use the same QA account and its API limit.
- CI needs the repository and a repository access token: in Bitbucket, the repository's **…** →
  **Settings** → **Security** → **Access tokens** → **Create access token**, with the permissions
  **Pipelines: Read** and **Pipelines: Write** (the token is shown once). Put both in nemo's
  `.env` as `QA_CONSOLE_BITBUCKET_REPOSITORY=<workspace>/<repository>` and
  `QA_CONSOLE_BITBUCKET_TOKEN=…`, and start the console again. The token stays in the
  console's server; the console asks Bitbucket only while one of its pages is open (every 20 s
  while a pipeline goes, every 5 minutes otherwise) to stay well under Bitbucket's limit of about
  1,000 requests an hour.
- **CI runs live** (a server console): with `QA_CONSOLE_INGEST_URL` (the console's address) and
  `QA_CONSOLE_INGEST_TOKEN` (one of its `QA_CONSOLE_INGEST_TOKENS`) among the repository's
  variables, an e2e step sends its run to the console as it goes (`ci/ingest.mts`, started by
  `ci/run.sh`): it shows in the run list as **CI** `b<build number>` (`-2`, `-3` for a rerun of the
  step), with its tests, steps, errors and, while someone watches, its step screenshots; its
  report comes when the step ends. The console checks with Bitbucket that the pipeline is running
  (so it needs `QA_CONSOLE_BITBUCKET_TOKEN` too) and keeps the place in the stream: after a
  restart the step sends the rest again. A run whose events stop ends 2 minutes after its pipeline,
  as the pipeline ended; one that has sent nothing for 15 minutes says so on its page (the step
  lost the console, or hangs: Bitbucket shows which). Stop, run again and clean up it from its
  pipeline's page. A console that is down or refuses never fails the step. The newest 30 CI runs
  are kept, apart from the console's own.
- **CI and the console take turns** on an environment (the same QA account): before its tests an
  e2e step asks the console for its environment (`node ci/ingest.mts wait`) and waits while a run
  of the console's own goes there — up to 20 minutes, and not at all when the console does not
  answer for 30 s. From that moment until the CI run ends, the console's runs on that environment
  wait their turn (a cleanup is refused). An operator may start a run **alongside CI** in New run
  instead of waiting.

### Agent checks

New run opens on **Agent check** (where the console runs them; **Scripted tests** beside it runs the
YAML tests): [Hermes Agent](#hermes-agent-skills) opens the app in a browser and
follows one of the skills — the skill store's ([Skill store](#skill-store)), or one in
`hermes/skills` of the branch the run tests (or of this working copy) — the way a tester would, with one of the console's models (OpenAI's GPT-6 Luna by default where the console has the
OpenAI key, Claude Haiku 5.5 or Claude Sonnet 5.5). It is a run like the others: it waits its turn on its environment, prod takes
an operator and its name, and **Stop** ends it (Hermes stops and closes its browser).

- **While it goes** (its **Check** tab): what the agent does now, how far it is into its limits
  (time, model turns), every step it took (what it runs in the browser, a terminal command, a
  vault fill, a look at a screenshot; a camera marks a step that saved a screenshot) and the
  skill's screenshots as it saves them: the newest large, the others to pick.
- **Once over:** it passes or fails as the skill's `RESULT: PASS` / `RESULT: FAIL` says, with the
  words of that line (or what went wrong); then what it spent (tokens as Hermes counts them, by
  kind, and dollars at the model's list prices: `AGENT_MODELS` in `console/server/settings.ts`)
  and the agent's report. **Open transcript** is the whole chat; Hermes's raw stream is attached.
  The run list shows what each check cost: a short read-only skill costs about half a cent on
  Haiku, nine cents on Sonnet and under a cent on GPT-6 Luna (which takes about three times as
  long).
- **From CI:** after each deploy an e2e step tested, and on the `agent-checks-*` Schedules, CI
  asks the console (`node ci/ingest.mts agents`, with the ingest token; the console checks with
  Bitbucket that the pipeline is running) to queue the checks its environment lists in
  `agent_checks` (`e2e.config.yaml` of the environment's branch, e.g. `agent_checks:
  [qa-landing-mobile]`) on the default model (GPT-6 Luna; Claude
  Haiku 5.5 where the console has no OpenAI key). They wait their turn like any run, count
  towards the day's limit, and their page says **Queued by** the pipeline; a step that asks again
  gets the checks it queued. CI does not wait for them and its result does not depend on them.
- **Arguments** (optional): one line the skill gets after the environment, e.g. a page to look
  at (`/qa-landing-mobile demo /pricing`).
- **Run again** repeats it: the same commit, skill, model and arguments.
- **Clean up** removes the data the check made. The console hands Hermes `QA_DATA_PREFIX`
  (`[SMOKE] E2E <run id> `); a skill starts the title of everything it creates with it
  (`hermes/qa-shared.md`), and Clean up deletes what carries it, as for a run of the tests
  (`pnpm sweep --run <run id>`). The nightly sweep removes what is left after a day. An
  attempt or a learner's progress stays: there is nothing to delete.
- **Not offered yet:** skills that drive the browser from Playwright scripts of their own (a
  `scripts` folder). New run lists them with why.

It takes a model key — `QA_CONSOLE_ANTHROPIC_API_KEY` for the Claude models, an Anthropic API key
(best one of a workspace of its own with a spend limit), and `QA_CONSOLE_OPENAI_API_KEY` for
GPT-6 Luna, an OpenAI project key (best one of a project of its own with a budget) — and Hermes
Agent: the image has it; on a Mac, `hermes` on the PATH or `QA_CONSOLE_HERMES`. New run offers the
models whose provider's key the console has and greys the others with why; with no key, or no
Hermes, it says why.

What checks may spend: each one stops after 60 model turns or 15 minutes, and all of them
together may spend `QA_CONSOLE_AGENT_DAILY_USD` a day (UTC; default $5, at list prices). Once
that is spent, New run and **Run again** refuse checks until the next day; New run shows the
day's spend. The console keeps it in `<data dir>/state/agent-spend.ndjson`, one line per check
(a check counts once it is over).

Each environment has an agent home, `<data dir>/agent-homes/<env>`: the check's HOME, with
Hermes's own home in `.hermes` (its runner's alone: Hermes refuses one that anybody else may
write). A check (`console/server/agents/agent-run.mts`, run as the environment's runner) links the
commit's skills there, writes Hermes's config (the model; the tools `browser`, `terminal`,
`skills`, `vision`, `todo`; Playwright's Chromium at 1440×900; whatever would need an approval is
refused) and puts the environment's QA account into Hermes's vault for its `login_origin`
(`e2e.config.yaml`), once per account: the browser fills the password, the agent never sees it,
and Hermes gets no `QA_*` variable. The key of the model's provider reaches the check through
its environment and stays in `.hermes/.env` only while it runs (`ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`, as Hermes reads them; its provider `anthropic` or `openai-api`).

On a Mac (`pnpm console`, `QA_CONSOLE_RUNNERS=self`) a check runs as you, with a terminal:
Hermes may read whatever you may, `~/.hermes/.env` with its passwords among it. The skills keep
to the app, but a model can stray (one opened screenshots of an older run in `~/nemo-output` by a
path it guessed). A check that nobody watches belongs on the Docker or the team's console, where
it runs as a runner user that reads nothing of the console's or of other environments.

### Skills

**Skills** (in the header) lists every skill an agent check may follow, with what it changes
(read-only, records the test account's activity, creates data, spends AI credits), where it comes
from, whether CI runs it after deploys (`agent_checks`), why the console would not run it, and its
last check. A console lists the repo's skills of the default environment's branch (runners and
operators may pick another) and the skill store's (or, without one, the ones added in it). A
skill's page shows its `skill.yaml` in words, the `SKILL.md` Hermes reads, the file itself, its
checks and (a stored skill) its versions and the one prod runs; **Run…** opens New run as an
agent check of it, on that branch.

An operator adds one with **Add skill**, which starts it one of three ways:

- **From a template** (`hermes/skill-templates`): a page checked read-only, a flow that leaves the
  test account's progress or an attempt, something created and checked. It opens as a form with
  the template's steps, screenshots, report and fail cases filled in, and places marked `[[…]]`
  for your words; the console adds nothing while one is left.
- **As a copy of a skill** (or **Use as template** on its page): the same form with its fields.
- **From a skill.yaml** you have: drop or choose the file, or paste and edit the text.

The form has a field for every part of a skill.yaml ([Writing a skill](#writing-a-skill)): steps
and the other lists are added, removed and moved item by item. **Form | YAML** shows the
`skill.yaml` the form makes, to edit by hand, and back. **New version…** on a skill's page takes a
new skill.yaml for it the way a file is added.

The console checks it at every pause in typing and lists what is wrong — under its field in the
form, at its line in a file: the fields (a missing or mistyped one, with what it is for), the name
(`qa-…`, not taken), a `[[…]]` left from the template, what looks like a secret or personal
data, a skill that creates data but never says `QA_DATA_PREFIX` (Clean up could not find what
it makes). Beside it: a summary, the `SKILL.md` Hermes will read and, for a new version, the
changes. One click, and nothing is left to do:

- **With the skill store** ([below](#skill-store)), on any console: it goes into the store as a
  new version, by whom and when (a Mac's console knows no one: by nobody); local and staging run
  it at once, prod once it is promoted.
- **On a Mac without it** it writes `hermes/skills/<name>/skill.yaml` and its `SKILL.md` into the
  working copy, as `pnpm skills` would; commit them to share the skill. **Delete…** on its page
  removes such a folder while git does not keep it (one added and not committed).
- **On a server without it** it keeps the skill in the console (`<data dir>/skills/<name>/`: every version, as
  it was added, by whom and when), not in git, and it runs at once on every environment. A check
  keeps the version it ran: **Run again** repeats it, a new check takes the newest. The `SKILL.md`
  is written from the console's own `hermes/skill-template.md`, and every check attaches the one
  Hermes read. A skill of the same name in a branch's repo wins on that branch (the console's is
  marked shadowed): that is how one moves into git — **skill.yaml** downloads it, commit it as
  above, and once merged the repo's runs.

A template of your own is a file in `hermes/skill-templates/<id>.yaml`: a `label` (what the
console's card says), `about` (a sentence or two on when to start from it) and `skill` (a
skill.yaml's fields, with `[[…]]` where the author's words go). Copy one of the three to start;
the editor checks it against `schema/skill-template.schema.json`, and `pnpm validate` fails
while a template does not read or makes no `SKILL.md`. The console offers it once it is on the
default environment's branch (or in this working copy).

On a Mac, the `hermes` launcher installs an environment of its own (about 640 MB, a few minutes)
for every new Hermes home, so for each agent home. To use the install you have, point
`QA_CONSOLE_HERMES` at its `bin/hermes`: the `venv` that `packages.venv.environment` names in
`~/.hermes/installs/*/facts.json`.

### Skill store

The team keeps its skills in one place every console reads — the team's and each Mac's — instead
of git: an S3 bucket of its own (S3-compatible; `QA_CONSOLE_SKILLS_*`, below). Only the
skills that run Playwright scripts stay in `hermes/skills`: they are code, with packages of
their own.

- **In the bucket:** `<prefix>skills/<name>/meta.json` (the skill's versions, who added each and
  when, and the one promoted to prod) and `v<n>/skill.yaml` (a version, never changed once
  written). A console mirrors the bucket into `<data dir>/skills-registry` and reads the mirror —
  synced at start, every minute and right after it writes — so a Mac sees the team's change within
  a minute, and a console whose bucket does not answer still lists and runs what it has.
- **Who writes:** every console with a key that may write: the team's (an operator there) and
  each Mac's. They add a skill or a version (**Add skill**, **New version…**), promote one, and
  delete a skill: a skill's page → **Delete…** asks first (and says when CI runs it after
  deploys: those checks then fail), then takes its every version out of the store for every
  console. A Mac sees another console's change within a minute.
- **Staging and prod:** a new version runs at once on local and staging; prod keeps the version
  an operator promoted (a skill's page → **Versions** → **Promote to prod**: it asks first, and
  goes into the audit log). Going back is promoting an older version. An environment's
  `skill_channel` (`e2e.config.yaml`) says which it runs: `latest` (the default) or `prod`
  (prod's). A skill with no version on prod yet is not offered there, CI's checks included; New
  run says why.
- **Of two skills with one name** the store's runs, and the repo's is marked shadowed. The console
  takes no new skill under a repo skill's name.
- **A check** keeps the version it ran (**Run again** repeats it). Its `SKILL.md` is written from
  the run's template into the run's folder (`stored-skill/`), where Hermes reads it: never into
  the working copy.

```bash
pnpm skills:migrate --dry-run         # what would move into the store (needs a key that may write)
pnpm skills:migrate                   # moves the hermes/skills folders that run no scripts (v1, promoted to
                                      # prod) and, on a server console, its own store with every version;
                                      # what the store has already is left alone
pnpm skills:pull                      # the store's skills into ~/.hermes/skills, for Hermes run by hand
                                      # (--channel prod; --to <folder>)
```

Without `QA_CONSOLE_SKILLS_*` a console keeps skills as before: a Mac in its working copy, a server
in its data folder.

### Console settings

The console reads `QA_CONSOLE_*` once at start, from the environment or else nemo's `.env`.
Set up wrong, it does not start: it lists what to fix.

| Setting | Default | What it sets |
|---|---|---|
| `QA_CONSOLE_MODE` | `local` | `local`: this Mac, nobody signs in, tests from this working copy, runs outlive the console. `server`: the team's console with sign-in, which stops its runs before it exits |
| `QA_CONSOLE_HOST` | `127.0.0.1`; server `0.0.0.0` | The address it listens on. A local console only listens on loopback (127.0.0.1, localhost) |
| `QA_CONSOLE_PORT` | `7357` | Its port (`--port` wins) |
| `QA_CONSOLE_PUBLIC_URL` | — | Server, required: where people open it, e.g. `https://qa.example.com` (https, except for 127.0.0.1 / localhost). Requests must come for this address, or for loopback while the console listens there; a page asked at another address is sent here |
| `QA_CONSOLE_IDP_URL` | — | Server, required: the app's IdP, e.g. `https://auth.example.com` (`/oauth/authorize`, `/oauth/token`) |
| `QA_CONSOLE_IDP_API_URL` | — | Server, required: the app's API, e.g. `https://api.example.com` (`/api/auth`: who signed in) |
| `QA_CONSOLE_OAUTH_CLIENT_ID` | — | Server, required: the console's public OAuth client on that IdP |
| `QA_CONSOLE_USERS_FILE` | — | Server, required: who may use the console, and as what (below) |
| `QA_CONSOLE_GIT_URL` | — | Server, required: the nemo repository the runs take their tests from, e.g. `https://github.com/<owner>/nemo.git` (below) |
| `QA_CONSOLE_GIT_TOKEN` | — | A repository access token (**Repositories: Read**) for a private https repository |
| `QA_CONSOLE_DATA_DIR` | `reports`; server `/data` | Where the run folders go (`<dir>/runs/`); a server also keeps its sessions and audit log (`state/`), its clone (`git/`), the packages of the commits it runs (`deps/`, hard links to pnpm's store `pnpm-store/`), Chromium for other Playwright versions (`browsers/`), run snapshots (`work/`) and the QA accounts' sessions (`auth/`, `runner-auth/`) there |
| `QA_CONSOLE_MAX_ACTIVE_RUNS` | `2` | Runs going at once, 1–8 |
| `QA_CONSOLE_KEEP_RUNS` | `30` | Run folders kept, 1–1000 |
| `QA_CONSOLE_BITBUCKET_REPOSITORY` | — | CI (above): the Bitbucket repository as `<workspace>/<repository>` |
| `QA_CONSOLE_BITBUCKET_TOKEN` | — | CI (above) |
| `QA_CONSOLE_INGEST_TOKENS` | — | CI runs live: the tokens CI may send its runs with, comma-separated (two while one is replaced), 24 characters at least; none: CI runs are not taken |
| `QA_CONSOLE_FILES_URL` | — | Where run files are served: an origin of their own, e.g. `https://qa-files.example.com` (below). None: the console's own origin serves them |
| `QA_CONSOLE_RUNNERS` | `self`; the image `sudo` | Who runs branch code: `self` the console's user; `sudo` the image's runner users (server mode only, below) |
| `QA_CONSOLE_ANTHROPIC_API_KEY` | — | Agent checks (above): the Claude models' API key |
| `QA_CONSOLE_OPENAI_API_KEY` | — | Agent checks: the OpenAI models' API key (GPT-6 Luna). Neither key: no agent checks |
| `QA_CONSOLE_HERMES` | `hermes`; the image `/usr/local/bin/qa-hermes` | Agent checks: the Hermes Agent command |
| `QA_CONSOLE_AGENT_DAILY_USD` | `5` | Agent checks: what they may spend in a day (UTC), in dollars at list prices |
| `QA_CONSOLE_SKILLS_BUCKET` | — | [Skill store](#skill-store): the S3 bucket skills live in, e.g. `nemo-skills`. None: skills stay where the mode keeps them. With it go its key, both or neither: |
| `QA_CONSOLE_SKILLS_ACCESS_KEY_ID`, `QA_CONSOLE_SKILLS_SECRET_ACCESS_KEY` | — | The bucket's key, one that may read and write: every console adds, promotes and deletes skills (a key that may only read: the console lists and runs them, and its changes fail) |
| `QA_CONSOLE_SKILLS_ENDPOINT` | `https://s3.amazonaws.com` | The S3 API's address (https, except for 127.0.0.1 / localhost) |
| `QA_CONSOLE_SKILLS_REGION` | `us-east-1` | The region requests are signed for (DigitalOcean Spaces takes any) |
| `QA_CONSOLE_SKILLS_PREFIX` | — | A folder in the bucket, ending in `/`, e.g. `test/` to try it out apart |
| `QA_CONSOLE_SKILLS_PATH_STYLE` | `false` | `true` for MinIO (the bucket in the path, not the host name) |

```bash
# server mode on this Mac against the staging IdP: the users file is a copy of
# console/users.example.yaml with your email; its own data folder keeps pnpm console's runs apart
QA_CONSOLE_MODE=server QA_CONSOLE_HOST=127.0.0.1 QA_CONSOLE_PUBLIC_URL=http://127.0.0.1:7357 \
QA_CONSOLE_IDP_URL=https://auth.staging.example.com QA_CONSOLE_IDP_API_URL=https://api.staging.example.com \
QA_CONSOLE_OAUTH_CLIENT_ID=<client id> QA_CONSOLE_USERS_FILE=/tmp/qa-console-users.yaml \
QA_CONSOLE_GIT_URL="$PWD" QA_CONSOLE_DATA_DIR=/tmp/qa-console pnpm console
```

For probes, `GET /api/health` (the process is up) and `GET /api/ready` (it takes work; 503 while it
shuts down) answer whatever the Host.

### Sign-in and roles (server mode)

People sign in with their app account: the console is a public OAuth client of the app's IdP
(authorization code with PKCE). It trades the code for a token once, asks the API whose account it
is, revokes the token and keeps only the email. An impersonated session, or an account whose
email is not verified, cannot sign in. A session lasts 12 hours at most and ends after 2 idle
hours; sessions survive a restart. Signing out ends the console's session, not the app's one.

The users file gives each email a role (`console/users.example.yaml`); a change applies at once,
with no restart. Each role can do what the ones before it can:

| Role | May |
|---|---|
| `viewer` | watch runs and CI, read logs, reports and traces (not prod's: they hold session tokens) |
| `runner` | start, stop, retry and clean up on staging; act on its CI pipelines |
| `operator` | the same on prod (still confirming with its name), and read prod's reports and traces |

Greyed-out buttons say which role they need. Two people retrying the same tests of a run at once:
the second hears who was first. Every change and every refusal, every sign-in and sign-out goes
to `<data dir>/state/audit.ndjson`; runs keep who started and who stopped them.

The OAuth client: a public client (PKCE) on the app's IdP — with Laravel Passport,
`php artisan passport:client --public` — with the redirect
`<QA_CONSOLE_PUBLIC_URL>/auth/callback`, e.g. `https://qa.example.com/auth/callback`. For tests on a
Mac, `http://127.0.0.1/auth/callback` fits any port; open that console at 127.0.0.1 (localhost is
sent there).

### Tests from git (server mode)

A server console runs the tests of a commit, not of a working copy: each environment's branch
(`branch` in `e2e.config.yaml`: `main` for prod, `develop` for the rest), or the branch picked in
New run (runners and operators see the branch list). The commit is fixed when the run is queued
and kept (a ref per run) as long as the run's folder, so a retry tests the same commit and the
run's YAML still shows after a force-push.

A commit is refused (409) when it is older than the console (no `engine/console-protocol.json`,
or another protocol version) or lacks the environment or the profile.

Taken from the queue, a run is **Preparing**: the commit's files go to a folder of their own, and
its packages (`pnpm install --frozen-lockfile --ignore-scripts` from its `pnpm-lock.yaml`, shared by
every commit with the same lockfile; the three latest sets stay) link into it. A set's files are
hard links to pnpm's store (`<data dir>/pnpm-store`), which drops what no set uses when the console
starts. A commit from before nemo moved to pnpm (no `pnpm-lock.yaml`) does not run: its branch
needs a rebase on `develop`. A commit with another Playwright than the image's gets its Chromium
once per version, installed by that Playwright into `<data dir>/browsers/<version>` (the two latest
versions stay; the image's system libraries serve them). Stop works there too; a console that
shuts down puts a preparing run back in the queue. The folder goes when the run is over. The list
of a branch's tests (New run → Pick tests) comes from that branch.

The code of a branch runs on the server with the basics of the console's environment and the
credentials of its run's environment only (`QA_<credentials>_*`); the console's own settings
and tokens never reach it. With `QA_CONSOLE_RUNNERS=sudo` (the image) it also runs as a user of its
own: `qa-runner` for open environments, `qa-runner-guarded` for guarded ones (prod), through sudo
(`console/runner-sudoers`). A runner cannot read the console's environment (its tokens, every QA
account), its sessions or secrets; it writes only in its run's folder, its snapshot and its own
sessions folder (`runner-auth/<user>`), and a staging runner cannot read prod's runs or sessions.
Its listings of tests run as that user too, with a temporary folder of its own. The console does
not start in this mode on a data folder that every user may write in (a runner could replace the
console's folders there). Still, whoever may push to nemo runs code on the server, as the
runner of the environments they may run on.

### Run files on their own origin

A run's report, traces, attachments and screenshots are written by the branch's code, and an HTML
report runs its scripts where it is opened. With `QA_CONSOLE_FILES_URL` the console never serves
them from its own origin: `/runs/<id>/report/…` and `/runs/<id>/files/…` check who asks (prod's
take an operator) and send the browser to that origin with a ticket in the path, for that run
only, good for two hours (`/t/<ticket>/runs/<id>/…`; a screenshot's ticket opens screenshots
only). The ticket is signed with a secret in `<data dir>/state/files-secret`. That origin answers
nothing else: no API, no pages, no sign-in, and changes are never taken from it. A link to a
report that comes from anywhere but the console's own pages (Slack, or the files origin itself)
first gets a page with a link to click, which nothing can frame. Point a second host name at the
console, e.g. `qa-files.example.com` (a domain of its own would keep it apart even better).

### Docker

The server console's image is the `Dockerfile` at the root: the console and the browsers of
Playwright (its tag must equal `@playwright/test`; `pnpm validate` checks it), git, `tini` as
PID 1, sudo with the runner users (`QA_CONSOLE_RUNNERS=sudo`) and Hermes Agent for the agent
checks (pinned by `HERMES_COMMIT`; the runners run `/usr/local/bin/qa-hermes`, with the image's
Chromium). The image is about 6 GB. It runs as `pwuser` in server
mode and keeps everything under `/data`: give it a volume.

```bash
cp console/users.example.yaml console/users.yaml   # your email (the file is git-ignored)
pnpm console:docker                                # builds and starts → http://127.0.0.1:7359
docker compose -f console/compose.yaml stop        # stops the runs first, as on the server
```

`console/compose.yaml` takes nemo's `.env` and `~/.hermes/.env`, as the engine does (the IdP
and git settings, `QA_*` for the QA accounts), and sets what the container needs itself: server mode on port 7357, published at
`http://127.0.0.1:7359` (run files at `http://localhost:7359`, another origin), `/data` in the
volume `qa-console-data`, the users file mounted read-only, and the image's Hermes (a
`QA_CONSOLE_HERMES` in `.env` is for `pnpm console` on the Mac).
Chromium gets 1 GB of shared memory, and stopping waits up to 4 minutes: the console stops its runs
(as **Stop** does, so their tests delete their data) and exits when they are done.

### Kubernetes

Build the image from the `Dockerfile` at the repo root (`--build-arg BUILD_ID=<tag>`) and push it
to your registry; `/api/health` tells which image runs (`build`).
`console/deploy/qa-console.yaml` is a reference manifest, and `console/deploy/README.md` is the
deploy guide, step by step: the minimum node, every key and where it comes from (the git host,
the OAuth client, the models, the skill store's bucket), the Kubernetes objects, the first
deploy, turning the skill store on, CI, and what must stay as it is.

## Configuration — `e2e.config.yaml`

| Section | What it sets |
|---|---|
| `environments` | `base_url`, `api_url`, `credentials` prefix (left out: a public site, tested signed out — no login, no setups, no `track`); `login` how the login project signs in (`path` where it starts, `submit` its button's name, `done` the path the app lands on once signed in); `api_token_cookie` the session cookie whose token the API takes as a Bearer header; `device` a Playwright device its tests run as (`Pixel 7`, `iPhone 15`: screen, user agent, touch); `tests` its own folder under `tests/` (the others leave that folder out); optional `allowed_tiers` to keep tiers off an environment, `guarded: true` to ask for a confirmation before interactive runs (`pnpm ui`, the console), `branch` the server console tests it from (default `develop`), `local_only: true` for one only a developer's machine reaches (the app on localhost: the server console neither shows nor runs it), `login_origin` the origin of its sign-in page (the console's agent checks put the QA account into Hermes's vault for it), `agent_checks` the Hermes skills CI has the console run there after a deploy and on a schedule |
| `tiers` | per tier: `workers`, `retries`, `needs` (tiers that must pass first), `read_only` |
| `profiles` | which tiers one run includes, `global_timeout` |
| `default_profile` | the profile of a bare run |
| `safety` | `data_prefix` (the title prefix of everything the tests create), `protected_titles` (never deleted) |
| `cleanup` | `on_pass` / `on_fail` / `on_interrupt`: `delete` or `keep` the data a test created |
| `error_monitor` | `auto_check` (end every test with the error check), `ignore` (regexes of known, accepted errors) |
| `sweeper` | `older_than`, `max_deletes` for `pnpm sweep` |

Each tier is its own Playwright project: `ai` needs `smoke`, so AI credits are never spent on a
deploy whose smoke tests fail. A read-only tier may not create data: no creating setup, no
`track` step (also not inside a template).

## AI

The `ai` section of `e2e.config.yaml` names the models AI features use, by role, and works with
any model: `protocol: openai` speaks the OpenAI-compatible API (OpenAI, and through `base_url`
OpenRouter, Gemini's OpenAI endpoint, vLLM, LM Studio, Ollama at `http://localhost:11434/v1` with
`key: null`), `protocol: anthropic` Anthropic's. A model must have `vision: true` to judge (it gets
screenshots); `key` names the `QA_*` variable holding its API key (`.env`, CI secrets);
`usd_per_million` is its list price, for the budget.

```yaml
ai:
  models:
    fast:   { protocol: openai, model: gpt-6-luna, key: QA_AI_OPENAI_KEY, vision: true,
              usd_per_million: { input: 0.1, output: 0.5 } }
    local:  { protocol: openai, base_url: http://localhost:11434/v1, model: qwen2.5vl, key: null,
              vision: true, usd_per_million: { input: 0, output: 0 } }
  judge: { model: fast, escalate_to: strong, min_confidence: 0.7, retries: 2, blocking: true }
  budget_usd_per_run: 1
```

**The judge** (`ai_check`) shows its model the page — a screenshot in CSS pixels from the top (up
to 1600 tall) and the ARIA snapshot of the whole page — with the test's title, its steps so far
(as written, without their values) and the question, and gets a verdict (`pass`, `fail`,
`unsure`), a confidence and a reason. When what decides is below the screenshot, the model answers
`unsure` with `look_at`, a text of the page; the next look is taken around it. An answer below
`min_confidence`, or `unsure`, is not trusted: the page is left to settle (network quiet,
animations done), looked at again (`retries`), then shown to `escalate_to`. A call gives up after
60 s, and the whole check after half the test's timeout (3 minutes at most). Only a confident
answer decides:

| Outcome | The step | The report |
|---|---|---|
| pass | passes | annotation `ai_check` with every attempt |
| fail, blocking | fails: `AI check failed (<confidence>): <reason>` | and `ai-check-<n>-marked`: the screenshot with the regions the model pointed at |
| fail, `blocking: false` | passes | annotation `ai finding` |
| still unsure | passes | annotation `ai review`: "AI was not sure: …" |
| not judged (no key, wrong key, outage, budget spent) | passes | annotation `ai review`: "AI did not judge: …", and one warning in the output |

AI never turns a failed step green, and an `ai_check` is not replayed after a rate limit (it would
be paid for again). What leaves the machine: the screenshot, the ARIA snapshot, the page's origin
and path (no query), the test's title and steps as written, the question; the key only to the
`base_url` the config names (the SDKs' own `*_BASE_URL` variables are ignored). Its calls cost what `usd_per_million` says; all workers of a
run share `budget_usd_per_run` (`<run folder or reports>/ai-spend/<run id>.ndjson`), and past it
nothing more is asked. In CI (`CI` set) a run whose tests use `ai_check` while the judge's model has no
key stops at start (listing tests does not), so a forgotten secret is not mistaken for passing
checks; a missing escalation key only skips the escalation. `ai: false` on an environment or a profile turns AI off
there (prod here); with AI off, `ai_check` only attaches the screenshot and the question. A local
QA console (`pnpm console`) runs with this machine's `.env`, so its runs are judged like the CLI's;
a server console's runs get no AI keys yet, and their `ai_check` steps are not judged.

## Writing a test with AI

Describe what to check; the AI walks it in a browser with nemo's own steps and writes the test:

```bash
pnpm author --env demo "On a phone, the FAQ question about where data lives opens its answer"
pnpm author --env staging "the contact form sends a message" --verify 2 --save
```

- **How:** the project `<env>:author` (`engine/author.spec.ts`) opens the site signed in, on the
  environment's device, and shows the model the screen and the ARIA snapshot; the model calls one
  step at a time (`goto`, `click`, `fill`, `press`, `expect…`, `ai_check`) and sees the page again.
  A step that fails is not kept. When the goal is reached it adds the assertions that prove it
  and calls `finish`. The draft is `reports/author/<run id>/<slug>.test.yaml`, with
  `result.json` (every step it tried) and a screenshot per turn.
- **Verified:** the draft is then run on its own, without retries, `--verify` times in a row
  (default 1); an `ai_check` in it counts only when judged `pass`. Only a verified draft is saved:
  `--save` copies it to the environment's tests folder (`tests/<tests>/`, else `tests/authored/`),
  never over a file. Read it, then commit it.
- **Safety, in the engine (not the prompt):** never on a `guarded` environment (write on staging;
  the test runs on prod too). One step per model reply, looked at in between. A `goto` off the site
  is refused, and a step that leaves it ends the case. A `click`/`press` target is found first
  (waited for; not found = refused) and refused when its text, label, value, alt, title or link
  path holds a word of `ai.author.avoid` (pay, buy, checkout, purchase, publish, delete, remove,
  sign out, signout, log out, logout, unsubscribe); so is a `goto` path with one.
- **Writes are seen on the network:** a request that is not a read (POST, PUT, DELETE …) to the
  app (its site, its `api_url`), or a form sent anywhere, is a write; telemetry paths
  (`ai.author.ignore_writes`: collect, log_event, trackevents, beacon, Sentry …) are not. Where
  the environment does not set `author_writes: true`, every such request is stopped before it
  leaves and the step is not kept (the page goes back to where it was). Where it does (staging
  here), a test that wrote is `regression`, tagged `writes`, runs only there
  (`environments: [staging]`) and is not cleaned up.
- **Settings:** `ai.author: { model, max_actions: 30, avoid: […], ignore_writes: […] }`, a role
  with tool calling and vision; `max_actions` counts every tool call. `params` on a model go into the request as they are: OpenAI's reasoning models take
  tools in Chat Completions only with `params: { reasoning_effort: none }` (the role `tools` here).
- A test file may name the environments that run it: `environments: [staging]`.

## A test file

```yaml
suite: Landing pages on a phone           # like describe()
tier: smoke                               # smoke | regression | ai (e2e.config.yaml tiers)
tags: [demo, mobile]                      # --grep @mobile
setup: []                                 # like beforeEach(): data through the API (see Setups)
each: { as: section, from: data/demo-pages.yaml } # like test.each(): one test per row
tests:
  - name: opens ${section.name}
    timeout: 2m                           # optional; skip: true / only: true also work
    steps:
      - goto: ${section.path}
      - expect_url: { matches: "${section.path}/?([?#]|$)" }
      - expect_visible: { css: h1, has_text: "${section.heading}" }
      - expect_fits_width: true
      - ai_check: Does the page look right on a phone?
        unless: section.plain             # skip the step when the row's variable is truthy
```

`tests/demo/` is the working example: the public landing of edplay.ai on a phone
(environment `demo`, `pnpm demo`), no account and no `.env` needed.

Add `# yaml-language-server: $schema=../../schema/test-file.schema.json` at the top for
autocompletion and inline errors in the editor. Folders under `tests/` follow the tiers by
convention; the `tier` field is what counts.

## Steps

| Step | Argument |
|---|---|
| `goto` | URL or path (paths are relative to the environment's `base_url`) |
| `click` | target |
| `fill` | target + `value` |
| `press` | a key for whatever has focus (`press: Escape`), or target + `key` |
| `expect` | target + any of `visible`, `checked`, `enabled`, `contains`, `matches` (a regex), `count` |
| `expect_visible` / `expect_hidden` | target |
| `expect_url` | exactly one of `contains`, `starts_with`, `matches` (a regex); retries, so it also catches a late redirect |
| `expect_no_errors` | `true` — the error check below, at this point of the test |
| `expect_fits_width` | `true` — the page is no wider than the window: nothing scrolls sideways (the phone check; names the element that sticks out) |
| `repeat` | `until` (a target), `max` rounds (default 25), `steps` — runs the steps until the target shows |
| `track` | `kind` + `title` — registers data made through the UI for cleanup |
| `ai_check` | a question for the [AI judge](#ai), or `{ question, blocking: false }`: a confident "fail" fails the step (unless not blocking), an unsure or missing answer marks the test for review |

Every step also takes `name` (report title), `when` and `unless` (a variable path). In the report
each step is numbered (`03`, and `03.1`, `03.2` inside a template or a `repeat` round) and points
at its YAML line.

```yaml
- repeat:                                  # one round per question of a quiz
    until: { text: Quiz Completed }
    max: 10
    steps:
      - click: { role: radio, nth: 0 }
      - click: { button: Check answer }
      - click: { button: Continue }
```

**Error check.** Every test ends with it (`error_monitor.auto_check`); it fails the test on a
403/404 page, an error message on the page, an error toast or alert, an API 5xx/401/403 response,
or the app leaving for the login page. Accept a known error with a regex in
`error_monitor.ignore` instead of switching the check off.

**API rate limit.** The API answers 429 past 300 requests a minute per user, and every test boots
the app afresh, so a busy run can reach it. A 429 is not an app error:
- the engine's own API calls (setups, cleanup, sweep) wait until the limit resets and retry;
- when a step fails after the page got a 429, the steps from the page's `goto` run again once the
  limit resets (up to twice), if every step in between only checks the page (`expect`,
  `expect_visible`, `expect_hidden`, `expect_url`, `expect_fits_width`, `expect_no_errors`). The
  report shows a `rate limited` annotation;
- a test that still fails says in its error that the rate limit refused requests of the page.

**Targets** use exactly one of `button`, `role` (+ `name`), `text`, `css`, `placeholder`,
`label`, `testid`, plus optional `in: <role>` (e.g. `in: dialog`), `exact` (default `true`,
case-sensitive), `has_text` / `has_not_text` (keep the matches that contain, or lack, a text —
e.g. a row by its title) and `nth`.

**Variables:** `${env.name}`, `${env.base_url}`; each row (`${section.name}`, `${section.path}`);
whatever the setups set (below). A number in the path picks a list item: `${order.items.1.name}`.

## Setups

A setup prepares a test's data before it runs, through the app's API: a fresh record, titled with
the data prefix and registered for cleanup (mode `creates`), or one that already exists (mode
`readonly`); it puts what the test needs into a variable, e.g. `${order.url}`. None ship — they
are the app's own. A setup is a file in `engine/setups/` with `defineSetup({ name, mode, params,
run })` and one line in `engine/setups/index.ts`; `pnpm schema` then offers it in the editor.

```yaml
setup: [order]                                   # like beforeEach()
setup: [{ order: { as: other_order } }]          # params, e.g. a second one in another variable
```

A read-only tier may not use a creating setup, and an environment without an account no setup.

## Test data and cleanup

- Everything a test creates is named `<data_prefix><run id> <test title>` (`${test.data_title}`)
  and registered: setups do it themselves; data made through the UI is registered with
  `- track: { kind: order, title: "${test.data_title}" }`.
- The kinds are the app's: one **gateway** per kind in `engine/cleanup/gateways.ts` reads a record
  back by id, lists the test user's own and deletes one, through the app's API
  (`ApiClient`: `get`, `find`, `post`, `delete`). Who the test user is comes from one hook,
  `fetchTestUserId` in `engine/cleanup/test-user.ts`. None ship; until they are written, `track`
  refuses every kind and `pnpm sweep` has nothing to look for.
- The run id is the CI build number, or `c<date>-<time>-<random>` for a local run.
- After the test, per `cleanup` in the config: a passing test deletes its data; a failing one
  keeps it and the report lists it under "kept for debugging"; a test interrupted by a stopped run
  (Ctrl+C, the console's Stop) follows `on_interrupt` (delete).
- Before deleting, the record is read again and must still start with the prefix, not be
  protected and belong to the test user — anything else is skipped and reported, never deleted
  (`engine/cleanup/guard.ts`).
- `pnpm sweep` deletes the test user's prefixed leftovers older than `sweeper.older_than`;
  `--run <run id>` takes one run's data instead, whatever its age. Without `--apply` it only
  lists them, it stops if there are more than `max_deletes`, and `--json` prints one JSON object.

Built-in variables: `${env.name}`, `${env.base_url}`, `${run.id}`, `${run.timestamp}`,
`${test.title}`, `${test.data_title}`.

## Templates — reusable blocks of steps

A template (`templates/**/*.template.yaml`) is a named block of steps with typed params; a test
calls it like a step. Example, `templates/demo/menu-link.template.yaml`:

```yaml
template: open_menu_link                           # becomes a step keyword
title: open ${params.link} from the mobile menu    # its report title
params:
  link: { type: string }                           # string | number | boolean | duration
steps:                                             # a default makes a param optional
  - click: { button: Open menu }
  - click: { role: link, name: "${params.link}", in: dialog }
```

```yaml
# in a test
- open_menu_link: { link: Pricing }
```

- Inside a template, `${params.x}` and `when: params.x` read its params; everything else
  (`${section.…}`, what the setups set) is the test's own variables, shared in both directions.
- Templates may call templates; params are checked when the files load (missing, unknown, wrong
  type) and again at run time for `${…}` values. Calls that loop are rejected.
- `pnpm schema` adds every template, with its params, to the editor autocompletion.

## New test from a scaffold

`pnpm new <tier> <path> ["Suite name"]` copies `scaffolds/<tier>.test.yaml` to
`tests/<tier>/<path>.test.yaml` with the suite name and schema line filled in. `pnpm validate`
also checks that every scaffold still makes a valid test.

## Adding a step

1. `defineStep({ keyword, schema, describe, run })` in `engine/steps/`.
2. Register it in `engine/steps/index.ts`.
3. `pnpm schema` to refresh the editor schemas (`pnpm validate` fails while they are stale).

## Hermes agent skills

`hermes/` holds the `qa-*` skills for [Hermes Agent](https://github.com/NousResearch/hermes-agent):
an AI agent that drives the browser from the command line for exploratory checks.
`hermes/qa-shared.md` is the contract every skill follows: environments, vault login, safety
rules, screenshots, marking what is wrong.

The repo ships one: `qa-landing-mobile`, the edplay.ai landing on a phone (environment `demo`,
no login) — the same page the YAML tests in `tests/demo/` check, looked at the way a tester
would. Start your own from a skill template (`hermes/skill-templates/`, or the console's Skills →
Add skill).

```bash
bash hermes/install.sh                       # links the skills into ~/.hermes (backs up what was there)
hermes -z "/qa-landing-mobile demo" --accept-hooks
```

- Edit the skills here: `~/.hermes/skills/qa-*` are symlinks to this folder. Most skills are in
  the QA console's [skill store](#skill-store): `pnpm skills:pull` writes them into
  `~/.hermes/skills` (`QA_CONSOLE_SKILLS_*` in `.env`; for this a key that may read is enough).
- Logins come from the Hermes vault (`hermes vault add` per login origin); the script-based skills
  read `QA_<ENV>_EMAIL` / `_PASSWORD` from `~/.hermes/.env`.
- Screenshots go to `~/nemo-output/smoke-screens/<env>/<skill>/`; make `~/nemo-output` a symlink before
  installing to keep them elsewhere.
- What a skill finds wrong on a page it also shows marked: before a `<name>-marked.png` screenshot
  the agent loads `hermes/qa-mark.js` into the page and frames each problem in red, draws a
  dashed "Missing" frame where something should be, or a banner for what has no place on the
  screen (the shared contract → Marking what is wrong). The marks live in the agent's browser
  only. A skill needs no code of its own for it; one that should also show what it found asks for
  green frames (`qaMark.ok`).

### Writing a skill

A skill is a folder `hermes/skills/<name>/` with two files: `skill.yaml`, what the skill does
(edit this one), and `SKILL.md`, the file Hermes reads, which `pnpm skills` writes from it
(never edit it by hand). What every skill shares is Markdown: `hermes/skill-template.md` holds the
base of every `SKILL.md` (the safety paragraph, Setup and the arguments, the Screenshots and Report
sections), and `hermes/qa-shared.md` the rules all of them follow (environments, the vault
login, test data, browser mechanics).

```bash
pnpm skills        # after changing a skill.yaml or the template: writes the SKILL.md files
pnpm validate      # fails while a SKILL.md is out of date or a skill.yaml is wrong (CI runs it)
```

| Field | What it says |
|---|---|
| `description` | what the skill checks and when to use it: Hermes's list of skills and the console's New run show it |
| `title`, `summary` | the heading of its `SKILL.md`, and what it does in a few sentences |
| `safety` | `read_only`, `records_activity` (the test account's own progress or attempts) or `creates_data`; `side_effects` says what exactly, `ai_credits: true` that it spends AI credits |
| `arguments` | what it takes besides the environment, e.g. an asset type |
| `start_at` | the page it starts on, e.g. `/dashboard/quizzes` |
| `rules` | what to keep to all along |
| `sections` | more sections before the steps (`title`, `text`), e.g. a one-time setup |
| `steps` | what to do, in order: one Markdown text each |
| `screenshots` | `folder` (under `~/nemo-output/smoke-screens/<env>/`) and `files`, each with when to take it |
| `report` | what the report gives after its `RESULT: PASS` / `RESULT: FAIL` line |
| `pass_if`, `fail_if`, `not_a_failure` | when it passes (any of; none: whenever no FAIL case holds), when it fails (any of), what does not fail it |

Long texts: `>-` joins their lines into one, `|-` keeps them (a list, a table or a code block in a
step). The editor completes and checks the fields (the `# yaml-language-server: $schema=…` line on
top). A new skill goes into the [skill store](#skill-store): the team's console → [Skills](#skills)
→ **Add skill** starts one from a template or a copy in a form (or takes the file) and checks it;
local and staging run it at once, prod once promoted, and `agent_checks` in `e2e.config.yaml` has
CI run it. Only a skill that runs Playwright scripts goes into git: copy a folder, name it
`qa-…` (the folder name is the skill's), change its `skill.yaml`, run `pnpm skills` and
commit both files; the QA console offers it in New run once its branch has it.

## Side effects

The demo (`tests/demo/`) only reads a public site. Your own creating setups and `track` make
`[SMOKE] E2E …` records (deleted after a pass, kept after a failure). The smoke tier only reads,
the `ai` tier spends the app's AI credits. `E2E_ENV=prod` runs the same tiers on prod unless
`allowed_tiers` says otherwise.
