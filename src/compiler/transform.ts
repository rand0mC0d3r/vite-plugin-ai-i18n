import MagicString, { type SourceMap } from "magic-string";

import { isUsableTranslation } from "../icu.js";
import type { Catalog, ResolvedMessage } from "../types.js";
import {
  type CallExpression,
  type JSXElement,
  type JSXText,
  type ParsedSource,
  parseSource,
  type StringLiteral,
  walk,
} from "./ast.js";

/** Virtual module id that exposes the runtime `setLocale()` and catalogues. */
export const RUNTIME_MODULE = "virtual:autoi18n";
/** Virtual module id that exposes `format()`, which renders ICU MessageFormat text with values. */
export const FORMAT_MODULE = "virtual:autoi18n-format";
/** Global name of the translation lookup function injected into transformed code. */
const RUNTIME_LOOKUP = "__autoI18nT";
/** Global name of the message-format helper injected into transformed code. */
const RUNTIME_FORMAT = "__autoI18nFormat";
/** Global name of the current-locale getter injected into transformed code. */
const RUNTIME_LOCALE = "__autoI18nLocale";

/** An AST node that a resolved message should replace, tagged with how its replacement is written. */
type Target =
  | { kind: "mixed"; node: JSXElement; message: ResolvedMessage }
  | { kind: "text"; node: JSXText; message: ResolvedMessage }
  | { kind: "attribute"; node: StringLiteral; message: ResolvedMessage }
  | { kind: "string"; node: CallExpression; message: ResolvedMessage };

/**
 * Build mode bakes the catalogue for `locale` into the code. Runtime mode emits `lookup(id, source)` calls that resolve
 * against the catalogues loaded by RUNTIME_MODULE. Messages written in `sourceLocale` are emitted as-is.
 *
 * Replacements are applied in place with MagicString, so the returned source map points back to the original file. When
 * any runtime helper is used, the matching import from RUNTIME_MODULE is prepended.
 *
 * @param code Source text of the module to transform.
 * @param filename Used for parsing and as the source name in the source map.
 * @param messages Messages extracted from this file, each with its character range in `code`.
 * @param locale Locale being built. Build mode looks translations up for this locale.
 * @param catalog Translations for `locale`, keyed by message ID. Missing IDs fall back to the source text.
 * @param runtime When true, emit runtime lookups instead of baked-in text.
 * @param sourceLocale Locale the source code is written in. Its messages are never looked up.
 * @returns The transformed code and its source map.
 * @throws SyntaxError if `code` cannot be parsed.
 */
export function transformSource(
  code: string,
  filename: string,
  messages: ResolvedMessage[],
  locale: string,
  catalog: Catalog,
  runtime = false,
  sourceLocale = "en",
  parsed: ParsedSource = parseSource(code, filename),
): { code: string; map: SourceMap } {
  const { program } = parsed;
  const byKind = {
    mixed: new Map<number, ResolvedMessage>(),
    text: new Map<number, ResolvedMessage>(),
    attribute: new Map<number, ResolvedMessage>(),
    string: new Map<number, ResolvedMessage>(),
  };
  for (const message of messages) byKind[message.kind].set(message.start, message);

  // Every target starts inside its parent's range, so a subtree with no message start cannot contain a target.
  const starts = messages.map((message) => message.start).sort((a, b) => a - b);
  const hasStartWithin = (from: number, to: number): boolean => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (starts[mid] < from) low = mid + 1;
      else high = mid;
    }
    return low < starts.length && starts[low] < to;
  };

  const targets: Target[] = [];
  walk(program, (node) => {
    if (!hasStartWithin(node.start, node.end)) return false;
    if (node.type === "JSXElement") {
      const message = byKind.mixed.get(node.start);
      if (message) targets.push({ kind: "mixed", node, message });
    } else if (node.type === "JSXText") {
      const message = byKind.text.get(node.start);
      if (message) targets.push({ kind: "text", node, message });
    } else if (node.type === "JSXAttribute" && node.value?.type === "Literal") {
      const message = byKind.attribute.get(node.value.start);
      if (message) targets.push({ kind: "attribute", node: node.value, message });
    } else if (node.type === "CallExpression") {
      const message = byKind.string.get(node.start);
      if (message) targets.push({ kind: "string", node, message });
    }
    return true;
  });

  const s = new MagicString(code);
  const used = { lookup: false, format: false, locale: false };

  const textFor = (message: ResolvedMessage): string =>
    locale === sourceLocale ? message.source : (catalog[message.id] ?? message.source);

  /**
   * Expression for a message's text: a `lookup(id, source)` call at runtime, or the translated string literal in build
   * mode.
   */
  const lookup = (message: ResolvedMessage): string => {
    if (runtime) {
      used.lookup = true;
      return `${RUNTIME_LOOKUP}(${JSON.stringify(message.id)}, ${JSON.stringify(message.source)})`;
    }
    return JSON.stringify(textFor(message));
  };

  /** Wraps text in the whitespace that was outside the extracted message. */
  const affixed = (message: ResolvedMessage, text: string): string =>
    `${message.prefix ?? ""}${text}${message.suffix ?? ""}`;

  /** Like `lookup`, but also wraps the text in the whitespace that was outside the extracted message. */
  const withAffixes = (message: ResolvedMessage): string => {
    if (!runtime) return JSON.stringify(affixed(message, textFor(message)));
    const prefix = message.prefix ?? "";
    const suffix = message.suffix ?? "";
    return [prefix && JSON.stringify(prefix), lookup(message), suffix && JSON.stringify(suffix)]
      .filter(Boolean)
      .join(" + ");
  };

  // Targets are applied innermost first, so an outer edit only ever overwrites ranges that are already final.
  for (const target of targets.reverse()) {
    const { message } = target;
    if (target.kind === "mixed") {
      const node = target.node;
      if (!node.closingElement) continue;
      const names = message.placeholders ?? [];
      const expressions = node.children.flatMap((child) =>
        child.type === "JSXExpressionContainer" ? [child.expression] : [],
      );
      const source = (index: number) => s.slice(expressions[index].start, expressions[index].end);
      const start = node.openingElement.end;
      const end = node.closingElement.start;
      const values = names.map((name, index) => `${JSON.stringify(name)}: ${source(index)}`).join(", ");
      used.format = true;
      if (runtime) {
        used.locale = true;
        s.overwrite(start, end, `{${RUNTIME_FORMAT}(${withAffixes(message)}, {${values}}, ${RUNTIME_LOCALE}())}`);
        continue;
      }
      // A translation that changes the argument names, or is blank, would render wrong text, so the source is used instead.
      const translated = textFor(message);
      const text = isUsableTranslation(translated, names) ? translated : message.source;
      const formatted = JSON.stringify(affixed(message, text));
      s.overwrite(start, end, `{${RUNTIME_FORMAT}(${formatted}, {${values}}, ${JSON.stringify(locale)})}`);
    } else if (target.kind === "text") {
      s.overwrite(target.node.start, target.node.end, `{${withAffixes(message)}}`);
    } else if (target.kind === "attribute") {
      // JSX attribute strings have no escape sequences, so the value must be an expression container.
      s.overwrite(target.node.start, target.node.end, `{${lookup(message)}}`);
    } else {
      // The whole `t("...")` call is replaced, so the translation is the call's value.
      s.overwrite(target.node.start, target.node.end, lookup(message));
    }
  }

  const specifiers = [
    ...(used.lookup ? [`lookup as ${RUNTIME_LOOKUP}`] : []),
    ...(used.locale ? [`getLocale as ${RUNTIME_LOCALE}`] : []),
  ];
  if (specifiers.length) s.prepend(`import { ${specifiers.join(", ")} } from "${RUNTIME_MODULE}";\n`);
  if (used.format) s.prepend(`import { format as ${RUNTIME_FORMAT} } from "${FORMAT_MODULE}";\n`);

  return { code: s.toString(), map: s.generateMap({ source: filename, hires: true, includeContent: true }) };
}
