import type { Metadata } from "next";

import { EmbedProviders } from "@/components/embed-providers";

// The card is one view of a campaign's page: search engines should list the page, not the card.
export const metadata: Metadata = { robots: { index: false } };

export default function EmbedLayout({ children }: LayoutProps<"/">) {
  return <EmbedProviders>{children}</EmbedProviders>;
}
