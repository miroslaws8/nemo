import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parse } from "yaml";
import { e2eConfigSchema } from "../config";
import { resolveAiSettingsFrom } from "./settings";

const BASE = `
environments:
  demo:
    base_url: https://example.com
__ENV_AI__
tiers:
  smoke: { read_only: true }
profiles:
  smoke:
    tiers: [smoke]
__PROFILE_AI__
default_profile: smoke
safety: { data_prefix: "[SMOKE] " }
cleanup: { on_pass: delete, on_fail: keep }
error_monitor: { auto_check: true }
sweeper: { older_than: 1d, max_deletes: 5 }
`;

const MINIMAL_AI = `
ai:
  models:
    fast: { protocol: openai, model: m-1, key: QA_AI_KEY, vision: true,
            usd_per_million: { input: 1, output: 2 } }
  judge: { model: fast }
`;

function configText(
  ai: string,
  options: { environmentAi?: string; profileAi?: string } = {}
): string {
  return (
    BASE.replace("__ENV_AI__", options.environmentAi ?? "").replace(
      "__PROFILE_AI__",
      options.profileAi ?? ""
    ) + ai
  );
}

function parseConfig(
  text: string
): ReturnType<typeof e2eConfigSchema.safeParse> {
  return e2eConfigSchema.safeParse(parse(text));
}

function issueAt(text: string, path: string): string | null {
  const result = parseConfig(text);
  if (result.success) {
    return null;
  }
  const issue = result.error.issues.find(
    (candidate) => candidate.path.join(".") === path
  );
  return issue?.message ?? null;
}

describe("ai settings", () => {
  test("defaults", () => {
    const result = parseConfig(configText(MINIMAL_AI));
    assert.ok(result.success, String(result.error));
    const settings = resolveAiSettingsFrom(result.data, "demo", "smoke");
    assert.ok(settings !== null);
    assert.equal(settings.judge.minConfidence, 0.7);
    assert.equal(settings.judge.retries, 2);
    assert.equal(settings.judge.blocking, true);
    assert.equal(settings.judge.escalateTo, null);
    assert.equal(settings.budgetUsdPerRun, 2);
    assert.equal(settings.models.fast.baseUrl, null);
    assert.equal(settings.models.fast.keyVariable, "QA_AI_KEY");
    assert.deepEqual(settings.models.fast.usdPerMillion, {
      input: 1,
      output: 2,
    });
  });

  test("model params pass through", () => {
    const result = parseConfig(
      configText(
        MINIMAL_AI.replace(
          "vision: true,",
          "vision: true, params: { reasoning_effort: none },"
        )
      )
    );
    assert.ok(result.success, String(result.error));
    assert.deepEqual(
      resolveAiSettingsFrom(result.data, "demo", "smoke")?.models.fast.params,
      { reasoning_effort: "none" }
    );
  });

  test("no ai section", () => {
    const result = parseConfig(configText(""));
    assert.ok(result.success, String(result.error));
    assert.equal(resolveAiSettingsFrom(result.data, "demo", "smoke"), null);
  });

  test("environment ai: false", () => {
    const result = parseConfig(
      configText(MINIMAL_AI, { environmentAi: "    ai: false" })
    );
    assert.ok(result.success, String(result.error));
    assert.equal(resolveAiSettingsFrom(result.data, "demo", "smoke"), null);
  });

  test("profile ai: false while the environment allows it", () => {
    const result = parseConfig(
      configText(MINIMAL_AI, { profileAi: "    ai: false" })
    );
    assert.ok(result.success, String(result.error));
    assert.equal(resolveAiSettingsFrom(result.data, "demo", "smoke"), null);
  });

  test("unknown role in judge.model", () => {
    const text = configText(
      MINIMAL_AI.replace("judge: { model: fast }", "judge: { model: slow }")
    );
    assert.match(issueAt(text, "ai.judge.model") ?? "", /slow/);
  });

  test("judge model without vision", () => {
    const text = configText(
      MINIMAL_AI.replace("vision: true", "vision: false")
    );
    assert.match(issueAt(text, "ai.judge.model") ?? "", /vision: true/);
  });

  test("author defaults", () => {
    const result = parseConfig(
      configText(`${MINIMAL_AI}  author: { model: fast }\n`)
    );
    assert.ok(result.success, String(result.error));
    const author = resolveAiSettingsFrom(result.data, "demo", "smoke")?.author;
    assert.ok(author !== null && author !== undefined);
    assert.equal(author.model, "fast");
    assert.equal(author.maxActions, 30);
    assert.ok(author.avoid.includes("delete"));
  });

  test("no author section", () => {
    const result = parseConfig(configText(MINIMAL_AI));
    assert.ok(result.success, String(result.error));
    assert.equal(
      resolveAiSettingsFrom(result.data, "demo", "smoke")?.author,
      null
    );
  });

  test("author model without vision", () => {
    const text = configText(
      `${MINIMAL_AI.replace(
        "judge: { model: fast }",
        "judge: { model: fast }\n  author: { model: blind }"
      )}`.replace(
        "  judge:",
        "    blind: { protocol: openai, model: m-2, key: null, vision: false, usd_per_million: { input: 0, output: 0 } }\n  judge:"
      )
    );
    assert.match(issueAt(text, "ai.author.model") ?? "", /vision: true/);
  });

  test("a base_url with credentials in it", () => {
    const text = configText(
      MINIMAL_AI.replace(
        "protocol: openai,",
        "protocol: openai, base_url: https://user:pass@llm.example.com/v1,"
      )
    );
    assert.ok(issueAt(text, "ai.models.fast.base_url") !== null);
  });

  test("a console setting as key", () => {
    const text = configText(MINIMAL_AI.replace("QA_AI_KEY", "QA_CONSOLE_KEY"));
    assert.ok(issueAt(text, "ai.models.fast.key") !== null);
  });
});
