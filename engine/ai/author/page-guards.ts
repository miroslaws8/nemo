import type { Page } from "@playwright/test";
import { locate } from "../../locate";
import { targetSchema } from "../../schema";
import type { IWriteWatch } from "../../types";
import { refuseByAvoid, refuseGoto } from "./guards";

// The test author's guards on the page itself, fail-closed:
// - writes are seen on the network, not guessed from markup: a request that is not a read (POST,
//   PUT, PATCH, DELETE …) is a write when it is a page (a form sent anywhere) or a fetch / XHR to
//   the app itself (its site, its api_url) — unless its path is telemetry (ai.author.ignore_writes).
//   Where writes are off, EVERY request that is not a read is aborted before it leaves, whatever
//   sent it (a form, Enter in a field, a script, a button of any kind); telemetry silently.
// - a target is checked before it is pressed: it must be found (waited for), and its name — text,
//   aria-label, value, alt, title, and a link's path — must not hold an avoid word.

const READS = new Set(["GET", "HEAD", "OPTIONS"]);
const WRITE_TYPES = new Set(["document", "fetch", "xhr"]);

export async function watchWrites(
  page: Page,
  allowed: boolean,
  appOrigins: string[],
  ignore: RegExp[]
): Promise<IWriteWatch> {
  let seen: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (READS.has(request.method())) {
      await route.fallback();
      return;
    }
    const url = new URL(request.url());
    const type = request.resourceType();
    const toTheApp =
      type === "document" ||
      (WRITE_TYPES.has(type) && appOrigins.includes(url.origin));
    if (toTheApp && !ignore.some((pattern) => pattern.test(url.pathname))) {
      seen.push(`${request.method()} ${url.pathname}`);
    }
    if (allowed) {
      await route.fallback();
    } else {
      await route.abort("blockedbyclient");
    }
  });
  return {
    begin(): void {
      seen = [];
    },
    end(): string[] {
      const writes = seen;
      seen = [];
      return writes;
    },
  };
}

/** A path as words: /account/delete-user → "account delete user". */
function pathWords(path: string): string {
  return decodeURIComponent(path)
    .replace(/[/_\-.?=&#]+/g, " ")
    .trim();
}

function targetOf(keyword: string, args: unknown): unknown {
  if (keyword === "press" && typeof args === "object" && args !== null) {
    const { key: _key, ...target } = { key: undefined, ...args };
    return target;
  }
  return args;
}

/**
 * Why the author may not take this step, or null. `goto`: not off the site, no avoid word in its
 * path. `click` / `press` on a target: the target must be found within `timeoutMs` (else refused)
 * and no avoid word in its names. Other steps only look.
 */
export async function targetRefusal(
  page: Page,
  keyword: string,
  args: unknown,
  avoid: string[],
  baseUrl: string,
  timeoutMs: number
): Promise<string | null> {
  if (keyword === "goto") {
    if (typeof args !== "string") {
      return null;
    }
    return (
      refuseGoto(args, baseUrl) ??
      refuseByAvoid(pathWords(new URL(args, `${baseUrl}/`).pathname), avoid)
    );
  }
  if (keyword !== "click" && keyword !== "press") {
    return null;
  }
  const target = targetSchema.safeParse(targetOf(keyword, args));
  if (!target.success) {
    // A press of a key alone (no target) acts on the focus: the network guard covers it.
    return keyword === "press"
      ? null
      : "refused: the target is not a valid target";
  }
  const element = locate(page, target.data).first();
  try {
    await element.waitFor({ state: "attached", timeout: timeoutMs });
  } catch {
    return "refused: the target could not be checked (not found); look at the page again";
  }
  const names = await element.evaluate((node) => {
    const control =
      node.closest(
        "button, a, input, select, [role=button], [role=link], [role=menuitem], [role=tab]"
      ) ?? node;
    const images = Array.from(control.querySelectorAll("img[alt]")).map(
      (image) => image.getAttribute("alt") ?? ""
    );
    const href = control.getAttribute("href") ?? "";
    return {
      text: [
        control.getAttribute("aria-label") ?? "",
        control instanceof HTMLInputElement ? control.value : "",
        control.getAttribute("title") ?? "",
        ...images,
        control.textContent ?? "",
      ]
        .filter((part) => part.trim() !== "")
        .join(" "),
      href,
    };
  });
  const hrefPath =
    names.href === ""
      ? ""
      : pathWords(new URL(names.href, `${baseUrl}/`).pathname);
  return refuseByAvoid(`${names.text} ${hrefPath}`.trim(), avoid);
}
