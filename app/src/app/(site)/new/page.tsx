import type { Metadata } from "next";

import { NewCampaignForm } from "@/components/new-campaign-form";

export const metadata: Metadata = { title: "Start a campaign" };

export default function NewCampaignPage() {
  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight">Start a campaign</h1>
        <p className="mt-3 leading-7 text-stone-600">
          Say what you would build, what a seat costs and how many people it takes. You lock a
          bond that pays a bonus to your earliest backers if too few join. That bonus is why
          people commit early instead of waiting.
        </p>
      </header>
      <NewCampaignForm />
    </div>
  );
}
