import { parseWithGrammar } from "../tree-sitter-runtime";
import type { ParseResult, ParserAdapter } from "../types";
import { extractEcmaScript } from "./ecmascript";

// TypeScript adapter: `.tsx` uses the TSX grammar, every other TypeScript path (.ts/.mts/.cts) the plain grammar.
export const typescriptAdapter: ParserAdapter = {
  id: "typescript",
  async parse({ path, source }): Promise<ParseResult> {
    const grammar = path.toLowerCase().endsWith(".tsx") ? "tsx" : "typescript";
    const parsed = await parseWithGrammar(grammar, source, (root) => extractEcmaScript(root, path));
    return parsed.ok ? { ok: true, structure: parsed.value } : { ok: false, error: parsed.error };
  },
};
