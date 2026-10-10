"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Bar, Button, buttonClass, Notice, StatusBadge } from "@/components/ui";
import { useNow, usePolled, useProgram } from "@/lib/chain";
import { MINT, RPC_URL } from "@/lib/env";
import { firstFew, formatDuration, plural, shortAddress, usd } from "@/lib/format";
import {
  bonusSeatsLeft,
  buildEnd,
  type Campaign,
  fetchCampaigns,
  refundIfFailed,
  statusAt,
} from "@/lib/tanda-jadi";

export function CampaignList() {
  const program = useProgram();
  const now = useNow();
  const load = useCallback(async () => {
    const campaigns = await fetchCampaigns(program);
    return (
      campaigns
        .filter((campaign) => MINT !== null && campaign.mint.equals(MINT))
        // Ids are the creation time in milliseconds, so the largest is the newest.
        .sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1))
    );
  }, [program]);
  const { data: campaigns, error } = usePolled(MINT ? load : null);

  if (!MINT) return <SetupNotice />;
  if (!campaigns || now === null) {
    return error ? <NetworkNotice /> : <LoadingCards />;
  }
  if (campaigns.length === 0) {
    return (
      <Notice title="No campaigns yet">
        <p>Be the first to ask whether people want what you would build.</p>
        <Link href="/new" className={`${buttonClass("primary", "sm")} mt-5`}>
          Start a campaign
        </Link>
      </Notice>
    );
  }

  // What can still be joined comes first. What has ended stays on the page: it is the record of
  // how campaigns here actually turned out.
  const isOpen = (campaign: Campaign) => {
    const status = statusAt(campaign, now);
    return status === "funding" || status === "building";
  };
  const open = campaigns.filter(isOpen);
  const ended = campaigns.filter((campaign) => !isOpen(campaign));

  return (
    <div className="space-y-10">
      {open.length > 0 ? (
        <Cards campaigns={open} now={now} />
      ) : (
        <p className="text-sm leading-6 text-stone-600">
          No campaign is open right now.{" "}
          <Link href="/new" className="font-medium text-accent-ink underline underline-offset-2">
            Start one
          </Link>
          .
        </p>
      )}
      {ended.length > 0 && (
        <section aria-labelledby="ended-title">
          <h3 id="ended-title" className="text-sm font-medium text-stone-500">
            Ended
          </h3>
          <div className="mt-4">
            <EndedCards campaigns={ended} now={now} />
          </div>
        </section>
      )}
    </div>
  );
}

function Cards({ campaigns, now }: { campaigns: Campaign[]; now: number }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {campaigns.map((campaign) => (
        <li key={campaign.address.toBase58()}>
          <CampaignCard campaign={campaign} now={now} />
        </li>
      ))}
    </ul>
  );
}

const ENDED_SHOWN = 4;

/** The latest few, with the rest one click away. */
function EndedCards({ campaigns, now }: { campaigns: Campaign[]; now: number }) {
  const [all, setAll] = useState(false);
  const hidden = campaigns.length - ENDED_SHOWN;
  return (
    <>
      <Cards campaigns={all ? campaigns : campaigns.slice(0, ENDED_SHOWN)} now={now} />
      {hidden > 0 && !all && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAll(true)}>
          Show {hidden} more
        </Button>
      )}
    </>
  );
}

export function SetupNotice() {
  return (
    <Notice title="This site is not set up yet">
      <p>
        No demo token is configured. Run <code className="font-mono">npm run setup</code> in the{" "}
        <code className="font-mono">app</code> folder and restart the site.
      </p>
    </Notice>
  );
}

export function NetworkNotice() {
  return (
    <Notice title="The network cannot be reached">
      <p>
        Nothing answers at <span className="break-all font-mono text-xs">{RPC_URL}</span>. This
        page keeps trying.
      </p>
    </Notice>
  );
}

function LoadingCards() {
  return (
    <ul aria-busy className="grid gap-4 sm:grid-cols-2">
      {[0, 1].map((key) => (
        <li key={key} className="h-48 animate-pulse rounded-2xl border border-stone-200 bg-white" />
      ))}
    </ul>
  );
}

function CampaignCard({ campaign, now }: { campaign: Campaign; now: number }) {
  const status = statusAt(campaign, now);
  const bonusSeats = bonusSeatsLeft(campaign);
  const bonusBackers = Math.min(campaign.backers, campaign.earlySlots);

  return (
    <Link
      href={`/campaign/${campaign.address.toBase58()}`}
      className="flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-5 transition-colors hover:border-stone-400 sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-lg font-semibold leading-snug">
          {campaign.title || "Untitled campaign"}
        </h3>
        <StatusBadge status={status} />
      </div>
      <p className="mt-1 text-xs text-stone-500">
        by <span className="font-mono">{shortAddress(campaign.creator)}</span>
      </p>

      <div className="mt-5 flex items-baseline justify-between gap-3 text-sm">
        <p>
          <span className="text-base font-semibold">
            {campaign.backers} / {campaign.targetBackers}
          </span>{" "}
          <span className="text-stone-600">seats taken</span>
        </p>
        <p>
          <span className="text-base font-semibold">{usd(campaign.price)}</span>{" "}
          <span className="text-stone-600">a seat</span>
        </p>
      </div>
      <div className="mt-2">
        <Bar
          value={campaign.backers}
          max={campaign.targetBackers}
          label="Seats taken"
          tone={status === "funding" || status === "building" ? "accent" : "muted"}
        />
      </div>

      <div className="mt-4 space-y-1 text-sm text-stone-600">
        {status === "funding" && (
          <>
            <p>{formatDuration(campaign.deadline - now)} left to fill the seats</p>
            {bonusSeats > 0 && (
              <p className="font-medium text-accent-ink">
                {plural(bonusSeats, "bonus seat")} left — get{" "}
                {usd(refundIfFailed(campaign, campaign.backers))} back if this fails
              </p>
            )}
          </>
        )}
        {status === "building" && (
          <p>
            Build period{" "}
            {Math.floor((Math.max(0, now - campaign.fundedAt) * 100) / campaign.buildSecs)}%
            through, {formatDuration(buildEnd(campaign) - now)} left
          </p>
        )}
        {status === "failed" && (
          <p>
            Too few joined. Every deposit goes back
            {bonusBackers > 0 &&
              `, with a ${usd(campaign.bonusPerEarly)} bonus for ${firstFew(bonusBackers, "backer")}`}
            .
          </p>
        )}
        {status === "braked" && (
          <p>
            Backers pulled the brake. {usd(campaign.refundPerBacker)} goes back to each of them.
          </p>
        )}
        {status === "completed" && (
          <p>The build period ended without a brake. The money raised is the creator&apos;s.</p>
        )}
      </div>
    </Link>
  );
}
