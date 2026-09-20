"use client";

import React, { useState } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { arcTestnet } from "./chains";

/**
 * wagmi config for Orbit's Arc rail.
 *
 * Only `injected` is configured: MetaMask and Coinbase Wallet both expose
 * themselves that way, and adding WalletConnect would require a project ID and
 * a network round-trip on every page load. Worth revisiting for mobile.
 *
 * `ssr: true` matters — Next.js renders these pages on the server, and without
 * it wagmi tries to read `window` during prerender and the build fails.
 */
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export function Web3Provider({ children }: { children: React.ReactNode }) {
  // Created inside the component so each browser session gets its own cache.
  // A module-level QueryClient would be shared across requests on the server
  // and leak one user's cached data into another's response.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Chain state is not that volatile, and every refetch is an RPC call.
            staleTime: 10_000,
            retry: 1,
          },
        },
      })
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
