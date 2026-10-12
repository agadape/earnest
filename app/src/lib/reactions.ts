/**
 * What a wallet signs to react when reactions are kept in the database. It is a message, not a
 * transaction: it costs nothing and moves nothing, and all it proves is that the holder of
 * this wallet asked for this one reaction to be added or taken away, at about this time.
 *
 * Shared by the browser, which asks for the signature, and the server, which rebuilds the same
 * text from what it was sent and checks the signature against it.
 */
import type { ReactionKind } from "@/lib/ledger";

/** How long after it was signed a message is still accepted. */
export const REACTION_FRESH_MS = 5 * 60_000;

export function reactionMessage(request: {
  campaign: string;
  kind: ReactionKind;
  wallet: string;
  on: boolean;
  at: number;
}): string {
  return [
    "Earnest: a reaction to a campaign.",
    "Signing this costs nothing and moves nothing.",
    "",
    `${request.on ? "Add" : "Remove"}: ${request.kind}`,
    `Campaign: ${request.campaign}`,
    `Wallet: ${request.wallet}`,
    `Time: ${request.at}`,
  ].join("\n");
}

export interface ReactionsAnswer {
  /** False where no database is set up; reactions are then read from the chain instead. */
  configured: boolean;
  /** By campaign address. */
  counts: Record<string, Record<ReactionKind, number>>;
  /** What the asking wallet has reacted with, as `campaign:kind`. */
  mine: string[];
}
