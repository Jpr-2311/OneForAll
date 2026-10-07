// The normalized structure model. Everything outside src/server/repository-structure/parsers/ and
// tree-sitter-runtime.ts depends ONLY on these types, never on a parser library's own types.
// Pure module: no imports, no I/O.

export const SYMBOL_KINDS = [
  "CLASS",
  "INTERFACE",
  "FUNCTION",
  "METHOD",
  "CONSTRUCTOR",
  "VARIABLE",
  "CONSTANT",
  "ENUM",
  "TYPE",
  "MODULE",
] as const;
export type SymbolKind = (typeof SYMBOL_KINDS)[number];

export const VISIBILITIES = ["PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL", "PACKAGE", "UNKNOWN"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const RELATIONSHIP_TYPES = ["CONTAINS", "IMPORTS", "CALLS", "EXTENDS", "IMPLEMENTS", "REFERENCES"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

// Storage limits (mirrored by CHECK constraints). Anything beyond them is dropped rather than truncated.
export const MAX_NAME_LENGTH = 500;
export const MAX_QUALIFIED_NAME_LENGTH = 1000;
export const MAX_SIGNATURE_LENGTH = 2000;

// POSITION CONVENTION, used by every adapter and stored as-is: all four values are 0-BASED.
// Lines are rows counted from 0; columns count UTF-16 code units (a JavaScript string index) from 0.
// The end position is EXCLUSIVE: it is the position just after the last character of the symbol.
export type SourceRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type NormalizedSymbol = {
  name: string;
  kind: SymbolKind;
  // Only when deterministically available (the scope chain inside the file, plus the Java package); else null.
  qualifiedName: string | null;
  // Parser-derived and whitespace-normalized; null when it cannot be extracted reliably.
  signature: string | null;
  // UNKNOWN when the language or parser exposes no meaningful visibility.
  visibility: Visibility;
  range: SourceRange;
};

// Symbols and relationships are index-addressed: a relationship refers to positions in `symbols` of the same
// NormalizedStructure, so a relationship can never point at a symbol outside its own structure.
export type NormalizedRelationship = {
  sourceIndex: number;
  targetIndex: number;
  type: RelationshipType;
};

export type NormalizedStructure = {
  symbols: NormalizedSymbol[];
  relationships: NormalizedRelationship[];
};

export type ParseInput = {
  // Repository-relative path (already normalized by the Phase 2G manifest).
  path: string;
  source: string;
};

export type ParseResult = { ok: true; structure: NormalizedStructure } | { ok: false; error: string };

// A parser adapter turns the source of ONE file into a normalized structure. It never throws for bad source:
// malformed input is a normal `{ ok: false }` result. It performs no I/O of its own beyond loading its grammar.
export interface ParserAdapter {
  readonly id: string;
  parse(input: ParseInput): Promise<ParseResult>;
}
