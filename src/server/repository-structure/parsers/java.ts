import { StructureBuilder, TopLevelRegistry, cleanSignature, nodeRange, qualify } from "../builder";
import { type Node, parseWithGrammar } from "../tree-sitter-runtime";
import type { NormalizedStructure, ParseResult, ParserAdapter, SymbolKind, Visibility } from "../types";

// Java structure extraction.
//
// WHAT IS EXTRACTED: a MODULE symbol for the compilation unit (the file; it CONTAINS every top-level type);
// classes, records (as CLASS), interfaces, enums; their constructors, methods, fields (a `static final` field and
// every interface constant is a CONSTANT, other fields are VARIABLE) and nested types; `import` declarations as
// MODULE symbols that the file IMPORTS (not resolved to files). Qualified names are the package (from the
// `package` declaration) plus the scope chain. EXTENDS / IMPLEMENTS only when the target is a top-level type of
// the SAME file with an unambiguous name.
// NOT EXTRACTED: enum constants, local and anonymous classes, annotation declarations, lambdas, calls,
// references (CALLS / REFERENCES are never emitted).
//
// Visibility follows the language: public / private / protected as written; no modifier means PACKAGE, except
// that members and nested types of an interface are public.

type Scope = {
  parent: number;
  chain: string[];
  topLevel: boolean;
  inInterface: boolean;
};

type Heritage = { source: number; sourceKind: SymbolKind; kind: "extends" | "implements"; target: string };

const TYPE_KINDS: Record<string, SymbolKind> = {
  class_declaration: "CLASS",
  record_declaration: "CLASS",
  interface_declaration: "INTERFACE",
  enum_declaration: "ENUM",
};

function modifierKeywords(node: Node): string[] {
  const modifiers = node.namedChildren.find((child) => child.type === "modifiers");
  if (!modifiers) return [];
  return modifiers.children.filter((child) => child.type !== "marker_annotation" && child.type !== "annotation").map((child) => child.type);
}

function visibilityOf(keywords: readonly string[], inInterface: boolean): Visibility {
  if (keywords.includes("public")) return "PUBLIC";
  if (keywords.includes("private")) return "PRIVATE";
  if (keywords.includes("protected")) return "PROTECTED";
  return inInterface ? "PUBLIC" : "PACKAGE";
}

function typeName(node: Node): string | null {
  if (node.type === "type_identifier") return node.text;
  if (node.type === "generic_type") {
    const first = node.namedChildren.find((child) => child.type === "type_identifier");
    return first ? first.text : null;
  }
  return null;
}

function typeListNames(list: Node | null | undefined): string[] {
  if (!list) return [];
  const container = list.type === "type_list" ? list : list.namedChildren.find((child) => child.type === "type_list");
  if (!container) return [];
  return container.namedChildren.map(typeName).filter((name): name is string => name !== null);
}

function extractJava(root: Node, path: string): NormalizedStructure {
  const builder = new StructureBuilder();
  const topLevel = new TopLevelRegistry();
  const heritage: Heritage[] = [];

  const packageNode = root.namedChildren.find((child) => child.type === "package_declaration");
  const packageName = packageNode?.namedChildren.find((child) => child.type === "scoped_identifier" || child.type === "identifier")?.text ?? null;

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

  function declare(
    node: Node,
    kind: SymbolKind,
    name: string,
    scope: Scope,
    visibility: Visibility,
    signature: string | null = null,
  ): number | null {
    const index = builder.addSymbol({
      name,
      kind,
      qualifiedName: qualify(packageName, [...scope.chain, name]),
      signature,
      visibility,
      range: nodeRange(node),
    });
    if (index === null) return null;
    builder.relate(scope.parent, index, "CONTAINS");
    if (scope.topLevel) topLevel.register(name, { index, kind });
    return index;
  }

  function addImport(node: Node): void {
    const target = node.namedChildren.find((child) => child.type === "scoped_identifier" || child.type === "identifier");
    if (!target) return;
    const hasWildcard = node.namedChildren.some((child) => child.type === "asterisk");
    const index = builder.addSymbol({
      name: hasWildcard ? `${target.text}.*` : target.text,
      kind: "MODULE",
      qualifiedName: null,
      signature: null,
      visibility: "UNKNOWN",
      range: nodeRange(node),
    });
    if (index !== null) builder.relate(file!, index, "IMPORTS");
  }

  function methodSignature(node: Node, name: string, isConstructor: boolean): string | null {
    const keywords = modifierKeywords(node).join(" ");
    const typeParameters = node.childForFieldName("type_parameters")?.text ?? "";
    const returnType = isConstructor ? "" : (node.childForFieldName("type")?.text ?? "");
    const parameters = node.childForFieldName("parameters")?.text ?? "()";
    const throwsClause = node.children.find((child) => child.type === "throws")?.text ?? "";
    return cleanSignature(`${keywords} ${typeParameters} ${returnType} ${name}${parameters} ${throwsClause}`);
  }

  function typeDeclaration(node: Node, scope: Scope): void {
    const kind = TYPE_KINDS[node.type];
    if (!kind) return;
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = nameNode.text;
    const keywords = modifierKeywords(node);
    const index = declare(node, kind, name, scope, visibilityOf(keywords, scope.inInterface));
    if (index === null) return;

    if (kind === "INTERFACE") {
      const extendsNode = node.namedChildren.find((child) => child.type === "extends_interfaces");
      for (const target of typeListNames(extendsNode)) heritage.push({ source: index, sourceKind: kind, kind: "extends", target });
    } else {
      const superclass = node.childForFieldName("superclass");
      const base = superclass?.namedChildren[0];
      const baseName = base ? typeName(base) : null;
      if (baseName) heritage.push({ source: index, sourceKind: kind, kind: "extends", target: baseName });
      for (const target of typeListNames(node.childForFieldName("interfaces"))) {
        heritage.push({ source: index, sourceKind: kind, kind: "implements", target });
      }
    }

    const body = node.childForFieldName("body");
    if (!body) return;
    const inner: Scope = { parent: index, chain: [...scope.chain, name], topLevel: false, inInterface: kind === "INTERFACE" };
    const members = body.namedChildren.flatMap((child) => (child.type === "enum_body_declarations" ? child.namedChildren : [child]));
    for (const member of members) memberDeclaration(member, inner);
  }

  function memberDeclaration(member: Node, scope: Scope): void {
    switch (member.type) {
      case "method_declaration":
      case "constructor_declaration":
      case "compact_constructor_declaration": {
        const nameNode = member.childForFieldName("name");
        if (!nameNode) return;
        const isConstructor = member.type !== "method_declaration";
        declare(
          member,
          isConstructor ? "CONSTRUCTOR" : "METHOD",
          nameNode.text,
          scope,
          visibilityOf(modifierKeywords(member), scope.inInterface),
          methodSignature(member, nameNode.text, isConstructor),
        );
        return;
      }
      case "field_declaration":
      case "constant_declaration": {
        const keywords = modifierKeywords(member);
        const isConstant = member.type === "constant_declaration" || (keywords.includes("static") && keywords.includes("final"));
        for (const declarator of member.namedChildren.filter((child) => child.type === "variable_declarator")) {
          const nameNode = declarator.childForFieldName("name");
          if (nameNode) declare(declarator, isConstant ? "CONSTANT" : "VARIABLE", nameNode.text, scope, visibilityOf(keywords, scope.inInterface));
        }
        return;
      }
      case "class_declaration":
      case "record_declaration":
      case "interface_declaration":
      case "enum_declaration":
        typeDeclaration(member, scope);
        return;
      default:
        return;
    }
  }

  const fileScope: Scope = { parent: file, chain: [], topLevel: true, inInterface: false };
  for (const node of root.namedChildren) {
    if (node.type === "import_declaration") addImport(node);
    else if (TYPE_KINDS[node.type]) typeDeclaration(node, fileScope);
  }

  for (const edge of heritage) {
    const allowed: SymbolKind[] =
      edge.kind === "implements" ? ["INTERFACE"] : edge.sourceKind === "INTERFACE" ? ["INTERFACE"] : ["CLASS"];
    const target = topLevel.resolve(edge.target, allowed);
    if (target !== null) builder.relate(edge.source, target, edge.kind === "extends" ? "EXTENDS" : "IMPLEMENTS");
  }
  return builder.toStructure();
}

export const javaAdapter: ParserAdapter = {
  id: "java",
  async parse({ path, source }): Promise<ParseResult> {
    const parsed = await parseWithGrammar("java", source, (root) => extractJava(root, path));
    return parsed.ok ? { ok: true, structure: parsed.value } : { ok: false, error: parsed.error };
  },
};
