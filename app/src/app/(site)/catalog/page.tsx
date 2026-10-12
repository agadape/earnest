import type { Metadata } from "next";
import Link from "next/link";

import { CampaignList } from "@/components/campaign-list";
import { buttonClass } from "@/components/ui";

const STEPS = [
  {
    title: "A creator makes an offer",
    text: "“I build this if 50 people put down $10 by Friday.” To show they mean it, they lock a bond of their own money.",
  },
  {
    title: "You put down a deposit",
    text: "It goes into a vault that only follows the campaign's terms. The creator cannot take it out early, and neither can we.",
  },
  {
    title: "Either it gets built, or you are paid back",
    text: "Seats filled: the money reaches the creator bit by bit while they build, and backers can pull a brake. Seats not filled: you get your deposit back, and the earliest backers get a bonus from the creator's bond.",
  },
];

export const metadata: Metadata = { title: "Catalog" };

export default function Catalog() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <section className="max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-widest text-stone-500">
          Catalog · every exhibit in the museum, as a list
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Put down a deposit before it&apos;s built. If too few people join, you get it back
          plus a bonus.
        </h1>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="#campaigns" className={buttonClass("primary")}>
            See campaigns
          </a>
          <Link href="/new" className={buttonClass("secondary")}>
            Start a campaign
          </Link>
        </div>
      </section>

      <section aria-labelledby="how-title">
        <h2 id="how-title" className="text-sm font-medium text-stone-500">
          How it works
        </h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-stone-200 bg-white p-5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink">
                {index + 1}
              </span>
              <h3 className="mt-3 font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-stone-600">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="campaigns" aria-labelledby="campaigns-title" className="scroll-mt-28">
        <h2 id="campaigns-title" className="text-xl font-semibold tracking-tight">
          Campaigns
        </h2>
        <div className="mt-4">
          <CampaignList />
        </div>
      </section>
    </div>
  );
}
