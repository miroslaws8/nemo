import fs from "node:fs";
import path from "node:path";
import { authorResultSchema } from "../../shared/api";
import type { IAuthorAnswer, IRunRecord } from "../../shared/types";
import { HttpError } from "../http-error";
import { runDirectory } from "../run-store";
import type { IRunKind } from "../types";

// A test written from a description (engine/author.spec.ts, the Playwright project <env>:author):
// the AI walks the case with nemo's steps, writes the draft and verifies it in the same run, into
// <run dir>/author/ (result.json, <slug>.test.yaml, turn-<n>.png). A run like the others from
// then on: /api/runs/<id> shows and stops it, Run again writes the same goal again.

const DRAFT_NAME = /^[a-z0-9][a-z0-9-]*\.test\.yaml$/;

function authorFolder(id: string): string {
  return path.join(runDirectory(id), "author");
}

export class AuthorRuns implements IRunKind {
  launch: IRunKind["launch"] = (record, prepared) => ({
    command: prepared.playwright(["test"]),
    env: {
      ...prepared.env,
      E2E_AUTHOR_GOAL: goalOf(record),
      E2E_AUTHOR_VERIFY: "1",
    },
  });

  retryPlan: IRunKind["retryPlan"] = (parent) => ({
    env: parent.run.env,
    profile: parent.run.profile,
    kind: "retry",
    parentId: parent.run.id,
    selection: {
      ...parent.run.selection,
      label: `again: ${parent.run.selection.label}`,
    },
    skipNeeds: false,
    alongsideCi: false,
    listLines: null,
    agent: null,
    author: parent.run.author,
  });

  ended: IRunKind["ended"] = () => ({});

  /** What the run wrote: its result (null while it runs, or when it wrote none) and its draft. */
  answer(id: string): IAuthorAnswer {
    const folder = authorFolder(id);
    const resultFile = path.join(folder, "result.json");
    if (!fs.existsSync(resultFile)) {
      return { result: null, draft: null };
    }
    const parsed = authorResultSchema.safeParse(
      JSON.parse(fs.readFileSync(resultFile, "utf8"))
    );
    if (!parsed.success) {
      throw new HttpError(502, "the run's author/result.json is not readable");
    }
    const draftFile = parsed.data.draft?.file ?? null;
    const draft =
      draftFile !== null &&
      DRAFT_NAME.test(draftFile) &&
      fs.existsSync(path.join(folder, draftFile))
        ? {
            file: draftFile,
            yaml: fs.readFileSync(path.join(folder, draftFile), "utf8"),
          }
        : null;
    return { result: parsed.data, draft };
  }
}

function goalOf(record: IRunRecord): string {
  if (record.author === null) {
    throw new HttpError(500, `run ${record.id} is not an author run`);
  }
  return record.author.goal;
}
