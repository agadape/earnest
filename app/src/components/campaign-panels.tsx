"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import type { ReactNode } from "react";

import { CreatorUpdates, silence, useJournal } from "@/components/creator-updates";
import { FaucetButton } from "@/components/faucet-button";
import { SeatMarket } from "@/components/seat-market";
import { Bar, Button, Card } from "@/components/ui";
import { useConnectDialog } from "@/components/wallet-button";
import { useAutoSettle } from "@/lib/auto-settle";
import { useBalance, useProgram } from "@/lib/chain";
import { firstFew, formatDate, formatDuration, usd } from "@/lib/format";
import { REFUNDS_PER_TRANSACTION } from "@/lib/settle";
import {
  BPS_DENOMINATOR,
  bond,
  brakesNeeded,
  buildEnd,
  type Campaign,
  claimRefundIxs,
  creatorClaimable,
  fee,
  fetchPledges,
  type Pledge,
  pledgeIx,
  raised,
  refundFor,
  refundIfBrakedAt,
  refundIfFailed,
  setBrakeIx,
  statusAt,
  streamTotal,
  upfront,
  vestedAt,
  withdrawIxs,
} from "@/lib/tanda-jadi";
import { useSend } from "@/lib/transactions";

const REST_AFTER_BRAKE =
  "The rest had already left the vault before the brake: released to the creator, or taken as the service fee.";

export interface PanelProps {
  campaign: Campaign;
  /** Pledges still on chain, in queue order. Refunded ones are gone. */
  pledges: Pledge[];
  /** The connected wallet's pledge, if it has one that was not refunded. */
  mine: Pledge | null;
  /** The seat this wallet held before its pledge was refunded, as this browser remembers it. */
  refundedSeat: number | null;
  /** What this wallet sold its seat for, if this browser saw that happen. */
  soldFor: bigint | null;
  /** What this wallet paid another backer for its seat, if it bought it in this browser. */
  boughtFor: bigint | null;
  now: number;
}

const share = (amount: bigint, bps: number) => (amount * BigInt(bps)) / BPS_DENOMINATOR;

function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm leading-6 text-stone-600">{children}</p>;
}

// ---------------------------------------------------------------------------------------------
// Taking pledges
// ---------------------------------------------------------------------------------------------

export function FundingPanel(props: PanelProps) {
  const { campaign, pledges, mine, now } = props;
  return (
    <>
      <FundingCard {...props} />
      <SeatMarket campaign={campaign} pledges={pledges} mine={mine} now={now} />
    </>
  );
}

function FundingCard({ campaign, mine, now }: PanelProps) {
  const seat = mine?.index ?? campaign.backers;
  const refund = refundIfFailed(campaign, seat);
  const hasBonus = refund > campaign.price;
  const upfrontShare = share(campaign.price, campaign.upfrontBps);
  const feeShare = share(campaign.price, campaign.feeBps);
  const oneSeat = campaign.targetBackers === 1;

  return (
    <Card>
      <h2 className="text-xl font-semibold tracking-tight">
        What happens to your {usd(campaign.price)}
      </h2>
      <Lead>
        {mine ? "You hold" : "You would take"} seat {seat + 1} of {campaign.targetBackers}. Both
        ways this can end are written into the campaign and cannot be changed.
      </Lead>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-stone-200 p-4">
          <p className="text-sm text-stone-500">
            {oneSeat
              ? "If the seat is taken in time"
              : `If all ${campaign.targetBackers} seats fill in time`}
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">It gets built</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-stone-700">
            {upfrontShare > 0n && (
              <li>
                <strong className="font-semibold">{usd(upfrontShare)}</strong> of your deposit
                goes to the creator at once.
              </li>
            )}
            <li>
              <strong className="font-semibold">
                {usd(campaign.price - upfrontShare - feeShare)}
              </strong>{" "}
              reaches them evenly over the {formatDuration(campaign.buildSecs)} they have to
              build it.
            </li>
            {feeShare > 0n && (
              <li>
                <strong className="font-semibold">{usd(feeShare)}</strong> is the service fee.
              </li>
            )}
            <li>
              Until the build period ends, backers can pull a brake. If more than half do, the
              money not yet released comes back, along with the creator&apos;s{" "}
              {usd(bond(campaign))} bond.
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-accent-line bg-accent-soft p-4">
          <p className="text-sm text-accent-ink">
            {oneSeat ? "If it is not taken by" : "If they don't fill by"}{" "}
            {formatDate(campaign.deadline)}
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-accent-ink">
            {usd(refund)} back
          </p>
          <p className="mt-3 text-sm leading-6 text-stone-700">
            {hasBonus ? (
              <>
                Your {usd(campaign.price)} plus a{" "}
                <strong className="font-semibold">{usd(campaign.bonusPerEarly)} bonus</strong> from
                the creator&apos;s bond, because{" "}
                {campaign.earlySlots === 1
                  ? "the first seat carries it"
                  : `seat ${seat + 1} is one of the first ${campaign.earlySlots}`}
                .
              </>
            ) : (
              <>
                Your whole deposit. The bonus went to {firstFew(campaign.earlySlots, "seat")},
                and {campaign.earlySlots === 1 ? "that one is" : "those are"} taken.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-6 border-t border-stone-200 pt-5">
        {mine ? (
          <p className="text-sm leading-6">
            <strong className="font-semibold">You are in.</strong> Your {usd(campaign.price)} is
            in the vault. Nothing more to do: this page shows what happens when the seats fill or
            the time runs out, in {formatDuration(campaign.deadline - now)}.
          </p>
        ) : (
          <PledgeAction campaign={campaign} />
        )}
      </div>
    </Card>
  );
}

function PledgeAction({ campaign }: { campaign: Campaign }) {
  const { publicKey } = useWallet();
  const openConnect = useConnectDialog();
  const balance = useBalance();
  const program = useProgram();
  const { send, busy } = useSend();

  if (!publicKey) {
    return <Button onClick={openConnect}>Connect a wallet to pledge</Button>;
  }
  if (balance !== null && balance < campaign.price) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="text-sm leading-6 text-stone-700">
          A seat costs {usd(campaign.price)}. This wallet holds {usd(balance)}.
        </p>
        <FaucetButton variant="primary" />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <Button
        disabled={balance === null}
        busy={busy === "pledge"}
        onClick={() =>
          send("pledge", {
            pending: `Pledging ${usd(campaign.price)}`,
            done: `You pledged ${usd(campaign.price)}. Your seat is taken.`,
            build: async (payer) => [[await pledgeIx(program, campaign, payer)]],
          })
        }
      >
        Pledge {usd(campaign.price)}
      </Button>
      <p className="text-sm text-stone-600">One pledge per wallet.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Being built
// ---------------------------------------------------------------------------------------------

export function BuildingPanel({ campaign, pledges, mine, now }: PanelProps) {
  const program = useProgram();
  const { send, busy } = useSend();

  const released = upfront(campaign) + vestedAt(campaign, now);
  const total = upfront(campaign) + streamTotal(campaign);
  const needed = brakesNeeded(campaign);
  const ifBrakedNow = refundIfBrakedAt(campaign, now);
  const wouldDecide = mine !== null && !mine.braked && campaign.brakes + 1 >= needed;
  const journal = useJournal(campaign);
  const quiet = silence(campaign, journal, now);

  return (
    <>
      <Card>
        <h2 className="text-xl font-semibold tracking-tight">Being built</h2>
        <Lead>
          The last seat was taken on {formatDate(campaign.fundedAt)}. Since then the money has
          been reaching the creator a little every second, until {formatDate(buildEnd(campaign))}.
        </Lead>

        <p className="mt-5 text-sm text-stone-500">Released to the creator so far</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight">
          {usd(released)}{" "}
          <span className="text-base font-normal text-stone-500">of {usd(total)}</span>
        </p>
        <div className="mt-3">
          <Bar
            value={Math.max(0, now - campaign.fundedAt)}
            max={campaign.buildSecs}
            label="Build period elapsed"
          />
        </div>
        <p className="mt-2 text-sm text-stone-600">
          {formatDuration(buildEnd(campaign) - now)} left.
          {upfront(campaign) > 0n && ` ${usd(upfront(campaign))} was released at the start.`}
        </p>

        <CreatorPayout campaign={campaign} now={now} />
      </Card>

      <CreatorUpdates campaign={campaign} journal={journal} now={now} always />

      <Card>
        <h2 className="text-xl font-semibold tracking-tight">The brake</h2>
        <Lead>
          If the creator goes quiet, backers can stop the money. It takes more than half of
          them. Once that many hold the brake, what has not been released goes back to the
          backers, together with the creator&apos;s {usd(bond(campaign))} bond.
        </Lead>
        {quiet && <p className="mt-3 text-sm font-medium text-stone-800">{quiet}</p>}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-stone-200 p-4">
            <p className="text-sm text-stone-500">Holding the brake</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              {campaign.brakes} of {needed} needed
            </p>
            <div className="mt-3">
              <Bar value={campaign.brakes} max={needed} label="Brakes held" tone="muted" />
            </div>
          </div>
          <div className="rounded-xl border border-stone-200 p-4">
            <p className="text-sm text-stone-500">If it stopped right now</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{usd(ifBrakedNow)} back</p>
            <p className="mt-3 text-sm text-stone-600">
              to each backer, of the {usd(campaign.price)} they put in. This shrinks as the build
              goes on.
            </p>
          </div>
        </div>

        <div className="mt-5 border-t border-stone-200 pt-5">
          {mine ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <Button
                variant={mine.braked ? "secondary" : "primary"}
                busy={busy === "brake"}
                onClick={() =>
                  send("brake", {
                    pending: mine.braked ? "Releasing your brake" : "Pulling your brake",
                    done: mine.braked
                      ? "You released your brake."
                      : wouldDecide
                        ? "You pulled the brake. The stream has stopped."
                        : "You are holding the brake.",
                    build: async (payer) => [
                      [await setBrakeIx(program, campaign.address, payer, !mine.braked)],
                    ],
                  })
                }
              >
                {mine.braked ? "Release my brake" : "Pull the brake"}
              </Button>
              <p className="min-w-0 flex-1 basis-56 text-sm leading-6 text-stone-600">
                {mine.braked
                  ? "You are holding the brake. You can let go as long as the stream is running."
                  : wouldDecide
                    ? "Yours would be the deciding one: the stream stops for good and cannot be restarted."
                    : "You can let go again as long as the stream is running."}
              </p>
            </div>
          ) : (
            <p className="text-sm text-stone-600">Only wallets that hold a seat can pull the brake.</p>
          )}
        </div>
      </Card>

      <SeatMarket campaign={campaign} pledges={pledges} mine={mine} now={now} />
    </>
  );
}

/** "Send $X to the creator", for anyone, whenever the vault holds money that is theirs by now. */
function CreatorPayout({
  campaign,
  now,
  note = "It is theirs but still in the vault.",
}: {
  campaign: Campaign;
  now: number;
  note?: string;
}) {
  const { publicKey } = useWallet();
  const program = useProgram();
  const { send, busy } = useSend();
  const claimable = creatorClaimable(campaign, now);
  if (claimable <= 0n) return null;

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-stone-200 pt-5">
      <Button
        variant="secondary"
        disabled={!publicKey}
        busy={busy === "withdraw"}
        onClick={() =>
          send("withdraw", {
            pending: "Sending the creator their money",
            done: "The money has reached the creator.",
            build: async (payer) => [await withdrawIxs(program, campaign, payer)],
          })
        }
      >
        Send {usd(claimable)} to the creator
      </Button>
      <p className="min-w-0 flex-1 basis-56 text-sm leading-6 text-stone-600">
        {note} Anyone can send it; it can only go to the creator.
        {!publicKey && " Connect a wallet to do so."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Failed or braked: money goes back
// ---------------------------------------------------------------------------------------------

export function RefundPanel({
  campaign,
  pledges,
  mine,
  refundedSeat,
  soldFor,
  boughtFor,
  now,
}: PanelProps) {
  const { publicKey } = useWallet();
  const program = useProgram();
  const { send, busy } = useSend();
  const failed = statusAt(campaign, now) === "failed";
  const bonusBackers = Math.min(campaign.backers, campaign.earlySlots);

  const seat = mine?.index ?? refundedSeat;
  const refund = seat === null ? null : refundFor(campaign, seat, now);
  const bonus = refund !== null && refund > campaign.price ? refund - campaign.price : 0n;

  // The server sends refunds and payouts by itself where it can; the buttons are the fallback.
  const claimable = creatorClaimable(campaign, now);
  const settle = useAutoSettle(campaign.address, pledges.length > 0 || claimable > 0n);
  const manual = settle === "unavailable" || settle === "failed";

  return (
    <Card>
      <h2 className="text-xl font-semibold tracking-tight">
        {failed ? "This campaign didn't fill" : "Backers stopped this build"}
      </h2>
      {failed ? (
        <Lead>
          {campaign.backers} of {campaign.targetBackers} seats were taken by{" "}
          {formatDate(campaign.deadline)}.{" "}
          {campaign.backers === 0 ? (
            "Nobody pledged, so there is nothing to return."
          ) : (
            <>
              Every deposit goes back to its backer, and {firstFew(bonusBackers, "backer")} also{" "}
              {bonusBackers === 1 ? "gets" : "get"} {usd(campaign.bonusPerEarly)} from the
              creator&apos;s bond.
            </>
          )}
        </Lead>
      ) : (
        <Lead>
          On {formatDate(campaign.brakedAt)} more than half of the backers were holding the
          brake, and the stream stopped. What had not been released, plus the creator&apos;s{" "}
          {usd(bond(campaign))} bond, is split between the backers:{" "}
          {usd(campaign.refundPerBacker)} each.
        </Lead>
      )}

      {refund !== null && mine && (
        <div className="mt-5 rounded-xl border border-accent-line bg-accent-soft p-5">
          <p className="text-sm text-accent-ink">
            {manual ? "Yours to take back" : "On its way back to your wallet"}
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-accent-ink">
            {usd(refund)}
          </p>
          <p className="mt-2 text-sm leading-6 text-stone-700">
            {bonus > 0n
              ? `Your ${usd(campaign.price)} deposit plus a ${usd(bonus)} bonus from the creator's bond.`
              : refund < campaign.price
                ? `Of the ${usd(campaign.price)} you put in. ${REST_AFTER_BRAKE}`
                : "Your whole deposit."}
          </p>
          {manual ? (
            <Button
              className="mt-4"
              busy={busy === "refund"}
              disabled={busy !== null}
              onClick={() =>
                send("refund", {
                  pending: `Returning ${usd(refund)} to your wallet`,
                  done: `${usd(refund)} is back in your wallet.`,
                  build: async (payer) => [
                    await claimRefundIxs(program, campaign, mine.backer, payer),
                  ],
                })
              }
            >
              Take back {usd(refund)}
            </Button>
          ) : (
            <p className="mt-4 text-sm leading-6 text-stone-600" aria-live="polite">
              Nothing to click. It is being sent to your wallet now and will show up in a moment.
            </p>
          )}
        </div>
      )}

      {refund !== null && !mine && (
        <div className="mt-5 rounded-xl border border-accent-line bg-accent-soft p-5">
          <p className="text-sm text-accent-ink">Returned to your wallet</p>
          <p className="mt-1 text-2xl font-semibold leading-tight tracking-tight text-accent-ink sm:text-3xl">
            {boughtFor !== null
              ? `You paid ${usd(boughtFor)} for this seat. It paid back ${usd(refund)}.`
              : `You put in ${usd(campaign.price)}. You got back ${usd(refund)}.`}
          </p>
          <p className="mt-2 text-sm leading-6 text-stone-700">
            {boughtFor !== null
              ? bonus > 0n
                ? `You bought it from another backer. It paid back its ${usd(campaign.price)} deposit plus the ${usd(bonus)} bonus that came with its place in line, out of the creator's bond.`
                : "You bought it from another backer. What it paid back is what was left for each seat."
              : bonus > 0n
                ? `The extra ${usd(bonus)} is your bonus for joining early. It came out of the creator's bond.`
                : refund < campaign.price
                  ? REST_AFTER_BRAKE
                  : "That is your whole deposit."}
          </p>
        </div>
      )}

      {soldFor !== null && !mine && (
        <div className="mt-5 rounded-xl border border-stone-200 p-5">
          <p className="text-sm text-stone-500">You sold your seat</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            You put in {usd(campaign.price)}. You sold for {usd(soldFor)}.
          </p>
          <p className="mt-2 text-sm leading-6 text-stone-700">
            The seat was someone else&apos;s when this ended, so what it paid back went to them.
          </p>
        </div>
      )}

      {pledges.length > 0 && !manual ? (
        <p className="mt-5 border-t border-stone-200 pt-5 text-sm leading-6 text-stone-600">
          {pledges.length === 1
            ? "1 deposit is being returned to its backer."
            : `${pledges.length} deposits are being returned to their backers.`}{" "}
          Nobody has to click, and each can only go to its own backer.
        </p>
      ) : pledges.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-stone-200 pt-5">
          <Button
            variant="secondary"
            disabled={!publicKey || busy !== null}
            busy={busy === "refund-all"}
            onClick={() =>
              send("refund-all", {
                pending: "Returning everyone's money",
                done: "Every deposit is back with its backer.",
                build: async (payer) => {
                  // Asked again at the last moment: someone else may have returned some already.
                  const remaining = await fetchPledges(program, campaign.address);
                  const groups = [];
                  for (let i = 0; i < remaining.length; i += REFUNDS_PER_TRANSACTION) {
                    const batch = remaining.slice(i, i + REFUNDS_PER_TRANSACTION);
                    const instructions = await Promise.all(
                      batch.map(({ backer }) => claimRefundIxs(program, campaign, backer, payer)),
                    );
                    groups.push(instructions.flat());
                  }
                  return groups;
                },
              })
            }
          >
            Return everyone&apos;s money
          </Button>
          <p className="min-w-0 flex-1 basis-56 text-sm leading-6 text-stone-600">
            {pledges.length === 1
              ? "1 deposit still waits in the vault. Anyone can send it back; it can only go to its own backer."
              : `${pledges.length} deposits still wait in the vault. Anyone can send them back; each can only go to its own backer.`}
            {!publicKey && " Connect a wallet to do so."}
          </p>
        </div>
      ) : (
        campaign.backers > 0 && (
          <p className="mt-5 border-t border-stone-200 pt-5 text-sm text-stone-600">
            {campaign.backers === 1
              ? "The deposit has been returned."
              : `All ${campaign.backers} deposits have been returned.`}
          </p>
        )
      )}

      {manual ? (
        <CreatorPayout
          campaign={campaign}
          now={now}
          note={
            failed
              ? "This part of the creator's bond was not needed for bonuses."
              : "This was released to the creator before the brake."
          }
        />
      ) : (
        claimable > 0n && (
          <p className="mt-5 border-t border-stone-200 pt-5 text-sm leading-6 text-stone-600">
            {usd(claimable)} is being sent to the creator:{" "}
            {failed
              ? "the part of their bond that was not needed for bonuses."
              : "what was released to them before the brake."}
          </p>
        )
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Completed
// ---------------------------------------------------------------------------------------------

export function CompletedPanel({ campaign, mine, now }: PanelProps) {
  const claimable = creatorClaimable(campaign, now);
  const settle = useAutoSettle(campaign.address, claimable > 0n);
  const manual = settle === "unavailable" || settle === "failed";
  const totals: [string, bigint][] = [
    ["Raised", raised(campaign)],
    ["To the creator", upfront(campaign) + streamTotal(campaign)],
    ["Service fee", fee(campaign)],
    ["Bond returned", bond(campaign)],
  ];

  return (
    <Card>
      <h2 className="text-xl font-semibold tracking-tight">Completed</h2>
      <Lead>
        The build period ended on {formatDate(buildEnd(campaign))} without the backers stopping
        it. Everything the campaign raised, less the fee, is the creator&apos;s, and their bond
        is theirs again.
      </Lead>

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        {totals.map(([label, amount]) => (
          <div key={label}>
            <dt className="text-stone-500">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold">{usd(amount)}</dd>
          </div>
        ))}
      </dl>

      {mine && (
        <div className="mt-5 rounded-xl border border-accent-line bg-accent-soft p-5">
          <p className="text-sm text-accent-ink">Your receipt</p>
          <p className="mt-1 text-lg font-semibold text-accent-ink">
            Seat {mine.index + 1}, paid {usd(campaign.price)}
          </p>
          <p className="mt-2 text-sm leading-6 text-stone-700">
            Your pledge stays on record as proof that this wallet pre-ordered.
          </p>
          <p className="mt-1 break-all font-mono text-xs text-stone-600">
            {mine.address.toBase58()}
          </p>
        </div>
      )}

      {manual ? (
        <CreatorPayout campaign={campaign} now={now} />
      ) : (
        claimable > 0n && (
          <p className="mt-5 border-t border-stone-200 pt-5 text-sm leading-6 text-stone-600">
            {usd(claimable)} is being sent to the creator.
          </p>
        )
      )}
    </Card>
  );
}
