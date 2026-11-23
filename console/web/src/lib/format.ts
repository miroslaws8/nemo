// Times and durations as the console shows them: a 24-hour clock in the Mac's time zone.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const shortClock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const day = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 850 ms · 12.4 s · 3 m 05 s · 1 h 02 m */
export function formatDuration(ms: number): string {
  if (ms < SECOND) {
    return `${Math.round(ms)} ms`;
  }
  if (ms < MINUTE) {
    return `${(ms / SECOND).toFixed(ms < 10 * SECOND ? 1 : 0)} s`;
  }
  if (ms < HOUR) {
    return `${Math.floor(ms / MINUTE)} m ${pad(
      Math.floor((ms % MINUTE) / SECOND)
    )} s`;
  }
  return `${Math.floor(ms / HOUR)} h ${pad(
    Math.floor((ms % HOUR) / MINUTE)
  )} m`;
}

/** Time from `from` to `to`, or to `now` while it is still going. */
export function elapsed(from: string, to: string | null, now: number): number {
  const end = to === null ? now : Date.parse(to);
  return Math.max(0, end - Date.parse(from));
}

export function formatClock(iso: string): string {
  return clock.format(new Date(iso));
}

export function formatShortClock(iso: string): string {
  return shortClock.format(new Date(iso));
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Today · Yesterday · Wed 11 Nov */
export function formatDay(iso: string, now: number): string {
  const days = Math.round(
    (startOfDay(now) - startOfDay(Date.parse(iso))) / (24 * HOUR)
  );
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Yesterday";
  }
  return day.format(new Date(iso));
}

/** today at 17:46 · yesterday at 09:05 · on Wed 11 Nov at 17:46 */
export function formatWhen(iso: string, now: number): string {
  const dayText = formatDay(iso, now);
  const prefix =
    dayText === "Today" || dayText === "Yesterday"
      ? dayText.toLowerCase()
      : `on ${dayText}`;
  return `${prefix} at ${formatShortClock(iso)}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The tier of a Playwright project named "<env>:<tier>". */
export function tierOf(project: string): string {
  return project.slice(project.indexOf(":") + 1);
}

/** A run's label as a title: capitalized, with typographic quotes around a test's name. */
export function formatLabel(label: string): string {
  const quoted = label.replace(/"([^"]*)"/g, "“$1”");
  return quoted.charAt(0).toUpperCase() + quoted.slice(1);
}

/** Dollars, to the cent, or to a tenth of a cent below a cent. */
export function formatUsd(usd: number): string {
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/** A token count, short: 840, 12.5k, 1.2M. */
export function formatTokens(count: number): string {
  if (count < 1000) {
    return String(count);
  }
  return count < 1_000_000
    ? `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`
    : `${(count / 1_000_000).toFixed(1)}M`;
}

/** Who, short: the name part of an email (the full one shows on the run's page). */
export function personOf(email: string): string {
  return email.split("@")[0] ?? email;
}
