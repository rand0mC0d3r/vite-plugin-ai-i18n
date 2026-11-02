import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import generateModule from "@babel/generator";
import * as t from "@babel/types";
import type { ExtractedMessage, Catalog } from "../types.js";
const traverse = (traverseModule as any).default ?? traverseModule;
const generate = (generateModule as any).default ?? generateModule;

export function transformSource(code: string, filename: string, messages: ExtractedMessage[], locale: string, catalog: Catalog): { code: string; map: any } {
  const ast = parse(code, { sourceType: "unambiguous", sourceFilename: filename, plugins: ["jsx", "typescript", "decorators-legacy"] });
  const byStart = new Map(messages.map(m => [m.start, m]));
  const used = new Set<string>();
  traverse(ast, {
    JSXText(p: any) {
      const message = byStart.get(p.node.start ?? -1);
      if (!message?.id) return;
      used.add(message.id);
      const translated = locale === "en" ? message.source : catalog[message.id] ?? message.source;
      const value = `${message.prefix ?? ""}${translated}${message.suffix ?? ""}`;
      p.replaceWith(t.jsxExpressionContainer(t.stringLiteral(value)));
    },
    JSXAttribute(p: any) {
      const valueNode = p.node.value;
      if (!t.isStringLiteral(valueNode)) return;
      const message = byStart.get(valueNode.start ?? -1);
      if (!message?.id) return;
      used.add(message.id);
      const value = locale === "en" ? message.source : catalog[message.id] ?? message.source;
      p.node.value = t.stringLiteral(value);
    }
  });
  const result = generate(ast, { sourceMaps: true, sourceFileName: filename }, code);
  return { code: result.code, map: result.map };
}
