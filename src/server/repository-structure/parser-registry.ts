import { javaAdapter } from "./parsers/java";
import { javascriptAdapter } from "./parsers/javascript";
import { pythonAdapter } from "./parsers/python";
import { typescriptAdapter } from "./parsers/typescript";
import type { ParserAdapter } from "./types";

// Language -> adapter. The language strings are the ones Phase 2G stores on repository_files.language
// (detected from the extension). Detecting a language is NOT the same as supporting it structurally: a language
// without an entry here (C, C++, C#, Go, HTML, CSS, SQL, JSON, YAML, Markdown, or none) is reported as
// "unsupported" by the analyzer, never as a failure and never with invented symbols.
// To add a language later, add an adapter and one line here; nothing else in OneForAll changes.
const ADAPTERS: Readonly<Record<string, ParserAdapter>> = {
  TypeScript: typescriptAdapter,
  JavaScript: javascriptAdapter,
  Python: pythonAdapter,
  Java: javaAdapter,
};

export function getParserAdapter(language: string | null): ParserAdapter | null {
  if (language === null) return null;
  return Object.hasOwn(ADAPTERS, language) ? ADAPTERS[language] : null;
}

export const SUPPORTED_LANGUAGES: readonly string[] = Object.keys(ADAPTERS);
