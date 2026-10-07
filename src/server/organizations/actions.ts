"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";
import { type CreateOrganizationState, createOrganizationSchema } from "./schema";

export async function createOrganization(
  _prev: CreateOrganizationState,
  formData: FormData,
): Promise<CreateOrganizationState> {
  // Verified server-side. No user id or role is ever read from the form.
  await requireUser();

  const parsed = createOrganizationSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  // The RPC derives the owner from auth.uid() and creates organization + OWNER membership atomically.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organization", { p_name: parsed.data.name });

  const created = data?.[0];
  if (error || !created) {
    return { error: "Could not create the organization. Please try again." };
  }

  revalidatePath("/organizations/new");
  return { organization: created };
}
