"use client";

import { type ReactNode, useMemo } from "react";

import { Bar, buttonClass, StatusBadge } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { useNow, usePolled, useProgram } from "@/lib/chain";
import { MINT } from "@/lib/env";
import { formatDuration, usd } from "@/lib/format";
import { findCampaign, parseAddress } from "@/lib/lookup";
import { hook, outcome, titleOf } from "@/lib/summary";
import { bonusSeatsLeft, buildEnd, type Campaign, statusAt } from "@/lib/tanda-jadi";

/**
 * A campaign as a small card, made to sit in an `<iframe>` on someone else's page. It only
 * reads the chain: whoever wants to pledge is sent to the campaign's page in a new tab, where
 * their wallet is.
 */
export function EmbedCard({ address }: { address: string }) {
  const program = useProgram();
  const now = useNow();
  const key = useMemo(() => parseAddress(address), [address]);
  const load = useMemo(
    () => (key && MINT ? () => findCampaign(program, key) : null),
    [program, key],
  );
  const { data: campaign, error } = usePolled(load);

  if (!MINT) return <Note>This site is not set up yet.</Note>;
  if (!key) return <Note>The address in this link is incomplete or mistyped.</Note>;
  if (campaign === undefined || now === null) {
    return error ? (
      <Note>The network cannot be reached. This card keeps trying.</Note>
    ) : (
      <Frame>
        <div aria-busy className="mt-3 flex-1 animate-pulse rounded-lg bg-stone-100" />
      </Frame>
    );
  }
  if (!campaign) return <Note>No campaign at this address.</Note>;
  if (!campaign.mint.equals(MINT)) return <Note>This campaign uses a different currency.</Note>;
  return <Loaded campaign={campaign} now={now} />;
}

/** The whole frame is the card: its border and corners are the `<iframe>`'s to draw. */
function Frame({ badge, children }: { badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-white p-4 text-sm">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <a
          href="/"
          target="_blank"
          rel="noopener"
          className="text-xs font-semibold tracking-tight text-stone-900 hover:text-accent"
        >
          {BRAND}
        </a>
        {badge}
      </div>
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <Frame>
      <p className="my-auto text-center text-stone-600">{children}</p>
    </Frame>
  );
}

function Loaded({ campaign, now }: { campaign: Campaign; now: number }) {
  const status = statusAt(campaign, now);
  const open = status === "funding";

  return (
    <Frame badge={<StatusBadge status={status} />}>
      <h1 className="mt-2 line-clamp-2 break-words text-base font-semibold leading-snug">
        {titleOf(campaign)}
      </h1>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <p>
          <span className="font-semibold">
            {campaign.backers} / {campaign.targetBackers}
          </span>{" "}
          <span className="text-stone-600">seats taken</span>
        </p>
        <p>
          <span className="font-semibold">{usd(campaign.price)}</span>{" "}
          <span className="text-stone-600">a seat</span>
        </p>
      </div>
      <div className="mt-1.5">
        <Bar
          value={campaign.backers}
          max={campaign.targetBackers}
          label="Seats taken"
          tone={open || status === "building" ? "accent" : "muted"}
        />
      </div>

      <div className="mt-2.5 text-[13px] leading-5 text-stone-600">
        {open ? (
          <>
            <p>{formatDuration(campaign.deadline - now)} left to fill the seats</p>
            {bonusSeatsLeft(campaign) > 0 && (
              <p className="font-medium text-accent-ink">{hook(campaign)}</p>
            )}
          </>
        ) : status === "building" ? (
          <p>
            Build period{" "}
            {Math.floor((Math.max(0, now - campaign.fundedAt) * 100) / campaign.buildSecs)}%
            through, {formatDuration(buildEnd(campaign) - now)} left
          </p>
        ) : (
          <p>{outcome(campaign, status)}</p>
        )}
      </div>

      <div className="mt-auto pt-3">
        <a
          href={`/campaign/${campaign.address.toBase58()}`}
          target="_blank"
          rel="noopener"
          className={`${buttonClass("primary", "sm")} w-full`}
        >
          {/* Nobody can pledge once the seats have filled or the deadline has passed. */}
          {open ? `Pledge on ${BRAND}` : `See it on ${BRAND}`}
        </a>
      </div>
    </Frame>
  );
}
