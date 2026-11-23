import type { IDiffLine } from "../../shared/types";

// Above this many line pairs a diff would take too long: it shows the whole old text out and the
// whole new one in (a skill.yaml is far smaller: 64 KB at most).
const MAX_PAIRS = 4_000_000;

/** The lines of `after` against `before`: kept, taken out and put in (the longest common run). */
export function lineDiff(before: string, after: string): IDiffLine[] {
  const old = before.replace(/\n$/, "").split("\n");
  const next = after.replace(/\n$/, "").split("\n");
  if (old.length * next.length > MAX_PAIRS) {
    return [
      ...old.map((text): IDiffLine => ({ kind: "removed", text })),
      ...next.map((text): IDiffLine => ({ kind: "added", text })),
    ];
  }
  // common[i][j]: how many lines old[i..] and next[j..] have in common, in order.
  const common = Array.from({ length: old.length + 1 }, () =>
    new Array<number>(next.length + 1).fill(0)
  );
  for (let i = old.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      common[i][j] =
        old[i] === next[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }
  const lines: IDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < old.length && j < next.length) {
    if (old[i] === next[j]) {
      lines.push({ kind: "same", text: old[i] });
      i += 1;
      j += 1;
    } else if (common[i + 1][j] >= common[i][j + 1]) {
      lines.push({ kind: "removed", text: old[i] });
      i += 1;
    } else {
      lines.push({ kind: "added", text: next[j] });
      j += 1;
    }
  }
  for (; i < old.length; i += 1) {
    lines.push({ kind: "removed", text: old[i] });
  }
  for (; j < next.length; j += 1) {
    lines.push({ kind: "added", text: next[j] });
  }
  return lines;
}
