"use client";

import { ConnectionProvider } from "@solana/wallet-adapter-react";
import type { ConnectionConfig } from "@solana/web3.js";
import type { ReactNode } from "react";

import { ChainProvider } from "@/lib/chain";
import { RPC_URL } from "@/lib/env";

// One object for the life of the page, for the reason given in `providers.tsx`.
const CONNECTION_CONFIG: ConnectionConfig = { commitment: "confirmed" };

/**
 * What the embedded card needs to read the chain and keep itself up to date, and nothing
 * else: no wallet and no toasts, because inside someone else's page nothing is ever signed.
 */
export function EmbedProviders({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_URL} config={CONNECTION_CONFIG}>
      <ChainProvider balance={false}>{children}</ChainProvider>
    </ConnectionProvider>
  );
}
