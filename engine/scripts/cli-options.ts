/** The value after `--name` in the arguments: null when the option is absent, "" when it has no value. */
export function optionValue(
  argv: readonly string[],
  name: string
): string | null {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] ?? "";
}
