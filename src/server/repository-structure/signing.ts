import { createHmac } from "node:crypto";
import type { PersistedRelationship, PersistedSymbol } from "./schema";

// Canonical form and HMAC-SHA256 signature of a structure persistence request. Pure (no environment, no secret
// of its own): the key is always passed in by the caller, which reads it from the server-only
// STRUCTURE_PERSIST_KEY (see persist-key.ts). The database verifies the same message with the key held in
// Supabase Vault (private.structure_canonical + persist_structure_analysis), so both sides MUST stay identical.
//
// CANONICAL MESSAGE, version 1 (UTF-8, every line ends with LF):
//   OFA-STRUCTURE-V1
//   <analysis_id, lowercase uuid>
//   <run_token, 64 lowercase hex>
//   <files_total>|<files_analyzed>|<files_unsupported>|<files_failed>
//   <number of symbols>
//   <number of relationships>
//   one line per symbol, in array order:
//     S|<file_id>|<kind>|<start_line>|<start_column>|<end_line>|<end_column>|<visibility or ->|<S name>|<S qualified_name>|<S signature>
//   one line per relationship, in array order:
//     R|<source_index>|<target_index>|<relationship_type>
// where <S x> is "-" for null, otherwise "<UTF-8 byte length>:<x>", so a value containing "|" or a newline can
// never move a field boundary. Integers are plain decimal. The signature is the lowercase hex HMAC-SHA256.

export type StructureSigningInput = {
  analysisId: string;
  runToken: string;
  filesTotal: number;
  filesAnalyzed: number;
  filesUnsupported: number;
  filesFailed: number;
  symbols: readonly PersistedSymbol[];
  relationships: readonly PersistedRelationship[];
};

function lengthPrefixed(value: string | null): string {
  return value === null ? "-" : `${Buffer.byteLength(value, "utf8")}:${value}`;
}

export function canonicalStructure(input: StructureSigningInput): string {
  const lines = [
    "OFA-STRUCTURE-V1",
    input.analysisId.toLowerCase(),
    input.runToken,
    `${input.filesTotal}|${input.filesAnalyzed}|${input.filesUnsupported}|${input.filesFailed}`,
    String(input.symbols.length),
    String(input.relationships.length),
    ...input.symbols.map(
      (s) =>
        `S|${s.file_id}|${s.kind}|${s.start_line}|${s.start_column}|${s.end_line}|${s.end_column}|${s.visibility}` +
        `|${lengthPrefixed(s.name)}|${lengthPrefixed(s.qualified_name)}|${lengthPrefixed(s.signature)}`,
    ),
    ...input.relationships.map((r) => `R|${r.source_index}|${r.target_index}|${r.relationship_type}`),
  ];
  return lines.join("\n") + "\n";
}

export function signStructure(key: string, input: StructureSigningInput): string {
  return createHmac("sha256", key).update(canonicalStructure(input), "utf8").digest("hex");
}
