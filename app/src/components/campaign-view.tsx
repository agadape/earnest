"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { NetworkNotice, SetupNotice } from "@/components/campaign-list";
import {
  BuildingPanel,
  CompletedPanel,
  FundingPanel,
  type PanelProps,
  RefundPanel,
} from "@/components/campaign-panels";
import { Share } from "@/components/share";
import { SeatTradesCard } from "@/components/seat-trades";
import { Bar, Card, Notice, StatusBadge, Tag } from "@/components/ui";
import { useNow, usePolled, useProgram } from "@/lib/chain";
import { MINT } from "@/lib/env";
import {
  formatDate,
  formatDuration,
  formatPercent,
  plural,
  shortAddress,
  usd,
} from "@/lib/format";
import { rememberPledge, useReceipt } from "@/lib/receipts";
import { sentence } from "@/lib/summary";
import {
  bond,
  buildEnd,
  type Campaign,
  fetchCampaign,
  fetchListing,
  fetchPledge,
  fetchPledges,
  type Pledge,
  refundFor,
  type Status,
  statusAt,
} from "@/lib/tanda-jadi";

const SEATS_SHOWN = 30;
const OPEN_SEATS_SHOWN = 4;

function parseAddress(text: string): PublicKey | null {
  try {
    return new PublicKey(text);
  } catch {
    return null;
  }
}

export function CampaignView({ address }: { address: string }) {
  const program = useProgram();
  const now = useNow();
  const { publicKey } = useWallet();
  const key = useMemo(() => parseAddress(address), [address]);

  const load = useMemo(() => {
    if (!key) return null;
    return async () => {
      const campaign = await fetchCampaign(program, key).catch((error: unknown) => {
        // An address that holds something else is "no campaign here", not a network problem.
        if (error instanceof Error && /discriminator|beyond buffer|decode/i.test(error.message)) {
          return null;
        }
        throw error;
      });
      return { campaign, pledges: campaign ? await fetchPledges(program, key) : [] };
    };
  }, [program, key]);
  const { data, error } = usePolled(load);

  // The viewer's own pledge is also asked for by its address. The list above would show it
  // too, but after a refund only this answer proves that the pledge is really gone.
  const loadOwn = useMemo(
    () => (key && publicKey ? () => fetchPledge(program, key, publicKey) : null),
    [program, key, publicKey],
  );
  const { data: own } = usePolled(loadOwn);

  if (!MINT) return <SetupNotice />;
  if (!key) {
    return (
      <Missing title="That is not a campaign address">
        The link you followed is incomplete or mistyped.
      </Missing>
    );
  }
  if (!data || now === null) {
    return error ? (
      <NetworkNotice />
    ) : (
      <div aria-busy className="space-y-4">
        <div className="h-10 w-2/3 animate-pulse rounded-lg bg-stone-200" />
        <div className="h-72 animate-pulse rounded-2xl border border-stone-200 bg-white" />
      </div>
    );
  }
  if (!data.campaign) {
    return (
      <Missing title="No campaign at this address">
        It may live on a different network than the one this site is connected to.
      </Missing>
    );
  }
  if (!data.campaign.mint.equals(MINT)) {
    return (
      <Missing title="This campaign uses a different currency">
        This site only shows campaigns priced in its own dollars.
      </Missing>
    );
  }
  return (
    <Loaded
      campaign={data.campaign}
      pledges={data.pledges}
      own={own}
      viewer={publicKey}
      now={now}
    />
  );
}

function Missing({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Notice title={title}>
      <p>{children}</p>
      <Link href="/" className="mt-4 inline-block text-accent hover:underline">
        See all campaigns
      </Link>
    </Notice>
  );
}

function Loaded({
  campaign,
  pledges,
  own,
  viewer,
  now,
}: {
  campaign: Campaign;
  pledges: Pledge[];
  /** The viewer's pledge fetched by address. `null`: there is none. `undefined`: not known yet. */
  own: Pledge | null | undefined;
  viewer: PublicKey | null;
  now: number;
}) {
  const address = campaign.address.toBase58();
  const wallet = viewer?.toBase58() ?? null;
  const status = statusAt(campaign, now);
  // Until the direct answer is in, the list of seats is the best guess.
  const mine =
    own !== undefined
      ? own
      : ((viewer && pledges.find((pledge) => pledge.backer.equals(viewer))) ?? null);

  // Written down while the pledge exists, because a refund or a sale removes it from the chain.
  const receipt = useReceipt(address, wallet);
  const mySeat = mine?.index;
  const stale = receipt?.index !== mySeat || receipt?.soldFor !== undefined;
  useEffect(() => {
    if (wallet && mySeat !== undefined && stale) rememberPledge(address, wallet, { index: mySeat });
  }, [address, wallet, mySeat, stale]);

  // A pledge that is gone was either refunded or sold. If this wallet had its seat on offer, the
  // offer tells them apart: buying a seat removes its offer, a refund leaves it standing.
  const program = useProgram();
  const offeredFor = own === null && !receipt?.soldFor ? receipt?.offeredFor : undefined;
  const loadOffer = useMemo(
    () =>
      viewer && offeredFor !== undefined
        ? () => fetchListing(program, campaign.address, viewer)
        : null,
    // The addresses as text: new PublicKey objects for the same accounts must not restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [program, address, wallet, offeredFor],
  );
  const { data: offer } = usePolled(loadOffer);
  useEffect(() => {
    if (wallet && receipt && offeredFor !== undefined && offer === null) {
      rememberPledge(address, wallet, {
        index: receipt.index,
        boughtFor: receipt.boughtFor,
        soldFor: offeredFor,
      });
    }
  }, [address, wallet, receipt, offeredFor, offer]);

  const soldFor = own === null && receipt?.soldFor ? BigInt(receipt.soldFor) : null;
  // Until an offered seat is known to be still on offer, it may have been sold: claim nothing.
  const undecided = offeredFor !== undefined && !offer;
  const refundedSeat =
    own === null &&
    receipt &&
    soldFor === null &&
    !undecided &&
    receipt.index < campaign.backers &&
    (status === "failed" || status === "braked")
      ? receipt.index
      : null;

  // Only while the note is about the seat in question: the one held now, or the one refunded.
  const boughtFor =
    receipt?.boughtFor && !receipt.soldFor && (mine ? mine.index === receipt.index : true)
      ? BigInt(receipt.boughtFor)
      : null;

  const panel: PanelProps = { campaign, pledges, mine, refundedSeat, soldFor, boughtFor, now };

  return (
    <div className="space-y-8">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h1 className="min-w-0 break-words text-3xl font-semibold leading-tight tracking-tight">
            {campaign.title || "Untitled campaign"}
          </h1>
          <StatusBadge status={status} />
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-600">
          <span>
            by <span className="font-mono">{shortAddress(campaign.creator)}</span>
          </span>
          {viewer?.equals(campaign.creator) && <Tag>You</Tag>}
          <SafeLink uri={campaign.uri} />
        </p>

        <div className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <div>
            <p className="text-sm text-stone-600">
              <span className="text-2xl font-semibold text-stone-900">
                {campaign.backers} / {campaign.targetBackers}
              </span>{" "}
              seats taken
            </p>
            <div className="mt-2">
              <Bar
                value={campaign.backers}
                max={campaign.targetBackers}
                label="Seats taken"
                tone={status === "funding" || status === "building" ? "accent" : "muted"}
              />
            </div>
          </div>
          <Fact label="A seat costs" value={usd(campaign.price)} />
          <Fact {...timing(campaign, status, now)} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {status === "funding" && <FundingPanel {...panel} />}
          {status === "building" && <BuildingPanel {...panel} />}
          {(status === "failed" || status === "braked") && <RefundPanel {...panel} />}
          {status === "completed" && <CompletedPanel {...panel} />}
          {status !== "funding" && status !== "building" && (
            <SeatTradesCard campaign={campaign} now={now} />
          )}
          <Seats
            campaign={campaign}
            pledges={pledges}
            status={status}
            viewer={viewer}
            refundedSeat={refundedSeat}
            now={now}
          />
        </div>
        <div className="space-y-6">
          <Terms campaign={campaign} />
          <Share address={address} text={sentence(campaign, status)} />
        </div>
      </div>
    </div>
  );
}

function timing(campaign: Campaign, status: Status, now: number): { label: string; value: string } {
  switch (status) {
    case "funding":
      return { label: "Time left to fill", value: formatDuration(campaign.deadline - now) };
    case "building":
      return { label: "Build time left", value: formatDuration(buildEnd(campaign) - now) };
    case "failed":
      return { label: "Closed on", value: formatDate(campaign.deadline) };
    case "braked":
      return { label: "Stopped on", value: formatDate(campaign.brakedAt) };
    case "completed":
      return { label: "Completed on", value: formatDate(buildEnd(campaign)) };
  }
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-stone-600">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

/** Creators type the link themselves, so only plain web addresses become clickable. */
function SafeLink({ uri }: { uri: string }) {
  if (!uri) return null;
  if (!/^https?:\/\//i.test(uri)) return <span className="break-all">{uri}</span>;
  return (
    <a
      href={uri}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="break-all text-accent hover:underline"
    >
      {uri.replace(/^https?:\/\//i, "")}
    </a>
  );
}

// ---------------------------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------------------------

interface Seat {
  index: number;
  /** `null` for a seat whose pledge was already refunded: the chain no longer says whose. */
  pledge: Pledge | null;
}

function Seats({
  campaign,
  pledges,
  status,
  viewer,
  refundedSeat,
  now,
}: {
  campaign: Campaign;
  pledges: Pledge[];
  status: Status;
  viewer: PublicKey | null;
  refundedSeat: number | null;
  now: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const refunding = status === "failed" || status === "braked";

  const byIndex = new Map(pledges.map((pledge) => [pledge.index, pledge]));
  const taken: Seat[] = refunding
    ? Array.from({ length: campaign.backers }, (_, index) => ({
        index,
        pledge: byIndex.get(index) ?? null,
      }))
    : pledges.map((pledge) => ({ index: pledge.index, pledge }));
  const visible = showAll ? taken : taken.slice(0, SEATS_SHOWN);

  const open = status === "funding" ? campaign.targetBackers - campaign.backers : 0;
  const openShown = Math.min(open, OPEN_SEATS_SHOWN);
  // Once the seats have filled, which of them were bonus seats no longer changes anything.
  const bonusMatters = status === "funding" || status === "failed";

  return (
    <Card>
      <h2 className="text-xl font-semibold tracking-tight">Seats</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        In the order people joined.
        {bonusMatters && (
          <>
            {" "}
            {campaign.earlySlots === 1
              ? "The first seat carries"
              : `The first ${campaign.earlySlots} seats carry`}{" "}
            the {usd(campaign.bonusPerEarly)} bonus
            {status === "funding" && " if the campaign does not fill"}.
          </>
        )}
      </p>

      {taken.length === 0 && open === 0 ? (
        <p className="mt-4 text-sm text-stone-600">Nobody pledged.</p>
      ) : (
        <ol className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
          {visible.map(({ index, pledge }) => {
            const isViewer =
              viewer !== null && (pledge ? pledge.backer.equals(viewer) : index === refundedSeat);
            const refund = refundFor(campaign, index, now);
            return (
              <SeatRow
                key={index}
                index={index}
                who={
                  pledge ? (
                    <span className="font-mono text-[13px]">{shortAddress(pledge.backer)}</span>
                  ) : (
                    <span className="text-stone-500">{isViewer ? "Your seat" : "A backer"}</span>
                  )
                }
                tags={
                  <>
                    {isViewer && <Tag tone="accent">You</Tag>}
                    {pledge?.backer.equals(campaign.creator) && <Tag>Creator</Tag>}
                    {bonusMatters && index < campaign.earlySlots && <Tag>Bonus seat</Tag>}
                  </>
                }
                note={
                  refund !== null
                    ? `${usd(refund)} ${pledge ? "to return" : "returned"}`
                    : status === "building" && pledge?.braked
                      ? "Holding the brake"
                      : null
                }
              />
            );
          })}
          {Array.from({ length: openShown }, (_, offset) => {
            const index = campaign.backers + offset;
            return (
              <SeatRow
                key={index}
                index={index}
                muted
                who={<span className="text-stone-500">Open</span>}
                tags={index < campaign.earlySlots && <Tag>Bonus seat</Tag>}
                note={offset === 0 ? "Next" : null}
              />
            );
          })}
        </ol>
      )}

      {(taken.length > visible.length || open > openShown) && (
        <p className="mt-3 text-sm text-stone-600">
          {open > openShown && `${plural(open - openShown, "more open seat")}. `}
          {taken.length > visible.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-accent hover:underline"
            >
              Show all {taken.length} taken seats
            </button>
          )}
        </p>
      )}
    </Card>
  );
}

function SeatRow({
  index,
  who,
  tags,
  note,
  muted = false,
}: {
  index: number;
  who: ReactNode;
  tags: ReactNode;
  note: string | null;
  muted?: boolean;
}) {
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm ${muted ? "opacity-70" : ""}`}>
      <span className="w-8 shrink-0 text-stone-500">{index + 1}</span>
      {who}
      <span className="flex flex-wrap gap-1.5">{tags}</span>
      {note && <span className="ml-auto text-stone-600">{note}</span>}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------------------------

function Terms({ campaign }: { campaign: Campaign }) {
  const rows: [string, ReactNode][] = [
    ["Price of a seat", usd(campaign.price)],
    ["Seats", campaign.targetBackers],
    [
      "Bonus if it doesn't fill",
      campaign.earlySlots === 1
        ? `${usd(campaign.bonusPerEarly)} for the first backer`
        : `${usd(campaign.bonusPerEarly)} each for the first ${campaign.earlySlots} backers`,
    ],
    ["Creator's bond", `${usd(bond(campaign))}, locked when the campaign opened`],
    ["Seats must fill by", formatDate(campaign.deadline)],
    [
      "Time to build",
      `${formatDuration(campaign.buildSecs)} from the moment the last seat is taken`,
    ],
    [
      "Paid to the creator",
      campaign.upfrontBps > 0
        ? `${formatPercent(campaign.upfrontBps)} when the seats fill, the rest evenly over the build period`
        : "Evenly over the build period, nothing at the start",
    ],
    ["Service fee", `${formatPercent(campaign.feeBps)}, only if the seats fill`],
  ];

  return (
    <Card>
      <h2 className="text-base font-semibold">Terms</h2>
      <p className="mt-1 text-sm text-stone-600">Fixed when the campaign opened. Nobody can change them.</p>
      <dl className="mt-4 space-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-stone-500">{label}</dt>
            <dd className="mt-0.5 leading-6">{value}</dd>
          </div>
        ))}
        <div>
          <dt className="text-stone-500">Creator</dt>
          <dd className="mt-0.5 break-all font-mono text-xs leading-5">
            {campaign.creator.toBase58()}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">Campaign</dt>
          <dd className="mt-0.5 break-all font-mono text-xs leading-5">
            {campaign.address.toBase58()}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
