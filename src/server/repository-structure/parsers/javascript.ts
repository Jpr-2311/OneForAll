import { parseWithGrammar } from "../tree-sitter-runtime";
import type { ParseResult, ParserAdapter } from "../types";
import { extractEcmaScript } from "./ecmascript";

// JavaScript adapter (.js/.jsx/.mjs/.cjs). The JavaScript grammar covers JSX. TypeScript-only syntax in a
// JavaScript file is a syntax error here, so the file is reported as failed rather than guessed at.
export const javascriptAdapter: ParserAdapter = {
  id: "javascript",
  async parse({ path, source }): Promise<ParseResult> {
    const parsed = await parseWithGrammar("javascript", source, (root) => extractEcmaScript(root, path));
    return parsed.ok ? { ok: true, structure: parsed.value } : { ok: false, error: parsed.error };
  },
};
