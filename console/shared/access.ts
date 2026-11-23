import type { IRole } from "./types";

// Who may do what in a server console, the same rule for the server (which enforces it) and the web
// app (which greys out what a role cannot do). Each role can do what the ones before it can:
//   viewer   — watches runs and CI, reads logs, reports and traces (not prod's: they hold tokens);
//   runner   — also starts, stops, retries and cleans up on an open environment (staging);
//   operator — also on a guarded one (prod), whose runs write real data.

const RANKS: Record<IRole, number> = { viewer: 0, runner: 1, operator: 2 };

/** What a request on an environment does: read its runs' files, or act (run, stop, clean up). */
export type IEnvironmentUse = "read" | "act";

const NEEDS: Record<IEnvironmentUse, { open: IRole; guarded: IRole }> = {
  read: { open: "viewer", guarded: "operator" },
  act: { open: "runner", guarded: "operator" },
};

/** Who may add a skill to the console (or the working copy) and give one a new version. */
export const SKILL_EDITOR: IRole = "operator";

export function hasRole(role: IRole, needed: IRole): boolean {
  return RANKS[role] >= RANKS[needed];
}

/** The role a use of an environment needs: a guarded one (prod) takes an operator. */
export function roleFor(use: IEnvironmentUse, guarded: boolean): IRole {
  const needs = NEEDS[use];
  return guarded ? needs.guarded : needs.open;
}
