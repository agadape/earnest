"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";

import { FaucetButton } from "@/components/faucet-button";
import { Mark } from "@/components/mark";
import { WalletButton } from "@/components/wallet-button";
import { BRAND } from "@/lib/brand";
import { useBalance } from "@/lib/chain";
import { DEMO_WALLET_NAME } from "@/lib/demo-wallet";
import { DEMO_WALLET_ENABLED, IS_LOCAL_RPC } from "@/lib/env";
import { usd } from "@/lib/format";

export function Header() {
  const { publicKey, wallet } = useWallet();
  const balance = useBalance();
  const usingDemoWallet = publicKey !== null && wallet?.adapter.name === DEMO_WALLET_NAME;

  return (
    <header className="z-30 border-b border-black bg-carbon text-paper sm:sticky sm:top-0">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:gap-x-8 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Mark className="h-6 w-6" />
          {BRAND}
        </Link>
        <nav className="order-last flex w-full gap-6 text-sm text-paper/70 sm:order-none sm:w-auto">
          <Link href="/" className="hover:text-lime">
            Museum
          </Link>
          <Link href="/catalog" className="hover:text-lime">
            Catalog
          </Link>
          <Link href="/new" className="hover:text-lime">
            Start a campaign
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {publicKey && (
            <p className="text-right text-sm leading-tight">
              <span className="block font-semibold">{balance === null ? "…" : usd(balance)}</span>
              <span className="block text-xs text-paper/60">
                {DEMO_WALLET_ENABLED ? "demo dollars" : "balance"}
              </span>
            </p>
          )}
          <WalletButton />
        </div>
      </div>
      {DEMO_WALLET_ENABLED && publicKey && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 bg-lime px-4 py-1.5 text-xs text-carbon">
          <p>
            {usingDemoWallet
              ? "Demo wallet: everything here is play money."
              : "This is a demo: the dollars here are play money."}
          </p>
          <FaucetButton variant="quiet" />
        </div>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto w-full max-w-5xl px-4 pb-10 pt-6 text-xs text-stone-500 sm:px-6">
      <p>
        Earnest money is the deposit you put down to show you mean it. {BRAND} holds those
        deposits in a vault that follows the campaign&apos;s terms. Neither the creator nor this
        site can move them any other way.
        {DEMO_WALLET_ENABLED &&
          ` This is a demo${IS_LOCAL_RPC ? " on a local test network" : ""}: the dollars are play money.`}
      </p>
    </footer>
  );
}
