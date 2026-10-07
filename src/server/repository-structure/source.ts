// The explicit source-retrieval boundary. PostgreSQL never holds source code (Phase 2G stores only a manifest of
// path, language, size and SHA-256), so the analyzer asks a SourceProvider for each file's content.
//
// There is deliberately NO production provider yet: no arbitrary-filesystem endpoint, no network fetching, no
// provider API. A future ingestion adapter (object storage, an archive reader, ...) implements this interface and
// is returned from getSourceProvider(); nothing else changes. Until then the default provider reports itself
// unavailable and an analysis fails cleanly with a clear message instead of guessing.
//
// The analyzer verifies every returned content against the manifest (SHA-256 and size), so a provider can only
// ever supply the exact bytes that were recorded for the snapshot.

export type SourceFile = {
  id: string;
  path: string;
  language: string | null;
  sizeBytes: number;
  contentHash: string;
};

export interface SourceProvider {
  // False when no source retrieval is configured. The analyzer then fails the analysis up front.
  readonly available: boolean;
  // The content of one file of the snapshot, or null when it cannot be provided.
  getContent(file: SourceFile): Promise<string | null>;
}

export const UNAVAILABLE_SOURCE_MESSAGE =
  "Source content is not available for this snapshot yet. Structure analysis needs a source provider.";

const unavailableSourceProvider: SourceProvider = {
  available: false,
  async getContent() {
    return null;
  },
};

// The single seam where a real provider will be wired in.
export function getSourceProvider(): SourceProvider {
  return unavailableSourceProvider;
}

// A fixed, in-memory provider for controlled fixtures and tests: path -> content. It cannot reach the filesystem
// or the network.
export function createInMemorySourceProvider(files: Readonly<Record<string, string>>): SourceProvider {
  return {
    available: true,
    async getContent(file) {
      return Object.hasOwn(files, file.path) ? files[file.path] : null;
    },
  };
}
