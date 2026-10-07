"use client";

import type { WalletError } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { ConnectionConfig } from "@solana/web3.js";
import { type ReactNode, useCallback, useMemo } from "react";

import { ToastProvider, useToasts } from "@/components/toasts";
import { ConnectDialogProvider } from "@/components/wallet-button";
import { ChainProvider } from "@/lib/chain";
import { DemoWalletAdapter } from "@/lib/demo-wallet";
import { DEMO_WALLET_ENABLED, RPC_URL } from "@/lib/env";
import { explainError } from "@/lib/errors";

// Has to be one object for the life of the page: `ConnectionProvider` opens a new connection
// whenever this prop changes identity, and its built-in default is a fresh object per render.
const CONNECTION_CONFIG: ConnectionConfig = { commitment: "confirmed" };

function Wallets({ children }: { children: ReactNode }) {
  const toasts = useToasts();
  // Wallets that follow the Wallet Standard announce themselves; only ours has to be listed.
  const wallets = useMemo(() => (DEMO_WALLET_ENABLED ? [new DemoWalletAdapter()] : []), []);
  const onError = useCallback(
    (error: WalletError) => {
      // Whoever asked for a transaction reports its failure; here it would show up twice.
      if (/SendTransaction|SignTransaction|NotConnected/.test(error.name)) return;
      toasts.show("error", explainError(error));
    },
    [toasts],
  );

  return (
    <WalletProvider wallets={wallets} autoConnect onError={onError}>
      {children}
    </WalletProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConnectionProvider endpoint={RPC_URL} config={CONNECTION_CONFIG}>
        <Wallets>
          <ChainProvider>
            <ConnectDialogProvider>{children}</ConnectDialogProvider>
          </ChainProvider>
        </Wallets>
      </ConnectionProvider>
    </ToastProvider>
  );
}
