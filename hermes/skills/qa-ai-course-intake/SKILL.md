---
# Written by `pnpm skills` from skill.yaml and hermes/skill-template.md: edit those.
name: qa-ai-course-intake
description: Functional test of the AI course-creation INTAKE flow (/create-course/ai) — drives it with a Playwright script (one persistent browser session) up to the Course Review brief gate and STOPS before Confirm. MUTATING + uses AI credits — runs on every env (staging/local AND prod); leaves a `[SMOKE]` draft. Use to verify the AI course intake / data-gathering works.
---

# Example app — AI course intake (Playwright-driven)

This long, multi-turn AI conversation is too fragile for step-by-step agent browser driving (the local daemon drops during the long gather waits). So the heavy work lives in a Playwright script (`scripts/intake.mjs`) that runs the whole intake in ONE persistent browser session with deterministic waits, stops at the **Course Review brief** gate, and NEVER clicks Confirm/Generate. Your job: run it and interpret output.

**Creates data on every environment, prod included:** a `[SMOKE]` draft course and its chat, left for manual cleanup (find them by the `[SMOKE]` marker in the courses list); it STOPS at the review brief and never clicks Confirm/Generate, so no full course is generated. Title what you create as the shared contract says (Titles of what you create), and never delete anything yourself.

**Spends AI credits** on the environment it runs on.

## Setup
First run `cat ~/.hermes/qa-shared.md` in the terminal (there is no `read_file` tool here) and follow it: environments, the vault login, test data, browser mechanics, screenshots, marking what is wrong.
Arguments: the environment (`local`, `staging` or `prod`; default `staging`).
Any other words are a note from whoever started the skill: follow it within this skill's rules.

## Credentials for the script

The script logs in by itself (it cannot use the Hermes vault). It needs, in `~/.hermes/.env` (it loads that file) or the environment, the pair for the target env: `QA_<ENV>_EMAIL` and `QA_<ENV>_PASSWORD` — `QA_STAGE_*` for staging, `QA_LOCAL_*` for local, `QA_PROD_*` for prod. If the pair for the target env is not set, the script STOPs with a setup error (exit 2) naming the missing var — add it to `~/.hermes/.env` (prod needs `QA_PROD_EMAIL` / `QA_PROD_PASSWORD`).

## One-time setup (only if deps are missing)

If `scripts/node_modules` does not exist in this skill directory, run once:
```
cd <skill-dir>/scripts && pnpm install --frozen-lockfile && pnpm exec playwright install chromium
```

## Steps
1. Ensure deps are installed (one-time setup above).
2. Run the script from the app's project root (so screenshots land there), passing the
   environment:
   ```
   cd ~/nemo-output && node ~/.hermes/skills/qa-ai-course-intake/scripts/intake.mjs staging
   ```
   (Use `local` or `prod` instead of `staging` for those envs.)
3. Run the script ONCE. Read the result from the JSON file `~/nemo-output/smoke-screens/<env>/intake/result.json` (the script always writes it) — it holds the same object as the `INTAKE_RESULT=<json>` stdout line: `stage`, `turns` (each with the `answer` picked), `brief`, `screenshots`, `error`. Combine with the exit code (0 = brief reached, 1 = not reached, 2 = setup error). **Do NOT re-run the script if the stdout line looks truncated — read `result.json` instead.** Each run costs AI credits and leaves a `[SMOKE]` draft.
4. Do not drive the browser yourself and do not click Confirm — the script already stops at the brief.

## Report
`RESULT: PASS` or `RESULT: FAIL` on the first line, then:
- environment and the script's `stage` (start → logged-in → intake-loaded → gathering → review-brief)
- whether the Course Review brief was reached; if so, summarize `brief` (title + rough outline/section count)
- the answers the script picked (from `turns[].answer` — one real option per question)
- the screenshot folder (`screenshots`)
- any `error` from the script
- side effects: a `[SMOKE]` draft course + chat were created on this env (left for manual cleanup — find by the `[SMOKE]` marker in the courses list); AI credits were used; generation was NOT triggered

**PASS** if any of:
- exit code 0 and `stage` is `review-brief` with a non-empty `brief`

**FAIL** if any of:
- exit 1: the brief was not reached (report the `stage` and `error` so the script/selectors can be tuned)
- exit 2: setup error (missing creds/deps)
