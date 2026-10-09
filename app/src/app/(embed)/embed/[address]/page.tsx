import type { Metadata } from "next";
import { Suspense } from "react";

import { EmbedCard } from "@/components/embed-card";

export const metadata: Metadata = { title: "Campaign" };

export default function EmbedPage({ params }: PageProps<"/embed/[address]">) {
  // As on the campaign page: the address is read inside the boundary and the campaign loads in
  // the browser, so the frame around it is served ready-made.
  return (
    <Suspense fallback={<div aria-busy className="min-h-dvh animate-pulse bg-white" />}>
      {params.then(({ address }) => (
        <EmbedCard address={address} />
      ))}
    </Suspense>
  );
}
