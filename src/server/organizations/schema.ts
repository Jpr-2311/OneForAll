import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Enter an organization name.").max(100, "Use at most 100 characters."),
});

export type CreateOrganizationState = {
  error?: string;
  fieldErrors?: { name?: string[] };
  organization?: { id: string; name: string; slug: string; role: string };
};
