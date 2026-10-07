import {
  BaseSignerWalletAdapter,
  isVersionedTransaction,
  type WalletError,
  type WalletName,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletReadyState,
  WalletSignTransactionError,
} from "@solana/wallet-adapter-base";
import {
  Keypair,
  type PublicKey,
  type Transaction,
  type TransactionVersion,
  type VersionedTransaction,
} from "@solana/web3.js";

export const DEMO_WALLET_NAME = "Demo wallet" as WalletName<"Demo wallet">;

const STORAGE_KEY = "tanda-jadi:demo-wallets";

const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0b6e4f"/><path d="M9 12h14v10H9z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="19.5" cy="17" r="1.5" fill="#fff"/></svg>',
  );

interface Stored {
  /** Secret keys of every demo wallet made in this browser. They only ever hold play money. */
  keys: number[][];
  active: number;
}

/** The wallets kept in this browser, or `null` if there are none or the entry is unreadable. */
function read(): { keypairs: Keypair[]; active: number } | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Stored | null;
    if (!stored || !Array.isArray(stored.keys) || stored.keys.length === 0) return null;
    const keypairs = stored.keys.map((key) => Keypair.fromSecretKey(Uint8Array.from(key)));
    const active = Number.isInteger(stored.active) ? stored.active : 0;
    return { keypairs, active: Math.min(Math.max(active, 0), keypairs.length - 1) };
  } catch {
    return null;
  }
}

function write(keypairs: Keypair[], active: number) {
  const stored: Stored = { keys: keypairs.map((k) => Array.from(k.secretKey)), active };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage can be switched off. The wallets then last until the page is reloaded.
  }
}

/**
 * A wallet that lives in this browser's `localStorage` and signs without asking. It exists
 * so that anyone can try the app with play money and nothing installed, and so that one person
 * can act as several backers. It must never be offered where the token is worth something.
 */
export class DemoWalletAdapter extends BaseSignerWalletAdapter<"Demo wallet"> {
  name = DEMO_WALLET_NAME;
  url = "https://solana.com/docs/intro/wallets";
  icon = ICON;
  supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set<TransactionVersion>([
    "legacy",
    0,
  ]);
  readyState =
    typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.Loadable;

  private keypairs: Keypair[] = [];
  private active = 0;
  private isConnected = false;
  private isConnecting = false;

  get publicKey(): PublicKey | null {
    return this.isConnected ? this.keypairs[this.active].publicKey : null;
  }

  get connecting(): boolean {
    return this.isConnecting;
  }

  /** Every demo wallet in this browser, in the order they were made. */
  get accounts(): PublicKey[] {
    return this.keypairs.map((keypair) => keypair.publicKey);
  }

  get activeIndex(): number {
    return this.active;
  }

  async connect(): Promise<void> {
    if (this.isConnected || this.isConnecting) return;
    this.isConnecting = true;
    try {
      // Announce the connection in a later task, as a wallet that has to ask someone would.
      // The wallet provider reconnects from an effect, and in development React runs effects
      // twice: an answer given on the spot would reach listeners that are about to be removed.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (this.readyState !== WalletReadyState.Loadable) throw new WalletNotReadyError();
      const stored = read();
      if (stored) {
        this.keypairs = stored.keypairs;
        this.active = stored.active;
      } else {
        this.keypairs = [Keypair.generate()];
        this.active = 0;
        write(this.keypairs, this.active);
      }
      this.isConnected = true;
      this.emit("connect", this.keypairs[this.active].publicKey);
    } catch (error) {
      this.emit("error", error as WalletError);
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect(): Promise<void> {
    // The keys stay in storage, so connecting again brings the same wallets back.
    this.isConnected = false;
    this.emit("disconnect");
  }

  /** Makes `index` the signing wallet. Reported as a fresh connection, like an account change. */
  switchTo(index: number): void {
    if (!this.isConnected || index === this.active || !this.keypairs[index]) return;
    this.active = index;
    write(this.keypairs, this.active);
    this.emit("connect", this.keypairs[index].publicKey);
  }

  /** Creates one more demo wallet and switches to it. */
  addAccount(): void {
    if (!this.isConnected) return;
    this.keypairs = [...this.keypairs, Keypair.generate()];
    this.switchTo(this.keypairs.length - 1);
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    try {
      if (!this.isConnected) throw new WalletNotConnectedError();
      const keypair = this.keypairs[this.active];
      if (isVersionedTransaction(transaction)) {
        transaction.sign([keypair]);
      } else {
        transaction.partialSign(keypair);
      }
      return transaction;
    } catch (error) {
      const wrapped =
        error instanceof WalletNotConnectedError
          ? error
          : new WalletSignTransactionError("The demo wallet could not sign this transaction");
      this.emit("error", wrapped);
      throw wrapped;
    }
  }
}
