import type { Connection, TransactionError } from "@solana/web3.js";

/** A transaction that was included in a block but failed there. */
export class TransactionFailedError extends Error {
  constructor(readonly reason: TransactionError) {
    super(`Transaction failed: ${JSON.stringify(reason)}`);
    this.name = "TransactionFailedError";
  }
}

export class TransactionExpiredError extends Error {
  constructor() {
    super("The transaction was not confirmed before it expired");
    this.name = "TransactionExpiredError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until `signature` is confirmed by asking for its status over plain HTTP. web3.js's own
 * `confirmTransaction` needs a websocket to the RPC node, which is the first thing to break
 * behind WSL port forwarding, proxies and free RPC plans.
 */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) throw new TransactionFailedError(status.err);
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }
    if (attempt % 5 === 4) {
      const height = await connection.getBlockHeight("confirmed");
      if (height > lastValidBlockHeight) throw new TransactionExpiredError();
    }
    await sleep(400);
  }
}
