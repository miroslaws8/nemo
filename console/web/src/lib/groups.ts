import type { IGroup } from "@/types";
import { formatDay } from "./format";

/** The items going now first ("Now"), then the rest by the day they began, newest first. */
export function groupByDay<TItem>(
  items: TItem[],
  beganAt: (item: TItem) => string,
  isCurrent: (item: TItem) => boolean,
  now: number
): IGroup<TItem>[] {
  const current = items.filter(isCurrent);
  const byDay = new Map<string, IGroup<TItem>>();
  for (const item of items) {
    if (isCurrent(item)) {
      continue;
    }
    const title = formatDay(beganAt(item), now);
    const group = byDay.get(title) ?? { title, items: [] };
    group.items.push(item);
    byDay.set(title, group);
  }
  const going: IGroup<TItem>[] =
    current.length > 0 ? [{ title: "Now", items: current }] : [];
  return [...going, ...byDay.values()];
}
