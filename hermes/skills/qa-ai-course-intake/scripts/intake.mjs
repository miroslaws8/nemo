// Playwright driver for the app's AI course-creation INTAKE test.
//
// Drives the whole conversational intake in ONE persistent browser session (no
// agent-loop teardown), survives the long AI-gather waits, stops at the Course Review
// brief gate, and NEVER clicks Confirm/Generate.
//
// Usage:   node intake.mjs <env>            env = staging | local | prod
//          INTAKE_HEADFUL=1 node intake.mjs staging   # watch it live (visible window)
// Creds:   QA_<ENV>_EMAIL/PASSWORD (STAGE | LOCAL | PROD),
//          read from the environment or ~/.hermes/.env.
// Output:  one line `INTAKE_RESULT=<json>` on stdout + screenshots under
//          <cwd>/smoke-screens/<env>/intake/. Exit 0 = brief reached, 1 = not, 2 = setup.

import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- minimal ~/.hermes/.env loader (only QA_* keys, never overwrites real env) ---
try {
  const envFile = path.join(os.homedir(), '.hermes', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const match = line.match(/^\s*(QA_[A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  }
} catch { /* ignore */ }

const env = (process.argv[2] || 'staging').toLowerCase();

const BASES = {
  local: process.env.QA_LOCAL_URL || 'http://qa-automation.localhost:5173',
  staging: process.env.QA_STAGE_URL || 'https://qa-automation.staging.example.com',
  prod: process.env.QA_PROD_URL || 'https://qa-automation.example.com',
};
const base = BASES[env];
if (!base) {
  console.error(`Unknown env "${env}" (use staging, local or prod)`);
  process.exit(2);
}

const ENV_PREFIX = { local: 'LOCAL', staging: 'STAGE', prod: 'PROD' };
const prefix = ENV_PREFIX[env];
const EMAIL = process.env[`QA_${prefix}_EMAIL`];
const PASSWORD = process.env[`QA_${prefix}_PASSWORD`];
if (!EMAIL || !PASSWORD) {
  console.error(`Missing QA_${prefix}_EMAIL / QA_${prefix}_PASSWORD (set them in ~/.hermes/.env or the environment)`);
  process.exit(2);
}

const PROMPT =
  '[SMOKE] AI intake test — create a short standard course about basic workplace fire safety for new employees. Keep it concise.';
const MAX_TURNS = 14;

const shotsDir = path.resolve(process.cwd(), 'smoke-screens', env, 'intake');
fs.mkdirSync(shotsDir, { recursive: true });

const result = {
  env,
  base,
  stage: 'start',
  turns: [],        // [{ turn, screenBefore, answer, sent }]
  brief: null,
  lastScreen: null, // tail of the final page text, for diagnosing where it stalled
  screenshots: shotsDir,
  error: null,
};

// Persist the result to a file so the caller can read it without re-running the script
// (re-running costs AI credits and leaves another draft).
const resultFile = path.join(shotsDir, 'result.json');
result.resultFile = resultFile;
const writeResult = () => {
  try {
    fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  } catch { /* ignore */ }
};

const browser = await chromium.launch({ headless: !process.env.INTAKE_HEADFUL });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(90000);
const shot = (name) =>
  page.screenshot({ path: path.join(shotsDir, name) }).catch(() => {});
const tail = async (n = 1200) =>
  (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(-n);

async function briefReached() {
  // The Course Review brief shows a "Confirm & Create Course" action (plus Learning
  // Outcomes / Settings / Difficulty). That text is the definitive signal. NOTE: the
  // review page still has a textarea ("Ask Lia to change something"), so do NOT rely on
  // the textarea being gone.
  const text = (await page.innerText('body').catch(() => '')).toLowerCase();
  return text.includes('confirm & create course') || text.includes('confirm and create course');
}

async function firstOptionText() {
  // Pick ONE real answer: the first visible option button, excluding control buttons and
  // "All of the above" (we want a single variant, not everything). Returns its text with
  // any leading "1 " / "1. " numbering stripped, or null if no option is found.
  const EXCLUDE = [
    'select all', 'all of the above', 'approve', 'send', 'back', 'next', 'previous',
    'specify', 'describe your own', 'type your own', 'other', 'ask lia',
    'confirm & create', 'confirm and create', 'system modes', 'show thinking',
    'hide thinking', 'preset', 'quick-start', 'optional', 'add description',
  ];
  return await page.evaluate((exclude) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    };
    for (const button of Array.from(document.querySelectorAll('button')).filter(visible)) {
      const text = (button.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 200) continue;
      const low = text.toLowerCase();
      if (exclude.some((term) => low.includes(term))) continue;
      return text.replace(/^\d+[.)]?\s*/, '');
    }
    return null;
  }, EXCLUDE);
}

async function waitForTurn(timeoutMs = 150000) {
  // Wait until either the brief appears, or the chat input is enabled again (AI finished
  // the previous turn and is ready for the next answer).
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await briefReached()) return 'brief';
    const ta = page.locator('textarea');
    if ((await ta.count()) > 0) {
      const enabled = await ta.last().isEnabled().catch(() => false);
      if (enabled) return 'input';
    }
    await page.waitForTimeout(2000);
  }
  return 'timeout';
}

try {
  // 1) Log in
  await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type=email]', { timeout: 90000 });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/dashboard**', { timeout: 90000 });
  result.stage = 'logged-in';
  await shot('00-dashboard.png');

  // 2) Start the intake from the Home "Generate a course" box
  const genBox = page.locator('textarea').first();
  await genBox.waitFor({ timeout: 60000 });
  await genBox.fill(PROMPT);
  const genButton = page.getByRole('button', { name: /generate/i }).first();
  if (await genButton.count()) {
    await genButton.click();
  } else {
    await genBox.press('Enter');
  }
  await page.waitForURL('**/create-course/ai**', { timeout: 90000 });
  result.stage = 'intake-loaded';
  await page.waitForTimeout(2000);
  await shot('01-intake-welcome.png');

  // 3) Answer clarifying questions until the review brief appears
  let reached = false;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const state = await waitForTurn();
    await shot(`02-gathering-${turn}.png`);
    const screenBefore = await tail();
    if (state === 'brief') {
      reached = true;
      break;
    }
    if (state === 'timeout') {
      result.turns.push({ turn, screenBefore, answer: null, sent: false, note: 'timeout waiting for turn' });
      break;
    }
    const input = page.locator('textarea').last();
    const answer = (await firstOptionText()) || 'Continue';
    await input.fill(answer);
    await input.press('Enter');
    await page.waitForTimeout(1500);
    // Verify the message actually sent: a sent chat clears the input.
    let sent = true;
    try {
      sent = (await input.inputValue()).trim().length === 0;
    } catch {
      sent = true; // input was replaced/removed → treat as sent
    }
    result.turns.push({ turn, screenBefore, answer, sent });
    await page.waitForTimeout(1500);
  }

  result.lastScreen = await tail(1600);
  if (reached) {
    result.stage = 'review-brief';
    await page.waitForTimeout(1500);
    await shot('03-review-brief.png');
    result.brief = (await page.innerText('body').catch(() => '')).slice(0, 2000);
  } else {
    result.stage = 'gathering';
    result.error = 'Course Review brief not reached within the turn/time budget';
  }

  await browser.close();
  writeResult();
  console.log('INTAKE_RESULT=' + JSON.stringify(result));
  process.exit(reached ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  result.lastScreen = await tail(1600).catch(() => null);
  await shot('99-error.png');
  await browser.close().catch(() => {});
  writeResult();
  console.log('INTAKE_RESULT=' + JSON.stringify(result));
  process.exit(1);
}
