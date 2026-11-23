import fs from "node:fs";
import path from "node:path";
import { loadE2eConfig } from "../config";
import { E2E_ROOT } from "../paths";
import { renderScaffold } from "../scaffolds";

// Creates a test file from the tier's scaffold:
//   pnpm new regression quizzes/take-quiz "Quiz — take"
//   → tests/regression/quizzes/take-quiz.test.yaml

const USAGE = 'Usage: pnpm new <tier> <path> ["Suite name"]';
const RELATIVE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

function suiteNameFrom(relativeName: string): string {
  const lastSegment = relativeName.split("/").at(-1) ?? relativeName;
  const words = lastSegment.split("-").join(" ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

function main(): void {
  const [tierName, relativeName, suiteName] = process.argv.slice(2);
  if (tierName === undefined || relativeName === undefined) {
    fail(USAGE);
    return;
  }

  const tiers = Object.keys(loadE2eConfig().tiers);
  if (!tiers.includes(tierName)) {
    fail(
      `Unknown tier "${tierName}" — e2e.config.yaml defines: ${tiers.join(
        ", "
      )}`
    );
    return;
  }
  if (!RELATIVE_NAME_PATTERN.test(relativeName)) {
    fail(
      `"${relativeName}": use lowercase words joined by dashes, folders separated by /`
    );
    return;
  }

  const target = path.join(
    E2E_ROOT,
    "tests",
    tierName,
    `${relativeName}.test.yaml`
  );
  if (fs.existsSync(target)) {
    fail(`${path.relative(E2E_ROOT, target)} already exists`);
    return;
  }

  const content = renderScaffold(
    tierName,
    suiteName ?? suiteNameFrom(relativeName),
    target
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  console.log(
    `Created ${path.relative(
      E2E_ROOT,
      target
    )} — edit its steps, then run pnpm validate`
  );
}

main();
