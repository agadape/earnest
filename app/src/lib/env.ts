import { PublicKey } from "@solana/web3.js";

// Each variable has to be read as `process.env.NEXT_PUBLIC_…` in full: that exact expression is
// what gets replaced with its value when the browser bundle is built.
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";

/** Offers the in-browser play-money wallet and the "Get demo dollars" button. */
export const DEMO_WALLET_ENABLED = process.env.NEXT_PUBLIC_DEMO_WALLET === "1";

function parseMint(): PublicKey | null {
  try {
    return new PublicKey(process.env.NEXT_PUBLIC_MINT ?? "");
  } catch {
    return null;
  }
}

/** The token shown as dollars. `null` until `npm run setup` has written `.env.local`. */
export const MINT = parseMint();

export const IS_LOCAL_RPC = /127\.0\.0\.1|localhost/.test(RPC_URL);
