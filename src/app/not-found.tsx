import { BrandMark } from "@/components/shell/brand";
import { ButtonLink } from "@/components/ui/button";
import { IconArrowLeft } from "@/components/ui/icons";

export const metadata = { title: "Not found · OneForAll" };

// Same response for missing, malformed and not-permitted paths (the app never reveals which).
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center animate-enter">
      <BrandMark href="/dashboard" />
      <p className="mt-10 font-mono text-[13px] text-fg-3">404</p>
      <h1 className="t-h1 mt-2 text-fg">This page isn’t available</h1>
      <p className="t-body mt-2 max-w-sm text-fg-2">It may not exist, or you may not have access to it.</p>
      <ButtonLink href="/dashboard" variant="secondary" className="mt-8">
        <IconArrowLeft size={15} />
        Back to dashboard
      </ButtonLink>
    </main>
  );
}
