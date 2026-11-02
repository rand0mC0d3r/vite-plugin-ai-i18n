import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import * as t from "@babel/types";
import path from "node:path";
import { createFingerprint, normalizeSource } from "../identity/fingerprint.js";
import type { ExtractedMessage } from "../types.js";

const traverse = (traverseModule as unknown as { default?: typeof traverseModule }).default ?? traverseModule;
const COMPONENT_TAG = /^[A-Z]/;
const IGNORED_TAGS = new Set(["script", "style", "code", "pre"]);
const IGNORE_ATTRS = new Set(["key", "ref", "id", "className", "style", "data-testid"]);

export function extractMessages(code: string, filename: string): ExtractedMessage[] {
  const ast = parse(code, { sourceType: "unambiguous", sourceFilename: filename, plugins: ["jsx", "typescript", "decorators-legacy"] });
  const found: ExtractedMessage[] = [];

  function componentName(nodePath: any): string {
    const fn = nodePath.findParent((p: any) => p.isFunctionDeclaration() || p.isFunctionExpression() || p.isArrowFunctionExpression());
    if (!fn) return "<module>";
    const parent = fn.parentPath;
    if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) return parent.node.id.name;
    if (fn.isFunctionDeclaration() && fn.node.id) return fn.node.id.name;
    return "<anonymous>";
  }

  function elementContext(elementPath: any, tag: string, attr?: string): string {
    const attrs = elementPath.node.openingElement.attributes
      .filter((a: any) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && ["aria-label", "title", "name", "type", "role"].includes(a.name.name))
      .map((a: any) => `${a.name.name}=${t.isStringLiteral(a.value) ? a.value.value : "{expr}"}`)
      .sort().join(";");
    const handlers = elementPath.node.openingElement.attributes
      .filter((a: any) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && /^on[A-Z]/.test(a.name.name))
      .map((a: any) => {
        const expression = t.isJSXExpressionContainer(a.value) ? a.value.expression : null;
        const semanticHandler = expression && t.isIdentifier(expression) ? expression.name : expression?.type ?? "handler";
        return `${a.name.name}=${semanticHandler}`;
      }).sort().join(",");
    return [tag, attr ?? "", attrs, handlers].filter(Boolean).join(" | ");
  }

  traverse(ast, {
    JSXText(p: any) {
      const raw = p.node.value as string;
      const source = normalizeSource(raw);
      if (!source) return;
      const element = p.findParent((x: any) => x.isJSXElement());
      if (!element) return;
      // Until expression-aware ICU grouping exists, leave an entire mixed-content sentence
      // in its source language rather than translating fragments into ungrammatical copy.
      if (element.node.children.some((child: any) => t.isJSXExpressionContainer(child))) return;
      const rawTag = element.node.openingElement.name;
      if (!t.isJSXIdentifier(rawTag) || IGNORED_TAGS.has(rawTag.name)) return;
      // Avoid extracting text inside custom components: their children may be API/content, not UI copy.
      const tag = rawTag.name;
      const component = componentName(element);
      const context = elementContext(element, tag);
      const prefix = raw.match(/^\s*/)?.[0] ?? "";
      const suffix = raw.match(/\s*$/)?.[0] ?? "";
      const item: ExtractedMessage = { source, prefix, suffix, kind: "text", file: filename, start: p.node.start ?? 0, end: p.node.end ?? 0, tag, component, context, fingerprint: "" };
      item.fingerprint = createFingerprint(item);
      found.push(item);
    },
    JSXAttribute(p: any) {
      const attr = p.node;
      if (!t.isJSXIdentifier(attr.name) || IGNORE_ATTRS.has(attr.name.name)) return;
      if (!t.isStringLiteral(attr.value)) return;
      const source = normalizeSource(attr.value.value);
      if (!source || !/[A-Za-z]/.test(source)) return;
      const element = p.findParent((x: any) => x.isJSXOpeningElement());
      if (!element || !t.isJSXIdentifier(element.node.name)) return;
      const tag = element.node.name.name;
      if (IGNORED_TAGS.has(tag)) return;
      const parentElement = p.findParent((x: any) => x.isJSXElement());
      if (!parentElement) return;
      const component = componentName(parentElement);
      const context = elementContext(parentElement, tag, attr.name.name);
      const item: ExtractedMessage = { source, kind: "attribute", file: filename, start: attr.value.start ?? 0, end: attr.value.end ?? 0, tag, component, attribute: attr.name.name, context, fingerprint: "" };
      item.fingerprint = createFingerprint(item);
      found.push(item);
    }
  });
  return found.sort((a, b) => a.start - b.start);
}

export function relativeFile(file: string, root: string): string {
  return path.relative(root, file).replaceAll(path.sep, "/");
}
