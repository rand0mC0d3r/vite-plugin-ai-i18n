import type { NodePath } from "@babel/traverse";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import generateModule from "@babel/generator";
import * as t from "@babel/types";
import type { Catalog, ResolvedMessage } from "../types.js";
import { PLACEHOLDER, isUsableTranslation } from "./placeholders.js";
const traverse = (traverseModule as any).default ?? traverseModule;
const generate = (generateModule as any).default ?? generateModule;

export const RUNTIME_MODULE = "virtual:autoi18n";
const RUNTIME_LOOKUP = "__autoI18nT";
const RUNTIME_FORMAT = "__autoI18nFormat";

/**
 * Build mode bakes the catalogue for `locale` into the code. Runtime mode emits
 * `t(id, source)` calls that resolve against the catalogues loaded by RUNTIME_MODULE.
 * Messages written in `sourceLocale` are emitted as-is.
 */
export function transformSource(code: string, filename: string, messages: ResolvedMessage[], locale: string, catalog: Catalog, runtime = false, sourceLocale = "en"): { code: string; map: any } {
  const ast = parse(code, { sourceType: "unambiguous", sourceFilename: filename, plugins: ["jsx", "typescript", "decorators-legacy"] });
  const byStart = new Map(messages.map(m => [m.start, m]));
  let usesRuntime = false;
  let usesFormat = false;

  const lookup = (message: ResolvedMessage): t.Expression => {
    if (runtime) {
      usesRuntime = true;
      return t.callExpression(t.identifier(RUNTIME_LOOKUP), [t.stringLiteral(message.id), t.stringLiteral(message.source)]);
    }
    return t.stringLiteral(locale === sourceLocale ? message.source : catalog[message.id] ?? message.source);
  };

  traverse(ast, {
    JSXElement(p: NodePath<t.JSXElement>) {
      const message = byStart.get(p.node.start ?? -1);
      if (message?.kind !== "mixed") return;
      const names = message.placeholders ?? [];
      const expressions = p.node.children.filter((c): c is t.JSXExpressionContainer => t.isJSXExpressionContainer(c)).map(c => c.expression as t.Expression);
      const prefix = message.prefix ?? "";
      const suffix = message.suffix ?? "";
      if (runtime) {
        usesFormat = true;
        const values = t.objectExpression(names.map((name, i) => t.objectProperty(t.stringLiteral(name), t.cloneNode(expressions[i]))));
        const text = [prefix && t.stringLiteral(prefix), lookup(message), suffix && t.stringLiteral(suffix)].filter(Boolean) as t.Expression[];
        const joined = text.reduce((left, right) => t.binaryExpression("+", left, right));
        p.node.children = [t.jsxExpressionContainer(t.callExpression(t.identifier(RUNTIME_FORMAT), [joined, values]))];
        return;
      }
      const translated = locale === sourceLocale ? message.source : catalog[message.id] ?? message.source;
      // A translation that drops, adds or renames a placeholder, or is blank, would render wrong text, so the source is used instead.
      const text = isUsableTranslation(translated, names) ? translated : message.source;
      const children: t.JSXElement["children"] = [];
      let last = 0;
      const pushText = (value: string) => { if (value) children.push(t.jsxExpressionContainer(t.stringLiteral(value))); };
      pushText(prefix);
      for (const match of text.matchAll(PLACEHOLDER)) {
        pushText(text.slice(last, match.index));
        children.push(t.jsxExpressionContainer(t.cloneNode(expressions[names.indexOf(match[1])])));
        last = match.index! + match[0].length;
      }
      pushText(text.slice(last) + suffix);
      p.node.children = children;
    },
    JSXText(p: NodePath<t.JSXText>) {
      const message = byStart.get(p.node.start ?? -1);
      if (!message) return;
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
    JSXAttribute(p: NodePath<t.JSXAttribute>) {
      const valueNode = p.node.value;
      if (!t.isStringLiteral(valueNode)) return;
      const message = byStart.get(valueNode.start ?? -1);
      if (!message) return;
      p.node.value = runtime ? t.jsxExpressionContainer(lookup(message)) : (lookup(message) as t.StringLiteral);
    }
  });

  const runtimeSpecifiers = [
    ...(usesRuntime ? [t.importSpecifier(t.identifier(RUNTIME_LOOKUP), t.identifier("t"))] : []),
    ...(usesFormat ? [t.importSpecifier(t.identifier(RUNTIME_FORMAT), t.identifier("format"))] : [])
  ];
  if (runtimeSpecifiers.length) {
    ast.program.body.unshift(t.importDeclaration(runtimeSpecifiers, t.stringLiteral(RUNTIME_MODULE)));
  }
  const result = generate(ast, { sourceMaps: true, sourceFileName: filename }, code);
  return { code: result.code, map: result.map };
}

