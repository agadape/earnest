"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Fragment, useId, useMemo, useState } from "react";

import { Button, Card, Tag } from "@/components/ui";
import { usePolled, useProgram } from "@/lib/chain";
import { formatDate, formatDuration } from "@/lib/format";
import {
  type Campaign,
  fetchJournal,
  type Journal,
  MAX_UPDATE_LENGTH,
  postUpdateIx,
} from "@/lib/tanda-jadi";
import { useSend } from "@/lib/transactions";

/** What the creator has posted. `undefined` while loading, `null` if they never posted. */
export function useJournal(campaign: Campaign): Journal | null | undefined {
  const program = useProgram();
  const address = campaign.address.toBase58();
  const load = useMemo(
    () => () => fetchJournal(program, campaign.address),
    // The address as text: a new PublicKey object for the same campaign must not restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [program, address],
  );
  return usePolled(load).data;
}

/**
 * How long the creator has been silent, in the words the brake needs: backers are deciding
 * whether the build is still alive, so only updates posted since it started count.
 */
export function silence(
  campaign: Campaign,
  journal: Journal | null | undefined,
  now: number,
): string | null {
  if (journal === undefined) return null;
  const last = journal?.recent.at(-1);
  if (last && last.at >= campaign.fundedAt) {
    return `The creator last posted an update ${formatDuration(Math.max(0, now - last.at))} ago.`;
  }
  return `The creator has not posted an update since the build started, ${formatDuration(
    Math.max(0, now - campaign.fundedAt),
  )} ago.`;
}

/**
 * The creator's updates, newest first, and the form to post one when the creator is looking.
 * Renders nothing when there is nothing to say, unless `always` asks for the empty state.
 */
export function CreatorUpdates({
  campaign,
  journal,
  now,
  always = false,
}: {
  campaign: Campaign;
  journal: Journal | null | undefined;
  now: number;
  always?: boolean;
}) {
  const { publicKey } = useWallet();
  const isCreator = publicKey?.equals(campaign.creator) ?? false;
  if (journal === undefined) return null;
  const updates = [...(journal?.recent ?? [])].reverse();
  if (updates.length === 0 && !isCreator && !always) return null;

  return (
    <Card>
      <h2 className="text-xl font-semibold tracking-tight">From the creator</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        Updates are posted by the creator&apos;s wallet and kept with their time. They cannot be
        edited afterwards.
      </p>

      {updates.length === 0 ? (
        <p className="mt-5 text-sm text-stone-600">
          {isCreator
            ? "You have not posted anything yet."
            : "The creator has not posted anything yet."}
        </p>
      ) : (
        <ol className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
          {updates.map((update, index) => (
            <li key={`${update.at}:${index}`} className="py-3">
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-stone-500">
                <time dateTime={new Date(update.at * 1000).toISOString()} title={formatDate(update.at)}>
                  {formatDuration(Math.max(0, now - update.at))} ago
                </time>
                {index === 0 && <Tag>Latest</Tag>}
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-stone-800">
                <Linked text={update.text} />
              </p>
            </li>
          ))}
        </ol>
      )}
      {journal && journal.posted > journal.recent.length && (
        <p className="mt-3 text-sm text-stone-500">
          The latest {journal.recent.length} of {journal.posted} updates.
        </p>
      )}

      {isCreator && <PostForm campaign={campaign} />}
    </Card>
  );
}

/** For the pages that show the updates on their own, without anything else needing them. */
export function CreatorUpdatesCard({ campaign, now }: { campaign: Campaign; now: number }) {
  const journal = useJournal(campaign);
  return <CreatorUpdates campaign={campaign} journal={journal} now={now} />;
}

const LINK = /(https?:\/\/[^\s]+)/g;

/** Creators type this themselves: web addresses become links and nothing else is interpreted. */
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(LINK).map((part, index) => {
        if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>;
        // A full stop or bracket right after an address belongs to the sentence, not the link.
        const href = part.replace(/[.,;:!?)\]]+$/, "");
        return (
          <Fragment key={index}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="break-all text-accent hover:underline"
            >
              {href.replace(/^https?:\/\//i, "")}
            </a>
            {part.slice(href.length)}
          </Fragment>
        );
      })}
    </>
  );
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

function PostForm({ campaign }: { campaign: Campaign }) {
  const id = useId();
  const program = useProgram();
  const { send, busy } = useSend();
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const length = bytes(trimmed);
  const tooLong = length > MAX_UPDATE_LENGTH;

  return (
    <form
      className="mt-5 border-t border-stone-200 pt-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!trimmed || tooLong) return;
        const posted = await send("update", {
          pending: "Posting your update",
          done: "Your update is on record.",
          build: async (creator) => [
            [await postUpdateIx(program, campaign.address, creator, trimmed)],
          ],
        });
        if (posted) setText("");
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        Tell your backers where things stand
      </label>
      <textarea
        id={id}
        rows={3}
        value={text}
        aria-invalid={tooLong ? true : undefined}
        aria-describedby={`${id}-note`}
        onChange={(event) => setText(event.target.value)}
        placeholder="Day 3: the parser works. Demo at https://…"
        className={`mt-2 block w-full rounded-lg border bg-white px-3 py-2 text-sm leading-6 text-stone-900 placeholder:text-stone-400 ${
          tooLong ? "border-red-400" : "border-stone-300 hover:border-stone-400"
        }`}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p id={`${id}-note`} className={`text-sm ${tooLong ? "text-red-700" : "text-stone-500"}`}>
          {length} of {MAX_UPDATE_LENGTH} characters.{" "}
          {tooLong ? "Shorten it to post." : "Web addresses become links."}
        </p>
        <Button
          type="submit"
          variant="secondary"
          busy={busy === "update"}
          disabled={busy !== null || !trimmed || tooLong}
        >
          Post update
        </Button>
      </div>
    </form>
  );
}
