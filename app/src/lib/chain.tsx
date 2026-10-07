"use client";

import { getAccount, TokenAccountNotFoundError } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { type Connection, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { MINT } from "@/lib/env";
import { getProgram, type TandaJadiProgram, tokenAccount } from "@/lib/tanda-jadi";

const POLL_MS = 2_000;
const CLOCK_SYNC_MS = 15_000;

interface Chain {
  program: TandaJadiProgram;
  /** Goes up whenever something was sent, so every poll runs again at once. */
  version: number;
  refresh(): void;
}

const ChainContext = createContext<Chain | null>(null);
const ClockContext = createContext<number | null>(null);
const BalanceContext = createContext<bigint | null>(null);

function useChain(): Chain {
  const chain = useContext(ChainContext);
  if (!chain) throw new Error("This component needs <ChainProvider>");
  return chain;
}

export const useProgram = () => useChain().program;

/** Makes every poll on the page run again now instead of at its next turn. */
export const useRefresh = () => useChain().refresh;

/**
 * The cluster's time in Unix seconds, or `null` until it is known. Deadlines are decided by the
 * validators' clock, which can be seconds away from this computer's.
 */
export const useNow = () => useContext(ClockContext);

/** The connected wallet's dollars in base units. `null` without a wallet or while loading. */
export const useBalance = () => useContext(BalanceContext);

/**
 * Calls `load` now, every two seconds, and after every `refresh()`. Pass a function made with
 * `useCallback`: a new function identity means "different data" and clears the old result.
 */
export function usePolled<T>(load: (() => Promise<T>) | null): {
  data: T | undefined;
  error: unknown;
} {
  const { version } = useChain();
  const [state, setState] = useState<{ load: unknown; data?: T; error?: unknown }>({
    load: null,
  });

  useEffect(() => {
    if (!load) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      try {
        const data = await load();
        if (active) setState({ load, data });
      } catch (error) {
        // Keep showing the last good answer; one failed poll is not worth blanking the page.
        if (active) {
          setState((previous) => ({
            load,
            data: previous.load === load ? previous.data : undefined,
            error,
          }));
        }
      }
      if (active) timer = setTimeout(run, POLL_MS);
    };
    run();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load, version]);

  return state.load === load && load
    ? { data: state.data, error: state.error }
    : { data: undefined, error: undefined };
}

/** What the program will read as "now": the timestamp of the most recent confirmed block. */
async function clusterTime(connection: Connection): Promise<number> {
  try {
    const time = await connection.getBlockTime(await connection.getSlot("confirmed"));
    if (time !== null) return time;
  } catch {
    // Some nodes cannot answer for the newest slot yet. The clock account below always can.
  }
  const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  if (!clock) throw new Error("the cluster did not report its time");
  // Layout: slot, epoch start timestamp, epoch, leader schedule epoch, unix timestamp.
  return Number(clock.data.readBigInt64LE(32));
}

function useClusterClock(connection: Connection): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Cluster time minus this computer's time, in seconds.
    let offset: number | null = null;

    const tick = () => {
      if (offset !== null) setNow(Math.floor(Date.now() / 1000 + offset));
    };
    const sync = async () => {
      let again = CLOCK_SYNC_MS;
      try {
        const time = await clusterTime(connection);
        // Measured when the answer arrives, so the estimate errs towards "slightly behind":
        // an action that needs a deadline to have passed is then never offered too early.
        offset = time - Date.now() / 1000;
        if (active) tick();
      } catch {
        again = POLL_MS;
      }
      if (active) timer = setTimeout(sync, again);
    };
    sync();
    const ticker = setInterval(tick, 1000);

    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(ticker);
    };
  }, [connection]);

  return now;
}

function BalanceProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  const load = useMemo(() => {
    if (!publicKey || !MINT) return null;
    const account = tokenAccount(MINT, publicKey);
    return async () => {
      try {
        return (await getAccount(connection, account)).amount;
      } catch (error) {
        if (error instanceof TokenAccountNotFoundError) return 0n;
        throw error;
      }
    };
  }, [connection, publicKey]);
  const { data } = usePolled(load);

  return <BalanceContext.Provider value={data ?? null}>{children}</BalanceContext.Provider>;
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const program = useMemo(() => getProgram(connection), [connection]);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((current) => current + 1), []);
  const chain = useMemo(() => ({ program, version, refresh }), [program, version, refresh]);
  const now = useClusterClock(connection);

  return (
    <ChainContext.Provider value={chain}>
      <ClockContext.Provider value={now}>
        <BalanceProvider>{children}</BalanceProvider>
      </ClockContext.Provider>
    </ChainContext.Provider>
  );
}
