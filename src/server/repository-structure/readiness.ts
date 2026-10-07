import "server-only";
import { KEY_MISSING_MESSAGE, getStructurePersistKey } from "./persist-key";
import { type SourceProvider, getSourceProvider } from "./source";

// Whether structure analysis can actually succeed on this server right now. The UI uses it so it never offers an
// action that is certain to fail, and the Server Action uses it so a direct call cannot create FAILED noise either.

export const SOURCE_INGESTION_REQUIRED_MESSAGE =
  "Structure analysis requires repository source ingestion, which is not available yet.";

export type AnalysisReadiness = { ready: true } | { ready: false; message: string };

export function getAnalysisReadiness(provider: SourceProvider = getSourceProvider()): AnalysisReadiness {
  if (!provider.available) return { ready: false, message: SOURCE_INGESTION_REQUIRED_MESSAGE };
  if (getStructurePersistKey() === null) return { ready: false, message: KEY_MISSING_MESSAGE };
  return { ready: true };
}
