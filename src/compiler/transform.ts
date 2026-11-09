import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import generateModule from "@babel/generator";
import * as t from "@babel/types";
import type { ExtractedMessage, Catalog } from "../types.js";
const traverse = (traverseModule as any).default ?? traverseModule;
const generate = (generateModule as any).default ?? generateModule;

export const RUNTIME_MODULE = "virtual:autoi18n";
const RUNTIME_LOOKUP = "__autoI18nT";

/**
 * Build mode bakes the catalogue for `locale` into the code. Runtime mode emits
 * `t(id, source)` calls that resolve against the catalogues loaded by RUNTIME_MODULE.
 */
export function transformSource(code: string, filename: string, messages: ExtractedMessage[], locale: string, catalog: Catalog, runtime = false): { code: string; map: any } {
  const ast = parse(code, { sourceType: "unambiguous", sourceFilename: filename, plugins: ["jsx", "typescript", "decorators-legacy"] });
  const byStart = new Map(messages.map(m => [m.start, m]));
  let usesRuntime = false;

  const lookup = (message: ExtractedMessage): t.Expression => {
    if (runtime) {
      usesRuntime = true;
      return t.callExpression(t.identifier(RUNTIME_LOOKUP), [t.stringLiteral(message.id!), t.stringLiteral(message.source)]);
    }
    return t.stringLiteral(locale === "en" ? message.source : catalog[message.id!] ?? message.source);
  };

  traverse(ast, {
    JSXText(p: any) {
      const message = byStart.get(p.node.start ?? -1);
      if (!message?.id) return;
      const parts: t.Expression[] = [];
      if (runtime) {
        if (message.prefix) parts.push(t.stringLiteral(message.prefix));
        parts.push(lookup(message));
        if (message.suffix) parts.push(t.stringLiteral(message.suffix));
      } else {
        const translated = (lookup(message) as t.StringLiteral).value;
        parts.push(t.stringLiteral(`${message.prefix ?? ""}${translated}${message.suffix ?? ""}`));
      }
      const expression = parts.reduce((left, right) => t.binaryExpression("+", left, right));
      p.replaceWith(t.jsxExpressionContainer(expression));
    },
    JSXAttribute(p: any) {
      const valueNode = p.node.value;
      if (!t.isStringLiteral(valueNode)) return;
      const message = byStart.get(valueNode.start ?? -1);
      if (!message?.id) return;
      p.node.value = runtime ? t.jsxExpressionContainer(lookup(message)) : lookup(message);
    }
  });

  if (usesRuntime) {
    ast.program.body.unshift(t.importDeclaration(
      [t.importSpecifier(t.identifier(RUNTIME_LOOKUP), t.identifier("t"))],
      t.stringLiteral(RUNTIME_MODULE)
    ));
  }
  const result = generate(ast, { sourceMaps: true, sourceFileName: filename }, code);
  return { code: result.code, map: result.map };
}
