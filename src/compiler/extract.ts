import { parse } from "@babel/parser";
import traverseModule, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { createFingerprint, normalizeSource } from "../identity/fingerprint.js";
import type { ExtractedMessage } from "../types.js";

const traverse = (traverseModule as unknown as { default?: typeof traverseModule }).default ?? traverseModule;
const COMPONENT_TAG = /^[A-Z]/;
const IGNORED_TAGS = new Set(["script", "style", "code", "pre"]);
// Attributes whose string values are user-facing copy. Others (href, type, variant, src, ...) are code or configuration.
const TRANSLATABLE_ATTRS = new Set(["alt", "title", "placeholder", "label", "summary", "aria-label", "aria-description", "aria-placeholder", "aria-roledescription", "aria-valuetext"]);

// Only intrinsic elements (lowercase DOM tags) carry copy; capitalised components receive data as children or props.
function isExtractableTag(name: t.JSXOpeningElement["name"]): name is t.JSXIdentifier {
  return t.isJSXIdentifier(name) && !COMPONENT_TAG.test(name.name) && !IGNORED_TAGS.has(name.name);
}

// Only side-effect-free references can become placeholders, so moving them inside a translated sentence is safe.
function placeholderExpressionName(expression: t.Node): string | undefined {
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

  function componentName(nodePath: NodePath): string {
    const fn = nodePath.findParent(p => p.isFunctionDeclaration() || p.isFunctionExpression() || p.isArrowFunctionExpression());
    if (!fn) return "<module>";
    const parent = fn.parentPath;
    if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) return parent.node.id.name;
    if (fn.isFunctionDeclaration() && fn.node.id) return fn.node.id.name;
    return "<anonymous>";
  }

  function elementContext(elementNode: t.JSXElement | t.JSXOpeningElement, tag: string, attr?: string): string {
    const openingElement = t.isJSXElement(elementNode) ? elementNode.openingElement : elementNode;
    const attrs = openingElement.attributes
      .filter((a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && ["aria-label", "title", "name", "type", "role"].includes(a.name.name))
      .map(a => `${(a.name as t.JSXIdentifier).name}=${t.isStringLiteral(a.value) ? a.value.value : "{expr}"}`)
      .sort().join(";");
    const handlers = openingElement.attributes
      .filter((a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && /^on[A-Z]/.test(a.name.name))
      .map(a => {
        const expression = t.isJSXExpressionContainer(a.value) ? a.value.expression : null;
        const semanticHandler = expression && t.isIdentifier(expression) ? expression.name : expression?.type ?? "handler";
        return `${(a.name as t.JSXIdentifier).name}=${semanticHandler}`;
      }).sort().join(",");
    return [tag, attr ?? "", attrs, handlers].filter(Boolean).join(" | ");
  }

  traverse(ast, {
    JSXElement(p) {
      const children = p.node.children;
      const expressions = children.filter((child): child is t.JSXExpressionContainer => t.isJSXExpressionContainer(child));
      if (!expressions.length) return;
      if (children.some(child => !t.isJSXText(child) && !t.isJSXExpressionContainer(child))) return;
      if (!expressions.every(child => placeholderExpressionName(child.expression) !== undefined)) return;
      if (!children.some(child => t.isJSXText(child) && /[A-Za-z]/.test(child.value))) return;
      const rawTag = p.node.openingElement.name;
      if (!isExtractableTag(rawTag)) return;
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
        tag, component: componentName(p), context: elementContext(p.node, tag), fingerprint: ""
      };
      item.fingerprint = createFingerprint(item);
      found.push(item);
    },
    JSXText(p) {
      const raw = p.node.value;
      const source = normalizeSource(raw);
      if (!source) return;
      const element = p.findParent(x => x.isJSXElement());
      if (!element?.isJSXElement()) return;
      // Mixed-content elements are handled as a whole by the JSXElement visitor, never fragment by fragment.
      if (element.node.children.some(child => t.isJSXExpressionContainer(child))) return;
      const rawTag = element.node.openingElement.name;
      // Text inside components is data supplied by the caller, not UI copy written here.
      if (!isExtractableTag(rawTag)) return;
      const tag = rawTag.name;
      const component = componentName(element);
      const context = elementContext(element.node, tag);
      const prefix = raw.match(/^\s*/)?.[0] ?? "";
      const suffix = raw.match(/\s*$/)?.[0] ?? "";
      const item: ExtractedMessage = { source, prefix, suffix, kind: "text", file: filename, start: p.node.start ?? 0, end: p.node.end ?? 0, tag, component, context, fingerprint: "" };
      item.fingerprint = createFingerprint(item);
      found.push(item);
    },
    JSXAttribute(p) {
      const attr = p.node;
      if (!t.isJSXIdentifier(attr.name) || !TRANSLATABLE_ATTRS.has(attr.name.name)) return;
      if (!t.isStringLiteral(attr.value)) return;
      const source = normalizeSource(attr.value.value);
      if (!source || !/[A-Za-z]/.test(source)) return;
      const element = p.parentPath;
      if (!element.isJSXOpeningElement() || !isExtractableTag(element.node.name)) return;
      const tag = element.node.name.name;
      const parentElement = p.findParent(x => x.isJSXElement());
      if (!parentElement?.isJSXElement()) return;
      const component = componentName(parentElement);
      const context = elementContext(parentElement.node, tag, attr.name.name);
      const item: ExtractedMessage = { source, kind: "attribute", file: filename, start: attr.value.start ?? 0, end: attr.value.end ?? 0, tag, component, attribute: attr.name.name, context, fingerprint: "" };
      item.fingerprint = createFingerprint(item);
      found.push(item);
    }
  });
  return found.sort((a, b) => a.start - b.start);
}
