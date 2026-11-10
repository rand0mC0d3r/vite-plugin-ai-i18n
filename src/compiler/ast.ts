import { parseSync, type Comment, type Node, type StringLiteral } from "oxc-parser";

export type Ancestors = Node[];
export type Visitor = (node: Node, ancestors: Ancestors) => void;

export interface ParsedSource {
  program: Node;
  /** Indexed by end offset, so the comment directly before a node is a single lookup. */
  commentsByEnd: Map<number, Comment>;
}

export function parseSource(code: string, filename: string): ParsedSource {
  const result = parseSync(filename, code, { lang: "tsx", sourceType: "unambiguous" });
  if (result.errors.length) throw new SyntaxError(`${filename}: ${result.errors[0].message}`);
  return { program: result.program, commentsByEnd: new Map(result.comments.map(comment => [comment.end, comment])) };
}

/** Pre-order traversal that also hands the visitor the chain of ancestors, from the root down to the parent. */
export function walk(root: Node, visit: Visitor): void {
  const ancestors: Ancestors = [];
  const visitNode = (node: Node): void => {
    visit(node, ancestors);
    ancestors.push(node);
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const value: unknown = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) value.forEach(child => isNode(child) && visitNode(child));
      else if (isNode(value)) visitNode(value);
    }
    ancestors.pop();
  };
  visitNode(root);
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** Other literal kinds (numbers, regexes, ...) share the `Literal` type, so the value is checked as well. */
export function isStringLiteral(node: unknown): node is StringLiteral {
  return isNode(node) && node.type === "Literal" && typeof (node as { value?: unknown }).value === "string";
}

/**
 * Mirrors Babel's `leadingComments` check: walks back from `start` over whitespace and comments and reports
 * whether a block comment with `value` sits directly before it.
 */
export function hasLeadingBlockComment(code: string, commentsByEnd: Map<number, Comment>, start: number, value: string): boolean {
  let position = start;
  for (;;) {
    let end = position;
    while (end > 0 && /\s/.test(code[end - 1])) end--;
    const comment = commentsByEnd.get(end);
    if (!comment) return false;
    if (comment.type === "Block" && comment.value.trim() === value) return true;
    position = comment.start;
  }
}
