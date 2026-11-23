import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { E2E_ROOT } from "../../../engine/paths";
import { BROWSER_INSTALL_TIMEOUT_MS, BROWSERS_KEPT } from "../settings";
import { runProgram, tailOf } from "./commands";
import { InstallCache } from "./install-cache";
import { toolEnvironment } from "./runner-env";

// Chromium for the Playwright a commit uses. The image's own version runs with the image's
// browsers (PLAYWRIGHT_BROWSERS_PATH as it is); any other is installed once into
// <data dir>/browsers/<version> by that commit's own Playwright (`playwright install chromium`),
// and the BROWSERS_KEPT versions used last stay. The image's system libraries serve them all (no
// --with-deps: the console is not root).

const VERSION = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const packageSchema = z.object({ version: z.string() });

/** The version of the Playwright (@playwright/test) in a node_modules folder. */
function versionIn(modules: string): string {
  const file = path.join(modules, "@playwright", "test", "package.json");
  const { version } = packageSchema.parse(
    JSON.parse(fs.readFileSync(file, "utf8"))
  );
  if (!VERSION.test(version)) {
    throw new Error(`not a Playwright version: ${version}`);
  }
  return version;
}

export interface IBrowsers {
  version: string;
  // PLAYWRIGHT_BROWSERS_PATH for the run; null: the image's own.
  path: string | null;
}

export class BrowserCache {
  private readonly own = versionIn(path.join(E2E_ROOT, "node_modules"));
  private readonly installs: InstallCache;

  constructor(directory: string) {
    this.installs = new InstallCache(
      directory,
      BROWSERS_KEPT,
      "the browsers of Playwright"
    );
  }

  /** The browsers of the Playwright in `modules`, installed if missing; used until release. */
  async acquire(modules: string, signal: AbortSignal): Promise<IBrowsers> {
    const version = versionIn(modules);
    if (version === this.own) {
      return { version, path: null };
    }
    const folder = await this.installs.acquire(version, (temporary) =>
      install(temporary, modules, version, signal)
    );
    return { version, path: folder };
  }

  release(browsers: IBrowsers): void {
    if (browsers.path !== null) {
      this.installs.release(browsers.version);
    }
  }

  tidy(): void {
    this.installs.tidy();
  }
}

async function install(
  folder: string,
  modules: string,
  version: string,
  signal: AbortSignal
): Promise<void> {
  const result = await runProgram(
    process.execPath,
    [
      path.join(modules, "@playwright", "test", "cli.js"),
      "install",
      "chromium",
    ],
    {
      cwd: folder,
      env: { ...toolEnvironment(), PLAYWRIGHT_BROWSERS_PATH: folder },
      signal,
      timeoutMs: BROWSER_INSTALL_TIMEOUT_MS,
    }
  );
  if (result.code !== 0) {
    throw new Error(
      `Chromium for Playwright ${version} did not install: ${tailOf(
        result.stderr || result.stdout
      )}`
    );
  }
}
