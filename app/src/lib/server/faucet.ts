import "server-only";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import {
  type Connection,
  type Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { confirmSignature } from "@/lib/confirm";
import { IS_LOCAL, loadServerKey, sendAsServer, serverConnection } from "@/lib/server/payer";

const USD = 1_000_000n;
const DRIP = 100n * USD;
/** A wallet holding this much is not given more. */
const BALANCE_CAP = 1_000n * USD;
const COOLDOWN_MS = 10_000;

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
  let authority: Keypair | null;
  try {
    authority = await loadServerKey();
  } catch {
    throw new FaucetError("The faucet's key is not a valid secret key.", 503);
  }
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

  const connection = serverConnection();
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
  return sendAsServer(connection, authority, instructions);
}
