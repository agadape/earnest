import type { Metadata } from "next";
import { Suspense } from "react";

import { CampaignView } from "@/components/campaign-view";

export const metadata: Metadata = { title: "Campaign" };

export default function CampaignPage({ params }: PageProps<"/campaign/[address]">) {
  // The address is only known per request, so it is read inside the boundary and the rest of
  // the page can be served as a ready-made shell. The campaign itself loads in the browser.
  return (
    <Suspense fallback={<div aria-busy className="h-72 animate-pulse rounded-2xl bg-stone-200/60" />}>
      {params.then(({ address }) => (
        <CampaignView address={address} />
      ))}
    </Suspense>
  );
}
