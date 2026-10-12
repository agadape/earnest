"use client";

import { type WalletName, WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { FaucetButton } from "@/components/faucet-button";
import { Button, Tag } from "@/components/ui";
import { DEMO_WALLET_NAME, DemoWalletAdapter } from "@/lib/demo-wallet";
import { shortAddress } from "@/lib/format";

const ConnectContext = createContext<() => void>(() => undefined);

/** Opens the "choose a wallet" dialog from anywhere on the page. */
export const useConnectDialog = () => useContext(ConnectContext);

export function ConnectDialogProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The list of wallets is only known in the browser, so it is not rendered until asked for:
  // the server's HTML and the first render in the browser have to be the same.
  const [shown, setShown] = useState(false);
  const open = useCallback(() => {
    setShown(true);
    dialog.current?.showModal();
  }, []);
  const close = useCallback(() => dialog.current?.close(), []);

  return (
    <ConnectContext.Provider value={open}>
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="connect-title"
        onClose={() => setShown(false)}
        onClick={(event) => {
          // The dialog element itself is only hit by clicks on the backdrop around its content.
          if (event.target === event.currentTarget) close();
        }}
        className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl bg-white p-0 text-stone-900 shadow-xl"
      >
        {shown && <WalletChoices close={close} />}
      </dialog>
    </ConnectContext.Provider>
  );
}

function WalletChoices({ close }: { close: () => void }) {
  const { wallets, select } = useWallet();
  // Selecting is enough: the wallet provider connects to whatever was just chosen.
  const choose = (name: WalletName) => {
    select(name);
    close();
  };

  const demo = wallets.find(({ adapter }) => adapter.name === DEMO_WALLET_NAME);
  const installed = wallets.filter(
    ({ adapter, readyState }) =>
      adapter.name !== DEMO_WALLET_NAME && readyState === WalletReadyState.Installed,
  );

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <h2 id="connect-title" className="text-lg font-semibold">
          Connect a wallet
        </h2>
        <button
          type="button"
          onClick={close}
          className="-m-1 rounded p-1 text-sm text-stone-500 hover:text-stone-900"
        >
          Close
        </button>
      </div>

      {demo && (
        <button
          type="button"
          onClick={() => choose(demo.adapter.name)}
          className="mt-5 w-full rounded-xl border border-accent-line bg-accent-soft p-4 text-left transition-colors hover:border-accent"
        >
          <span className="flex items-center gap-2 font-medium text-accent-ink">
            Use a demo wallet <Tag tone="accent">Play money</Tag>
          </span>
          <span className="mt-1 block text-sm text-stone-600">
            Nothing to install. A wallet is created in this browser, and one click fills it
            with demo dollars that are worth nothing.
          </span>
        </button>
      )}

      <p className="mt-6 text-sm font-medium text-stone-700">
        {demo ? "Or use your own wallet" : "Wallets found in this browser"}
      </p>
      {installed.length > 0 ? (
        <ul className="mt-2 divide-y divide-stone-200 rounded-xl border border-stone-200">
          {installed.map(({ adapter }) => (
            <li key={adapter.name}>
              <button
                type="button"
                onClick={() => choose(adapter.name)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-stone-50"
              >
                <span className="font-medium">{adapter.name}</span>
                <span className="text-stone-500">Connect</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-stone-600">
          No Solana wallet was found in this browser. Install one, reload this page, and it
          will be listed here.
        </p>
      )}
    </div>
  );
}

export function WalletButton() {
  const { publicKey, connecting } = useWallet();
  const openConnect = useConnectDialog();

  if (!publicKey) {
    return (
      <Button variant="signal" size="sm" busy={connecting} onClick={openConnect}>
        {connecting ? "Connecting" : "Connect"}
      </Button>
    );
  }
  return <WalletMenu address={publicKey.toBase58()} />;
}

function WalletMenu({ address }: { address: string }) {
  const { wallet, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const demo = wallet?.adapter instanceof DemoWalletAdapter ? wallet.adapter : null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard access; the full address is on screen to select by hand.
    }
  };

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-9 items-center gap-2 rounded-sm border border-paper/30 bg-paper px-3 text-sm font-medium text-stone-900 hover:border-lime"
      >
        {demo && <Tag tone="accent">Demo</Tag>}
        <span className="font-mono text-[13px]">{shortAddress(address)}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-md border border-stone-300 bg-white p-4 text-sm text-stone-900 shadow-xl shadow-stone-900/10">
          <p className="font-medium">
            {demo ? "Demo wallet — play money" : (wallet?.adapter.name ?? "Wallet")}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-stone-600">{address}</p>
          <button type="button" onClick={copy} className="mt-1 text-xs text-accent hover:underline">
            {copied ? "Copied" : "Copy address"}
          </button>

          {demo && (
            <div className="mt-4 border-t border-stone-200 pt-3">
              <p className="text-xs text-stone-600">
                Demo wallets in this browser. Switch between them to act as several people.
              </p>
              <ul className="mt-2 space-y-1">
                {demo.accounts.map((account, index) => (
                  <li key={account.toBase58()}>
                    <button
                      type="button"
                      aria-current={index === demo.activeIndex}
                      onClick={() => demo.switchTo(index)}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left ${
                        index === demo.activeIndex
                          ? "bg-accent-soft text-accent-ink"
                          : "hover:bg-stone-50"
                      }`}
                    >
                      <span>Wallet {index + 1}</span>
                      <span className="font-mono text-xs">{shortAddress(account)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => demo.addAccount()}
                className="mt-1 px-2.5 py-1.5 text-accent hover:underline"
              >
                New demo wallet
              </button>
            </div>
          )}

          <div className="mt-3 flex flex-col gap-2 border-t border-stone-200 pt-3">
            <FaucetButton size="sm" />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpen(false);
                disconnect().catch(() => undefined);
              }}
            >
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
