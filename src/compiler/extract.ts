import { createFingerprint } from "../identity/fingerprint.js";
import type { ExtractedMessage } from "../types.js";
import { isStringLiteral, type Node, type ParsedSource, parseSource, walk } from "./ast.js";
import { normalizeSource } from "./normalize.js";
import { RUNTIME_MODULE } from "./transform.js";

// `t("...")` imported from the runtime module marks a string for translation.
const TRANSLATE_FN = "t";

const hasLetter = (text: string): boolean => /[A-Za-z]/.test(text);

/**
 * Local names bound to `t` by imports from the runtime module. Only calls through these bindings are extracted, so an
 * unrelated `t()` from another library is left alone.
 */
function translateBindings(program: Node): Set<string> {
  const names = new Set<string>();
  if (program.type !== "Program") return names;
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== RUNTIME_MODULE) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      const imported = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
      if (imported === TRANSLATE_FN) names.add(specifier.local.name);
    }
  }
  return names;
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

/**
 * Finds `t("...")` calls in a module, where `t` is imported from the runtime module and the only argument is a string
 * literal containing letters. The calls stay in the source; the transform replaces them later.
 *
 * @param code Source text of the module.
 * @param filename Used for parsing and recorded on each message.
 * @param parsed The module's AST, when the caller already has it.
 * @returns The extracted messages, sorted by their start offset in `code`.
 * @throws SyntaxError if `code` cannot be parsed.
 */
export function extractMessages(
  code: string,
  filename: string,
  parsed: ParsedSource = parseSource(code, filename),
): ExtractedMessage[] {
  const { program } = parsed;
  const translateNames = translateBindings(program);
  const found: ExtractedMessage[] = [];
  walk(program, (node, ancestors) => {
    if (node.type !== "CallExpression" || node.callee.type !== "Identifier") return;
    if (!translateNames.has(node.callee.name) || node.arguments.length !== 1) return;
    const [argument] = node.arguments;
    if (!isStringLiteral(argument)) return;
    const source = normalizeSource(argument.value);
    if (!source || !hasLetter(source)) return;
    found.push({
      source,
      file: filename,
      start: node.start,
      end: node.end,
      component: componentName(ancestors),
      fingerprint: createFingerprint({ source }),
    });
  });
  return found.sort((a, b) => a.start - b.start);
}
