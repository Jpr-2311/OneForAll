import Link from "next/link";
import { IconLogo } from "@/components/ui/icons";

export function BrandMark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5" aria-label="OneForAll home">
      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-[#4f5fe0] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_6px_16px_-6px_rgb(123_140_255/0.7)]">
        <IconLogo size={17} />
      </span>
      <span className="text-[16px] font-semibold tracking-tight text-fg">OneForAll</span>
    </Link>
  );
}
