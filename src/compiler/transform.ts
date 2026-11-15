import MagicString, { type SourceMap } from "magic-string";
import type { Catalog, ResolvedMessage } from "../types.js";
import { parseSource, walk, type JSXElement, type JSXText, type ParsedSource, type StringLiteral } from "./ast.js";
import { isUsableTranslation } from "./placeholders.js";
import { FORMAT_MODULE, RUNTIME_LOCALE, RUNTIME_LOOKUP, RUNTIME_FORMAT, RUNTIME_MODULE } from "../constants.js";

/** An AST node that a resolved message should replace, tagged with how its replacement is written. */
type Target =
  | { kind: "mixed"; node: JSXElement; message: ResolvedMessage }
  | { kind: "text"; node: JSXText; message: ResolvedMessage }
  | { kind: "attribute"; node: StringLiteral; message: ResolvedMessage }
  | { kind: "string"; node: StringLiteral; message: ResolvedMessage };

/**
 * Build mode bakes the catalogue for `locale` into the code. Runtime mode emits
 * `t(id, source)` calls that resolve against the catalogues loaded by RUNTIME_MODULE.
 * Messages written in `sourceLocale` are emitted as-is.
 *
 * Replacements are applied in place with MagicString, so the returned source map points back to the original file.
 * When any runtime helper is used, the matching import from RUNTIME_MODULE is prepended.
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
  for (const message of messages) byKind[message.kind]?.set(message.start, message);

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
      if (message) targets.push({ kind: "attribute", node: node.value as StringLiteral, message });
    } else if (node.type === "Literal" && typeof node.value === "string") {
      const message = byKind.string.get(node.start);
      if (message) targets.push({ kind: "string", node: node as StringLiteral, message });
    }
  });

  const s = new MagicString(code);
  let usesRuntime = false;
  let usesFormat = false;
  let usesLocale = false;

  const textFor = (message: ResolvedMessage): string =>
    locale === sourceLocale ? message.source : (catalog[message.id] ?? message.source);

  /** Expression for a message's text: a `t(id, source)` call at runtime, or the translated string literal in build mode. */
  const lookup = (message: ResolvedMessage): string => {
    if (runtime) {
      usesRuntime = true;
      return `${RUNTIME_LOOKUP}(${JSON.stringify(message.id)}, ${JSON.stringify(message.source)})`;
    }
    return JSON.stringify(textFor(message));
  };

  /** Like `lookup`, but also wraps the text in the whitespace that was outside the extracted message. */
  const withAffixes = (message: ResolvedMessage): string => {
    const prefix = message.prefix ?? "";
    const suffix = message.suffix ?? "";
    if (!runtime) return JSON.stringify(`${prefix}${textFor(message)}${suffix}`);
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
      usesFormat = true;
      if (runtime) {
        usesLocale = true;
        s.overwrite(start, end, `{${RUNTIME_FORMAT}(${withAffixes(message)}, {${values}}, ${RUNTIME_LOCALE}())}`);
        continue;
      }
      // A translation that changes the argument names, or is blank, would render wrong text, so the source is used instead.
      const translated = textFor(message);
      const text = isUsableTranslation(translated, names) ? translated : message.source;
      const formatted = JSON.stringify(`${message.prefix ?? ""}${text}${message.suffix ?? ""}`);
      s.overwrite(start, end, `{${RUNTIME_FORMAT}(${formatted}, {${values}}, ${JSON.stringify(locale)})}`);
    } else if (target.kind === "text") {
      s.overwrite(target.node.start, target.node.end, `{${withAffixes(message)}}`);
    } else if (target.kind === "attribute") {
      // JSX attribute strings have no escape sequences, so the value must be an expression container.
      s.overwrite(target.node.start, target.node.end, `{${lookup(message)}}`);
    } else {
      s.overwrite(target.node.start, target.node.end, lookup(message));
    }
  }

  const specifiers = [
    ...(usesRuntime ? [`t as ${RUNTIME_LOOKUP}`] : []),
    ...(usesLocale ? [`getLocale as ${RUNTIME_LOCALE}`] : []),
  ];
  if (specifiers.length) s.prepend(`import { ${specifiers.join(", ")} } from "${RUNTIME_MODULE}";\n`);
  if (usesFormat) s.prepend(`import { format as ${RUNTIME_FORMAT} } from "${FORMAT_MODULE}";\n`);

  return { code: s.toString(), map: s.generateMap({ source: filename, hires: true, includeContent: true }) };
}
