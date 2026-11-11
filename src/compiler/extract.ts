import type { Node, JSXAttribute, JSXElement, JSXOpeningElement, JSXText, JSXExpressionContainer } from "oxc-parser";
import { createFingerprint, normalizeSource } from "../identity/fingerprint.js";
import type { ExtractedMessage } from "../types.js";
import { hasLeadingBlockComment, isStringLiteral, parseSource, walk } from "./ast.js";
import { decodeJsxEntities } from "./entities.js";

const COMPONENT_TAG = /^[A-Z]/;
const IGNORED_TAGS = new Set(["script", "style", "code", "pre"]);
// Attributes whose string values are user-facing copy. Others (href, type, variant, src, ...) are code or configuration.
const TRANSLATABLE_ATTRS = new Set(["alt", "title", "placeholder", "label", "summary", "aria-label", "aria-description", "aria-placeholder", "aria-roledescription", "aria-valuetext"]);

export interface ExtractOptions {
  /** Attributes of custom components whose string values are UI copy, keyed by component name. */
  componentProps?: Record<string, readonly string[]>;
}

// A block comment directly before a string literal opts that literal into translation, for copy outside JSX.
const STRING_MARKER = "i18n";

// `translate="no"` is the standard HTML marker for content that must not be translated. It also covers descendants.
const IGNORE_ATTR = "translate";
const IGNORE_VALUE = "no";

type JSXIdentifierNode = Extract<JSXAttribute["name"], { type: "JSXIdentifier" }>;

// Attribute strings are decoded like JSX text, so `title="A &amp; B"` yields the same source as Babel did.
function attributeText(value: JSXAttribute["value"]): string | undefined {
  return isStringLiteral(value) ? decodeJsxEntities(value.value) : undefined;
}

function textOf(node: JSXText): string {
  return decodeJsxEntities(node.value);
}

function hasIgnoreMarker(opening: JSXOpeningElement): boolean {
  return opening.attributes.some(a => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === IGNORE_ATTR && attributeText(a.value) === IGNORE_VALUE);
}

// Only intrinsic elements (lowercase DOM tags) carry copy; capitalised components receive data as children or props.
function isExtractableTag(name: JSXOpeningElement["name"]): name is JSXIdentifierNode {
  return name.type === "JSXIdentifier" && !COMPONENT_TAG.test(name.name) && !IGNORED_TAGS.has(name.name);
}

// Only side-effect-free references can become placeholders, so moving them inside a translated sentence is safe.
function placeholderExpressionName(expression: Node): string | undefined {
  if (expression.type === "Identifier") return expression.name;
  if (expression.type === "MemberExpression" && !expression.computed && expression.property.type === "Identifier") {
    const object = placeholderExpressionName(expression.object);
    return object ? `${object}.${expression.property.name}` : undefined;
  }
  return undefined;
}

const isFunction = (node: Node, parent: Node | undefined): boolean => {
  if (node.type === "FunctionExpression") {
    // Methods are not function expressions in Babel, so they are skipped here to keep component names identical.
    const isMethod = parent?.type === "MethodDefinition" || (parent?.type === "Property" && (parent.method || parent.kind !== "init"));
    return !isMethod;
  }
  return node.type === "FunctionDeclaration" || node.type === "ArrowFunctionExpression";
};

function lastIndexWhere(nodes: Node[], predicate: (node: Node) => boolean): number {
  for (let i = nodes.length - 1; i >= 0; i--) if (predicate(nodes[i])) return i;
  return -1;
}

// True when the node or any ancestor element is marked with translate="no". `chain` runs from the root to the node.
function isMarkedUntranslated(chain: Node[]): boolean {
  return chain.some(node => {
    const opening = node.type === "JSXOpeningElement" ? node : node.type === "JSXElement" ? node.openingElement : undefined;
    return opening !== undefined && hasIgnoreMarker(opening);
  });
}

function elementContext(opening: JSXOpeningElement, tag: string, attr?: string): string {
  const attrs = opening.attributes
    .filter((a): a is JSXAttribute => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && ["aria-label", "title", "name", "type", "role"].includes(a.name.name))
    .map(a => `${(a.name as JSXIdentifierNode).name}=${attributeText(a.value) ?? "{expr}"}`)
    .sort().join(";");
  // Only the presence of a handler is recorded: renaming the function it points at should not change the identity.
  const handlers = opening.attributes
    .filter((a): a is JSXAttribute => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && /^on[A-Z]/.test(a.name.name))
    .map(a => (a.name as JSXIdentifierNode).name)
    .sort().join(",");
  return [tag, attr ?? "", attrs, handlers].filter(Boolean).join(" | ");
}

export function extractMessages(code: string, filename: string, options: ExtractOptions = {}): ExtractedMessage[] {
  const { program, commentsByEnd } = parseSource(code, filename);
  const found: ExtractedMessage[] = [];
  const componentPropsFor = (tag: string): readonly string[] =>
    Object.prototype.hasOwnProperty.call(options.componentProps ?? {}, tag) ? options.componentProps![tag] : [];

  // `ancestors` runs from the root to the parent of the node being inspected, so the enclosing function's parent is one step back.
  function componentName(ancestors: Node[]): string {
    let index = ancestors.length - 1;
    while (index >= 0 && !isFunction(ancestors[index], ancestors[index - 1])) index--;
    if (index < 0) return "<module>";
    const fn = ancestors[index];
    const parent = ancestors[index - 1];
    if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") return parent.id.name;
    if (fn.type === "FunctionDeclaration" && fn.id) return fn.id.name;
    return "<anonymous>";
  }

  function visitElement(node: JSXElement, ancestors: Node[]): void {
    if (isMarkedUntranslated([...ancestors, node])) return;
    const children = node.children;
    const expressions = children.filter((child): child is JSXExpressionContainer => child.type === "JSXExpressionContainer");
    if (!expressions.length) return;
    if (children.some(child => child.type !== "JSXText" && child.type !== "JSXExpressionContainer")) return;
    if (!expressions.every(child => placeholderExpressionName(child.expression) !== undefined)) return;
    if (!children.some(child => child.type === "JSXText" && /[A-Za-z]/.test(textOf(child)))) return;
    const rawTag = node.openingElement.name;
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
    for (const child of children) raw += child.type === "JSXText" ? textOf(child) : `{${names[index++]}}`;
    const source = normalizeSource(raw);
    if (!source) return;
    const tag = rawTag.name;
    const item: ExtractedMessage = {
      source, prefix: raw.match(/^\s*/)?.[0] ?? "", suffix: raw.match(/\s*$/)?.[0] ?? "",
      kind: "mixed", placeholders: names, file: filename, start: node.start, end: node.end,
      tag, component: componentName(ancestors), context: elementContext(node.openingElement, tag), fingerprint: ""
    };
    item.fingerprint = createFingerprint(item);
    found.push(item);
  }

  function visitText(node: JSXText, ancestors: Node[]): void {
    if (isMarkedUntranslated([...ancestors, node])) return;
    const raw = textOf(node);
    const source = normalizeSource(raw);
    if (!source) return;
    const elementIndex = lastIndexWhere(ancestors, ancestor => ancestor.type === "JSXElement");
    if (elementIndex < 0) return;
    const element = ancestors[elementIndex] as JSXElement;
    // Mixed-content elements are handled as a whole by the JSXElement visitor, never fragment by fragment.
    if (element.children.some(child => child.type === "JSXExpressionContainer")) return;
    const rawTag = element.openingElement.name;
    // Text inside components is data supplied by the caller, not UI copy written here.
    if (!isExtractableTag(rawTag)) return;
    const tag = rawTag.name;
    const item: ExtractedMessage = {
      source, prefix: raw.match(/^\s*/)?.[0] ?? "", suffix: raw.match(/\s*$/)?.[0] ?? "",
      kind: "text", file: filename, start: node.start, end: node.end, tag,
      component: componentName(ancestors.slice(0, elementIndex)), context: elementContext(element.openingElement, tag), fingerprint: ""
    };
    item.fingerprint = createFingerprint(item);
    found.push(item);
  }

  function visitAttribute(node: JSXAttribute, ancestors: Node[]): void {
    if (node.name.type !== "JSXIdentifier") return;
    const attribute = node.name.name;
    const opening = ancestors[ancestors.length - 1];
    if (opening?.type !== "JSXOpeningElement") return;
    const tag = opening.name.type === "JSXIdentifier" ? opening.name.name : "";
    // Components only expose the attributes listed for them in `componentProps`; intrinsic elements use the built-in set.
    const allowed = isExtractableTag(opening.name)
      ? TRANSLATABLE_ATTRS.has(attribute)
      : componentPropsFor(tag).includes(attribute);
    if (!allowed) return;
    if (isMarkedUntranslated([...ancestors, node])) return;
    if (!isStringLiteral(node.value)) return;
    const source = normalizeSource(decodeJsxEntities(node.value.value));
    if (!source || !/[A-Za-z]/.test(source)) return;
    const elementIndex = lastIndexWhere(ancestors, ancestor => ancestor.type === "JSXElement");
    if (elementIndex < 0) return;
    const element = ancestors[elementIndex] as JSXElement;
    const item: ExtractedMessage = {
      source, kind: "attribute", file: filename, start: node.value.start, end: node.value.end, tag,
      component: componentName(ancestors.slice(0, elementIndex)), attribute, context: elementContext(element.openingElement, tag, attribute), fingerprint: ""
    };
    item.fingerprint = createFingerprint(item);
    found.push(item);
  }

  function visitString(node: Node, ancestors: Node[]): void {
    if (!isStringLiteral(node)) return;
    if (ancestors[ancestors.length - 1]?.type === "JSXAttribute") return;
    // Babel attaches a leading comment to the outermost node starting at that offset, so `/* i18n */ "a" + "b"` marks the sum, not "a".
    if (ancestors.some(ancestor => ancestor.start === node.start)) return;
    if (!hasLeadingBlockComment(code, commentsByEnd, node.start, STRING_MARKER)) return;
    const source = normalizeSource(node.value);
    if (!source || !/[A-Za-z]/.test(source)) return;
    const item: ExtractedMessage = { source, kind: "string", file: filename, start: node.start, end: node.end, tag: "", component: componentName(ancestors), context: "", fingerprint: "" };
    item.fingerprint = createFingerprint(item);
    found.push(item);
  }

  walk(program, (node, ancestors) => {
    switch (node.type) {
      case "JSXElement": return visitElement(node, ancestors);
      case "JSXText": return visitText(node, ancestors);
      case "JSXAttribute": return visitAttribute(node, ancestors);
      case "Literal": return visitString(node, ancestors);
    }
  });
  return found.sort((a, b) => a.start - b.start);
}
