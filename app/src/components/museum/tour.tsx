"use client";

import { Frame } from "@/components/museum/chamber";
import type { RoomId } from "@/lib/museum/plan";

/**
 * The tutorial, in the manner of a game's first level: a few stops, each said in a sentence or
 * two, and at three of them the visitor has to do the thing itself before it goes on. While it
 * runs, everything else the page lays over the floor is put away, so there is one thing to read
 * and one thing to do. Written for someone who has never heard of any of this.
 */
export interface Stop {
  /** The room this stop is about; the view and the visitor go there. */
  room?: RoomId;
  /** Shows the whole building instead of a room. */
  wide?: boolean;
  title: string;
  body: string;
  /**
   * What the visitor has to do for the tour to go on by itself: walk a few steps, open an
   * exhibit, or close it again. A stop without one has a Next button.
   */
  task?: "walk" | "open" | "close";
  /** The task, in the words of an instruction. */
  ask?: string;
  tip?: string;
}

export const TOUR: Stop[] = [
  {
    wide: true,
    title: "This is a museum of things that don't exist yet",
    body: "Every object on a stand is an idea somebody wants to build. They only build it if enough people say “I want one” first.",
    tip: "This takes about a minute. You will walk, open one idea, and see what happens to ideas that make it and ideas that don't.",
  },
  {
    room: "unmade",
    title: "First, walk",
    body: "The small figure with “You” over it is you.",
    task: "walk",
    ask: "Press W, A, S or D to walk. Or click anywhere on the floor.",
  },
  {
    title: "Open an idea",
    body: "This room holds ideas that are still looking for people. The little chairs in front of each one show how many seats are taken.",
    task: "open",
    ask: "Click any object. Or walk up to one and press Enter.",
  },
  {
    title: "This is one idea, up close",
    body: "On the left: what a seat costs, how many are taken, and when it closes. On the right: where you take a seat by putting down a deposit.",
    task: "close",
    ask: "Have a look, then press Back at the bottom left.",
  },
  {
    room: "workshop",
    title: "Enough people joined: it gets built",
    body: "When every seat is taken, the idea moves here. The creator is paid a part now and the rest later, while they build. Finished ones end up in the Realized Wing.",
    tip: "If the creator disappears, the backers can vote to stop it and take back what is left.",
  },
  {
    room: "almost",
    title: "Not enough people joined",
    body: "These ideas did not fill their seats in time. Everyone got their deposit back, and the earliest backers also got a bonus, paid by the creator.",
    tip: "The creator locks that bonus up before asking, so joining early is never for nothing.",
  },
  {
    room: "annex",
    title: "Rooms built by creators",
    body: "Anyone who starts an idea can build it a room of its own here: pick an empty square, pick a floor colour, done.",
  },
  {
    room: "unmade",
    title: "Now it's your turn",
    body: "The board by the door lists every idea. The curator's desk next to it is where you start your own.",
    tip: "This is a demo on a test network with play money: press “Connect” at the top, then “Get demo dollars”, and try taking a seat. Nothing here has been audited.",
  },
];

export function Tour({
  step,
  onStep,
  onClose,
}: {
  step: number;
  onStep: (step: number) => void;
  onClose: () => void;
}) {
  const stop = TOUR[step];
  const last = step === TOUR.length - 1;
  if (!stop) return null;

  return (
    <section
      aria-label="Guided tour"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 sm:p-6"
    >
      <Frame className="pointer-events-auto w-full max-w-2xl shadow-2xl">
        <div className="p-5 text-paper sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[11px] uppercase tracking-widest text-paper/60">
              Tutorial · {step + 1} of {TOUR.length}
            </p>
            <div aria-hidden className="flex gap-1">
              {TOUR.map((_, index) => (
                <span key={index} className={`h-1.5 w-5 ${index <= step ? "bg-lime" : "bg-paper/20"}`} />
              ))}
            </div>
          </div>
          <h2 className="mt-2 text-xl font-semibold leading-tight text-lime sm:text-2xl">{stop.title}</h2>
          <p className="mt-2 text-base leading-7 text-paper">{stop.body}</p>
          {stop.ask && (
            <p className="mt-3 flex items-start gap-3 border border-lime bg-lime/10 px-3 py-2.5 text-base font-medium leading-6 text-lime">
              <span aria-hidden className="mt-0.5 font-mono text-xs uppercase tracking-wider">
                Do this
              </span>
              <span>{stop.ask}</span>
            </p>
          )}
          {stop.tip && <p className="mt-2 border-l-2 border-lime pl-3 text-sm leading-6 text-paper/75">{stop.tip}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {stop.task ? (
              <button type="button" onClick={() => onStep(step + 1)} className="hud-button">
                I can&apos;t, skip this step
              </button>
            ) : (
              <button
                type="button"
                autoFocus
                onClick={() => (last ? onClose() : onStep(step + 1))}
                className="h-10 bg-lime px-5 font-mono text-xs font-semibold uppercase tracking-wider text-carbon hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
              >
                {last ? "Start exploring" : "Next"}
              </button>
            )}
            {step > 0 && !stop.task && (
              <button type="button" onClick={() => onStep(step - 1)} className="hud-button">
                Back
              </button>
            )}
            {!last && (
              <button type="button" onClick={onClose} className="hud-button ml-auto">
                Leave the tutorial
              </button>
            )}
          </div>
        </div>
      </Frame>
    </section>
  );
}
