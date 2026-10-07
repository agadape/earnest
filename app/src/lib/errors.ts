import { TransactionExpiredError, TransactionFailedError } from "@/lib/confirm";
import idl from "@/lib/tanda-jadi/idl.json";

const PROGRAM_MESSAGES = new Map(idl.errors.map((error) => [error.code, error]));

// The program's own messages are used as they are, except where they use a word the interface
// calls something else ("early slots" are "bonus seats" here, a "URI" is a "link").
const REWORDED: Record<string, string> = {
  InvalidEarlySlots: "Bonus seats must be between one and the number of seats.",
  InvalidBonus: "The bonus per seat must be greater than zero.",
  InvalidDuration: "Each time period must be longer than zero and within its limit.",
  TextTooLong: "The title or the link is too long.",
  MathOverflow: "These amounts are too large.",
  NotFunding: "This campaign is no longer taking pledges.",
  NothingToWithdraw: "There is nothing to send to the creator yet.",
};

// How validators say that the wallet paying the fee is empty or does not exist yet.
const NO_SOL =
  /no record of a prior credit|insufficient lamports|insufficient funds for (fee|rent)/i;

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

function programMessage(code: number): string | null {
  const known = PROGRAM_MESSAGES.get(code);
  return known ? (REWORDED[known.name] ?? sentence(known.msg)) : null;
}

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  logs?: unknown;
  error?: unknown;
}

/** The error itself followed by whatever it wraps: wallet adapters keep the cause in `.error`. */
function chain(error: unknown): ErrorLike[] {
  const links: ErrorLike[] = [];
  let current = error;
  while (current && typeof current === "object" && links.length < 5) {
    links.push(current as ErrorLike);
    current = (current as ErrorLike).error ?? (current as { cause?: unknown }).cause;
  }
  return links;
}

/** `{ InstructionError: [1, { Custom: 6010 }] }` → `6010`. */
function customCode(reason: unknown): number | null {
  const instructionError = (reason as { InstructionError?: unknown } | null)?.InstructionError;
  if (!Array.isArray(instructionError)) return null;
  const custom = (instructionError[1] as { Custom?: unknown } | null)?.Custom;
  return typeof custom === "number" ? custom : null;
}

function explainCode(code: number, text: string): string | null {
  const fromProgram = programMessage(code);
  if (fromProgram) return fromProgram;
  // The token program's "insufficient funds".
  if (code === 1) return "This wallet does not hold enough dollars for that.";
  // The system program refusing to create an account that exists: a second pledge.
  if (code === 0 && /already in use/.test(text)) {
    return "This wallet already has a pledge on this campaign.";
  }
  return null;
}

/** Turns whatever a wallet, the RPC node or the program threw into one plain sentence. */
export function explainError(error: unknown): string {
  const links = chain(error);
  if (links.some((link) => link instanceof TransactionExpiredError)) {
    return "The network did not confirm this in time. Nothing was paid. Please try again.";
  }
  const failure = links.find(
    (link): link is TransactionFailedError => link instanceof TransactionFailedError,
  );
  if (failure) {
    const code = customCode(failure.reason);
    return (code !== null && explainCode(code, "")) || "The network rejected this transaction.";
  }

  const logs = links.flatMap((link) =>
    Array.isArray(link.logs) ? link.logs.filter((line) => typeof line === "string") : [],
  );
  const text = [
    ...links.map((link) => (typeof link.message === "string" ? link.message : "")),
    ...logs,
  ].join("\n");

  if (/user rejected|rejected the request|user denied|cancell?ed/i.test(text)) {
    return "You cancelled the request in your wallet.";
  }

  // Programs written with Anchor log the name, number and message of the error they raise.
  const logged = /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.+?)\.?$/m.exec(text);
  if (logged) {
    const [, name, number, message] = logged;
    const fromProgram = programMessage(Number(number));
    if (fromProgram) return fromProgram;
    if (name === "AccountNotInitialized" && /account: (backer|creator)_token/.test(text)) {
      return "This wallet does not hold any dollars yet.";
    }
    if (name === "AccountNotInitialized" && /account: pledge/.test(text)) {
      return "That pledge was already returned.";
    }
    return sentence(message);
  }

  const custom = /custom program error: 0x([0-9a-f]+)/i.exec(text);
  if (custom) {
    const explained = explainCode(parseInt(custom[1], 16), text);
    if (explained) return explained;
  }

  if (NO_SOL.test(text)) {
    return "This wallet has no SOL to pay the network fee.";
  }
  if (/blockhash not found|block height exceeded/i.test(text)) {
    return "The network did not confirm this in time. Nothing was paid. Please try again.";
  }
  if (/failed to fetch|networkerror|load failed|econnrefused|fetch failed/i.test(text)) {
    return "The network cannot be reached right now.";
  }
  if (links.some((link) => link.name === "WalletNotConnectedError")) {
    return "Connect a wallet first.";
  }

  const first = links
    .map((link) => (typeof link.message === "string" ? link.message.split("\n")[0].trim() : ""))
    .find((message) => message.length > 0);
  return first ? sentence(first.slice(0, 200)) : "Something went wrong. Please try again.";
}
