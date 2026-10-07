import { z } from "zod";

const email = z.email("Enter a valid email address.").trim().toLowerCase().max(254);

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(72),
});

export const signUpSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name.").max(100),
  email,
  // Supabase/bcrypt limit is 72 bytes; server enforces minimum 8 (supabase/config.toml).
  password: z.string().min(8, "Use at least 8 characters.").max(72),
});

// Only allow same-origin relative paths to prevent open redirects.
export function safeRedirectPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

export type AuthFormState = {
  error?: string;
  message?: string;
  fieldErrors?: Partial<Record<"displayName" | "email" | "password", string[]>>;
};
