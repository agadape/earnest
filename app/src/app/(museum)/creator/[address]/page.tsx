import type { Metadata } from "next";
import { Suspense } from "react";

import { Museum } from "@/components/museum/museum";

export const metadata: Metadata = { title: "Creator record" };

export default function CreatorPage({ params }: PageProps<"/creator/[address]">) {
  // A creator's record is a file kept inside the museum; this address opens the museum with
  // that file on the table. The address is only known per request, so it is read in the boundary.
  return (
    <Suspense fallback={<div className="absolute inset-0 bg-carbon" />}>
      {params.then(({ address }) => (
        <Museum creator={address} />
      ))}
    </Suspense>
  );
}
