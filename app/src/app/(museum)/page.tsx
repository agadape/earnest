import { Suspense } from "react";

import { Museum } from "@/components/museum/museum";

export default function MuseumPage() {
  // The museum reads the address bar to know what to open, which is only known per visit.
  return (
    <Suspense fallback={<div className="absolute inset-0 bg-carbon" />}>
      <Museum />
    </Suspense>
  );
}
