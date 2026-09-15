import Link from "next/link";
import Image from "next/image";

interface BrandProps {
  variant?: "black" | "white";
  className?: string;
}

export function Brand({ variant = "black", className = "" }: BrandProps) {
  return (
    <Link className={`brand ${className}`} href="/" data-testid="link-brand">
      <Image
        src={variant === "white" ? "/orbit-logo-white.png" : "/orbit-logo-black.png"}
        alt="Orbit"
        width={28}
        height={28}
        className="w-7 h-7 object-contain flex-shrink-0"
        priority
      />
      <span className="text-xl font-bold tracking-tight">orbit</span>
    </Link>
  );
}
