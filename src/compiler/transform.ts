import MagicString from "magic-string";
import type { JSXElement, JSXText, StringLiteral } from "oxc-parser";
import type { Catalog, ResolvedMessage } from "../types.js";
import { parseSource, walk } from "./ast.js";
import { PLACEHOLDER, isUsableTranslation } from "./placeholders.js";

export const RUNTIME_MODULE = "virtual:autoi18n";
const RUNTIME_LOOKUP = "__autoI18nT";
const RUNTIME_FORMAT = "__autoI18nFormat";

type Target =
  | { kind: "mixed"; node: JSXElement; message: ResolvedMessage }
  | { kind: "text"; node: JSXText; message: ResolvedMessage }
  | { kind: "attribute"; node: StringLiteral; message: ResolvedMessage }
  | { kind: "string"; node: StringLiteral; message: ResolvedMessage };

/**
 * Build mode bakes the catalogue for `locale` into the code. Runtime mode emits
 * `t(id, source)` calls that resolve against the catalogues loaded by RUNTIME_MODULE.
 * Messages written in `sourceLocale` are emitted as-is.
 */
export function transformSource(code: string, filename: string, messages: ResolvedMessage[], locale: string, catalog: Catalog, runtime = false, sourceLocale = "en"): { code: string; map: any } {
  const { program } = parseSource(code, filename);
  const byKind = {
    mixed: new Map<number, ResolvedMessage>(),
    text: new Map<number, ResolvedMessage>(),
    attribute: new Map<number, ResolvedMessage>(),
    string: new Map<number, ResolvedMessage>()
  };
  for (const message of messages) byKind[message.kind]?.set(message.start, message);

  const targets: Target[] = [];
  walk(program, node => {
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

  const textFor = (message: ResolvedMessage): string => locale === sourceLocale ? message.source : catalog[message.id] ?? message.source;

  const lookup = (message: ResolvedMessage): string => {
    if (runtime) {
      usesRuntime = true;
      return `${RUNTIME_LOOKUP}(${JSON.stringify(message.id)}, ${JSON.stringify(message.source)})`;
    }
    return JSON.stringify(textFor(message));
  };

  const withAffixes = (message: ResolvedMessage): string => {
    const prefix = message.prefix ?? "";
    const suffix = message.suffix ?? "";
    if (!runtime) return JSON.stringify(`${prefix}${textFor(message)}${suffix}`);
    return [prefix && JSON.stringify(prefix), lookup(message), suffix && JSON.stringify(suffix)].filter(Boolean).join(" + ");
  };

  // Targets are applied innermost first, so an outer edit only ever overwrites ranges that are already final.
  for (const target of targets.reverse()) {
    const { message } = target;
    if (target.kind === "mixed") {
      const node = target.node;
      if (!node.closingElement) continue;
      const names = message.placeholders ?? [];
      const expressions = node.children.flatMap(child => child.type === "JSXExpressionContainer" ? [child.expression] : []);
      const source = (index: number) => s.slice(expressions[index].start, expressions[index].end);
      const start = node.openingElement.end;
      const end = node.closingElement.start;
      if (runtime) {
        usesFormat = true;
        const values = names.map((name, index) => `${JSON.stringify(name)}: ${source(index)}`).join(", ");
        s.overwrite(start, end, `{${RUNTIME_FORMAT}(${withAffixes(message)}, {${values}})}`);
        continue;
      }
      const translated = textFor(message);
      // A translation that drops, adds or renames a placeholder, or is blank, would render wrong text, so the source is used instead.
      const text = isUsableTranslation(translated, names) ? translated : message.source;
      const parts: string[] = [];
      let last = 0;
      const pushText = (value: string) => { if (value) parts.push(`{${JSON.stringify(value)}}`); };
      pushText(message.prefix ?? "");
      for (const match of text.matchAll(PLACEHOLDER)) {
        pushText(text.slice(last, match.index));
        parts.push(`{${source(names.indexOf(match[1]))}}`);
        last = match.index! + match[0].length;
      }
      pushText(text.slice(last) + (message.suffix ?? ""));
      s.overwrite(start, end, parts.join(""));
    } else if (target.kind === "text") {
      s.overwrite(target.node.start, target.node.end, `{${withAffixes(message)}}`);
    } else if (target.kind === "attribute") {
      s.overwrite(target.node.start, target.node.end, runtime ? `{${lookup(message)}}` : lookup(message));
    } else {
      s.overwrite(target.node.start, target.node.end, lookup(message));
    }
  }

  const specifiers = [
    ...(usesRuntime ? [`t as ${RUNTIME_LOOKUP}`] : []),
    ...(usesFormat ? [`format as ${RUNTIME_FORMAT}`] : [])
  ];
  if (specifiers.length) s.prepend(`import { ${specifiers.join(", ")} } from "${RUNTIME_MODULE}";\n`);

  return { code: s.toString(), map: s.generateMap({ source: filename, hires: true, includeContent: true }) };
}
