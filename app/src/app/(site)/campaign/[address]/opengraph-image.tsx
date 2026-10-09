import { ImageResponse } from "next/og";

import { campaignImage, OG_SIZE, siteImage } from "@/lib/og";
import { campaignPreview } from "@/lib/server/preview";

export const alt = "A campaign on Tanda Jadi";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const preview = await campaignPreview(address);
  return new ImageResponse(preview ? campaignImage(preview) : siteImage(), size);
}
