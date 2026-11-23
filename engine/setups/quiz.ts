import { z } from "zod";
import { createdQuizSchema } from "../api-schemas";
import { dataTitle } from "../run-info";
import { variableNameSchema } from "../schema";
import type { IRunContext } from "../types";
import { defineSetup } from "./define-setup";

const paramsSchema = z.strictObject({
  as: variableNameSchema.default("quiz"),
  questions: z.number().int().min(1).max(10).default(2),
});

// Single-choice questions with one right option each; the right one is listed first, so a test
// that always picks the first option scores full marks.
function buildQuestions(count: number): object[] {
  return Array.from({ length: count }, (_, index) => ({
    question: `Question ${index + 1}: which option is right?`,
    type: "single_choice",
    order: index,
    options: [
      { id: `q${index + 1}-right`, text: "The right one", isCorrect: true },
      { id: `q${index + 1}-wrong`, text: "The wrong one", isCorrect: false },
    ],
    correct_feedback: "Correct.",
    incorrect_feedback: "Not quite.",
  }));
}

// A quiz of the test's own, so taking it never uses up the attempts of a real quiz. The player
// does not need it published. Deleted after the test like any data the tests create.
async function createQuiz(
  params: z.infer<typeof paramsSchema>,
  context: IRunContext
): Promise<void> {
  const { api, environment, testInfo } = context;
  const { workspaceId } = await api.resolveInstance();
  const title = dataTitle(
    params.as === "quiz" ? testInfo.title : `${testInfo.title} ${params.as}`
  );

  const quiz = await api.post(
    `/api/workspaces/${workspaceId}/quizzes`,
    {
      title,
      quiz_type: "knowledge",
      questions: buildQuestions(params.questions),
    },
    createdQuizSchema
  );
  const playerUrl = `${environment.baseUrl}/dashboard/quizzes/${quiz.id}/player`;
  context.resources.track({ kind: "quiz", id: quiz.id, title, url: playerUrl });

  context.variables[params.as] = {
    id: quiz.id,
    title,
    questions: params.questions,
    player_url: playerUrl,
    preview_url: `${environment.baseUrl}/dashboard/quizzes/preview/${quiz.id}`,
  };
  testInfo.annotations.push({
    type: "quiz",
    description: `${title} — quiz ${quiz.id} — ${playerUrl}`,
  });
}

export const quizSetup = defineSetup({
  name: "quiz",
  mode: "creates",
  params: paramsSchema,
  run: createQuiz,
});
