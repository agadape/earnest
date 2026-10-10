"use client";

import { type ReactNode, useEffect, useId, useState, useSyncExternalStore } from "react";

import { Button, buttonClass, Card } from "@/components/ui";
import { BRAND } from "@/lib/brand";

const never = () => () => {};

/** This site's address as the visitor has it in front of them. Empty on the server. */
function useOrigin(): string {
  return useSyncExternalStore(
    never,
    () => window.location.origin,
    () => "",
  );
}

/**
 * Ways to bring people to a campaign: its link, a post on X, and a card for the creator's own
 * site. `address` has to be the campaign's address as the chain has it, not as a link carried
 * it: it ends up in code that people paste into their pages.
 */
export function Share({ address, text }: { address: string; text: string }) {
  const origin = useOrigin();
  const [embedShown, setEmbedShown] = useState(false);
  const embedId = useId();

  const link = `${origin}/campaign/${address}`;
  const post = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`;
  // Nothing a creator typed goes in here, only the address, which is letters and digits.
  const code = `<iframe src="${origin}/embed/${address}" title="${BRAND} campaign" width="100%" height="260" style="max-width:480px;border:1px solid #e7e5e4;border-radius:16px" loading="lazy"></iframe>`;

  return (
    <Card>
      <h2 className="text-base font-semibold">Share</h2>
      <p className="mt-1 text-sm text-stone-600">
        Send the link, or show this campaign on your own site.
      </p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <CopyButton text={link}>Copy link</CopyButton>
        <a
          href={post}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("quiet")}
        >
          Share on X
        </a>
        <Button
          variant="quiet"
          aria-expanded={embedShown}
          aria-controls={embedId}
          onClick={() => setEmbedShown((shown) => !shown)}
        >
          Embed
        </Button>
      </div>

      {embedShown && (
        <div id={embedId} className="mt-4">
          <p className="text-sm text-stone-600">
            Paste this into your page. The card it shows keeps itself up to date.
          </p>
          <pre className="mt-2 select-all whitespace-pre-wrap break-all rounded-lg border border-stone-200 bg-stone-50 p-3 font-mono text-xs leading-5 text-stone-800">
            {code}
          </pre>
          <div className="mt-2 text-sm">
            <CopyButton text={code}>Copy code</CopyButton>
          </div>
        </div>
      )}
    </Card>
  );
}

function CopyButton({ text, children }: { text: string; children: ReactNode }) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 2_000);
    return () => clearTimeout(timer);
  }, [result]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setResult("copied");
    } catch {
      // No clipboard in this browser, or the page is not allowed to use it.
      setResult("failed");
    }
  };

  return (
    <Button variant="quiet" onClick={copy}>
      <span aria-live="polite">
        {result === "copied" ? "Copied" : result === "failed" ? "Could not copy" : children}
      </span>
    </Button>
  );
}
