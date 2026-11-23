---
# Written by `pnpm skills` from skill.yaml and hermes/skill-template.md: edit those.
name: qa-lp-create
description: Functional test — manually create a Learning Path in the app and attach existing courses to it. MUTATING (creates data) — runs on every env (staging/local AND prod); every created path carries the `[SMOKE]` marker for cleanup. Use when asked to test Learning Path creation / adding courses to a path.
---

# Example app — create a Learning Path and add courses (manual flow)

Create a path, then attach existing courses from the picker.

**Creates data on every environment, prod included:** one Learning Path, with up to 2 existing courses attached. Title what you create as the shared contract says (Titles of what you create), and never delete anything yourself.

## Setup
First run `cat ~/.hermes/qa-shared.md` in the terminal (there is no `read_file` tool here) and follow it: environments, the vault login, test data, browser mechanics, screenshots, marking what is wrong.
Arguments: the environment (`local`, `staging` or `prod`; default `staging`).
Any other words are a note from whoever started the skill: follow it within this skill's rules.
Start at `<base>/dashboard/learning-paths`.

- The landing page is admin-only; the test account is Owner/admin.
- Do NOT delete the path or detach courses — leave everything in place. From the QA console its **Clean up** removes the path; by hand it is left for review and removed manually.

## Steps
1. Open `<base>/dashboard/learning-paths` and log in. Confirm the list loaded (no 401/403/404/error).
2. Note the current path count — the list has no total label, so count the `N courses` lines in `document.body.innerText` (one per path card).
3. Click **New Learning Path** (the button label is "New Learning Path", not "Create"). In the modal: Title `#lp-title` = `<QA_DATA_PREFIX>LP <YYYY-MM-DD HH:MM>` when `QA_DATA_PREFIX` is set, else `[SMOKE] LP <YYYY-MM-DD HH:MM>` (current date-time); Description `#lp-description` = `Automated test path - safe to delete`; leave the Sequential and Certificate switches OFF (`aria-checked="false"`). Click the dialog button whose text is exactly `Save`.
4. Verify the path was created (appears as a Draft with `0 courses`, or its detail page opens). Record its title and id (detail URL `<base>/dashboard/learning-paths/<id>`; open by clicking the card title).
5. On the detail page click **Add courses** to open the picker. Select the first 2 SELECTABLE courses: each row is a `<button>` whose first innerText line is the course title and which has NO `disabled` attribute; a course already in another path shows a second line `In another path` — skip those (that text is the only lock signal). Click the row whose first line equals the title. Attach with the dialog button whose text starts with `Add selected` (reads `Add selected (N)`, not "Add"; disabled at 0). If fewer than 2 are selectable, take what is available. Scope dialog lookups to `document.querySelector('[role=dialog]')`.
6. Verify the courses attached (the detail shows the cards; count == number added).

## Screenshots
Save them in `~/myqa-output/smoke-screens/<env>/lp/` as the shared contract's Screenshots section says (expand the home path: a relative `./` path lands in `~/.hermes`), and report their absolute paths:
- `01-list.png`
- `02-create-modal.png`
- `03-detail-empty.png`
- `04-add-courses-modal.png`
- `05-detail-with-courses.png`

When something on a page is wrong or missing, also save a marked screenshot of it (`<name>-marked.png`), as the shared contract's Marking what is wrong section says, and name it in the report.

## Report
`RESULT: PASS` or `RESULT: FAIL` on the first line, then:
- environment
- the created path's title and id/URL
- courses added (count and titles, or "none available")
- path count before vs after
- screenshot paths
- a reminder: `Left in place: the QA console's Clean up removes it` (with `QA_DATA_PREFIX`) or `Left in place for review — delete manually when done.` (without)

**PASS** if any of:
- the path was created and, when selectable courses existed, the chosen courses attached

**FAIL** if any of:
- the environment is unreachable or login fails
- creating the path or adding courses does not persist

Not a failure:
- adding 0 courses because none were selectable
