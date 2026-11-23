import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { optionValue } from "../../engine/scripts/cli-options";
import { AppModule } from "./app.module";
import { ConsoleSetupError, consoleSettings } from "./config";
import { ACCESS } from "./core/tokens";
import { IngestService } from "./ingest/service";
import { createRunners } from "./runners";
import { RunManager } from "./run-manager";
import { CiSource } from "./sources/bitbucket";
import { SseHub } from "./sse-hub";
import type { IAccessControl, IConsoleMode, IConsoleSettings } from "./types";

// The QA console: pnpm console [--port 7357] → http://127.0.0.1:7357, set up by QA_CONSOLE_*
// settings (config.ts); a NestJS application (app.module.ts). On a developer's machine runs are
// separate processes: they keep going when the console stops, and it follows them again when it
// starts. A server stops them first: its container stops with every process in it.

async function isConsoleAt(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body: unknown = await response.json();
    return (
      typeof body === "object" &&
      body !== null &&
      "app" in body &&
      body.app === "qa-console"
    );
  } catch {
    return false;
  }
}

// Resolves to the exit code: 0 when the console already runs on the port (nothing failed).
async function explainListenError(
  error: unknown,
  port: number
): Promise<number> {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;
  if (code !== "EADDRINUSE") {
    console.error(
      `✗ ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }
  if (await isConsoleAt(port)) {
    console.log(`QA Console already runs at http://127.0.0.1:${port}`);
    return 0;
  }
  console.error(
    `✗ Port ${port} is taken by another program — start with: pnpm console --port <port>`
  );
  return 1;
}

// What stopping the console does to the runs that go.
const SHUTDOWNS: Record<IConsoleMode, (manager: RunManager) => Promise<void>> =
  {
    local: async (manager) => {
      const going = manager.activeRuns();
      manager.detach();
      if (going.length > 0) {
        console.log(
          `${going.length} run(s) keep going; the console follows them again when it starts`
        );
      }
    },
    server: async (manager) => {
      const going = manager.activeRuns().length;
      if (going > 0) {
        console.log(
          `Stopping ${going} run(s) so their tests delete their data first…`
        );
      }
      await manager.drain();
    },
  };

function printProblems(problems: string[]): void {
  console.error("✗ The console is not set up right:");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
}

// --port wins over QA_CONSOLE_PORT; a console set up wrong says what to fix and does not start.
function loadSettings(): IConsoleSettings | null {
  const port = optionValue(process.argv.slice(2), "--port");
  if (port !== null) {
    process.env.QA_CONSOLE_PORT = port;
  }
  try {
    return consoleSettings();
  } catch (error) {
    if (!(error instanceof ConsoleSetupError)) {
      throw error;
    }
    printProblems(error.problems);
    return null;
  }
}

async function main(): Promise<void> {
  const settings = loadSettings();
  if (settings === null) {
    process.exitCode = 1;
    return;
  }
  const runners = createRunners(settings);
  const runnerProblems = runners.setUp();
  if (runnerProblems.length > 0) {
    printProblems(runnerProblems);
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(settings, runners),
    // The request middleware reads JSON bodies itself (after its checks); CI's uploads stream.
    { bodyParser: false, logger: ["error", "warn"] }
  );
  app.disable("x-powered-by");
  try {
    await app.listen(settings.port, settings.host);
  } catch (error) {
    process.exit(await explainListenError(error, settings.port));
  }

  const manager = app.get(RunManager);
  const ci = app.get(CiSource);
  const ingest = app.get(IngestService);
  const hub = app.get(SseHub);
  const access = app.get<IAccessControl>(ACCESS);
  manager.restore();
  ci.start();
  ingest.start();
  console.log(`QA Console (${settings.mode}): ${settings.publicUrl}`);

  let stopping = false;
  const shutDown = (): void => {
    // A second signal while the runs are being stopped: no more waiting.
    if (stopping) {
      manager.killAll();
      access.close();
      process.exit(1);
    }
    stopping = true;
    ci.stop();
    ingest.stop();
    void SHUTDOWNS[settings.mode](manager).finally(() => {
      access.close();
      hub.close();
      void app.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutDown);
  process.on("SIGTERM", shutDown);
}

void main();
