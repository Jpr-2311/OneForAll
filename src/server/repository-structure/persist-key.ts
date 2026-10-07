import "server-only";

// The HMAC key that authorises structure persistence. SERVER-ONLY: read from the environment on the server,
// never NEXT_PUBLIC_*, never logged, never returned to a caller, never sent over an API. The same value must be
// stored in Supabase Vault as 'structure_persist_key' (see the 20261015000002 migration). It is not a Supabase key.

const MIN_KEY_LENGTH = 32;

export const KEY_MISSING_MESSAGE = "Structure persistence is not configured on this server.";

// Returns the key, or null when it is missing or too short. Never throws and never includes the value in a message.
export function getStructurePersistKey(): string | null {
  const key = process.env.STRUCTURE_PERSIST_KEY;
  return key !== undefined && key.length >= MIN_KEY_LENGTH ? key : null;
}
