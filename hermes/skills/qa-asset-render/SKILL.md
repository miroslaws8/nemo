---
# Written by `pnpm skills` from skill.yaml and hermes/skill-template.md: edit those.
name: qa-asset-render
description: Per-asset test — verifies ONE asset type's AI-generated asset renders in the learner view, using the "[SMOKE] Asset Zoo" fixture course (also reports its generation_status). Read-only (opens the fixture course, submits nothing). Takes the asset type as the first argument, env as the second. Requires the fixture built first with qa-asset-zoo. Use to check a specific asset (e.g. "test the hero asset").
---

# Example app — per-asset render test

Verifies that a given asset **type** renders correctly in the learner view. Assets have no standalone route, so this relies on the fixture course `[SMOKE] Asset Zoo` (built by `qa-asset-zoo`), which holds one asset of every type on one page. The manifest `~/.hermes/asset-zoo-<env>.json` maps each type to its `asset_id` and the course's learner URL. This skill opens that course, finds the asset block, and confirms it rendered.

**Read-only on every environment, prod included:** the only state change is logging in. Submit nothing else.

## Setup
First run `cat ~/.hermes/qa-shared.md` in the terminal (there is no `read_file` tool here) and follow it: environments, the vault login, test data, browser mechanics, screenshots, marking what is wrong.
Arguments, in either order: the environment (`local`, `staging` or `prod`; default `staging`) and the asset type, a slug from the registry (`quiz`, `matching`, `dialog`, `fill_in_the_blank`, `accordion`, ...), e.g. `matching staging`.
Any other words are a note from whoever started the skill: follow it within this skill's rules.

## Steps
1. Resolve the asset type and the environment (default `staging`) from the arguments.
2. Load the manifest for the env with the exec/python tool:
   ```python
   import json, os
   m = json.load(open(os.path.expanduser(f"~/.hermes/asset-zoo-{ENV}.json")))
   entry = next((a for a in m["assets"] if a["type"] == ASSET_TYPE), None)
   print(entry)   # {type, asset_id, page_id, generation_status, ai, view_url, learner_url}
   ```
   - No manifest file → STOP: `RESULT: FAIL — no Asset Zoo manifest for <env>; build it first: /qa-asset-zoo <env>`.
   - Type not in `assets` → STOP: `RESULT: FAIL — "<type>" not in the Asset Zoo fixture for <env> (its add/generation may have failed); rebuild with /qa-asset-zoo <env>`.
   - If `entry["generation_status"] == "failed"` → this is a GENERATION failure, report
     `RESULT: FAIL — "<type>" generation failed on the fixture` (still open the page for the
     screenshot, but the asset likely did not render).
   - Otherwise note `view_url` and the target `asset_id`.
3. Open the entry's `view_url` (author preview: `<base>/hub/<hub_id>/<chat_id>/ai-builder/<page_id>?mode=preview` — the SPECIFIC page holding this asset, by NUMERIC page_id). Use the preview URL, NOT the published learner view (`learner_url`): the published view addresses pages by a HASH, so the numeric page_id redirects to the course home page and the asset is absent. If it redirects to login, log in per the shared contract, then return to `view_url`. Wait 5-8s — the builder renders assets progressively; preview mode shows them read-only (no edit toolbar).
4. Locate the asset block by its id (the wrapper carries `data-asset-id`, NOT a type attr):
   ```
   js: (() => { const el = document.querySelector('[data-asset-id="<asset_id>"]'); if (!el) return 'MISSING'; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return JSON.stringify({ h: Math.round(r.height), text: (el.innerText||'').slice(0,160) }); })()
   ```
   Wait ~1s after scrolling for lazy content/images to paint.
5. Judge the render (by content, not DOM classes):
   - FAIL if the block is `MISSING`, has height 0, or its text contains
     `Unknown component type` (the asset failed to map to a component).
   - FAIL if the page shows a real error: search `document.body.innerText` for `404`, `403`,
     `401`, `500`, "something went wrong", "page not found".
   - Otherwise run `vision_analyze` on the asset screenshot to confirm it visually rendered
     (real content, not a blank/empty box or a stuck loader). Note it as visually confirmed.

## Screenshots
Save them in `~/myqa-output/smoke-screens/<env>/asset-render/` as the shared contract's Screenshots section says (expand the home path: a relative `./` path lands in `~/.hermes`), and report their absolute paths:
- `<type>-01-page.png`: the course view
- `<type>-02-asset.png`: the asset scrolled into view

When something on a page is wrong or missing, also save a marked screenshot of it (`<name>-marked.png`), as the shared contract's Marking what is wrong section says, and name it in the report.

## Report
`RESULT: PASS` or `RESULT: FAIL` on the first line, then:
- environment
- asset type and `asset_id`
- `generation_status` from the manifest
- per-page learner URL
- whether the block rendered (height, and whether vision confirmed real content)
- any error text found
- absolute screenshot paths

**PASS** if any of:
- the asset block exists, has non-zero height, is not an "Unknown component type", the page shows no error, and vision confirms real content

**FAIL** if any of:
- any of those checks fails (say which)
