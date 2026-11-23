---
# Written by `pnpm skills` from skill.yaml and hermes/skill-template.md: edit those.
name: qa-landing-mobile
description: "Read-only check of the edplay.ai landing on a phone-sized screen (environment `demo`) — no login. Opens the home page, the mobile menu and a few pages, and looks for what a phone user would notice: sideways scrolling, overlapping or cut-off text, buttons too small to tap, broken images."
---

# Landing on a phone (demo, read-only)

Open the edplay.ai landing at a phone's size, use its menu and FAQ, and report what looks broken on a small screen.

**Read-only on every environment, prod included:** the only state change is logging in. Submit nothing else.

## Setup
First run `cat ~/.hermes/qa-shared.md` in the terminal (there is no `read_file` tool here) and follow it: environments, the vault login, test data, browser mechanics, screenshots, marking what is wrong.
Arguments: the environment (`local`, `staging` or `prod`; default `staging`).
Any other words are a note from whoever started the skill: follow it within this skill's rules.
Start at `<base>/`.

- No login: the site is public. Skip the shared contract's Credentials section; never type anything into a form, and never book a demo or follow a link off the site.
- Work at a phone's size: before the first page, set the window to 412 × 839 (`browser_exec`: `page.set_viewport_size({"width": 412, "height": 839})`).

## Steps
1. Open `<base>/`. Verify the page rendered: a main headline, a **Book a demo** link, no error screen and no 4xx/5xx page. Check that the page does not scroll sideways: `js("document.documentElement.scrollWidth - document.documentElement.clientWidth")` is 0 or 1.
2. Scroll through the whole page once. Note anything a phone user would see as broken: text cut off or overlapping, an image that does not load, a button or link smaller than a fingertip (about 40 px), content wider than the screen.
3. Tap **Open menu**: the navigation opens with **Pricing**, **About Us** and **Blog**. Tap **Pricing**: the URL ends in `/pricing` and its headline shows. Check sideways scrolling again.
4. Back on `<base>/`, open one FAQ question (e.g. "Where does our data live?"): its answer shows under it.

## Screenshots
Save them in `~/nemo-output/smoke-screens/<env>/landing-mobile/` as the shared contract's Screenshots section says (expand the home path: a relative `./` path lands in `~/.hermes`), and report their absolute paths:
- `01-home.png`: the top of the home page
- `02-menu.png`: the menu, open
- `03-pricing.png`: the pricing page
- `04-faq.png`: the FAQ with one answer open

When something on a page is wrong or missing, also save a marked screenshot of it (`<name>-marked.png`), as the shared contract's Marking what is wrong section says, and name it in the report.

## Report
`RESULT: PASS` or `RESULT: FAIL` on the first line, then:
- environment, final URL and the window size used
- each page checked and whether it scrolls sideways
- what looked broken on a small screen (marked on its screenshot), or "nothing"
- screenshot paths

**FAIL** if any of:
- the site is unreachable, or a page shows an error, 404 or 5xx
- a page scrolls sideways
- the menu does not open, or its Pricing link does not lead to `/pricing`
- an FAQ answer does not open

**PASS** otherwise.

Not a failure:
- a cookie banner: close it and go on
- copy that changed since this skill was written, while the page still works
