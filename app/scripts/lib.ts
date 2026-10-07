/**
 * Shared plumbing for the scripts. They talk to `RPC_URL` (a local validator by default) and keep
 * their throwaway keypairs in `app/.keys/`, which is git-ignored. Never put a funded mainnet key
 * there.
 */
import fs from "node:fs";
import path from "node:path";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  type PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import { confirmSignature } from "../src/lib/confirm";
import { formatTokens, getProgram, tokenAccount } from "../src/lib/tanda-jadi";

export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
export const IS_LOCAL = /127\.0\.0\.1|localhost/.test(RPC_URL);
export const USD = 1_000_000n;

/**
 * Public RPC nodes answer 429 when asked too much. Waiting and asking again is all it takes, and
 * a script has the patience for it.
 */
async function patientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(input, init);
    if (response.status !== 429 || attempt === 8) return response;
    await sleep(Math.min(500 * 2 ** attempt, 8_000));
  }
}

export const connection = new Connection(RPC_URL, {
  commitment: "confirmed",
  fetch: patientFetch as typeof fetch,
  disableRetryOnRateLimit: true,
});
export const program = getProgram(connection);

const KEYS_DIR = path.resolve(process.cwd(), ".keys");

/** Loads `app/.keys/<name>.json`, creating it on first use. */
export function keypair(name: string): Keypair {
  const file = path.join(KEYS_DIR, `${name}.json`);
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  }
  const created = Keypair.generate();
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(Array.from(created.secretKey)));
  return created;
}

export function hasKeypair(name: string): boolean {
  return fs.existsSync(path.join(KEYS_DIR, `${name}.json`));
}

export async function send(
  instructions: TransactionInstruction[],
  payer: Keypair,
  signers: Keypair[] = [],
): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: payer.publicKey, ...latest }).add(
    ...instructions,
  );
  transaction.sign(payer, ...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  // Confirmed over plain HTTP: the websocket of a public RPC node is the first thing to be throttled.
  await confirmSignature(connection, signature, latest.lastValidBlockHeight);
  return signature;
}

/** Tops `wallet` up to `sol` SOL. Only a local validator hands out SOL on request. */
export async function ensureSol(wallet: PublicKey, sol: number, from?: Keypair): Promise<void> {
  const balance = await connection.getBalance(wallet);
  const missing = sol * LAMPORTS_PER_SOL - balance;
  if (missing <= 0) return;

  if (IS_LOCAL) {
    const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const signature = await connection.requestAirdrop(wallet, missing);
    await confirmSignature(connection, signature, lastValidBlockHeight);
  } else if (from) {
    await send(
      [SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: wallet, lamports: missing })],
      from,
    );
  } else {
    throw new Error(
      `${wallet.toBase58()} needs ${missing / LAMPORTS_PER_SOL} more SOL on ${RPC_URL}. ` +
        "Fund it from https://faucet.solana.com and run this again.",
    );
  }
}

export async function tokenBalance(mint: PublicKey, owner: PublicKey): Promise<bigint> {
  try {
    return (await getAccount(connection, tokenAccount(mint, owner))).amount;
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) return 0n;
    throw error;
  }
}

/** Mints demo tokens so that `owner` holds exactly `amount`, or leaves a larger balance alone. */
export async function ensureTokens(
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint,
  mintAuthority: Keypair,
): Promise<void> {
  const account = tokenAccount(mint, owner);
  const missing = amount - (await tokenBalance(mint, owner));
  const instructions = [
    createAssociatedTokenAccountIdempotentInstruction(
      mintAuthority.publicKey,
      account,
      owner,
      mint,
    ),
  ];
  if (missing > 0n) {
    instructions.push(
      createMintToInstruction(mint, account, mintAuthority.publicKey, missing),
    );
  }
  await send(instructions, mintAuthority);
}

/** The cluster's own clock. Deadlines are compared against this, not against the local one. */
export async function chainTime(): Promise<number> {
  const time = await connection.getBlockTime(await connection.getSlot("confirmed"));
  if (time === null) throw new Error("the cluster did not report a block time");
  return time;
}

export async function waitUntil(timestamp: number): Promise<void> {
  while ((await chainTime()) < timestamp) {
    await sleep(IS_LOCAL ? 500 : 2_000);
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const usd = (amount: bigint) => `$${formatTokens(amount)}`;
