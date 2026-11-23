import fs from "node:fs";
import path from "node:path";
import { buildJsonSchemaFiles } from "../json-schemas";
import { E2E_ROOT } from "../paths";

// Writes the JSON Schemas for YAML autocompletion and inline errors in the editor. Re-run
// (pnpm schema) after changing a step, the test file format or e2e.config.yaml tiers.

for (const file of buildJsonSchemaFiles()) {
  fs.mkdirSync(path.dirname(file.path), { recursive: true });
  fs.writeFileSync(file.path, file.content);
  console.log(`Wrote ${path.relative(E2E_ROOT, file.path)}`);
}
