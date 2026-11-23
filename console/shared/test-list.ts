import type { ILiveTest } from "../../engine/types";

// A --test-list line selects one test by its full title: "[project] › spec › describe › title"
// (Playwright 1.65; the loader keeps "›" out of suite and test names, so it is safe to join on).

const SEPARATOR = " › ";

export function testListLine(
  test: Pick<ILiveTest, "project" | "spec" | "suite" | "title">
): string {
  const describes =
    test.suite === "" || test.suite === test.spec ? [] : [test.suite];
  return [`[${test.project}]`, test.spec, ...describes, test.title].join(
    SEPARATOR
  );
}

/** The login setup runs as a dependency of every run; it is never selected on its own. */
export function isLoginProject(project: string): boolean {
  return project.endsWith(":login");
}
