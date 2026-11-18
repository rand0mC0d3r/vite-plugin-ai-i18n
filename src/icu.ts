import { type MessageFormatElement, parse, TYPE } from "@formatjs/icu-messageformat-parser";

/** Parser options shared with the runtime formatter, so `<b>` stays literal text in both places. */
export const ICU_PARSER_OPTIONS = { ignoreTag: true } as const;

/**
 * Returns the names of every argument used in an ICU message, including arguments nested in plural and select branches.
 * Throws a SyntaxError when the message is not valid ICU.
 */
export function argumentNames(message: string): Set<string> {
  const names = new Set<string>();
  collectArguments(parse(message, ICU_PARSER_OPTIONS), names);
  return names;
}

function collectArguments(elements: MessageFormatElement[], names: Set<string>): void {
  for (const element of elements) {
    if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
    names.add(element.value);
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      for (const option of Object.values(element.options)) collectArguments(option.value, names);
    }
  }
}

/**
 * Checks that a translation still uses the same arguments as its source, so a machine translation that renames or drops
 * `{count}` is rejected. `allowed` lists arguments the translation may add beyond the source's own, such as `count` for
 * a count template whose source omits it. A source that is not valid ICU has nothing to compare against and is accepted
 * as is.
 */
export function keepsArguments(source: string, translation: string, allowed: readonly string[] = []): boolean {
  let expected: Set<string>;
  try {
    expected = argumentNames(source);
  } catch {
    return true;
  }
  for (const name of allowed) expected.add(name);
  let actual: Set<string>;
  try {
    actual = argumentNames(translation);
  } catch {
    return false;
  }
  return actual.size === expected.size && [...expected].every((name) => actual.has(name));
}
