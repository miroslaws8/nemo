import type { Ref } from "vue";
import { readonly, ref } from "vue";

// One clock for the whole app, ticking once a second: enough for the durations of runs, tests
// and steps that are still going.

const TICK_MS = 1000;
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

/** The current time in ms. */
export function useClock(): Readonly<Ref<number>> {
  if (timer === null) {
    timer = setInterval(() => {
      now.value = Date.now();
    }, TICK_MS);
  }
  return readonly(now);
}
