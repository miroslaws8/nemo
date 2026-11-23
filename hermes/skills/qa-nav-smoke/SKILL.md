---
# Written by `pnpm skills` from skill.yaml and hermes/skill-template.md: edit those.
name: qa-nav-smoke
description: Read-only navigation health check of the app's dashboard — log in and visit every main sidebar section, asserting each page loads without error. Safe on staging AND prod. Use to verify all routes are alive after a deploy, or as a synthetic uptime monitor.
---

# Example app — navigation smoke (route health check)

Check that every main dashboard section loads.

**Read-only on every environment, prod included:** the only state change is logging in. Submit nothing else.

## Setup
First run `cat ~/.hermes/qa-shared.md` in the terminal (there is no `read_file` tool here) and follow it: environments, the vault login, test data, browser mechanics, screenshots, marking what is wrong.
Arguments: the environment (`local`, `staging` or `prod`; default `staging`).
Any other words are a note from whoever started the skill: follow it within this skill's rules.
Start at `<base>/dashboard`.

## Steps
1. Open `<base>/dashboard` and log in. Confirm Home rendered.
2. Enumerate the sidebar: collect every link via `document.querySelectorAll('a[href]')` then filter in JS/Python — do NOT rely on a container selector like `aside a, nav a` (it returned empty on prod). The sidebar varies by workspace/plan, so read it from the page you are on. Expand collapsible groups ("Build & Manage", "Workforce") to reveal sub-items (read-only). The anchor scan can miss top-level links (Home, Courses, Learning Paths, Shared with me) — if so, find them in a screenshot and check their routes directly.
3. Reference sections seen on staging (varies by account): Home (`/dashboard` itself), `courses`, `collections`, `learning-paths`, `share` (Shared with me), `quizzes`, `certificates`, `user-management`, `recently-deleted`, and the Workforce group `workforce` + sub-pages (`workforce/skill-gaps`, `/recommendations`, `/knowledge`, `/requests`, `/learners`, `/structure`, `/work-areas`, `/setup`, `/automation`, `/scales`, `/sign-off`). "Learning Settings" is a TOP-LEVEL route `<base>/learning-settings` (outside `/dashboard`). Micro-learning is NOT a route (a toggle on Home). `content-library` may be absent. A section missing from the sidebar is INFO (not a failure); only sections present-but-broken fail.
4. For each destination (batch ~5 navigations per call): navigate (click its link, else go to its href), read `js("location.href")`, let it settle, and record OK/FAIL. FAIL if: 401/403/404/5xx, an error screen or `role=alert`, a genuinely blank/no-content page, a spinner with no content after ~8s, or a redirect back to login. Empty-state pages are OK.

## Screenshots
Save them in `~/nemo-output/smoke-screens/<env>/nav/` as the shared contract's Screenshots section says (expand the home path: a relative `./` path lands in `~/.hermes`), and report their absolute paths:
- one per section: `01-home.png`, `02-courses.png`, …; always keep a failing section's shot

When something on a page is wrong or missing, also save a marked screenshot of it (`<name>-marked.png`), as the shared contract's Marking what is wrong section says, and name it in the report.

## Report
`RESULT: PASS` or `RESULT: FAIL` on the first line, then:
- a table, one row per section: `section | final URL | OK/FAIL | note`, broken sections first
- environment and the number of sections checked
- expected sections absent from the sidebar (INFO)
- the screenshot folder

**PASS** if any of:
- every section present in the sidebar loaded OK

**FAIL** if any of:
- a section present in the sidebar did not load (list the broken ones first)

Not a failure:
- a section missing from the sidebar (INFO)
- an empty-state page
