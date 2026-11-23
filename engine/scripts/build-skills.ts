import fs from "node:fs";
import path from "node:path";
import { E2E_ROOT } from "../paths";
import { buildSkillFiles } from "../skills";

// Writes each Hermes skill's SKILL.md from its skill.yaml and hermes/skill-template.md. Run it
// (pnpm skills) after changing either; pnpm validate fails while a SKILL.md is out of date.

const { files, problems } = buildSkillFiles();
let written = 0;
for (const file of files) {
  const current = fs.existsSync(file.path)
    ? fs.readFileSync(file.path, "utf8")
    : null;
  if (current !== file.content) {
    fs.writeFileSync(file.path, file.content);
    written += 1;
    console.log(`Wrote ${path.relative(E2E_ROOT, file.path)}`);
  }
}
for (const problem of problems) {
  console.error(`✗ ${problem}`);
}
if (problems.length > 0) {
  process.exitCode = 1;
} else if (written === 0) {
  console.log(`The ${files.length} skills are up to date`);
}
