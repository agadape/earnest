"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { type PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { useCallback, useState } from "react";

import { useToasts } from "@/components/toasts";
import { useRefresh } from "@/lib/chain";
import { confirmSignature } from "@/lib/confirm";
import { explainError } from "@/lib/errors";

export interface Action {
  /** Shown while the transaction is on its way, e.g. "Pledging $10.00". */
  pending: string;
  /** Shown once it is confirmed. */
  done: string;
  /**
   * The instructions to send, built for the wallet that pays the fee. Return one inner list per
   * transaction; most actions have exactly one.
   */
  build(payer: PublicKey): Promise<TransactionInstruction[][]>;
}

/**
 * The one way this app changes anything on chain: build the instructions, have the connected
 * wallet sign and send them, wait for confirmation, then reload what the page shows.
 *
 * `busy` is the `key` of the action in flight, so a button can show that it is the one working
 * while its neighbours are disabled.
 */
export function useSend() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signAllTransactions } = useWallet();
  const toasts = useToasts();
  const refresh = useRefresh();
  const [busy, setBusy] = useState<string | null>(null);

  const send = useCallback(
    async (key: string, action: Action): Promise<boolean> => {
      if (!publicKey) {
        toasts.show("error", "Connect a wallet first.");
        return false;
      }
      setBusy(key);
      const toast = toasts.show("pending", `${action.pending}…`);
      try {
        const groups = (await action.build(publicKey)).filter((group) => group.length > 0);
        if (groups.length === 0) throw new Error("There is nothing left to send");

        const latest = await connection.getLatestBlockhash("confirmed");
        const transactions = groups.map((instructions) =>
          new Transaction({ feePayer: publicKey, ...latest }).add(...instructions),
        );

        // A batch is signed in one go where the wallet can, so it asks for approval only once.
        const signed =
          transactions.length > 1 && signAllTransactions
            ? await signAllTransactions(transactions)
            : null;
        for (const [index, transaction] of transactions.entries()) {
          if (transactions.length > 1) {
            const step = `${index + 1} of ${transactions.length}`;
            toasts.update(toast, "pending", `${action.pending} (${step})…`);
          }
          const signature = signed
            ? await connection.sendRawTransaction(signed[index].serialize())
            : await sendTransaction(transaction, connection);
          await confirmSignature(connection, signature, latest.lastValidBlockHeight);
        }

        toasts.update(toast, "success", action.done);
        return true;
      } catch (error) {
        toasts.update(toast, "error", explainError(error));
        return false;
      } finally {
        // Also after a failure: part of a batch may have gone through, or the page was stale.
        refresh();
        setBusy(null);
      }
    },
    [connection, publicKey, sendTransaction, signAllTransactions, toasts, refresh],
  );

  return { send, busy };
}
