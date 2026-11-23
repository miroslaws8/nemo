---
# Written by `pnpm skills` from skill.yaml and hermes/skill-template.md: edit those.
name: qa-course-view
description: Functional test of the course player — open a published course and verify its pages and assets render and page navigation works. Uses the learner view on every env (records progress). Use to check that published course content actually plays.
---

# Example app — view a published course (player render check)

Open a published course and confirm the player renders real content (the first page has a title + a content/asset block) and page navigation works.

**Records the test account's own activity on every environment, prod included:** opening the learner view records learner progress for the test account. That is expected; change nothing else.

## Setup
First run `cat ~/.hermes/qa-shared.md` in the terminal (there is no `read_file` tool here) and follow it: environments, the vault login, test data, browser mechanics, screenshots, marking what is wrong.
Arguments: the environment (`local`, `staging` or `prod`; default `staging`).
Any other words are a note from whoever started the skill: follow it within this skill's rules.
Start at `<base>/dashboard/courses`.

- All environments use the learner view, prod included (full prod parity): `<base>/hub/<hub_id>/course`.
- Read-only within the course: view pages only — do NOT answer quizzes, click Complete/Finish, edit, or submit any form other than login. (Viewing records progress; that is fine. Completing the course is a separate, heavier action we don't trigger here.)

## Steps
1. Log in and open `<base>/dashboard/courses`.
2. Find a **Published** course and get its `hub_id`. Clicking a course card as an admin opens the EDIT builder (not the player), so read the id from the card if exposed, or click it once to open `<base>/hub/<hub_id>/<chat_id>/ai-builder` and read `hub_id` from `js("location.href")`. If NO published course exists, STOP (not a failure): `RESULT: PASS — no published course to view (nothing to test)`.
3. Open the learner player: `<base>/hub/<hub_id>/course`.
4. Verify the FIRST page rendered: a page/section title AND at least one visible content/asset block; not blank; no error / `role=alert` / 401/403/404/5xx; no stuck spinner.
5. If the course has more than one page, navigate to the NEXT page (page control / next — not "Complete") and verify it rendered too.
6. Note the asset/content types seen (text, image, dialog, quiz, etc.).

## Screenshots
Save them in `~/myqa-output/smoke-screens/<env>/course/` as the shared contract's Screenshots section says (expand the home path: a relative `./` path lands in `~/.hermes`), and report their absolute paths:
- `01-courses-list.png`
- `02-course-page1.png`
- `03-course-page2.png` (if present)

When something on a page is wrong or missing, also save a marked screenshot of it (`<name>-marked.png`), as the shared contract's Marking what is wrong section says, and name it in the report.

## Report
`RESULT: PASS` or `RESULT: FAIL` on the first line, then:
- environment
- course title and `hub_id`
- pages verified and whether navigation worked
- content/asset types seen
- screenshot paths
- side effects: learner progress was recorded for the test account

**PASS** if any of:
- the player opened and the first page rendered real content (and next-page navigation worked when the course has more pages)
- there was no published course

**FAIL** if any of:
- the player errors
- a page is blank or shows an error
- a loader never resolves
- navigation is broken
