import {
  MAX_NAME_LENGTH,
  MAX_QUALIFIED_NAME_LENGTH,
  MAX_SIGNATURE_LENGTH,
  type NormalizedRelationship,
  type NormalizedStructure,
  type NormalizedSymbol,
  type RelationshipType,
  type SourceRange,
} from "./types";

// Shared by every adapter. Pure: it knows nothing about any parser library.

type Positioned = {
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
};

// 0-based line/column, end exclusive (see types.ts).
export function nodeRange(node: Positioned): SourceRange {
  return {
    startLine: node.startPosition.row,
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row,
    endColumn: node.endPosition.column,
  };
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// A signature that is empty or too long to store is reported as "not reliably available", never truncated.
export function cleanSignature(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const signature = normalizeWhitespace(raw);
  return signature.length > 0 && signature.length <= MAX_SIGNATURE_LENGTH ? signature : null;
}

export function qualify(prefix: string | null, chain: readonly string[]): string | null {
  const joined = [...(prefix ? [prefix] : []), ...chain].join(".");
  return joined.length > 0 && joined.length <= MAX_QUALIFIED_NAME_LENGTH ? joined : null;
}

const REFLEXIVE_ALLOWED: ReadonlySet<RelationshipType> = new Set(["CALLS", "REFERENCES"]);

export class StructureBuilder {
  private readonly symbols: NormalizedSymbol[] = [];
  private readonly relationships: NormalizedRelationship[] = [];
  private readonly seenRelationships = new Set<string>();
  private readonly seenSymbols = new Set<string>();

  // Returns the symbol's index, or null when the symbol cannot be stored faithfully (unusable name, or an
  // exact duplicate of a symbol already recorded at the same place). Nothing is ever fabricated to fill the gap.
  addSymbol(symbol: NormalizedSymbol): number | null {
    const name = symbol.name;
    if (name.trim().length === 0 || name.length > MAX_NAME_LENGTH) return null;
    const key = `${symbol.kind}\u0000${name}\u0000${symbol.range.startLine}\u0000${symbol.range.startColumn}`;
    if (this.seenSymbols.has(key)) return null;
    this.seenSymbols.add(key);
    this.symbols.push(symbol);
    return this.symbols.length - 1;
  }

  relate(sourceIndex: number, targetIndex: number, type: RelationshipType): void {
    if (sourceIndex === targetIndex && !REFLEXIVE_ALLOWED.has(type)) return;
    const key = `${sourceIndex}\u0000${targetIndex}\u0000${type}`;
    if (this.seenRelationships.has(key)) return;
    this.seenRelationships.add(key);
    this.relationships.push({ sourceIndex, targetIndex, type });
  }

  toStructure(): NormalizedStructure {
    return { symbols: this.symbols, relationships: this.relationships };
  }
}

// Same-file reference resolution shared by the EXTENDS / IMPLEMENTS logic of every adapter. A relationship is
// emitted ONLY when the target is a top-level declaration of this same file and the name is unambiguous.
// Cross-file or ambiguous references are never guessed.
export type TopLevelEntry = { index: number; kind: NormalizedSymbol["kind"] };

export class TopLevelRegistry {
  private readonly byName = new Map<string, TopLevelEntry[]>();

  register(name: string, entry: TopLevelEntry): void {
    const entries = this.byName.get(name) ?? [];
    entries.push(entry);
    this.byName.set(name, entries);
  }

  resolve(name: string, allowedKinds: readonly NormalizedSymbol["kind"][]): number | null {
    const matches = (this.byName.get(name) ?? []).filter((entry) => allowedKinds.includes(entry.kind));
    return matches.length === 1 ? matches[0].index : null;
  }
}
