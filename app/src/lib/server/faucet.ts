import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { confirmSignature } from "@/lib/confirm";

const USD = 1_000_000n;
const DRIP = 100n * USD;
/** A wallet holding this much is not given more. */
const BALANCE_CAP = 1_000n * USD;
const COOLDOWN_MS = 10_000;

const RPC_URL = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(RPC_URL);
// What a wallet is topped up to, and the level below which that happens.
const SOL_TARGET = (IS_LOCAL ? 1 : 0.05) * LAMPORTS_PER_SOL;
const SOL_FLOOR = SOL_TARGET / 5;

/** A refusal that is safe to show to whoever called the faucet. */
export class FaucetError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FaucetError";
  }
}

const lastDrip = new Map<string, number>();

/**
 * The key that may mint the demo token: `FAUCET_SECRET_KEY` (a JSON array, as `solana-keygen`
 * writes it) or else the key the dev scripts keep in `app/.keys/admin.json`.
 *
 * Errors raised here never include the cause, because a parser's message quotes its input.
 */
async function loadAuthority(): Promise<Keypair | null> {
  let source = process.env.FAUCET_SECRET_KEY;
  if (!source) {
    const file = path.join(/* turbopackIgnore: true */ process.cwd(), ".keys", "admin.json");
    try {
      source = await fs.readFile(file, "utf8");
    } catch {
      return null;
    }
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(source) as number[]));
  } catch {
    throw new FaucetError("The faucet's key is not a valid secret key.", 503);
  }
}

async function confirmed(connection: Connection, signature: string) {
  const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  await confirmSignature(connection, signature, lastValidBlockHeight);
}

/** Gives `address` 100 demo dollars and, if it is short of it, SOL to pay network fees with. */
export async function drip(address: string): Promise<{ signature: string; amount: string }> {
  const mintAddress = process.env.NEXT_PUBLIC_MINT;
  if (!mintAddress) {
    throw new FaucetError("No demo token is configured. Run `npm run setup` first.", 503);
  }
  const authority = await loadAuthority();
  if (!authority) {
    throw new FaucetError("The faucet is not set up on this server.", 503);
  }

  let recipient: PublicKey;
  try {
    recipient = new PublicKey(address);
  } catch {
    throw new FaucetError("That is not a valid wallet address.", 400);
  }

  const key = recipient.toBase58();
  const now = Date.now();
  if (now - (lastDrip.get(key) ?? 0) < COOLDOWN_MS) {
    throw new FaucetError("You were just topped up. Try again in a few seconds.", 429);
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const mint = new PublicKey(mintAddress);
  const account = getAssociatedTokenAddressSync(mint, recipient, true);
  try {
    if ((await getAccount(connection, account)).amount >= BALANCE_CAP) {
      throw new FaucetError("This wallet already holds plenty of demo dollars.", 409);
    }
  } catch (error) {
    if (!(error instanceof TokenAccountNotFoundError)) throw error;
  }

  lastDrip.set(key, now);
  try {
    const signature = await topUp(connection, authority, mint, recipient, account);
    return { signature, amount: DRIP.toString() };
  } catch (error) {
    lastDrip.delete(key);
    throw error;
  }
}

async function topUp(
  connection: Connection,
  authority: Keypair,
  mint: PublicKey,
  recipient: PublicKey,
  account: PublicKey,
): Promise<string> {
  const instructions = [];
  if ((await connection.getBalance(recipient)) < SOL_FLOOR) {
    if (IS_LOCAL) {
      // Only a local validator hands out SOL on request.
      await confirmed(connection, await connection.requestAirdrop(recipient, SOL_TARGET));
    } else {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: recipient,
          lamports: SOL_TARGET,
        }),
      );
    }
  }
  if (IS_LOCAL && (await connection.getBalance(authority.publicKey)) < SOL_FLOOR) {
    await confirmed(connection, await connection.requestAirdrop(authority.publicKey, SOL_TARGET));
  }
  instructions.push(
    createAssociatedTokenAccountIdempotentInstruction(
      authority.publicKey,
      account,
      recipient,
      mint,
    ),
    createMintToInstruction(mint, account, authority.publicKey, DRIP),
  );

  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: authority.publicKey, ...latest }).add(
    ...instructions,
  );
  transaction.sign(authority);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  await confirmSignature(connection, signature, latest.lastValidBlockHeight);
  return signature;
}
