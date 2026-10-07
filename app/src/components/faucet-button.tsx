"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { type ReactNode, useCallback, useState } from "react";

import { useToasts } from "@/components/toasts";
import { Button } from "@/components/ui";
import { useRefresh } from "@/lib/chain";
import { DEMO_WALLET_ENABLED } from "@/lib/env";

/** Asks this app's own faucet for play money. `available` is false when there is none to ask. */
export function useFaucet() {
  const { publicKey } = useWallet();
  const toasts = useToasts();
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);

  const request = useCallback(async () => {
    if (!publicKey) return;
    setBusy(true);
    const toast = toasts.show("pending", "Getting demo dollars…");
    try {
      const response = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: publicKey.toBase58() }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "The faucet did not answer.");
      toasts.update(toast, "success", "$100.00 in demo dollars added to this wallet.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The faucet did not answer.";
      toasts.update(toast, "error", message);
    } finally {
      refresh();
      setBusy(false);
    }
  }, [publicKey, toasts, refresh]);

  return { request, busy, available: DEMO_WALLET_ENABLED && publicKey !== null };
}

export function FaucetButton({
  variant = "secondary",
  size = "md",
  className,
  children = "Get demo dollars",
}: {
  variant?: "primary" | "secondary" | "quiet";
  size?: "md" | "sm";
  className?: string;
  children?: ReactNode;
}) {
  const { request, busy, available } = useFaucet();
  if (!available) return null;
  return (
    <Button variant={variant} size={size} className={className} busy={busy} onClick={request}>
      {children}
    </Button>
  );
}
