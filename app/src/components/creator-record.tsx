"use client";

import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { CampaignCards, NetworkNotice, SetupNotice } from "@/components/campaign-list";
import { Notice } from "@/components/ui";
import { useNow, useProgram } from "@/lib/chain";
import { MINT } from "@/lib/env";
import { plural, usd } from "@/lib/format";
import { describeRecord, recordOf } from "@/lib/record";
import { type Campaign, fetchCampaigns } from "@/lib/tanda-jadi";

/**
 * Every campaign `creator` has opened here, newest first. Asked once per page: a record changes
 * when a campaign ends, not from one second to the next. `undefined` while loading, `null` if
 * the network did not answer.
 */
function useCreatorCampaigns(creator: PublicKey | null): Campaign[] | null | undefined {
  const program = useProgram();
  const address = creator?.toBase58() ?? null;
  const [state, setState] = useState<{ address: string | null; campaigns?: Campaign[] | null }>({
    address: null,
  });

  useEffect(() => {
    if (!address || !MINT) return;
    let active = true;
    const mint = MINT;
    fetchCampaigns(program, new PublicKey(address))
      .then((all) =>
        all
          .filter((campaign) => campaign.mint.equals(mint))
          // Ids are the creation time in milliseconds, so the largest is the newest.
          .sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1)),
      )
      .then(
        (campaigns) => active && setState({ address, campaigns }),
        () => active && setState({ address, campaigns: null }),
      );
    return () => {
      active = false;
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
  const href = `/creator/${campaign.creator.toBase58()}`;

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

function parseAddress(text: string): PublicKey | null {
  try {
    return new PublicKey(text);
  } catch {
    return null;
  }
}

/** The page for one creator: the totals, then every campaign they opened. */
export function CreatorRecordView({ address }: { address: string }) {
  const now = useNow();
  const creator = useMemo(() => parseAddress(address), [address]);
  const campaigns = useCreatorCampaigns(creator);

  if (!MINT) return <SetupNotice />;
  if (!creator) {
    return (
      <Notice title="That is not a wallet address">
        <p>Check the link and try again.</p>
      </Notice>
    );
  }
  if (campaigns === null) return <NetworkNotice />;
  if (campaigns === undefined || now === null) {
    return <div aria-busy className="h-72 animate-pulse rounded-2xl bg-stone-200/60" />;
  }

  const record = recordOf(campaigns, now);
  const totals: { label: string; value: string; note?: string }[] = [
    { label: "Campaigns opened", value: String(record.opened) },
    {
      label: "Ran to the end",
      value: String(record.completed),
      note: record.earned > 0n ? `${usd(record.earned)} reached the creator` : undefined,
    },
    {
      label: "Didn't fill",
      value: String(record.failed),
      note:
        record.bonuses > 0n ? `${usd(record.bonuses)} paid to early backers in bonuses` : undefined,
    },
    {
      label: "Stopped by backers",
      value: String(record.braked),
      note:
        record.bondsLost > 0n ? `${usd(record.bondsLost)} of bonds went to backers` : undefined,
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm text-stone-500">Creator</p>
        <h1 className="mt-1 break-all font-mono text-xl font-semibold leading-snug sm:text-2xl">
          {address}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
          Everything here is read from the campaigns this wallet opened. A campaign that
          didn&apos;t fill is not a black mark: it means the creator asked before building, and
          paid the bonus they promised. One thing this cannot tell you: a creator can start over
          with a new wallet, so an empty record says nothing either way.
        </p>
      </header>

      {campaigns.length === 0 ? (
        <Notice title="No campaigns from this wallet">
          <p>It has not opened a campaign here.</p>
        </Notice>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {totals.map(({ label, value, note }) => (
              <div key={label} className="rounded-2xl border border-stone-200 bg-white p-5">
                <dt className="text-sm text-stone-500">{label}</dt>
                <dd className="mt-1 text-3xl font-semibold tracking-tight">{value}</dd>
                {note && <dd className="mt-1 text-sm leading-5 text-stone-600">{note}</dd>}
              </div>
            ))}
          </dl>
          <section aria-labelledby="creator-campaigns">
            <h2 id="creator-campaigns" className="text-xl font-semibold tracking-tight">
              Their campaigns
            </h2>
            <div className="mt-4">
              <CampaignCards campaigns={campaigns} now={now} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
