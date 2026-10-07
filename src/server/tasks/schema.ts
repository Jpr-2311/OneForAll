import { z } from "zod";

export { workItemFieldsSchema as taskFieldsSchema } from "@/server/requirements/schema";
export type { WorkItemActionResult as TaskActionResult, WorkItemFormState as TaskFormState } from "@/server/requirements/schema";

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const taskStatusSchema = z.enum(TASK_STATUSES, { error: "Invalid status." });

// Mirrors the database trigger (the database is the authority; this gives clean errors early):
// TODO -> IN_PROGRESS | CANCELLED, IN_PROGRESS -> COMPLETED | TODO | CANCELLED,
// COMPLETED -> IN_PROGRESS, CANCELLED -> TODO.
const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "TODO", "CANCELLED"],
  COMPLETED: ["IN_PROGRESS"],
  CANCELLED: ["TODO"],
};

export function isAllowedTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
