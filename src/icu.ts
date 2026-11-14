import { IntlMessageFormat } from "intl-messageformat";

/** A node of a parsed ICU message. Types 1 to 6 name an argument in `value`; tags (8) carry `children`. */
interface IcuElement {
  type: number;
  value?: string;
  children?: IcuElement[];
  options?: Record<string, { value: IcuElement[] }>;
}

const ARGUMENT_TYPES = new Set([1, 2, 3, 4, 5, 6]);

/** Escapes source text so ICU reads it literally: apostrophes are doubled and braces are quoted. */
export function escapeIcu(text: string): string {
  return text.replace(/['{}]/g, char => (char === "'" ? "''" : `'${char}'`));
}

/** Turns a source expression such as `user.name` into an ICU argument name such as `user_name`. */
export function argumentName(expression: string): string {
  return expression.replace(/[^\p{L}\p{N}_]/gu, "_");
}

/** Returns the distinct argument names an ICU message uses, or undefined when the message does not parse. */
export function icuArgumentNames(text: string): string[] | undefined {
  let ast: IcuElement[];
  try {
    ast = new IntlMessageFormat(text, "en").getAst() as IcuElement[];
  } catch {
    return undefined;
  }
  const names = new Set<string>();
  const visit = (elements: IcuElement[]): void => {
    for (const element of elements) {
      if (ARGUMENT_TYPES.has(element.type) && element.value) names.add(element.value);
      if (element.children) visit(element.children);
      if (element.options) for (const option of Object.values(element.options)) visit(option.value);
    }
  };
  visit(ast);
  return [...names];
}
