import type { IRunRecord } from "@shared/types";
import { RUN_STATUS_LOOKS } from "@/lib/status";
import type { ITone } from "@/types";

/** An environment's colour in the sidebar: run while a run goes there, else how its last run ended. */
export function environmentTone(
  active: IRunRecord | undefined,
  last: IRunRecord | undefined
): ITone {
  if (active !== undefined) {
    return "run";
  }
  if (last !== undefined) {
    return RUN_STATUS_LOOKS[last.status].tone;
  }
  return "idle";
}
