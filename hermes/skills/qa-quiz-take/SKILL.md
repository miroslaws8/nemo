---
# Written by `pnpm skills` from skill.yaml and hermes/skill-template.md: edit those.
name: qa-quiz-take
description: Functional test of the quiz-taking flow — open a quiz and run it to the graded results screen. Takes the quiz fully on every env (staging/local AND prod) and records an attempt. Use to check that quizzes actually play and grade.
---

# Example app — take a quiz (player run check)

Open a quiz and confirm it plays end to end: intro screen → answer each question → the results screen renders with a score.

**Records the test account's own activity on every environment, prod included:** taking a quiz records ONE learner attempt server-side for the test account. That is expected; change nothing else.

## Setup
First run `cat ~/.hermes/qa-shared.md` in the terminal (there is no `read_file` tool here) and follow it: environments, the vault login, test data, browser mechanics, screenshots, marking what is wrong.
Arguments: the environment (`local`, `staging` or `prod`; default `staging`).
Any other words are a note from whoever started the skill: follow it within this skill's rules.
Start at `<base>/dashboard/quizzes`.

- All environments take the quiz fully, prod included (full prod parity). Use the learner player `<base>/dashboard/quizzes/<quiz_id>/player`.

## Note on reliability

This is a multi-step flow but each wait is short (a per-question submit is a quick API call), so agent-driven browsing is fine — unlike the long AI-gather in `qa-ai-course-intake`. If a very long quiz proves flaky (daemon drops mid-run), picking the smallest quiz in step 3 avoids it; the durable fix would be to port this to the Playwright `scripts/` pattern like the intake skill.

## Steps
1. Log in and open `<base>/dashboard/quizzes`.
2. If NO quizzes exist, STOP (not a failure): `RESULT: PASS — no quiz to take (nothing to test)`.
3. Pick a quiz. Prefer one with a **Published** badge and the **FEWEST questions** (each card
   shows an "N questions" count) — fewer questions = fewer steps = more reliable. Get its
   `quiz_id`: click the card (it opens `<base>/dashboard/quizzes/preview/<quiz_id>`) and read the
   id from `js("location.href")`.
   Quiz cards are NOT anchors (no `href`), and a DOM `.click()` on the title text does not
   navigate. Get the card's bounding box via `getBoundingClientRect()` on the title element and
   use `click_at_xy(x, y)` at its centre. Confirm navigation with `js("location.href")` after a
   short wait.
4. Build the player URL from the preview URL you just read: replace `preview/<quiz_id>` with `<quiz_id>/player` (so you reuse the real path prefix). Navigate to it.
5. Intro screen: click **Start Quiz** (button `.quiz-start-btn`, or the button whose text is "Start Quiz"). If instead you land straight on a results / "no attempts left" screen, that is acceptable — the player rendered; note it and treat as PASS (skip to step 7).
6. Answer each question until the quiz ends (cap at ~25 loops as a safety stop):
   a. Select the FIRST option: click the first `button[role=radio]` (single choice) or
      `button[role=checkbox]` (multiple choice) inside the question.
   b. Click **Check answer** (the primary button reading "Check answer"; it is disabled until an
      option is selected). Wait for the answer feedback to render.
   c. Click **Continue** (the primary button reading "Continue"). This advances to the next
      question, or on the last question opens the results.
   d. After Continue, check: if the **results** screen is now showing, stop the loop. Results
      text is "Quiz Completed", then "N of M right", then "Attempt X of Y" and a "Try Again"
      button. Detect it by searching `document.body.innerText` for "Quiz Completed"; a bare `%`
      check is unreliable.
   e. Loop exit: the loop ends right after the last Continue. Treat a missing
      Select/Check/Continue button at that point as the results screen, not as a stuck quiz.
      Only report stuck if the results text never appears.
7. Verify the Results screen rendered: a score/outcome is shown (correct count or a percentage) and a retry/restart action exists.

## Screenshots
Save them in `~/myqa-output/smoke-screens/<env>/quiz/` as the shared contract's Screenshots section says (expand the home path: a relative `./` path lands in `~/.hermes`), and report their absolute paths:
- `01-quiz-list.png`
- `02-quiz-start.png`
- `03-question.png`: during the answer loop, after the first question renders (the loop does not capture it by itself)
- `04-results.png`
- (skip any that don't apply)

When something on a page is wrong or missing, also save a marked screenshot of it (`<name>-marked.png`), as the shared contract's Marking what is wrong section says, and name it in the report.

## Report
`RESULT: PASS` or `RESULT: FAIL` on the first line, then:
- environment
- quiz title, `quiz_id` and question count
- how many questions were answered and whether the results screen rendered with a score
- screenshot paths
- side effects: one **quiz attempt was recorded** for the test account on this env (expected)

**PASS** if any of:
- the player reached the results screen with a score
- there was no quiz to take
- the player opened but the attempt limit was already exhausted

**FAIL** if any of:
- the player errors
- a question or the results never render
- an option can't be selected
- Check answer / Continue is missing or stuck
- a loader never resolves
