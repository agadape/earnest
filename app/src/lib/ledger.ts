/**
 * Notes about campaigns that the program itself knows nothing of: a reaction to one, and which
 * plot of the annex its creator built its room on. There is no database behind them. A note is
 * a transaction signed by whoever writes it, carrying a line of text through the memo program
 * and a transfer of nothing to one fixed address, so that every note can be found again by
 * asking for that address's history.
 *
 * What that buys: a note cannot be written in someone else's name, it does not vanish, and
 * anyone can check it. What it does not: one wallet can react as often as it likes, so a count
 * of reactions is a count of signed transactions, not of people.
 */
import {
  type Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import { KINDS, type Look, LOOK_TINTS, LOOK_TRIMS } from "@/lib/museum/plan";
import { PROGRAM_ID } from "@/lib/tanda-jadi";

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** The address every note touches. Nobody holds its key; it only gives the notes a shelf. */
export const REGISTRY = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("guestbook")],
  PROGRAM_ID,
)[0];

const PREFIX = "earnest:1";

export const REACTIONS = [
  { kind: "want", sign: "🔥", label: "I want this" },
  { kind: "clever", sign: "💡", label: "Clever" },
  { kind: "watching", sign: "👀", label: "Watching" },
] as const;
export type ReactionKind = (typeof REACTIONS)[number]["kind"];
export type ReactionCounts = Record<ReactionKind, number>;

/** How many floors a creator can choose between for their room. */
export const ROOM_STYLES = 5;

export interface PlotClaim {
  signature: string;
  campaign: string;
  /** The plot asked for. */
  plot: number;
  style: number;
}

/** A creator saying what their campaign's object should look like. */
export interface LookNote extends Look {
  signature: string;
  campaign: string;
}

export interface Notes {
  reactions: Map<string, ReactionCounts>;
  /** Oldest first: the order in which they have to be judged. */
  claims: PlotClaim[];
  /** Oldest first: the last one that counts is the one that holds. */
  looks: LookNote[];
}

/** The instructions that write one note, signed and paid for by `writer`. */
function note(writer: PublicKey, text: string): TransactionInstruction[] {
  return [
    SystemProgram.transfer({ fromPubkey: writer, toPubkey: REGISTRY, lamports: 0 }),
    new TransactionInstruction({
      programId: MEMO_PROGRAM,
      keys: [{ pubkey: writer, isSigner: true, isWritable: false }],
      data: Buffer.from(new TextEncoder().encode(text)),
    }),
  ];
}

export const reactIx = (writer: PublicKey, campaign: PublicKey, kind: ReactionKind) =>
  note(writer, `${PREFIX}:react:${campaign.toBase58()}:${kind}`);

export const claimPlotIx = (writer: PublicKey, campaign: PublicKey, plot: number, style: number) =>
  note(writer, `${PREFIX}:plot:${campaign.toBase58()}:${plot}:${style}`);

export const lookIx = (writer: PublicKey, campaign: PublicKey, look: Look) =>
  note(writer, `${PREFIX}:look:${campaign.toBase58()}:${look.kind}:${look.tint}:${look.trim}`);

const emptyCounts = (): ReactionCounts => ({ want: 0, clever: 0, watching: 0 });

/** Sorts the lines of text into reactions and plot claims. Anything else is ignored. */
export function sortNotes(lines: { signature: string; text: string }[]): Notes {
  const reactions = new Map<string, ReactionCounts>();
  const claims: PlotClaim[] = [];
  const looks: LookNote[] = [];
  for (const { signature, text } of lines) {
    const [brand, version, what, campaign, ...rest] = text.trim().split(":");
    if (`${brand}:${version}` !== PREFIX || !campaign) continue;
    if (what === "react") {
      const kind = REACTIONS.find((reaction) => reaction.kind === rest[0])?.kind;
      if (!kind) continue;
      const counts = reactions.get(campaign) ?? emptyCounts();
      counts[kind] += 1;
      reactions.set(campaign, counts);
    } else if (what === "plot") {
      const plot = Number(rest[0]);
      const style = Number(rest[1]);
      if (!Number.isInteger(plot) || !Number.isInteger(style)) continue;
      claims.push({ signature, campaign, plot, style: ((style % ROOM_STYLES) + ROOM_STYLES) % ROOM_STYLES });
    } else if (what === "look") {
      const kind = KINDS.find((candidate) => candidate === rest[0]);
      const tint = Number(rest[1]);
      const trim = Number(rest[2]);
      const inRange = (value: number, most: number) => Number.isInteger(value) && value >= 0 && value < most;
      if (!kind || !inRange(tint, LOOK_TINTS.length) || !inRange(trim, LOOK_TRIMS.length)) continue;
      looks.push({ signature, campaign, kind, tint, trim });
    }
  }
  return { reactions, claims, looks };
}

/** Every note there is, read from the registry's history. The newest few thousand at most. */
export async function readNotes(connection: Connection): Promise<Notes> {
  const lines: { signature: string; text: string }[] = [];
  let before: string | undefined;
  for (let page = 0; page < 3; page++) {
    const batch = await connection.getSignaturesForAddress(REGISTRY, { limit: 1000, before }, "confirmed");
    for (const entry of batch) {
      if (entry.err || !entry.memo) continue;
      // The node answers "[length] text", and "; " between the memos of one transaction.
      for (const part of entry.memo.split("; ")) {
        lines.push({ signature: entry.signature, text: part.replace(/^\[\d+\]\s*/, "") });
      }
    }
    if (batch.length < 1000) break;
    before = batch[batch.length - 1].signature;
  }
  // The node answers newest first.
  return sortNotes(lines.reverse());
}

const signers = new Map<string, string[]>();

/** The wallets that signed a transaction. Asked once; a signature never changes its mind. */
export async function signersOf(connection: Connection, signature: string): Promise<string[]> {
  const known = signers.get(signature);
  if (known) return known;
  const transaction = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction) throw new Error(`Transaction ${signature} is not known yet`);
  const found = transaction.transaction.message.accountKeys
    .filter((key) => key.signer)
    .map((key) => key.pubkey.toBase58());
  signers.set(signature, found);
  return found;
}

/**
 * The look each creator chose for their campaign: the last note about it that its own
 * creator signed. Anyone else's note about it counts for nothing.
 */
export function judgeLooks(
  looks: LookNote[],
  creatorOf: (campaign: string) => string | undefined,
  signedBy: (signature: string) => string[] | undefined,
): Map<string, Look> {
  const chosen = new Map<string, Look>();
  for (const { signature, campaign, kind, tint, trim } of looks) {
    const creator = creatorOf(campaign);
    if (creator && signedBy(signature)?.includes(creator)) chosen.set(campaign, { kind, tint, trim });
  }
  return chosen;
}

export interface Plot {
  plot: number;
  style: number;
}

/**
 * Who has which plot, judged claim by claim in the order they were made. A claim counts when
 * the campaign's own creator signed it, the campaign has no room yet and the plot is free at
 * that moment. A room is built once: it cannot be moved or given up afterwards, so a later
 * claim for a campaign that has one counts for nothing.
 */
export function judgeClaims(
  claims: PlotClaim[],
  creatorOf: (campaign: string) => string | undefined,
  signedBy: (signature: string) => string[] | undefined,
  plots: number,
): Map<string, Plot> {
  const held = new Map<string, Plot>();
  const taken = new Set<number>();
  for (const claim of claims) {
    const creator = creatorOf(claim.campaign);
    if (!creator || !signedBy(claim.signature)?.includes(creator)) continue;
    if (claim.plot < 0 || claim.plot >= plots) continue;
    if (held.has(claim.campaign) || taken.has(claim.plot)) continue;
    held.set(claim.campaign, { plot: claim.plot, style: claim.style });
    taken.add(claim.plot);
  }
  return held;
}
