import fs from "node:fs";
import path from "node:path";
import { E2E_ROOT } from "./paths";

const SCAFFOLDS_DIRECTORY = path.join(E2E_ROOT, "scaffolds");
const TEST_FILE_SCHEMA = path.join(E2E_ROOT, "schema", "test-file.schema.json");

export function scaffoldPath(tierName: string): string {
  return path.join(SCAFFOLDS_DIRECTORY, `${tierName}.test.yaml`);
}

/** The scaffold of a tier with its placeholders filled in, for a test file at `targetPath`. */
export function renderScaffold(
  tierName: string,
  suiteName: string,
  targetPath: string
): string {
  const source = scaffoldPath(tierName);
  if (!fs.existsSync(source)) {
    throw new Error(
      `No scaffold for tier "${tierName}" — add ${path.relative(
        E2E_ROOT,
        source
      )}`
    );
  }

  const schemaPath = path
    .relative(path.dirname(targetPath), TEST_FILE_SCHEMA)
    .split(path.sep)
    .join("/");
  return fs
    .readFileSync(source, "utf8")
    .replaceAll("__SCHEMA_PATH__", schemaPath)
    .replaceAll("__SUITE__", JSON.stringify(suiteName));
}
