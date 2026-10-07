import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import {
  Connection,
  Keypair,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import { confirmSignature } from "@/lib/confirm";

export const RPC_URL =
  process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";
export const IS_LOCAL = /127\.0\.0\.1|localhost/.test(RPC_URL);

export const serverConnection = () => new Connection(RPC_URL, "confirmed");

/**
 * The one key this server holds: `FAUCET_SECRET_KEY` (a JSON array, as `solana-keygen` writes
 * it) or else the key the dev scripts keep in `app/.keys/faucet.json`. It mints the demo token
 * and pays the network fee of payouts. It cannot touch the program's config or any vault.
 *
 * Errors raised here never include the cause, because a parser's message quotes its input.
 */
export async function loadServerKey(): Promise<Keypair | null> {
  let source = process.env.FAUCET_SECRET_KEY;
  if (!source) {
    const file = path.join(/* turbopackIgnore: true */ process.cwd(), ".keys", "faucet.json");
    try {
      source = await fs.readFile(file, "utf8");
    } catch {
      return null;
    }
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(source) as number[]));
  } catch {
    throw new Error("The server's key is not a valid secret key.");
  }
}

/** Signs with the server's key, sends, and waits until the transaction is confirmed. */
export async function sendAsServer(
  connection: Connection,
  key: Keypair,
  instructions: TransactionInstruction[],
): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: key.publicKey, ...latest }).add(
    ...instructions,
  );
  transaction.sign(key);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  await confirmSignature(connection, signature, latest.lastValidBlockHeight);
  return signature;
}
