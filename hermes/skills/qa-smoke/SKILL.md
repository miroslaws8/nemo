---
# Written by `pnpm skills` from skill.yaml and hermes/skill-template.md: edit those.
name: qa-smoke
description: Read-only browser smoke test of the web app (local | staging | prod) — log in and verify the dashboard and courses list render. Use to smoke-test the app, check an environment's login/dashboard is up, or verify the app after a deploy.
---

# App smoke test (local | staging | prod)

Log in and verify the dashboard and the courses list render.

**Read-only on every environment, prod included:** the only state change is logging in. Submit nothing else.

## Setup
First run `cat ~/.hermes/qa-shared.md` in the terminal (there is no `read_file` tool here) and follow it: environments, the vault login, test data, browser mechanics, screenshots, marking what is wrong.
Arguments: the environment (`local`, `staging` or `prod`; default `staging`).
Any other words are a note from whoever started the skill: follow it within this skill's rules.
Start at `<base>/dashboard`.

## Steps
1. Open `<base>/dashboard` and log in (shared contract → Credentials).
2. Verify the dashboard rendered: the final URL is on the workspace host; no error screen, no 401/403/404, no `role=alert`, no stuck loader.
3. Open `<base>/dashboard/courses`; report how many courses are listed (by section if grouped, e.g. Micro-learning / My courses; fall back to section heading counts if a card selector matches nothing).

## Screenshots
Save them in `~/myqa-output/smoke-screens/<env>/smoke/` as the shared contract's Screenshots section says (expand the home path: a relative `./` path lands in `~/.hermes`), and report their absolute paths:
- `01-login.png`: the bare login form, before typing
- `02-dashboard.png`
- `03-courses.png`

When something on a page is wrong or missing, also save a marked screenshot of it (`<name>-marked.png`), as the shared contract's Marking what is wrong section says, and name it in the report.

## Report
`RESULT: PASS` or `RESULT: FAIL` on the first line, then:
- environment and final URL
- dashboard rendered? (key sections seen)
- courses count (or why unknown)
- screenshot paths
- any side effects

**FAIL** if any of:
- the environment is unreachable or login fails
- the dashboard shows an error, 401, 403 or 404
- a loader never resolves
- the final URL is not on the workspace host

**PASS** otherwise.
