"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useId, useMemo, useState } from "react";

import { Button, Card, Tag } from "@/components/ui";
import { useConnectDialog } from "@/components/wallet-button";
import { useBalance, usePolled, useProgram } from "@/lib/chain";
import { shortAddress, usd } from "@/lib/format";
import { rememberPledge, useReceipt } from "@/lib/receipts";
import {
  buySeatIxs,
  type Campaign,
  fetchListings,
  formatTokens,
  impliedFailureChance,
  type Listing,
  listSeatIx,
  parseTokens,
  type Pledge,
  refundIfFailed,
  statusAt,
  unlistSeatIx,
} from "@/lib/tanda-jadi";
import { useSend } from "@/lib/transactions";

interface Offer {
  listing: Listing;
  pledge: Pledge;
}

/**
 * Seats on offer from their holders, and the form to offer one's own. Shown while the outcome is
 * open; afterwards a seat is a refund claim or a receipt and no longer changes hands.
 */
export function SeatMarket({
  campaign,
  pledges,
  mine,
  now,
}: {
  campaign: Campaign;
  pledges: Pledge[];
  mine: Pledge | null;
  now: number;
}) {
  const { publicKey } = useWallet();
  const program = useProgram();
  const balance = useBalance();
  const openConnect = useConnectDialog();
  const { send, busy } = useSend();

  const address = campaign.address.toBase58();
  // Carried along whenever the note about this wallet's seat is rewritten below.
  const boughtFor = useReceipt(address, publicKey?.toBase58() ?? null)?.boughtFor;
  const load = useMemo(
    () => () => fetchListings(program, campaign.address),
    // The address as text: a new PublicKey object for the same campaign must not restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [program, address],
  );
  const { data: listings } = usePolled(load);

  // An offer can outlive its seat, so only those whose seller still holds one count.
  const offers = useMemo<Offer[]>(() => {
    const bySeller = new Map(pledges.map((pledge) => [pledge.backer.toBase58(), pledge]));
    return (listings ?? []).flatMap((listing) => {
      const pledge = bySeller.get(listing.seller.toBase58());
      return pledge ? [{ listing, pledge }] : [];
    });
  }, [listings, pledges]);

  const building = statusAt(campaign, now) === "building";
  const myOffer = mine ? offers.find(({ pledge }) => pledge.index === mine.index) : undefined;
  const others = offers.filter((offer) => offer !== myOffer);

  return (
    <Card>
      <h2 className="text-xl font-semibold tracking-tight">Seats for sale</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        A backer who wants out can sell their seat instead of waiting. The buyer takes their place
        in line{building ? "" : ", so a bonus seat stays a bonus seat"}. The campaign keeps the
        same number of backers either way.
      </p>

      {others.length === 0 && !myOffer ? (
        <p className="mt-5 text-sm text-stone-600">No seat is on offer right now.</p>
      ) : (
        <ul className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
          {myOffer && (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <SeatLabel campaign={campaign} pledge={myOffer.pledge} building={building} />
              <Tag tone="accent">Your offer</Tag>
              <span className="ml-auto text-sm font-semibold">{usd(myOffer.listing.ask)}</span>
              <Button
                variant="secondary"
                size="sm"
                busy={busy === "unlist"}
                disabled={busy !== null}
                onClick={async () => {
                  const down = await send("unlist", {
                    pending: "Taking your offer down",
                    done: "Your seat is no longer for sale.",
                    build: async (payer) => [
                      [await unlistSeatIx(program, campaign.address, payer)],
                    ],
                  });
                  if (down && publicKey) {
                    rememberPledge(address, publicKey.toBase58(), {
                      index: myOffer.pledge.index,
                      boughtFor,
                    });
                  }
                }}
              >
                Take it down
              </Button>
            </li>
          )}
          {others.map(({ listing, pledge }) => {
            const key = `buy:${pledge.index}`;
            const short = balance !== null && balance < listing.ask;
            return (
              <li key={pledge.index} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <SeatLabel campaign={campaign} pledge={pledge} building={building} />
                <span className="text-sm text-stone-500">from {shortAddress(listing.seller)}</span>
                <span className="ml-auto text-sm font-semibold">{usd(listing.ask)}</span>
                {!publicKey ? (
                  <Button variant="secondary" size="sm" onClick={openConnect}>
                    Connect to buy
                  </Button>
                ) : mine ? (
                  <span className="text-sm text-stone-500">You already hold a seat</span>
                ) : (
                  <Button
                    size="sm"
                    busy={busy === key}
                    disabled={busy !== null || balance === null || short}
                    onClick={async () => {
                      const bought = await send(key, {
                        pending: `Buying seat ${pledge.index + 1} for ${usd(listing.ask)}`,
                        done: `Seat ${pledge.index + 1} is yours.`,
                        build: async (payer) => [
                          await buySeatIxs(program, campaign, listing, payer),
                        ],
                      });
                      // What was paid is not on chain afterwards; the page needs it to say
                      // truthfully what this wallet put in.
                      if (bought) {
                        rememberPledge(address, publicKey.toBase58(), {
                          index: pledge.index,
                          boughtFor: listing.ask.toString(),
                        });
                      }
                    }}
                  >
                    {short ? "Not enough dollars" : "Buy"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Reading campaign={campaign} offers={offers} building={building} />

      {mine && !myOffer && (
        <SellForm
          campaign={campaign}
          mine={mine}
          building={building}
          busy={busy}
          onOffer={async (ask) => {
            const listed = await send("list", {
              pending: `Offering your seat for ${usd(ask)}`,
              done: `Your seat is on offer for ${usd(ask)}.`,
              build: async (payer) => [[await listSeatIx(program, campaign.address, payer, ask)]],
            });
            // Remembered so that, if it sells, this page can tell a sale from a refund later.
            if (listed && publicKey) {
              rememberPledge(address, publicKey.toBase58(), {
                index: mine.index,
                boughtFor,
                offeredFor: ask.toString(),
              });
            }
          }}
        />
      )}
      {myOffer && (
        <p className="mt-4 text-sm leading-6 text-stone-600">
          Until someone buys it the seat is still yours, with everything that comes with it. To
          change the price, take the offer down and make a new one.
        </p>
      )}
    </Card>
  );
}

function SeatLabel({
  campaign,
  pledge,
  building,
}: {
  campaign: Campaign;
  pledge: Pledge;
  building: boolean;
}) {
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="font-medium">Seat {pledge.index + 1}</span>
      {!building && pledge.index < campaign.earlySlots && <Tag>Bonus seat</Tag>}
    </span>
  );
}

/** What the cheapest offer says, in plain words. Silent when it says nothing reliable. */
function Reading({
  campaign,
  offers,
  building,
}: {
  campaign: Campaign;
  offers: Offer[];
  building: boolean;
}) {
  if (building) {
    const cheapest = offers[0];
    if (!cheapest || cheapest.listing.ask <= campaign.price) return null;
    return (
      <p className="mt-4 rounded-xl bg-stone-50 p-4 text-sm leading-6 text-stone-700">
        Every seat is taken, and the cheapest one on offer costs {usd(cheapest.listing.ask)},
        more than the {usd(campaign.price)} it was pledged for. That is what a holder is asking,
        not yet what anyone paid.
      </p>
    );
  }

  const bonusOffer = offers.find(({ pledge }) => pledge.index < campaign.earlySlots);
  if (!bonusOffer) return null;
  const chance = impliedFailureChance(campaign, bonusOffer.listing.ask);
  if (chance === null) return null;
  const premium = bonusOffer.listing.ask - campaign.price;

  return (
    <p className="mt-4 rounded-xl bg-stone-50 p-4 text-sm leading-6 text-stone-700">
      <strong className="font-semibold">What this price says.</strong> The cheapest bonus seat is
      on offer for {usd(bonusOffer.listing.ask)}. If the campaign does not fill, that seat pays
      back {usd(refundIfFailed(campaign, bonusOffer.pledge.index))}. Its holder would rather have{" "}
      {usd(premium)} extra now than wait for a {usd(campaign.bonusPerEarly)} bonus, which makes
      sense if they put the chance of this not filling at about{" "}
      <strong className="font-semibold">{Math.round(chance * 100)}%</strong> or lower. It is one
      holder&apos;s asking price, not a forecast you can rely on.
    </p>
  );
}

function SellForm({
  campaign,
  mine,
  building,
  busy,
  onOffer,
}: {
  campaign: Campaign;
  mine: Pledge;
  building: boolean;
  busy: string | null;
  onOffer: (ask: bigint) => void;
}) {
  const id = useId();
  const [text, setText] = useState(formatTokens(campaign.price));
  const ask = parseTokens(text);
  const valid = ask !== null && ask > 0n;
  const hasBonus = !building && mine.index < campaign.earlySlots;

  return (
    <form
      className="mt-5 border-t border-stone-200 pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onOffer(ask);
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        Sell your seat (seat {mine.index + 1})
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <div className="relative w-36">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-stone-500">
            $
          </span>
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            aria-invalid={valid ? undefined : true}
            aria-describedby={`${id}-note`}
            onChange={(event) => setText(event.target.value)}
            className={`h-11 w-full min-w-0 rounded-lg border bg-white pl-7 pr-3 text-sm text-stone-900 ${
              valid ? "border-stone-300 hover:border-stone-400" : "border-red-400"
            }`}
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          busy={busy === "list"}
          disabled={busy !== null || !valid}
        >
          Offer my seat
        </Button>
      </div>
      <p id={`${id}-note`} className="mt-2 text-sm leading-6 text-stone-600">
        {valid
          ? hasBonus
            ? `Yours is a bonus seat: it pays back ${usd(refundIfFailed(campaign, mine.index))} if the campaign does not fill. If it sells, the buyer gets that instead of you.`
            : "If it sells, the buyer takes your place and you are out. You can take the offer down any time before then."
          : "Enter a price in dollars, like 11.50."}
      </p>
    </form>
  );
}
