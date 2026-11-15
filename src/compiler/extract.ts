import { argumentName, escapeIcu } from "../icu.js";
import { createFingerprint } from "../identity/fingerprint.js";
import type { ExtractedMessage } from "../types.js";
import {
  hasLeadingBlockComment,
  isStringLiteral,
  type JSXAttribute,
  type JSXElement,
  type JSXExpressionContainer,
  type JSXOpeningElement,
  type JSXText,
  type Node,
  type ParsedSource,
  parseSource,
  walk,
} from "./ast.js";
import { decodeJsxEntities } from "./entities.js";
import { normalizeSource } from "./normalize.js";

/** Matches a tag or component name that starts with an uppercase letter, i.e. a React component. */
const COMPONENT_TAG = /^[A-Z]/;
/** Tags whose text is never translated. */
const IGNORED_TAGS = new Set(["script", "style", "code", "pre"]);
// Pseudo-prop in `componentProps` that opts a capitalised component's literal children into translation.
const CHILDREN_PROP = "children";
// Attributes whose string values are user-facing copy. Others (href, type, variant, src, ...) are code or configuration.
const TRANSLATABLE_ATTRS = new Set([
  "alt",
  "title",
  "placeholder",
  "label",
  "summary",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
]);
// A block comment directly before a string literal opts that literal into translation, for copy outside JSX.
const DEFAULT_STRING_MARKER = "i18n";
// `translate="no"` is the standard HTML marker for content that must not be translated. It also covers descendants.
const IGNORE_ATTR = "translate";
const IGNORE_VALUE = "no";

/** Options that tune which JSX and string literals are extracted. */
export interface ExtractOptions {
  /**
   * Attributes of custom components whose string values are UI copy, keyed by component name. The pseudo-prop
   * `children` also makes the component's text children translatable, for example `{ Button: ["children"] }`.
   */
  componentProps?: Record<string, readonly string[]> | undefined;
  /** Block-comment text that marks a string literal for translation. Default `i18n`. */
  stringMarker?: string | undefined;
}

/** A plain JSX identifier used as an element name or attribute name. */
type JSXIdentifierNode = Extract<JSXAttribute["name"], { type: "JSXIdentifier" }>;

/** Attribute strings are decoded like JSX text, so `title="A &amp; B"` yields the same source as Babel did. */
function attributeText(value: JSXAttribute["value"]): string | undefined {
  return isStringLiteral(value) ? decodeJsxEntities(value.value) : undefined;
}

/** Raw text of a JSX text node with character references decoded. */
function textOf(node: JSXText): string {
  return decodeJsxEntities(node.value);
}

/** Leading and trailing whitespace of a raw text run, so the translation can be wrapped in the same spacing. */
function edgeWhitespace(raw: string): { prefix: string; suffix: string } {
  return { prefix: raw.match(/^\s*/)?.[0] ?? "", suffix: raw.match(/\s*$/)?.[0] ?? "" };
}

const hasLetter = (text: string): boolean => /[A-Za-z]/.test(text);

/** True when the element carries `translate="no"`, which excludes it and its subtree from extraction. */
function hasIgnoreMarker(opening: JSXOpeningElement): boolean {
  return opening.attributes.some(
    (a) =>
      a.type === "JSXAttribute" &&
      a.name.type === "JSXIdentifier" &&
      a.name.name === IGNORE_ATTR &&
      attributeText(a.value) === IGNORE_VALUE,
  );
}

/**
 * Only intrinsic elements (lowercase DOM tags) carry copy by default; capitalised components need `children` in
 * `componentProps`.
 */
function isExtractableTag(name: JSXOpeningElement["name"]): name is JSXIdentifierNode {
  return name.type === "JSXIdentifier" && !COMPONENT_TAG.test(name.name) && !IGNORED_TAGS.has(name.name);
}

/** Only side-effect-free references can become placeholders, so moving them inside a translated sentence is safe. */
function placeholderExpressionName(expression: Node): string | undefined {
  if (expression.type === "Identifier") return expression.name;
  if (expression.type === "MemberExpression" && !expression.computed && expression.property.type === "Identifier") {
    const object = placeholderExpressionName(expression.object);
    return object !== undefined ? `${object}.${expression.property.name}` : undefined;
  }
  return undefined;
}

const isFunction = (node: Node, parent: Node | undefined): boolean => {
  if (node.type === "FunctionExpression") {
    // Methods are not function expressions in Babel, so they are skipped here to keep component names identical.
    const isMethod =
      parent?.type === "MethodDefinition" || (parent?.type === "Property" && (parent.method || parent.kind !== "init"));
    return !isMethod;
  }
  return node.type === "FunctionDeclaration" || node.type === "ArrowFunctionExpression";
};

/** Index of the last node that satisfies `predicate`, or -1 if none does. */
function lastIndexWhere(nodes: Node[], predicate: (node: Node) => boolean): number {
  for (let i = nodes.length - 1; i >= 0; i--) if (predicate(nodes[i])) return i;
  return -1;
}

/** Index and element of the innermost JSX element among `ancestors`, or undefined when there is none. */
function nearestElement(ancestors: Node[]): { index: number; element: JSXElement } | undefined {
  const index = lastIndexWhere(ancestors, (ancestor) => ancestor.type === "JSXElement");
  return index < 0 ? undefined : { index, element: ancestors[index] as JSXElement };
}

/** True when the node or any ancestor element is marked with translate="no". `chain` runs from the root to the node. */
function isMarkedUntranslated(chain: Node[]): boolean {
  return chain.some((node) => {
    if (node.type === "JSXOpeningElement") return hasIgnoreMarker(node);
    if (node.type === "JSXElement") return hasIgnoreMarker(node.openingElement);
    return false;
  });
}

/**
 * Builds the identity context for a message: tag, the attribute being extracted (if any), a sorted summary of
 * identifying attributes, and the handler names. Attribute values that are expressions are recorded as `{expr}`.
 */
function elementContext(opening: JSXOpeningElement, tag: string, attr?: string): string {
  const attrs = opening.attributes
    .filter(
      (a): a is JSXAttribute =>
        a.type === "JSXAttribute" &&
        a.name.type === "JSXIdentifier" &&
        ["aria-label", "title", "name", "type", "role"].includes(a.name.name),
    )
    .map((a) => `${(a.name as JSXIdentifierNode).name}=${attributeText(a.value) ?? "{expr}"}`)
    .sort()
    .join(";");
  // Only the presence of a handler is recorded: renaming the function it points at should not change the identity.
  const handlers = opening.attributes
    .filter(
      (a): a is JSXAttribute =>
        a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && /^on[A-Z]/.test(a.name.name),
    )
    .map((a) => (a.name as JSXIdentifierNode).name)
    .sort()
    .join(",");
  return [tag, attr ?? "", attrs, handlers].filter(Boolean).join(" | ");
}

/**
 * Finds translatable copy in a module: mixed-content JSX elements, plain JSX text, translatable JSX attributes, and
 * string literals marked with a leading `/* i18n *\/` comment. Elements marked `translate="no"` are skipped with their
 * whole subtree.
 *
 * @param code Source text of the module.
 * @param filename Used for parsing and recorded on each message.
 * @param options Component props and the string marker to honour.
 * @returns The extracted messages, sorted by their start offset in `code`.
 * @throws SyntaxError if `code` cannot be parsed.
 */
export function extractMessages(
  code: string,
  filename: string,
  options: ExtractOptions = {},
  parsed: ParsedSource = parseSource(code, filename),
): ExtractedMessage[] {
  const { program, commentsByEnd } = parsed;
  const found: ExtractedMessage[] = [];
  /**
   * Stores a message with the fingerprint derived from its identifying fields. `identitySource` is the text the
   * fingerprint hashes, which differs from `item.source` when that text is escaped for ICU.
   */
  const record = (item: Omit<ExtractedMessage, "fingerprint">, identitySource = item.source): void => {
    found.push({ ...item, fingerprint: createFingerprint({ ...item, source: identitySource }) });
  };
  const componentPropsFor = (tag: string): readonly string[] => {
    const props: readonly string[] | undefined = options.componentProps?.[tag];
    return Object.prototype.hasOwnProperty.call(options.componentProps ?? {}, tag) && props !== undefined ? props : [];
  };
  const isTextTag = (name: JSXOpeningElement["name"]): name is JSXIdentifierNode => {
    if (name.type !== "JSXIdentifier") return false;
    const tag = name.name;
    return isExtractableTag(name) || (COMPONENT_TAG.test(tag) && componentPropsFor(tag).includes(CHILDREN_PROP));
  };

  /**
   * `ancestors` runs from the root to the parent of the node being inspected, so the enclosing function's parent is one
   * step back.
   */
  function componentName(ancestors: Node[]): string {
    let index = ancestors.length - 1;
    while (index >= 0 && !isFunction(ancestors[index], ancestors[index - 1])) index--;
    if (index < 0) return "<module>";
    const fn = ancestors[index];
    const parent = index > 0 ? ancestors[index - 1] : undefined;
    if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") return parent.id.name;
    if (fn.type === "FunctionDeclaration" && fn.id) return fn.id.name;
    return "<anonymous>";
  }

  /** Extracts a whole element whose children mix text and `{expression}` placeholders, such as `Hello {name}`. */
  function visitElement(node: JSXElement, ancestors: Node[]): void {
    if (isMarkedUntranslated([...ancestors, node])) return;
    const children = node.children;
    const expressions = children.filter(
      (child): child is JSXExpressionContainer => child.type === "JSXExpressionContainer",
    );
    if (!expressions.length) return;
    if (children.some((child) => child.type !== "JSXText" && child.type !== "JSXExpressionContainer")) return;
    const baseNames: string[] = [];
    for (const child of expressions) {
      const base = placeholderExpressionName(child.expression);
      if (base === undefined) return;
      baseNames.push(base);
    }
    if (!children.some((child) => child.type === "JSXText" && hasLetter(textOf(child)))) return;
    const rawTag = node.openingElement.name;
    if (!isTextTag(rawTag)) return;
    // Names as written in the source, made unique. They identify the message, so they stay out of the ICU text.
    const sourceNames: string[] = [];
    for (const base of baseNames) {
      let name = base;
      for (let suffix = 2; sourceNames.includes(name); suffix++) name = `${base}_${suffix}`;
      sourceNames.push(name);
    }
    // ICU argument names are letters, digits and underscores only, so `user.name` becomes `user_name`.
    const names: string[] = [];
    for (const base of sourceNames) {
      const sanitized = argumentName(base);
      let name = sanitized;
      for (let suffix = 2; names.includes(name); suffix++) name = `${sanitized}_${suffix}`;
      names.push(name);
    }
    let raw = "";
    let icu = "";
    let index = 0;
    for (const child of children) {
      if (child.type === "JSXText") {
        const text = textOf(child);
        raw += text;
        icu += escapeIcu(text);
      } else {
        raw += `{${sourceNames[index]}}`;
        icu += `{${names[index]}}`;
        index++;
      }
    }
    const source = normalizeSource(icu);
    if (!source) return;
    const tag = rawTag.name;
    record(
      {
        source,
        ...edgeWhitespace(raw),
        kind: "mixed",
        placeholders: names,
        file: filename,
        start: node.start,
        end: node.end,
        tag,
        component: componentName(ancestors),
        context: elementContext(node.openingElement, tag),
      },
      normalizeSource(raw),
    );
  }

  /**
   * Extracts a text node that is the only content of a translatable element. Mixed-content elements are left to
   * `visitElement`.
   */
  function visitText(node: JSXText, ancestors: Node[]): void {
    if (isMarkedUntranslated([...ancestors, node])) return;
    const raw = textOf(node);
    const source = normalizeSource(raw);
    if (!source) return;
    const nearest = nearestElement(ancestors);
    if (!nearest) return;
    const { index: elementIndex, element } = nearest;
    // Mixed-content elements are handled as a whole by the JSXElement visitor, never fragment by fragment.
    if (element.children.some((child) => child.type === "JSXExpressionContainer")) return;
    const rawTag = element.openingElement.name;
    if (!isTextTag(rawTag)) return;
    const tag = rawTag.name;
    record({
      source,
      ...edgeWhitespace(raw),
      kind: "text",
      file: filename,
      start: node.start,
      end: node.end,
      tag,
      component: componentName(ancestors.slice(0, elementIndex)),
      context: elementContext(element.openingElement, tag),
    });
  }

  /** Extracts a string-literal attribute whose name is translatable for this element or component. */
  function visitAttribute(node: JSXAttribute, ancestors: Node[]): void {
    if (node.name.type !== "JSXIdentifier") return;
    const attribute = node.name.name;
    const opening = ancestors.at(-1);
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
    if (!source || !hasLetter(source)) return;
    const nearest = nearestElement(ancestors);
    if (!nearest) return;
    const { index: elementIndex, element } = nearest;
    record({
      source,
      kind: "attribute",
      file: filename,
      start: node.value.start,
      end: node.value.end,
      tag,
      component: componentName(ancestors.slice(0, elementIndex)),
      attribute,
      context: elementContext(element.openingElement, tag, attribute),
    });
  }

  /** Extracts a string literal that is preceded by the string marker comment. */
  function visitString(node: Node, ancestors: Node[]): void {
    if (!isStringLiteral(node)) return;
    if (ancestors[ancestors.length - 1]?.type === "JSXAttribute") return;
    // Babel attaches a leading comment to the outermost node starting at that offset, so `/* i18n */ "a" + "b"` marks the sum, not "a".
    if (ancestors.some((ancestor) => ancestor.start === node.start)) return;
    if (!hasLeadingBlockComment(code, commentsByEnd, node.start, options.stringMarker ?? DEFAULT_STRING_MARKER)) return;
    const source = normalizeSource(node.value);
    if (!source || !hasLetter(source)) return;
    record({
      source,
      kind: "string",
      file: filename,
      start: node.start,
      end: node.end,
      tag: "",
      component: componentName(ancestors),
      context: "",
    });
  }

  walk(program, (node, ancestors) => {
    switch (node.type) {
      case "JSXElement":
        return visitElement(node, ancestors);
      case "JSXText":
        return visitText(node, ancestors);
      case "JSXAttribute":
        return visitAttribute(node, ancestors);
      case "Literal":
        return visitString(node, ancestors);
      default:
        return undefined;
    }
  });
  return found.sort((a, b) => a.start - b.start);
}
