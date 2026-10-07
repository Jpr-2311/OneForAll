import { StructureBuilder, TopLevelRegistry, cleanSignature, nodeRange, qualify } from "../builder";
import type { Node } from "../tree-sitter-runtime";
import type { NormalizedStructure, SymbolKind, Visibility } from "../types";

// Shared structure extraction for TypeScript, TSX, JavaScript and JSX syntax trees.
//
// WHAT IS EXTRACTED (and, deliberately, what is not):
//  * a MODULE symbol for the file itself, which CONTAINS every top-level declaration;
//  * classes, interfaces, enums, type aliases, functions, namespaces, and top-level variables/constants
//    (a variable initialised with an arrow/function expression is a FUNCTION);
//  * class members: constructors, methods, accessors, fields; interface method signatures;
//  * imports (`import`, `export ... from`, and a top-level `const x = require("lit")`) as MODULE symbols that the
//    file IMPORTS. They are NOT resolved to other files in the repository.
//  * EXTENDS / IMPLEMENTS only when the target is a top-level class/interface of the SAME file, by unambiguous name.
//  Not extracted: local variables, destructuring, computed/string member names, enum members, interface
//  properties, calls or references (CALLS / REFERENCES are never emitted: they cannot be resolved reliably
//  without type information).
//
// Positions are the declaration node's own range (0-based, end exclusive; for `export class A {}` the range starts
// at `class`, not `export`).

type Scope = {
  parent: number;
  chain: string[];
  topLevel: boolean; // directly in the file (not inside a namespace/class/function)
  insideFunction: boolean; // only function and class declarations are extracted from function bodies
};

type Heritage = {
  source: number;
  sourceKind: SymbolKind;
  kind: "extends" | "implements";
  target: string;
};

const FUNCTION_VALUES = new Set(["arrow_function", "function_expression", "function", "generator_function"]);
const SIMPLE_MEMBER_NAMES = new Set(["property_identifier", "private_property_identifier", "identifier"]);

function typeName(node: Node): string | null {
  if (node.type === "type_identifier" || node.type === "identifier") return node.text;
  if (node.type === "generic_type") {
    const name = node.childForFieldName("name");
    return name && name.type === "type_identifier" ? name.text : null;
  }
  return null;
}

function stringValue(node: Node): string {
  return node.text.length >= 2 ? node.text.slice(1, -1) : "";
}

function functionSignature(node: Node, name: string, prefix = ""): string | null {
  const typeParameters = node.childForFieldName("type_parameters")?.text ?? "";
  const parameters = node.childForFieldName("parameters");
  const bare = node.childForFieldName("parameter"); // `x => x`
  const parameterText = parameters ? parameters.text : bare ? `(${bare.text})` : "()";
  const returnType = node.childForFieldName("return_type")?.text ?? "";
  return cleanSignature(`${prefix}${name}${typeParameters}${parameterText}${returnType}`);
}

function memberVisibility(member: Node, nameNode: Node): Visibility {
  if (nameNode.type === "private_property_identifier") return "PRIVATE"; // `#name` is language-level private
  const modifier = member.children.find((child) => child.type === "accessibility_modifier");
  switch (modifier?.text) {
    case "private":
      return "PRIVATE";
    case "protected":
      return "PROTECTED";
    case "public":
      return "PUBLIC";
    default:
      return "PUBLIC"; // members without a modifier are public by language semantics
  }
}

function accessorPrefix(method: Node): string {
  for (const child of method.children) {
    if (child.type === "get") return "get ";
    if (child.type === "set") return "set ";
  }
  return "";
}

export function extractEcmaScript(root: Node, path: string): NormalizedStructure {
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
      qualifiedName: qualify(null, [...scope.chain, name]),
      signature,
      visibility,
      range: nodeRange(node),
    });
    if (index === null) return null;
    builder.relate(scope.parent, index, "CONTAINS");
    if (scope.topLevel) topLevel.register(name, { index, kind });
    return index;
  }

  function childScope(index: number, name: string, scope: Scope, insideFunction = scope.insideFunction): Scope {
    return { parent: index, chain: [...scope.chain, name], topLevel: false, insideFunction };
  }

  function addImport(node: Node, specifier: string): void {
    if (specifier.length === 0) return;
    const index = builder.addSymbol({
      name: specifier,
      kind: "MODULE",
      qualifiedName: null,
      signature: null,
      visibility: "UNKNOWN",
      range: nodeRange(node),
    });
    if (index !== null) builder.relate(file!, index, "IMPORTS");
  }

  function walk(nodes: readonly Node[], scope: Scope): void {
    for (const node of nodes) statement(node, scope, false);
  }

  function statement(node: Node, scope: Scope, exported: boolean): void {
    const visibility: Visibility = exported ? "PUBLIC" : "UNKNOWN";
    switch (node.type) {
      case "import_statement": {
        const source = node.childForFieldName("source");
        if (source && !scope.insideFunction) addImport(node, stringValue(source));
        return;
      }
      case "export_statement": {
        const source = node.childForFieldName("source");
        if (source && !scope.insideFunction) addImport(node, stringValue(source)); // `export * from "x"`
        const declaration = node.childForFieldName("declaration");
        if (declaration) statement(declaration, scope, true);
        return;
      }
      case "class_declaration":
      case "abstract_class_declaration":
        return classDeclaration(node, scope, visibility);
      case "interface_declaration":
        return interfaceDeclaration(node, scope, visibility);
      case "enum_declaration":
      case "type_alias_declaration": {
        const name = node.childForFieldName("name");
        if (name) declare(node, node.type === "enum_declaration" ? "ENUM" : "TYPE", name.text, scope, visibility);
        return;
      }
      case "function_declaration":
      case "generator_function_declaration": {
        const name = node.childForFieldName("name");
        if (!name) return;
        const index = declare(node, "FUNCTION", name.text, scope, visibility, functionSignature(node, name.text));
        const body = node.childForFieldName("body");
        if (index !== null && body) walk(body.namedChildren, childScope(index, name.text, scope, true));
        return;
      }
      case "lexical_declaration":
      case "variable_declaration":
        if (!scope.insideFunction) variables(node, scope, visibility);
        return;
      case "expression_statement": {
        const inner = node.namedChild(0);
        if (inner && (inner.type === "internal_module" || inner.type === "module")) namespace(inner, scope, visibility);
        return;
      }
      case "internal_module":
      case "module":
        return namespace(node, scope, visibility);
      case "ambient_declaration":
        for (const child of node.namedChildren) statement(child, scope, exported);
        return;
      default:
        return;
    }
  }

  function namespace(node: Node, scope: Scope, visibility: Visibility): void {
    const name = node.childForFieldName("name");
    if (!name || (name.type !== "identifier" && name.type !== "nested_identifier")) return; // `module "x" {}` is skipped
    const index = declare(node, "MODULE", name.text, scope, visibility);
    const body = node.childForFieldName("body");
    if (index !== null && body) walk(body.namedChildren, childScope(index, name.text, scope));
  }

  function classDeclaration(node: Node, scope: Scope, visibility: Visibility): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = nameNode.text;
    const index = declare(node, "CLASS", name, scope, visibility);
    if (index === null) return;

    for (const heritageNode of node.namedChildren.filter((child) => child.type === "class_heritage")) {
      for (const clause of heritageNode.namedChildren) {
        if (clause.type === "extends_clause") {
          const value = clause.childForFieldName("value");
          if (value && value.type === "identifier") heritage.push({ source: index, sourceKind: "CLASS", kind: "extends", target: value.text });
        } else if (clause.type === "implements_clause") {
          for (const target of clause.namedChildren) {
            const targetName = typeName(target);
            if (targetName) heritage.push({ source: index, sourceKind: "CLASS", kind: "implements", target: targetName });
          }
        } else if (clause.type === "identifier") {
          heritage.push({ source: index, sourceKind: "CLASS", kind: "extends", target: clause.text }); // JavaScript
        }
      }
    }

    const body = node.childForFieldName("body");
    if (!body) return;
    const inner = childScope(index, name, scope, false);
    for (const member of body.namedChildren) classMember(member, inner);
  }

  function classMember(member: Node, scope: Scope): void {
    switch (member.type) {
      case "method_definition": {
        const nameNode = member.childForFieldName("name");
        if (!nameNode || !SIMPLE_MEMBER_NAMES.has(nameNode.type)) return; // computed / string names are skipped
        const name = nameNode.text;
        const isConstructor = name === "constructor" && nameNode.type === "property_identifier";
        const index = declare(
          member,
          isConstructor ? "CONSTRUCTOR" : "METHOD",
          name,
          scope,
          memberVisibility(member, nameNode),
          functionSignature(member, name, accessorPrefix(member)),
        );
        const body = member.childForFieldName("body");
        if (index !== null && body) walk(body.namedChildren, childScope(index, name, scope, true));
        return;
      }
      case "method_signature":
      case "abstract_method_signature": {
        const nameNode = member.childForFieldName("name");
        if (!nameNode || !SIMPLE_MEMBER_NAMES.has(nameNode.type)) return;
        declare(member, "METHOD", nameNode.text, scope, memberVisibility(member, nameNode), functionSignature(member, nameNode.text));
        return;
      }
      case "public_field_definition":
      case "field_definition": {
        const nameNode = member.childForFieldName("name") ?? member.childForFieldName("property");
        if (!nameNode || !SIMPLE_MEMBER_NAMES.has(nameNode.type)) return;
        declare(member, "VARIABLE", nameNode.text, scope, memberVisibility(member, nameNode));
        return;
      }
      default:
        return;
    }
  }

  function interfaceDeclaration(node: Node, scope: Scope, visibility: Visibility): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = nameNode.text;
    const index = declare(node, "INTERFACE", name, scope, visibility);
    if (index === null) return;

    for (const clause of node.namedChildren.filter((child) => child.type === "extends_type_clause")) {
      for (const target of clause.namedChildren) {
        const targetName = typeName(target);
        if (targetName) heritage.push({ source: index, sourceKind: "INTERFACE", kind: "extends", target: targetName });
      }
    }

    const body = node.childForFieldName("body");
    if (!body) return;
    const inner = childScope(index, name, scope, false);
    for (const member of body.namedChildren) {
      if (member.type !== "method_signature") continue; // property signatures carry no callable structure
      const memberName = member.childForFieldName("name");
      if (!memberName || !SIMPLE_MEMBER_NAMES.has(memberName.type)) continue;
      declare(member, "METHOD", memberName.text, inner, "PUBLIC", functionSignature(member, memberName.text)); // interface members are public
    }
  }

  function variables(node: Node, scope: Scope, visibility: Visibility): void {
    const keyword = node.child(0)?.type; // const | let | var
    for (const declarator of node.namedChildren.filter((child) => child.type === "variable_declarator")) {
      const nameNode = declarator.childForFieldName("name");
      if (!nameNode || nameNode.type !== "identifier") continue; // destructuring patterns are skipped
      const name = nameNode.text;
      const value = declarator.childForFieldName("value");
      const isFunction = value !== null && FUNCTION_VALUES.has(value.type);
      const kind: SymbolKind = isFunction ? "FUNCTION" : keyword === "const" ? "CONSTANT" : "VARIABLE";
      declare(declarator, kind, name, scope, visibility, isFunction && value ? functionSignature(value, name) : null);

      // `const x = require("literal")` at the top level is a CommonJS import.
      if (value && value.type === "call_expression" && value.childForFieldName("function")?.text === "require") {
        const args = value.childForFieldName("arguments");
        const only = args && args.namedChildCount === 1 ? args.namedChild(0) : null;
        if (only && only.type === "string") addImport(declarator, stringValue(only));
      }
    }
  }

  walk(root.namedChildren, { parent: file, chain: [], topLevel: true, insideFunction: false });

  // Same-file EXTENDS / IMPLEMENTS only; an unresolved or ambiguous name produces no relationship.
  for (const edge of heritage) {
    const allowed: SymbolKind[] =
      edge.kind === "implements" ? ["INTERFACE", "CLASS"] : edge.sourceKind === "INTERFACE" ? ["INTERFACE"] : ["CLASS"];
    const target = topLevel.resolve(edge.target, allowed);
    if (target !== null) builder.relate(edge.source, target, edge.kind === "extends" ? "EXTENDS" : "IMPLEMENTS");
  }

  return builder.toStructure();
}
