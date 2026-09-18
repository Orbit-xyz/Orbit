import Link from "next/link";
import { ORBIT_LOGO_BLACK, ORBIT_LOGO_WHITE } from "./brand-logos";

interface BrandProps {
  variant?: "black" | "white";
  className?: string;
}

export function Brand({ variant = "black", className = "" }: BrandProps) {
  const logoSrc = variant === "white" ? ORBIT_LOGO_WHITE : ORBIT_LOGO_BLACK;

  return (
    <Link className={`brand ${className}`} href="/" data-testid="link-brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoSrc}
        alt="Orbit"
        width={28}
        height={28}
        className="w-7 h-7 object-contain shrink-0"
        loading="eager"
      />
      <span className="text-xl font-bold tracking-tight">orbit</span>
    </Link>
  );
}
