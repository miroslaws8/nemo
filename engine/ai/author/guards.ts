// What the test author may not do, checked by the engine before a step runs — not left to the
// prompt: leave the environment's site, or press a control named like something that pays,
// publishes, deletes or signs out (ai.author.avoid).

/** Why a `goto` is refused, or null: an absolute URL on another origin leaves the site. */
export function refuseGoto(target: string, baseUrl: string): string | null {
  const base = new URL(baseUrl).origin;
  let destination: URL;
  try {
    destination = new URL(target, `${base}/`);
  } catch {
    return null;
  }
  return destination.origin === base
    ? null
    : `goto leaves the site (${destination.origin}): stay on ${base}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Why a target named `name` must not be pressed, or null: a whole avoid word or phrase in it. */
export function refuseByAvoid(name: string, avoid: string[]): string | null {
  const word = avoid.find((candidate) =>
    new RegExp(`\\b${escapeRegExp(candidate.trim())}\\b`, "i").test(name)
  );
  return word === undefined
    ? null
    : `refused: "${name}" matches "${word}" (ai.author.avoid)`;
}
