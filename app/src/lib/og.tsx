/**
 * The pictures shown with a link to this site. They are drawn by `next/og`, which knows only
 * flexbox and inline styles: every element with more than one child has to say `display: flex`,
 * and the class names of the rest of the site mean nothing here.
 */
import type { ReactNode } from "react";

import type { CampaignPreview } from "@/lib/server/preview";

export const OG_SIZE = { width: 1200, height: 630 };

// The same colors as in `globals.css`.
const PAPER = "#f8f7f4";
const ACCENT = "#0b6e4f";
const INK = "#1c1917";
const MUTED = "#57534e";
const TRACK = "#e2e0db";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px 72px 72px",
        background: PAPER,
        color: INK,
      }}
    >
      <div style={{ display: "flex", fontSize: 36, color: ACCENT, letterSpacing: "-0.01em" }}>
        Tanda Jadi
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

function Title({ children }: { children: string }) {
  // Titles are typed by strangers. A long one gets smaller letters, then is cut at three lines.
  const size = children.length <= 20 ? 92 : children.length <= 40 ? 76 : 62;
  return (
    <div
      style={{
        display: "block",
        lineClamp: 3,
        fontSize: size,
        lineHeight: 1.1,
        letterSpacing: "-0.025em",
        wordBreak: "break-word",
      }}
    >
      {children}
    </div>
  );
}

function Line({
  accent = false,
  gap = 20,
  children,
}: {
  accent?: boolean;
  gap?: number;
  children: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        marginTop: gap,
        fontSize: 38,
        lineHeight: 1.35,
        color: accent ? ACCENT : MUTED,
      }}
    >
      {children}
    </div>
  );
}

/** The site's own picture: also what a campaign link shows when the campaign cannot be read. */
export function siteImage() {
  return (
    <Frame>
      <Title>Pre-orders that pay you back</Title>
      <Line gap={28}>
        {"Put down a deposit before it's built. " +
          "If too few people join, you get it back plus a bonus."}
      </Line>
    </Frame>
  );
}

export function campaignImage({ title, line, hook, backers, targetBackers }: CampaignPreview) {
  const share = targetBackers > 0 ? Math.min(backers / targetBackers, 1) : 0;
  return (
    <Frame>
      <Title>{title}</Title>
      {hook !== null && (
        <div
          style={{
            display: "flex",
            marginTop: 44,
            height: 14,
            borderRadius: 7,
            background: TRACK,
          }}
        >
          <div style={{ width: `${share * 100}%`, borderRadius: 7, background: ACCENT }} />
        </div>
      )}
      <Line gap={hook !== null ? 20 : 28}>{line}</Line>
      {hook !== null && (
        <Line accent gap={8}>
          {hook}
        </Line>
      )}
    </Frame>
  );
}
