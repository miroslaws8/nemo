# Test skills — shared contract

Common setup for every `qa-*` test skill. Each skill's SKILL.md says "read this
file and follow it", then adds only its unique steps. Follow these sections unless a
skill explicitly overrides them.

This file and the skills live in the `nemo` repo (`hermes/`); `hermes/install.sh` links
them into `~/.hermes`, so edit them in the repo (a skill: its `skill.yaml`, then `pnpm skills`).

## Environment

Each skill takes the environment as its invocation argument (a name in `e2e.config.yaml`).
**Default: `staging`.** Its base URL is that environment's `base_url`, unless `QA_<NAME>_URL` is
set (the console sets it for every check it runs). The repo ships:
- `demo`    → `https://edplay.ai` (a public site on a phone: no account, no login)
- `staging` → `https://qa-automation.staging.example.com` (override `QA_STAGE_URL`)
- `prod`    → `https://qa-automation.example.com`      (override `QA_PROD_URL`)

Replace `staging` and `prod` with your app's. Build every page URL as `<base>/<path>`.
An environment with an account runs with its test account (`QA_<NAME>_EMAIL`), never a personal
one; one without (`demo`) is never logged in to.

## Credentials (vault login)

Passwords come ONLY from the credential **vault** auto-fill: the browser tool cannot
type a password, and `save_login` cannot prompt in a `-z` session. The vault is
seeded once per login origin (`login_origin` in `e2e.config.yaml`) with `hermes vault add`,
e.g. staging → `https://auth.staging.example.com`. An environment without an account has no
login: skip this section there.

Login procedure (verified):
1. Open the skill's landing URL; an unauthenticated load redirects to the login
   page. Take the login origin (scheme + host).
2. Look up the vault via `tool_call` `browser_vault` `{"action":"list"}` (run
   `tool_describe` on `browser_vault` first if its schema is not loaded). Pick the
   item whose `origin` equals the login origin; when several match, the one whose
   `identifier` equals `QA_<ENV>_EMAIL`. Note its `handle` and `identifier`.
3. Type the identifier into the email field of the login form (`fill_input(<its selector>, identifier)`)
   (identifier from the vault, or `QA_<ENV>_EMAIL`). Do not touch the password.
4. Fill the password via `tool_call` `browser_vault` `{"action":"fill","handle":<handle>}`
   (it fills the password field). Never type the password.
5. Submit by clicking the form's OWN `button[type=submit]` whose text is "Sign in".
   Never click Google / Microsoft / SSO; if an external OAuth page opens, go back and
   use the email/password form.
6. After submit, read `js("location.href")` and wait 2-3s. Do NOT call `page_info()`
   right after a navigation — it throws while the document is being replaced.
7. If the vault has no entry for the login origin, STOP:
   `RESULT: FAIL — vault not seeded for <origin>; run: hermes vault add`.
Never print, echo, or log the password.

## Prod & test-data safety

Prod runs the FULL test suite, same as staging (full parity). Mutating skills WRITE real data
to prod — attempts, progress, `[SMOKE]` drafts — and AI skills spend real credits there.
- Every artefact a skill CREATES keeps the `[SMOKE]` marker in its title so prod test data
  is identifiable and removable. Never delete anything yourself: leave what you created in
  place. (The YAML e2e tests in this repo delete their own `[SMOKE] E2E` data after a passing
  test, keep it after a failure, and `pnpm sweep` removes leftovers older than a day.)
- **Titles of what you create (`QA_DATA_PREFIX`).** Read it first:
  `os.environ.get("QA_DATA_PREFIX")` in `browser_exec`, `echo "$QA_DATA_PREFIX"` in the
  terminal. The QA console sets it for every check it runs (`[SMOKE] E2E <run id> `, ending in
  a space): start the title of everything you create with it exactly, then the skill's own
  name, e.g. `<QA_DATA_PREFIX>LP 2026-11-16 22:40`. The console's **Clean up** for the
  check, and the nightly sweep after a day, delete what carries it. Not set (a run by hand):
  use the skill's own `[SMOKE] …` title; that data stays for review until someone removes it.
- Test account: the vault login per origin — use the dedicated QA account of that
  environment, never a personal one. A skill's own Playwright scripts can't read the vault:
  they need `QA_<NAME>_EMAIL` / `_PASSWORD` in `~/.hermes/.env`.
- Still NEVER do anything TRULY destructive or costly beyond the skill's purpose, on any
  env: don't delete or edit data you did not create, never complete a payment / enter card
  details, and don't publish to real learners.
- A purely read-only skill stays read-only everywhere — it submits nothing beyond login.

## Browser resilience & mechanics

The local browser daemon is flaky on heavy pages. Handle it, don't fail on it:
- On a timeout, a blank `about:blank`, or a drop back to the login page: start a
  FRESH named session, log in again, and resume — retry ONCE before recording FAIL. A
  wedged daemon stays wedged for the rest of that session, so always use a NEW session
  for the retry. Treat daemon timeouts as infrastructure, not a product bug.
- Batch at most ~5 navigations per `browser_exec` call; one call with 10+ navigations
  can hit a daemon timeout partway and lose progress.
- Judge a page by its RENDERED CONTENT (screenshot / visible text), NOT by DOM class
  names: a lingering `loader`/spinner class can persist on a fully rendered page.
- `document.body.innerText` includes the sidebar, so its length is not a blank signal.
  Detect real errors by searching page text for `404`, `403`, `401`, `500`,
  "something went wrong", "page not found", "forbidden", "unauthorized".
- Empty-state pages ("No ... yet", "Nothing here yet") are OK — the designed state for
  an account with no data; FAIL only if the screenshot shows no UI at all.
- For thin pages, run `vision_analyze` on the screenshot to confirm it rendered before
  recording OK; note which pages were visually confirmed vs text-only.

## Screenshots

Save under `~/nemo-output/smoke-screens/<env>/<skill-subdir>/` (each skill names its subdir and
filenames). `~/nemo-output` is the QA output folder `hermes/install.sh` creates (it may be a
symlink to wherever you keep screenshots). IMPORTANT: the browser/exec tool's cwd is
`~/.hermes`, so a relative `./smoke-screens/...` path — and `os.path.abspath()` of one —
resolves to `~/.hermes/smoke-screens/...`, scattering screenshots. Always expand the home path:
`folder = os.path.expanduser("~/nemo-output/smoke-screens/<env>/<skill-subdir>/")`, then
`os.makedirs(folder, exist_ok=True)` and capture with
`shutil.copy(capture_screenshot(), os.path.join(folder, "<name>.png"))`
(`capture_screenshot()` returns a temp path). Report absolute paths.
Give `vision_analyze` only a path your `browser_exec` printed (`print(os.path.join(folder, …))`),
never one you write yourself: your home is `$HOME`, which need not be the home of the account
you run as (the QA console gives each check a home of its own), and a hand-written path can open
another run's old screenshot.

## Marking what is wrong

When a skill that saves screenshots finds something wrong that a person could see — or something
that should be on the page and is not — mark it on the page and save a marked screenshot, so the
screenshot shows the problem at a glance. The marks are drawn in your browser only: the app never
sees them. Mark only what you report as wrong (or what the skill asks to show); a PASS needs none.

1. Load the helper into the page, once per page (again after a full page load):
   `js(open(os.path.expanduser("~/.hermes/qa-mark.js")).read())` answers
   `qaMark is ready: …`.
2. Mark each problem, with single quotes inside `js("…")`:
   - `js("qaMark.bad('<target>', 'what is wrong')")`: an element that is there and wrong (an
     error message, a broken image, a button with no name, a wrong value).
   - `js("qaMark.missing('<anchor>', 'what is missing')")`: what should be there and is not,
     drawn beside the element it belongs next to (a third argument `'left'`, `'right'`,
     `'above'` or `'below'` picks the side; else the side with more room). Leave the anchor out
     (`qaMark.missing(null, '…')`) only when nothing on the page is near where it belongs: then it
     is a banner.
   - `js("qaMark.note('what is wrong')")`: a problem with no place on the screen (the tab's title,
     a redirect, a console error): a banner at the top.
   - `js("qaMark.ok('<target>', 'what is there')")`: a green frame, only when a skill asks to show
     what it found as well.

   A target is a CSS selector or `text=<visible text>`, chained with ` >> ` as in Playwright (each
   part looks inside what the one before found: `button >> text=New quiz`); `>> nth=1` picks the
   second of several (0 is the first, -1 the last). A label names the problem in a few words
   (`no name`, `Export quizzes`): the helper adds the ✗, and "Missing:" for `missing`.
3. Read what each call answers. `marked: false`: the target or the anchor is wrong, or it names
   an element marked already — find the element another way (a CSS selector from the DOM) and mark
   again, or mark it as `missing` or `note` if it is really not there. `matches` above 1: the
   target names several elements and this framed one; mark each of them with its own `nth`.
   `warning`: the page scrolled to show it — screenshot what is marked so far, `qaMark.clear()`,
   then mark the rest for another screenshot.
4. Save the marked screenshot as a file of its own, named after the plain one with `-marked`
   (`02-quizzes-marked.png`), then `js("qaMark.clear()")` before going on. Keep the plain
   screenshot too: it shows the page as the app drew it.
5. In the report, name the marked screenshot beside each finding it shows.
