import type { PublicKey } from "@solana/web3.js";

import type { Campaign, Pledge, Status } from "@/lib/tanda-jadi";

/** Above this many seats a plan stops being readable and a bar says it better. */
export const SEAT_PLAN_LIMIT = 48;

/**
 * Every seat of a campaign as a numbered square: taken or open, with a dot on the ones that
 * carry the bonus and a ring around the viewer's own. A seat is a deposit that was paid, not a
 * free reservation, and the order matters: it decides who gets the bonus.
 */
export function SeatPlan({
  campaign,
  pledges,
  viewer,
  status,
}: {
  campaign: Campaign;
  pledges: Pledge[];
  viewer: PublicKey | null;
  status: Status;
}) {
  // The bonus is only in play until the seats fill; after that no seat carries one.
  const bonusInPlay = status === "funding" || status === "failed";
  const live = status === "funding" || status === "building";
  const holders = new Map(pledges.map((pledge) => [pledge.index, pledge]));

  return (
    <div>
      <ol
        aria-label={`Seating plan: ${campaign.backers} of ${campaign.targetBackers} seats taken`}
        className="flex flex-wrap gap-1.5"
      >
        {Array.from({ length: campaign.targetBackers }, (_, index) => {
          const taken = index < campaign.backers;
          const bonus = bonusInPlay && index < campaign.earlySlots;
          const mine = viewer !== null && (holders.get(index)?.backer.equals(viewer) ?? false);
          const words = [
            `Seat ${index + 1}`,
            taken ? "taken" : "open",
            bonus ? "bonus seat" : null,
            mine ? "yours" : null,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <li
              key={index}
              title={words}
              className={`relative flex h-8 w-8 items-center justify-center font-mono text-xs ${
                taken
                  ? live
                    ? "bg-carbon text-lime"
                    : "bg-stone-400 text-white"
                  : "border border-dashed border-stone-400 text-stone-500"
              } ${mine ? "outline-2 outline-offset-2 outline-accent" : ""}`}
            >
              <span aria-hidden>{index + 1}</span>
              <span className="sr-only">{words}</span>
              {bonus && (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-paper bg-accent"
                />
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-stone-500">
        Filled: taken.{bonusInPlay && " Dot: carries the bonus if this doesn't fill."}
        {viewer && pledges.some((pledge) => pledge.backer.equals(viewer)) && " Outlined: yours."}
      </p>
    </div>
  );
}
