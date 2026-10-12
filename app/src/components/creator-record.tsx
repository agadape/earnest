"use client";

import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useProgram } from "@/lib/chain";
import { MINT } from "@/lib/env";
import { plural } from "@/lib/format";
import { describeRecord, recordOf } from "@/lib/record";
import { type Campaign, fetchCampaigns } from "@/lib/tanda-jadi";

/**
 * Every campaign `creator` has opened here, newest first. Asked once per look: a record changes
 * when a campaign ends, not from one second to the next. `undefined` while loading, `null` if
 * the network did not answer.
 */
export function useCreatorCampaigns(creator: PublicKey | null): Campaign[] | null | undefined {
  const program = useProgram();
  const address = creator?.toBase58() ?? null;
  const [state, setState] = useState<{ address: string | null; campaigns?: Campaign[] | null }>({
    address: null,
  });

  useEffect(() => {
    if (!address || !MINT) return;
    let active = true;
    const mint = MINT;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A busy network gets three more tries, a little further apart each time, before giving up.
    const ask = (triesLeft: number) =>
      fetchCampaigns(program, new PublicKey(address))
        .then((all) =>
          all
            .filter((campaign) => campaign.mint.equals(mint))
            // Ids are the creation time in milliseconds, so the largest is the newest.
            .sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1)),
        )
        .then(
          (campaigns) => active && setState({ address, campaigns }),
          () => {
            if (!active) return;
            if (triesLeft === 0) setState({ address, campaigns: null });
            else timer = setTimeout(() => ask(triesLeft - 1), (4 - triesLeft) * 2500);
          },
        );
    ask(3);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [program, address]);

  return state.address === address ? state.campaigns : undefined;
}

/**
 * One line under a campaign's title: what else this wallet has opened, and how that went. A
 * backer is about to trust this creator with a deposit, so this is where the record belongs.
 */
export function CreatorRecordLine({ campaign, now }: { campaign: Campaign; now: number }) {
  const campaigns = useCreatorCampaigns(campaign.creator);
  if (!campaigns) return null;
  const others = campaigns.filter((other) => !other.address.equals(campaign.address));
  const href = `/?creator=${campaign.creator.toBase58()}`;

  if (others.length === 0) {
    return (
      <p className="mt-1 text-sm text-stone-600">This is the first campaign from this wallet.</p>
    );
  }
  return (
    <p className="mt-1 text-sm text-stone-600">
      {plural(others.length, "other campaign")} from this wallet:{" "}
      {describeRecord(recordOf(others, now))}.{" "}
      <Link href={href} className="text-accent hover:underline">
        See the record
      </Link>
    </p>
  );
}

