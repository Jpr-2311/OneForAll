import path from "node:path";
import { Language, type Node, Parser } from "web-tree-sitter";

// The ONLY module that touches the Tree-sitter runtime. Adapters import `Node` as a type from here; nothing
// outside src/server/repository-structure/ ever sees a Tree-sitter type.
//
// It performs no network access and takes no input from users. The only files it ever reads are the runtime and
// grammar .wasm files below, at fixed locations inside node_modules, chosen from the closed GrammarId set.
// (next.config.ts lists these packages in serverExternalPackages so the server build leaves them on disk.)

export type { Node };

export type GrammarId = "typescript" | "tsx" | "javascript" | "python" | "java";

const GRAMMAR_FILES: Record<GrammarId, { pkg: string; file: string }> = {
  typescript: { pkg: "tree-sitter-typescript", file: "tree-sitter-typescript.wasm" },
  tsx: { pkg: "tree-sitter-typescript", file: "tree-sitter-tsx.wasm" },
  javascript: { pkg: "tree-sitter-javascript", file: "tree-sitter-javascript.wasm" },
  python: { pkg: "tree-sitter-python", file: "tree-sitter-python.wasm" },
  java: { pkg: "tree-sitter-java", file: "tree-sitter-java.wasm" },
};

function modulePath(...segments: string[]): string {
  return path.join(process.cwd(), "node_modules", ...segments);
}

let runtimeReady: Promise<void> | null = null;
const languages = new Map<GrammarId, Promise<Language>>();

function initRuntime(): Promise<void> {
  runtimeReady ??= Parser.init({
    locateFile: (name: string) => modulePath("web-tree-sitter", name),
  });
  return runtimeReady;
}

async function loadLanguage(grammar: GrammarId): Promise<Language> {
  await initRuntime();
  let language = languages.get(grammar);
  if (!language) {
    const { pkg, file } = GRAMMAR_FILES[grammar];
    language = Language.load(modulePath(pkg, file));
    languages.set(grammar, language);
    // A failed load must not be cached forever.
    language.catch(() => languages.delete(grammar));
  }
  return language;
}

// The first syntax error (or missing token), as a 1-based line number for human-readable messages only.
function firstErrorLine(root: Node): number | null {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "ERROR" || node.isMissing) return node.startPosition.row + 1;
    if (node.hasError) for (let i = node.childCount - 1; i >= 0; i--) stack.push(node.child(i)!);
  }
  return null;
}

export type GrammarParse<T> = { ok: true; value: T } | { ok: false; error: string };

// Parses `source` with the grammar and runs `visit` on the root while the tree is alive. Source with ANY syntax
// error is reported as a failure: a partial tree could yield misleading symbols, and symbols are never guessed.
export async function parseWithGrammar<T>(
  grammar: GrammarId,
  source: string,
  visit: (root: Node) => T,
): Promise<GrammarParse<T>> {
  let language: Language;
  try {
    language = await loadLanguage(grammar);
  } catch (error) {
    return { ok: false, error: `Parser for ${grammar} is unavailable: ${error instanceof Error ? error.message : "load failed"}` };
  }

  const parser = new Parser();
  try {
    parser.setLanguage(language);
    const tree = parser.parse(source);
    if (!tree) return { ok: false, error: "The parser produced no syntax tree." };
    try {
      const root = tree.rootNode;
      if (root.hasError) {
        const line = firstErrorLine(root);
        return { ok: false, error: line ? `Syntax error near line ${line}.` : "Syntax error." };
      }
      return { ok: true, value: visit(root) };
    } finally {
      tree.delete();
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Parsing failed." };
  } finally {
    parser.delete();
  }
}
