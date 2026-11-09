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

// Only side-effect-free references can become placeholders, so moving them inside a translated sentence is safe.
function placeholderExpressionName(expression: any): string | undefined {
  if (t.isIdentifier(expression)) return expression.name;
  if (t.isMemberExpression(expression) && !expression.computed && t.isIdentifier(expression.property)) {
    const object = placeholderExpressionName(expression.object);
    return object ? `${object}.${expression.property.name}` : undefined;
  }
  return undefined;
}

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
    JSXElement(p: any) {
      const children: any[] = p.node.children;
      const expressions = children.filter(child => t.isJSXExpressionContainer(child));
      if (!expressions.length) return;
      if (children.some(child => !t.isJSXText(child) && !t.isJSXExpressionContainer(child))) return;
      if (!expressions.every(child => placeholderExpressionName(child.expression) !== undefined)) return;
      if (!children.some(child => t.isJSXText(child) && /[A-Za-z]/.test(child.value))) return;
      const rawTag = p.node.openingElement.name;
      if (!t.isJSXIdentifier(rawTag) || IGNORED_TAGS.has(rawTag.name)) return;
      const names: string[] = [];
      for (const child of expressions) {
        const base = placeholderExpressionName(child.expression)!;
        let name = base;
        for (let suffix = 2; names.includes(name); suffix++) name = `${base}_${suffix}`;
        names.push(name);
      }
      let raw = "";
      let index = 0;
      for (const child of children) raw += t.isJSXText(child) ? child.value : `{${names[index++]}}`;
      const source = normalizeSource(raw);
      if (!source) return;
      const tag = rawTag.name;
      const item: ExtractedMessage = {
        source, prefix: raw.match(/^\s*/)?.[0] ?? "", suffix: raw.match(/\s*$/)?.[0] ?? "",
        kind: "mixed", placeholders: names, file: filename, start: p.node.start ?? 0, end: p.node.end ?? 0,
        tag, component: componentName(p), context: elementContext(p, tag), fingerprint: ""
      };
      item.fingerprint = createFingerprint(item);
      found.push(item);
    },
    JSXText(p: any) {
      const raw = p.node.value as string;
      const source = normalizeSource(raw);
      if (!source) return;
      const element = p.findParent((x: any) => x.isJSXElement());
      if (!element) return;
      // Mixed-content elements are handled as a whole by the JSXElement visitor, never fragment by fragment.
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
