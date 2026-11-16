import { type ESTree, parseSync } from "rolldown/utils";

export type Node = ESTree.Node;
export type StringLiteral = ESTree.StringLiteral;
export type CallExpression = ESTree.CallExpression;
export type JSXElement = ESTree.JSXElement;
export type JSXText = ESTree.JSXText;
export type JSXAttribute = ESTree.JSXAttribute;
export type JSXExpressionContainer = ESTree.JSXExpressionContainer;
export type JSXOpeningElement = ESTree.JSXOpeningElement;

/** Nodes from the root down to a node's parent, in order. */
export type Ancestors = Node[];
/** Callback invoked by {@link walk} for every node, with its ancestors. Returning `false` skips the node's children. */
export type Visitor = (node: Node, ancestors: Ancestors) => void | boolean;

/** A parsed module, ready for AST traversal. */
export interface ParsedSource {
  program: Node;
}

/**
 * Parses TSX source with oxc. Both module and script syntax are accepted.
 *
 * @throws SyntaxError with the file name and the first parser error.
 */
export function parseSource(code: string, filename: string): ParsedSource {
  const result = parseSync(filename, code, { lang: "tsx", sourceType: "unambiguous" });
  if (result.errors.length) throw new SyntaxError(`${filename}: ${result.errors[0].message}`);
  return { program: result.program };
}

/** Pre-order traversal that also hands the visitor the chain of ancestors, from the root down to the parent. */
export function walk(root: Node, visit: Visitor): void {
  const ancestors: Ancestors = [];
  const visitNode = (node: Node): void => {
    if (visit(node, ancestors) === false) return;
    ancestors.push(node);
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const value: unknown = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) value.forEach((child) => isNode(child) && visitNode(child));
      else if (isNode(value)) visitNode(value);
    }
    ancestors.pop();
  };
  visitNode(root);
}

/** Distinguishes AST nodes from other object values by the presence of a string `type`. */
function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** Other literal kinds (numbers, regexes, ...) share the `Literal` type, so the value is checked as well. */
export function isStringLiteral(node: unknown): node is StringLiteral {
  return isNode(node) && node.type === "Literal" && typeof (node as { value?: unknown }).value === "string";
}
