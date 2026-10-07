import { z } from "zod";
import { branchSchema } from "@/server/repositories/schema";

export const SNAPSHOT_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

export const STATUS_LABELS: Record<SnapshotStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export const snapshotStatusSchema = z.enum(SNAPSHOT_STATUSES, { error: "Invalid status." });

// Mirrors the database CHECKs (the database is the authority; this gives clean errors early).
// A full Git object id in hex (SHA-1: 40, SHA-256: 64). Abbreviated ids and ref names are not commits.
export const commitShaSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/, "Enter the full 40- or 64-character commit SHA.");

// Same rules as a repository's default branch, plus no control characters. Never assumes "main".
export const snapshotBranchSchema = branchSchema.refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
  message: "That is not a valid branch name.",
});

export const createSnapshotSchema = z.object({ commitSha: commitShaSchema, branch: snapshotBranchSchema });

export const failureMessageSchema = z.string().trim().max(2000, "Use at most 2000 characters.");

// Mirrors the database trigger: PENDING -> PROCESSING | FAILED, PROCESSING -> COMPLETED | FAILED,
// FAILED -> PENDING (retry). COMPLETED is terminal.
const ALLOWED_TRANSITIONS: Record<SnapshotStatus, readonly SnapshotStatus[]> = {
  PENDING: ["PROCESSING", "FAILED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: ["PENDING"],
};

export function isAllowedSnapshotTransition(from: SnapshotStatus, to: SnapshotStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// The mutable columns that go with each target status, so timestamps and the error message always agree
// with the status. Retrying a failed snapshot returns it to a clean PENDING state.
export function snapshotStatusPatch(to: SnapshotStatus, now: Date, failureMessage?: string) {
  const timestamp = now.toISOString();
  switch (to) {
    case "PROCESSING":
      return { status: to, started_at: timestamp, completed_at: null, error_message: null };
    case "COMPLETED":
      return { status: to, completed_at: timestamp, error_message: null };
    case "FAILED":
      return { status: to, completed_at: timestamp, error_message: failureMessage || "Snapshot failed." };
    case "PENDING":
      return { status: to, started_at: null, completed_at: null, error_message: null };
  }
}

export type SnapshotFormState = {
  error?: string;
  fieldErrors?: { commitSha?: string[]; branch?: string[] };
};

export type SnapshotActionResult = { error?: string };
