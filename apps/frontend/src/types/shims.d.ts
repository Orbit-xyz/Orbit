import React from "react";

declare module "next/link" {
  export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
    href: string | object;
    as?: string | object;
    replace?: boolean;
    scroll?: boolean;
    shallow?: boolean;
    passHref?: boolean;
    prefetch?: boolean;
    locale?: string | false;
  }
  const Link: React.ForwardRefExoticComponent<LinkProps & React.RefAttributes<HTMLAnchorElement>>;
  export default Link;
}

declare module "next/navigation" {
  export function usePathname(): string;
  export function useRouter(): {
    push(url: string): void;
    replace(url: string): void;
    refresh(): void;
    back(): void;
    forward(): void;
    prefetch(url: string): void;
  };
  export function useSearchParams(): URLSearchParams;
  export function useParams(): Record<string, string | string[]>;
}

declare module "next-intl" {
  export function useTranslations(namespace?: string): {
    (key: string, values?: Record<string, any>): string;
    rich(key: string, values?: Record<string, any>): React.ReactNode;
    raw(key: string): any;
  };
  export function useLocale(): string;
  export function NextIntlClientProvider(props: {
    children: React.ReactNode;
    messages?: Record<string, any>;
    locale?: string;
    getMessageFallback?: (info: { key: string }) => string;
  }): React.JSX.Element;
}

declare module "@playwright/test" {
  export const test: any;
  export const expect: any;
}
