/**
 * A campaign in a few plain lines, for the places that have no room for its page: link
 * previews, the card other sites embed and the text of a shared post.
 */
import { usd } from "@/lib/format";
import { bonusSeatsLeft, type Campaign, refundIfFailed, type Status } from "@/lib/tanda-jadi";

/** The title as one line. Creators type it, so it may be empty or carry line breaks. */
export function titleOf(c: Campaign): string {
  return c.title.replace(/\s+/g, " ").trim() || "Untitled campaign";
}

/** What the next backer gets back if the seats don't fill: more while bonus seats are left. */
export function hook(c: Campaign): string {
  return bonusSeatsLeft(c) > 0
    ? `Join early: get ${usd(refundIfFailed(c, c.backers))} back if it doesn't fill`
    : `Get your ${usd(c.price)} back if it doesn't fill`;
}

/** What became of a campaign that no longer takes pledges. */
export function outcome(c: Campaign, status: Exclude<Status, "funding">): string {
  switch (status) {
    case "building":
      return `Being built. All ${c.targetBackers} seats filled.`;
    case "failed":
      return "Didn't fill. Every deposit goes back.";
    case "braked":
      return `Stopped by backers. ${usd(c.refundPerBacker)} goes back to each of them.`;
    case "completed":
      return "Completed. The build period ended without a brake.";
  }
}

/** All of it as one short text. */
export function sentence(c: Campaign, status: Status): string {
  if (status !== "funding") return outcome(c, status);
  const back =
    bonusSeatsLeft(c) > 0
      ? `Join early and get ${usd(refundIfFailed(c, c.backers))} back`
      : `Get your ${usd(c.price)} back`;
  return `${c.backers} of ${c.targetBackers} seats taken at ${usd(c.price)}. ${back} if it doesn't fill.`;
}
