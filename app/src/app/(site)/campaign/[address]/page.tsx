import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { CampaignView } from "@/components/campaign-view";
import { BRAND } from "@/lib/brand";
import { campaignPreview } from "@/lib/server/preview";

export async function generateMetadata({
  params,
}: PageProps<"/campaign/[address]">): Promise<Metadata> {
  const { address } = await params;
  const preview = await campaignPreview(address);
  // Nothing to show for this address: the site's own title, description and picture stand in.
  if (!preview) return { title: "Campaign" };

  const { title, description } = preview;
  return {
    title,
    description,
    // The picture comes from `opengraph-image.tsx` in this folder.
    openGraph: {
      siteName: BRAND,
      type: "website",
      url: `/campaign/${preview.address}`,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * Renders nothing. The seats in the description change from minute to minute, so it is worked
 * out per request, while everything this page shows could be made ahead of time. Next.js takes
 * that combination for a mistake unless the page itself also waits for a request somewhere.
 */
async function PerRequest() {
  await connection();
  return null;
}

export default function CampaignPage({ params }: PageProps<"/campaign/[address]">) {
  // The address is only known per request, so it is read inside the boundary and the rest of
  // the page can be served as a ready-made shell. The campaign itself loads in the browser.
  return (
    <>
      <Suspense
        fallback={<div aria-busy className="h-72 animate-pulse rounded-2xl bg-stone-200/60" />}
      >
        {params.then(({ address }) => (
          <CampaignView address={address} />
        ))}
      </Suspense>
      <Suspense>
        <PerRequest />
      </Suspense>
    </>
  );
}
