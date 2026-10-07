import { StructureBuilder, TopLevelRegistry, cleanSignature, nodeRange, normalizeWhitespace, qualify } from "../builder";
import { type Node, parseWithGrammar } from "../tree-sitter-runtime";
import type { NormalizedStructure, ParseResult, ParserAdapter, SymbolKind } from "../types";

// Python structure extraction.
//
// WHAT IS EXTRACTED: a MODULE symbol for the file (it CONTAINS every module-level symbol); classes; functions;
// methods (a function defined directly in a class body, including `__init__`, which is reported as a METHOD);
// nested classes/functions; module- and class-level `name = value` / `name: T = value` as VARIABLE; PEP 695
// `type X = ...` as TYPE; `import` / `from ... import` as MODULE symbols that the file IMPORTS (not resolved to
// files). EXTENDS only for a plain-name base class defined at module level in the SAME file.
// NOT EXTRACTED: local variables, tuple targets, definitions nested inside if/try/with/for blocks, calls,
// references. Python has no visibility or constant keywords, so visibility is always UNKNOWN and nothing is
// classified CONSTANT from an UPPER_CASE name (that would be a naming-convention guess).
//
// Qualified names are the scope chain inside the file (`A.method`); the dotted module path is not derived from
// the file path because package roots are not reliably known.

type Scope = {
  parent: number;
  chain: string[];
  kind: "module" | "class" | "function";
};

type Heritage = { source: number; target: string };

// The Python grammar tolerates a definition with NO body (`def f():` followed by nothing) and reports it as a
// valid tree containing a zero-width `block`, with no error node. Real Python rejects that (IndentationError),
// and a valid block always has at least one statement, so a zero-width block is treated as a syntax error.
function firstEmptyBlockLine(root: Node): number | null {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "block" && node.startIndex === node.endIndex) return node.startPosition.row + 1;
    for (let i = node.childCount - 1; i >= 0; i--) stack.push(node.child(i)!);
  }
  return null;
}

function extractPython(root: Node, path: string): NormalizedStructure {
  const emptyBlockLine = firstEmptyBlockLine(root);
  if (emptyBlockLine !== null) throw new Error(`Syntax error near line ${emptyBlockLine}: a block has no body.`);

  const builder = new StructureBuilder();
  const topLevel = new TopLevelRegistry();
  const heritage: Heritage[] = [];

  const fileName = path.length <= 500 ? path : path.slice(path.lastIndexOf("/") + 1);
  const file = builder.addSymbol({
    name: fileName,
    kind: "MODULE",
    qualifiedName: null,
    signature: null,
    visibility: "UNKNOWN",
    range: nodeRange(root),
  });
  if (file === null) throw new Error("The file name cannot be stored.");

  function declare(node: Node, kind: SymbolKind, name: string, scope: Scope, signature: string | null = null): number | null {
    const index = builder.addSymbol({
      name,
      kind,
      qualifiedName: qualify(null, [...scope.chain, name]),
      signature,
      visibility: "UNKNOWN",
      range: nodeRange(node),
    });
    if (index === null) return null;
    builder.relate(scope.parent, index, "CONTAINS");
    if (scope.kind === "module") topLevel.register(name, { index, kind });
    return index;
  }

  function addImport(node: Node, moduleName: string): void {
    if (moduleName.length === 0) return;
    const index = builder.addSymbol({
      name: moduleName,
      kind: "MODULE",
      qualifiedName: null,
      signature: null,
      visibility: "UNKNOWN",
      range: nodeRange(node),
    });
    if (index !== null) builder.relate(file!, index, "IMPORTS");
  }

  function walk(nodes: readonly Node[], scope: Scope): void {
    for (const node of nodes) statement(node, scope);
  }

  function statement(node: Node, scope: Scope): void {
    switch (node.type) {
      case "import_statement":
        if (scope.kind === "function") return;
        for (const item of node.namedChildren) {
          const target = item.type === "aliased_import" ? item.childForFieldName("name") : item;
          if (target && target.type === "dotted_name") addImport(item, target.text);
        }
        return;
      case "import_from_statement": {
        if (scope.kind === "function") return;
        const moduleName = node.childForFieldName("module_name");
        if (moduleName) addImport(node, normalizeWhitespace(moduleName.text)); // `.`, `.models`, `a.b`
        return;
      }
      case "decorated_definition": {
        const definition = node.childForFieldName("definition");
        if (definition) statement(definition, scope);
        return;
      }
      case "class_definition": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) return;
        const name = nameNode.text;
        const index = declare(node, "CLASS", name, scope);
        if (index === null) return;
        const bases = node.childForFieldName("superclasses");
        if (bases) {
          for (const base of bases.namedChildren) {
            if (base.type === "identifier") heritage.push({ source: index, target: base.text });
          }
        }
        const body = node.childForFieldName("body");
        if (body) walk(body.namedChildren, { parent: index, chain: [...scope.chain, name], kind: "class" });
        return;
      }
      case "function_definition": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) return;
        const name = nameNode.text;
        const isAsync = node.children.some((child) => child.type === "async");
        const typeParameters = node.childForFieldName("type_parameters")?.text ?? "";
        const parameters = node.childForFieldName("parameters")?.text ?? "()";
        const returnType = node.childForFieldName("return_type");
        const signature = cleanSignature(
          `${isAsync ? "async " : ""}def ${name}${typeParameters}${parameters}${returnType ? ` -> ${returnType.text}` : ""}`,
        );
        const index = declare(node, scope.kind === "class" ? "METHOD" : "FUNCTION", name, scope, signature);
        const body = node.childForFieldName("body");
        if (index !== null && body) walk(body.namedChildren, { parent: index, chain: [...scope.chain, name], kind: "function" });
        return;
      }
      case "expression_statement": {
        if (scope.kind === "function") return; // local variables are not extracted
        const assignment = node.namedChild(0);
        if (!assignment || assignment.type !== "assignment") return;
        const left = assignment.childForFieldName("left");
        if (left && left.type === "identifier") declare(assignment, "VARIABLE", left.text, scope);
        return;
      }
      case "type_alias_statement": {
        if (scope.kind === "function") return;
        const left = node.childForFieldName("left");
        const identifier = left?.namedChildren.find((child) => child.type === "identifier");
        if (identifier) declare(node, "TYPE", identifier.text, scope);
        return;
      }
      default:
        return;
    }
  }

  walk(root.namedChildren, { parent: file, chain: [], kind: "module" });

  for (const edge of heritage) {
    const target = topLevel.resolve(edge.target, ["CLASS"]);
    if (target !== null) builder.relate(edge.source, target, "EXTENDS");
  }
  return builder.toStructure();
}

export const pythonAdapter: ParserAdapter = {
  id: "python",
  async parse({ path, source }): Promise<ParseResult> {
    const parsed = await parseWithGrammar("python", source, (root) => extractPython(root, path));
    return parsed.ok ? { ok: true, structure: parsed.value } : { ok: false, error: parsed.error };
  },
};
