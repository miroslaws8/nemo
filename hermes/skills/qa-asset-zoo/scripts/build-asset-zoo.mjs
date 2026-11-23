// Playwright builder for the app's "[SMOKE] Asset Zoo" fixture course.
//
// Creates ONE blank course and AI-GENERATES assets into it to test asset generation:
// a batch of asset types, PER_PAGE on each page (default 5), each added with
// with_ai:true (unless the type is manual_only per the backend). Waits for every
// generation to finish (generation_status completed/failed), then writes a manifest
// mapping asset type -> { page_id, asset_id, generation_status, ai, learner_url } so
// qa-asset-render can open the exact page and verify each asset.
//
// Usage:   node build-asset-zoo.mjs <env>            env = staging | local | prod
//          PROBE=1 node build-asset-zoo.mjs staging  # build ONE page (first 3 types),
//                                                     # dump every API shape; cheap
//          NO_AI=1 node build-asset-zoo.mjs staging  # cheap render-only (with_ai:false)
//          ZOO_TOPIC="..." node build-asset-zoo.mjs staging   # override generation topic
//          ZOO_HEADFUL=1 node build-asset-zoo.mjs staging     # visible window
//
// Creds:   QA_<ENV>_EMAIL / QA_<ENV>_PASSWORD (STAGE | LOCAL | PROD),
//          read from the environment or ~/.hermes/.env.
// Output:  manifest at ~/.hermes/asset-zoo-<env>.json (+ a copy under
//          <cwd>/smoke-screens/<env>/asset-zoo/), screenshots there, and (PROBE) a full
//          dump at probe.json. Exit 0 = ok, 1 = failed, 2 = setup error.

import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
const PROBE = !!process.env.PROBE;
const AI = !process.env.NO_AI; // default: generate with AI
const TOPIC = process.env.ZOO_TOPIC || 'Workplace fire safety for new employees';
const PER_PAGE = Number(process.env.ZOO_PER_PAGE || 5);

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

const hostFirstLabel = new URL(base).host.split('.')[0];
const ALIAS = process.env[`QA_${prefix}_ALIAS`] || hostFirstLabel;

// First batch: the 10 simplest (content/layout) asset types — fast, reliable AI generation.
const BATCH = [
  'text_block', 'content_block', 'hero', 'cards', 'feature_grid',
  'accordion', 'case_study', 'goals', 'numbered_grid', 'comparison_columns',
];

const BUSY = new Set(['queued', 'generating']);
const isTerminal = (status) => !status || !BUSY.has(status);

const TITLE = `[SMOKE] Asset Zoo ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

const outDir = path.resolve(process.cwd(), 'smoke-screens', env, 'asset-zoo');
fs.mkdirSync(outDir, { recursive: true });
const manifestFile = path.join(os.homedir(), '.hermes', `asset-zoo-${env}.json`);

const log = (...a) => console.log('[zoo]', ...a);
const unwrap = (body) => (body && typeof body === 'object' && 'data' in body ? body.data : body);
const parseAssets = (body) => {
  const comp = unwrap(body);
  const arr = Array.isArray(comp) ? comp : (comp?.assets ?? comp?.components ?? []);
  return (Array.isArray(arr) ? arr : []).map((asset) => ({
    asset_id: asset.id,
    type: asset.type,
    order: asset.order,
    generation_status: asset.generation_status ?? null,
  }));
};

const browser = await chromium.launch({ headless: !process.env.ZOO_HEADFUL });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(90000);
const shot = (name) => page.screenshot({ path: path.join(outDir, name) }).catch(() => {});

// The frontend calls a SEPARATE API host (VITE_API_URL), not the app origin. Capture it
// from the app's own XHR/fetch traffic (override with QA_<ENV>_API).
let apiBase = process.env[`QA_${prefix}_API`] || null;
page.on('request', (req) => {
  if (apiBase) return;
  try {
    const url = new URL(req.url());
    if ((req.resourceType() === 'xhr' || req.resourceType() === 'fetch') && url.pathname.includes('/api/')) {
      apiBase = url.origin;
      log('captured API base:', apiBase);
    }
  } catch { /* ignore */ }
});

// Cross-origin fetch from inside the app page to the API host, with the bearer token
// (stored in the `idp_access_token` cookie, shared across subdomains, not HttpOnly).
async function api(method, apiPath, body) {
  const fullUrl = (apiBase || '') + apiPath;
  const result = await page.evaluate(
    async ({ method, fullUrl, body }) => {
      const cookieMatch = document.cookie.match(/(?:^|; )idp_access_token=([^;]*)/);
      const token = cookieMatch ? decodeURIComponent(cookieMatch[1]) : localStorage.getItem('idp.access_token');
      const res = await fetch(fullUrl, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, ok: res.ok, body: json };
    },
    { method, fullUrl, body }
  );
  log(`${method} ${apiPath} -> ${result.status}`);
  return result;
}

const probeDump = { env, base, alias: ALIAS, ai: AI, topic: TOPIC, steps: {} };
const fail = async (stage, detail) => {
  probeDump.error = { stage, detail };
  await shot('99-error.png');
  if (PROBE) fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(probeDump, null, 2));
  console.error(`FAILED at ${stage}: ${detail}`);
  await browser.close().catch(() => {});
  process.exit(1);
};

try {
  // 1) Log in through the UI (sets cookies + token)
  await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type=email]', { timeout: 90000 });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/dashboard**', { timeout: 90000 });
  log('logged in');
  await shot('00-dashboard.png');

  for (let i = 0; i < 20 && !apiBase; i++) await page.waitForTimeout(500);
  if (!apiBase) {
    await fail('capture-api-base', `could not capture the API host; set QA_${prefix}_API (e.g. https://api.staging.example.com)`);
  }
  probeDump.apiBase = apiBase;

  // 2) Resolve instance_id + workspace_id from the tenant alias
  const inst = await api('GET', `/api/instances/alias/${ALIAS}`);
  probeDump.steps.instance = { status: inst.status };
  const instance = unwrap(inst.body);
  const instanceId = instance?.id;
  const workspaceId = instance?.workspace_id ?? instance?.workspace?.id;
  if (!inst.ok || !instanceId || !workspaceId) {
    await fail('resolve-instance', `alias=${ALIAS} status=${inst.status} instanceId=${instanceId} workspaceId=${workspaceId} (set QA_${prefix}_ALIAS if alias is wrong)`);
  }
  log(`instance_id=${instanceId} workspace_id=${workspaceId}`);

  // Shortcut: publish an EXISTING fixture course (no rebuild, no new credits) and exit.
  if (process.env.ZOO_PUBLISH_ONLY) {
    const existingHub = process.env.ZOO_PUBLISH_ONLY;
    const pub = await api('POST', `/api/instances/alias/${ALIAS}/courses/${existingHub}/publish`);
    log(`publish hub ${existingHub} -> ${pub.status}`);
    console.log('ZOO_RESULT=' + JSON.stringify({ env, publishOnly: existingHub, status: pub.status, ok: pub.ok }));
    await browser.close();
    process.exit(pub.ok ? 0 : 1);
  }

  // Shortcut: REFRESH an existing manifest's URLs with the current page hashes (no rebuild).
  // Use after a fixture was built before view_url/hash support existed.
  if (process.env.ZOO_REFRESH) {
    const existingHub = process.env.ZOO_REFRESH;
    const secRes = await api('GET', `/api/instances/${instanceId}/hubs/${existingHub}/builder/sections`);
    const secs = unwrap(secRes.body);
    const hashById = new Map();
    for (const section of (Array.isArray(secs) ? secs : [])) {
      for (const pg of (section.pages || [])) hashById.set(pg.id, pg.hash);
    }
    if (!fs.existsSync(manifestFile)) await fail('refresh', `no manifest at ${manifestFile}`);
    const man = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    man.assets = man.assets.map((a) => {
      const h = hashById.get(a.page_id);
      return {
        ...a,
        page_hash: h,
        view_url: `${base}/hub/${existingHub}/${man.chat_id}/ai-builder/${h}?mode=preview`,
        learner_url: `${base}/hub/${existingHub}/course/${h}`,
      };
    });
    man.pages = (man.pages || []).map((p) => ({ ...p, hash: hashById.get(p.page_id) }));
    fs.writeFileSync(manifestFile, JSON.stringify(man, null, 2));
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(man, null, 2));
    log(`refreshed ${man.assets.length} assets with page hashes`);
    console.log('ZOO_RESULT=' + JSON.stringify({ env, refresh: existingHub, assets: man.assets.length }));
    await browser.close();
    process.exit(0);
  }

  // Shortcut: create a FRESH BLANK course with ONE empty page and print its EDIT url, then
  // exit — no AI, no asset adds, no publish, no credits. This is the setup step for the
  // agent-driven qa-asset-add skill, which then adds assets through the real UI buttons
  // (the asset ADD itself, not this scaffolding, is what that skill tests on the frontend).
  if (process.env.ZOO_BLANK_ONLY) {
    const uiTitle = `[SMOKE] Asset Zoo UI ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

    const bChatRes = await api('POST', `/api/workspaces/${workspaceId}/ai/builder/chat/`, { type: 'blank' });
    const bChat = unwrap(bChatRes.body);
    const bChatId = bChat?.chat_id;
    const bHubId = bChat?.hub_id;
    if (!bChatRes.ok || !bChatId || !bHubId) {
      await fail('blank-only:create-chat', `status=${bChatRes.status} chatId=${bChatId} hubId=${bHubId}`);
    }

    const bSecRes = await api('GET', `/api/instances/${instanceId}/hubs/${bHubId}/builder/sections`);
    const bSecs = unwrap(bSecRes.body);
    const bSectionId = Array.isArray(bSecs) && bSecs.length ? bSecs[0].id : null;
    if (!bSectionId) {
      await fail('blank-only:resolve-section', 'no section on blank course');
    }

    const bPageRes = await api('POST', `/api/instances/${instanceId}/hubs/${bHubId}/builder/sections/${bSectionId}/pages`, { type: 'page', title: '[SMOKE] Asset Add' });
    const bPage = unwrap(bPageRes.body);
    const bPageId = bPage?.id;
    const bPageHash = bPage?.hash; // the route addresses pages by HASH, not numeric id
    if (!bPageRes.ok || !bPageId || !bPageHash) {
      await fail('blank-only:create-page', `status=${bPageRes.status} pageId=${bPageId} hash=${bPageHash}`);
    }

    await api('POST', `/api/instances/${instanceId}/hubs/${bHubId}/update`, { title: uiTitle });

    // EDIT url (no ?mode=preview): shows the add-asset buttons the skill clicks.
    const editUrl = `${base}/hub/${bHubId}/${bChatId}/ai-builder/${bPageHash}`;
    const info = {
      env, base, title: uiTitle,
      instance_id: instanceId, workspace_id: workspaceId,
      hub_id: bHubId, chat_id: bChatId, section_id: bSectionId,
      page_id: bPageId, page_hash: bPageHash,
      edit_url: editUrl,
      created_at: new Date().toISOString(),
    };
    const infoFile = path.join(os.homedir(), '.hermes', `asset-add-${env}.json`);
    fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));
    log(`blank course ready: hub_id=${bHubId} edit_url=${editUrl}`);
    console.log('ZOO_RESULT=' + JSON.stringify({ blankOnly: true, ...info, infoFile }));
    await browser.close();
    process.exit(0);
  }

  // 3) manual_only asset config (these cannot be AI-generated)
  const cfgRes = await api('GET', `/api/common/asset-config`);
  probeDump.steps.assetConfig = cfgRes;
  const cfg = unwrap(cfgRes.body);
  const manualOnly = new Set(Array.isArray(cfg?.manual_only) ? cfg.manual_only : []);
  log(`manual_only types: ${[...manualOnly].join(', ') || '(none)'}`);

  // 4) Create a BLANK course (chat) -> { chat_id, hub_id }
  const chatRes = await api('POST', `/api/workspaces/${workspaceId}/ai/builder/chat/`, { type: 'blank' });
  probeDump.steps.createChat = { status: chatRes.status };
  const chat = unwrap(chatRes.body);
  const chatId = chat?.chat_id;
  const hubId = chat?.hub_id;
  if (!chatRes.ok || !chatId || !hubId) {
    await fail('create-blank-chat', `status=${chatRes.status} chatId=${chatId} hubId=${hubId}`);
  }
  log(`chat_id=${chatId} hub_id=${hubId}`);

  // 5) Resolve a section to create pages under
  const sectionsRes = await api('GET', `/api/instances/${instanceId}/hubs/${hubId}/builder/sections`);
  probeDump.steps.sections = sectionsRes;
  const sections = unwrap(sectionsRes.body);
  const sectionId = Array.isArray(sections) && sections.length ? sections[0].id : null;
  if (!sectionId) {
    await fail('resolve-section', `no section on blank course; inspect probe.json "sections"`);
  }
  log(`section_id=${sectionId}`);

  // 6) Chunk the batch into pages of PER_PAGE, create a page per chunk, add its assets
  const typesToBuild = PROBE ? BATCH.slice(0, 3) : BATCH;
  const chunks = [];
  for (let i = 0; i < typesToBuild.length; i += PER_PAGE) {
    chunks.push(typesToBuild.slice(i, i + PER_PAGE));
  }
  const pages = []; // { page_id, title, types: [...] }
  const added = []; // per add: { type, page_id, with_ai, status, ok }
  for (let c = 0; c < chunks.length; c++) {
    const pageTitle = `[SMOKE] Assets ${c + 1}`;
    const pageRes = await api('POST', `/api/instances/${instanceId}/hubs/${hubId}/builder/sections/${sectionId}/pages`, { type: 'page', title: pageTitle });
    if (c === 0) probeDump.steps.createPage = pageRes;
    const newPage = unwrap(pageRes.body);
    const pageId = newPage?.id;
    const pageHash = newPage?.hash; // the route addresses pages by HASH, not numeric id
    if (!pageRes.ok || !pageId) {
      await fail('create-page', `status=${pageRes.status} (page body = {type:'page'}); inspect probe.json "createPage"`);
    }
    log(`page ${c + 1} created: page_id=${pageId} hash=${pageHash}`);
    pages.push({ page_id: pageId, hash: pageHash, title: pageTitle, types: chunks[c] });

    for (const assetType of chunks[c]) {
      const withAi = AI && !manualOnly.has(assetType);
      const addRes = await api(
        'POST',
        `/api/workspaces/${workspaceId}/ai/builder/chat/${chatId}/assets`,
        {
          page_id: pageId,
          asset_type: assetType,
          with_ai: withAi,
          prompt: withAi ? TOPIC : undefined,
          rich_effects: false,
          force_qa: false,
          client_request_id: randomUUID(),
        }
      );
      added.push({ type: assetType, page_id: pageId, with_ai: withAi, status: addRes.status, ok: addRes.ok });
      if (!addRes.ok) log(`! add ${assetType} failed (${addRes.status})`);
      if (PROBE && !probeDump.steps.firstAdd) probeDump.steps.firstAdd = addRes;
      await page.waitForTimeout(500);
    }
  }
  probeDump.steps.added = added;

  // 7) Wait for every generation to finish (status completed/failed). Adds are async too,
  //    so also wait for the assets to appear.
  const totalExpected = added.filter((a) => a.ok).length;
  const MAX_WAIT_MS = PROBE ? 6 * 60 * 1000 : 20 * 60 * 1000;
  const started = Date.now();
  let byPage = new Map(); // page_id -> assets[]
  while (Date.now() - started < MAX_WAIT_MS) {
    await page.waitForTimeout(5000);
    byPage = new Map();
    let total = 0;
    let busy = 0;
    for (const p of pages) {
      const compRes = await api('GET', `/api/instances/${instanceId}/hubs/${hubId}/builder/sections/${sectionId}/pages/${p.page_id}/component`);
      const assets = parseAssets(compRes.body);
      byPage.set(p.page_id, assets);
      total += assets.length;
      busy += assets.filter((a) => BUSY.has(a.generation_status)).length;
      if (PROBE) probeDump.steps.lastComponent = compRes;
    }
    const statuses = [...byPage.values()].flat().map((a) => `${a.type}:${a.generation_status || 'manual'}`);
    log(`waiting… assets=${total}/${totalExpected} busy=${busy} [${statuses.join(', ')}]`);
    if (total >= totalExpected && busy === 0) break;
  }

  // 8) Build manifest (dedup by type; per-page learner URL)
  const seen = new Set();
  const manifestAssets = [];
  for (const p of pages) {
    for (const asset of (byPage.get(p.page_id) || [])) {
      if (!asset.type || seen.has(asset.type)) continue;
      seen.add(asset.type);
      manifestAssets.push({
        type: asset.type,
        asset_id: asset.asset_id,
        page_id: p.page_id,
        order: asset.order,
        generation_status: asset.generation_status,
        ai: AI && !manualOnly.has(asset.type),
        // The ROUTE addresses pages by HASH (numeric page_id redirects to the course home).
        // Author preview renders assets read-only with no publish needed; that's view_url.
        page_hash: p.hash,
        view_url: `${base}/hub/${hubId}/${chatId}/ai-builder/${p.hash}?mode=preview`,
        learner_url: `${base}/hub/${hubId}/course/${p.hash}`,
      });
    }
  }
  const missingTypes = typesToBuild.filter((type) => !seen.has(type));
  const failedGen = manifestAssets.filter((a) => a.generation_status === 'failed').map((a) => a.type);
  if (missingTypes.length) log(`! did NOT appear: ${missingTypes.join(', ')}`);
  if (failedGen.length) log(`! generation FAILED: ${failedGen.join(', ')}`);

  // 9) Rename the course so it is findable/removable
  const renameRes = await api('POST', `/api/instances/${instanceId}/hubs/${hubId}/update`, { title: TITLE });
  probeDump.steps.rename = { status: renameRes.status };

  // 9b) PUBLISH the fixture — a draft course's learner view redirects to a "not published"
  //     page, so qa-asset-render can't reach the assets until it's published. This is a
  //     [SMOKE] test course on this env (not assigned to any real learners).
  const publishRes = await api('POST', `/api/instances/alias/${ALIAS}/courses/${hubId}/publish`);
  probeDump.steps.publish = { status: publishRes.status };
  log(`publish -> ${publishRes.status}`);

  // 10) Sanity-check the author-preview page renders (this is what qa-asset-render opens)
  const firstPage = pages[0];
  const previewUrl = `${base}/hub/${hubId}/${chatId}/ai-builder/${firstPage.hash}?mode=preview`;
  await page.goto(previewUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(8000);
  await shot('01-preview.png');
  probeDump.steps.preview = { url: previewUrl, textHead: (await page.innerText('body').catch(() => '')).slice(0, 400) };

  const manifest = {
    env, base, title: TITLE, topic: TOPIC, ai_mode: AI, per_page: PER_PAGE,
    instance_id: instanceId, workspace_id: workspaceId, chat_id: chatId,
    hub_id: hubId, section_id: sectionId,
    course_url: `${base}/hub/${hubId}/course`,
    published: publishRes.ok,
    created_at: new Date().toISOString(),
    pages: pages.map((p) => ({ page_id: p.page_id, hash: p.hash, title: p.title, view_url: `${base}/hub/${hubId}/${chatId}/ai-builder/${p.hash}?mode=preview` })),
    assets: manifestAssets,
    missing_types: missingTypes,
    failed_generation: failedGen,
    add_results: added,
  };

  if (PROBE) {
    probeDump.manifestPreview = manifest;
    fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(probeDump, null, 2));
    log('PROBE complete — see', path.join(outDir, 'probe.json'));
  } else {
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    log('manifest written to', manifestFile);
  }

  console.log('ZOO_RESULT=' + JSON.stringify({
    env, hub_id: hubId, title: TITLE, ai: AI, requested: typesToBuild.length,
    onPage: manifestAssets.length, missing: missingTypes, failed_generation: failedGen,
    probe: PROBE, manifest: PROBE ? null : manifestFile,
  }));
  await browser.close();
  process.exit(0);
} catch (err) {
  await fail('exception', String(err && err.message ? err.message : err));
}
