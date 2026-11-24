import crypto from "node:crypto";
import { createModelClient } from "../../../engine/ai/client";
import { resolveAiSettingsFrom } from "../../../engine/ai/settings";
import {
  parseSkillAnswer,
  skillNameFrom,
  skillWriterRequest,
} from "../../../engine/ai/skill-writer";
import { loadE2eConfig } from "../../../engine/config";
import { DEFAULT_ENVIRONMENT } from "../../../engine/environment";
import { SKILL_NAME_PATTERN } from "../../../engine/skill-schema";
import { skillFields } from "../../../engine/skills";
import type { IAiSettings, IRunSpend } from "../../../engine/types";
import type { ISkillProblem, ISkillWritten } from "../../shared/types";
import type { AgentRuns } from "../agents/agent-runs";
import { offeredEnvironments } from "../environments";
import { HttpError } from "../http-error";
import type { SkillCatalog } from "./skill-catalog";
import type { SkillChecks } from "./skill-check";

// A skill from a description (Skills → Add skill → Describe it): the model of `ai.author` (the one
// that writes tests and skills) writes a skill.yaml, the console checks it like any skill, and when
// it has errors asks once more with them. The person then edits it in the form and adds it.
// Its cost counts against the console's daily AI limit (with the agent checks).

const ATTEMPTS = 2;

interface IWritingSetup {
  settings: IAiSettings;
  role: string;
}

/** The AI settings and role that write skills, or why there are none. */
function writingSetup(): IWritingSetup | string {
  const config = loadE2eConfig();
  const settings = resolveAiSettingsFrom(
    config,
    DEFAULT_ENVIRONMENT,
    config.default_profile
  );
  if (settings === null || settings.author === null) {
    return "e2e.config.yaml has no ai.author (the model that writes tests and skills)";
  }
  const variable = settings.models[settings.author.model]?.keyVariable ?? null;
  if (variable !== null && (process.env[variable]?.trim() ?? "") === "") {
    return `${variable} is not set for this console`;
  }
  return { settings, role: settings.author.model };
}

/** Whether this console can write a skill from a description (GET /api/config). */
export function skillWriting(): { available: boolean; reason: string | null } {
  const setup = writingSetup();
  return typeof setup === "string"
    ? { available: false, reason: setup }
    : { available: true, reason: null };
}

function describeProblem(problem: ISkillProblem): string {
  const where = problem.path.length === 0 ? "" : `${problem.path.join(".")}: `;
  return `${where}${problem.message}`;
}

export class SkillWriter {
  constructor(
    private readonly checks: SkillChecks,
    private readonly catalog: SkillCatalog,
    private readonly agents: AgentRuns
  ) {}

  async write(description: string): Promise<ISkillWritten> {
    const setup = writingSetup();
    if (typeof setup === "string") {
      throw new HttpError(409, `No skill writing here: ${setup}`);
    }
    this.agents.checkAiBudget();
    let spent = 0;
    const spend: IRunSpend = {
      total: () => spent,
      add: (usd) => {
        spent += usd;
      },
    };
    const client = createModelClient(setup.settings, setup.role, spend);
    const example = await this.catalog
      .example()
      .then((found) => found.yaml)
      .catch(() => "");
    const base = {
      description,
      fields: skillFields(),
      example,
      environments: offeredEnvironments().map(
        (environment) => environment.name
      ),
    };

    let answered: { name: string; yaml: string } | null = null;
    let problems: string[] = [];
    let failure: string | null = null;
    try {
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        let text: string;
        try {
          text = (
            await client.complete(
              skillWriterRequest({
                ...base,
                problems,
                previous: answered?.yaml ?? null,
              })
            )
          ).text;
        } catch (error) {
          // A failed call keeps what an earlier one wrote.
          failure = error instanceof Error ? error.message : String(error);
          break;
        }
        const answer = parseSkillAnswer(text);
        if (answer === null) {
          problems = ['the answer was not JSON {"name": "qa-…", "yaml": "…"}'];
          continue;
        }
        answered = {
          name: SKILL_NAME_PATTERN.test(answer.name)
            ? answer.name
            : skillNameFrom(description),
          yaml: answer.yaml,
        };
        // The skill without its name: a taken name is the form's to change, not a reason to ask
        // the model again.
        const check = await this.checks.check({
          name: "",
          yaml: answered.yaml,
          replacing: false,
        });
        problems = check.problems
          .filter((problem) => problem.severity === "error")
          .map(describeProblem);
        if (problems.length === 0) {
          break;
        }
      }
    } finally {
      this.agents.recordSpend(`skill-write-${crypto.randomUUID()}`, spent);
    }
    if (answered === null) {
      throw new HttpError(
        502,
        failure === null
          ? "The model wrote no skill.yaml; try again"
          : `The model did not answer: ${failure}`
      );
    }
    const check = await this.checks.check({ ...answered, replacing: false });
    return { ...answered, problems: check.problems };
  }
}
