// Joins class names, skipping falsy values. Tiny on purpose: no styling logic lives here.
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
