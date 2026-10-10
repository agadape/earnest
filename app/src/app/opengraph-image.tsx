import { ImageResponse } from "next/og";

import { OG_SIZE, siteImage } from "@/lib/og";

export const alt = "Earnest: pre-orders that pay you back";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(siteImage(), size);
}
