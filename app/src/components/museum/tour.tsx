"use client";

import { Frame } from "@/components/museum/chamber";
import type { RoomId } from "@/lib/museum/plan";

/**
 * The guided tour: the whole idea in seven short stops, each one said in a sentence or two and
 * shown by taking the visitor to the room it is about. Written for someone who has never heard
 * of any of this and does not know where to start.
 */
export const TOUR: {
  /** The room this stop is about; the view and the visitor go there. Missing: the whole building. */
  room?: RoomId;
  title: string;
  body: string;
  /** What to do with it, once the tour is over. */
  tip?: string;
}[] = [
  {
    title: "This is a museum of things that don't exist yet",
    body: "Every object on a stand is an idea somebody wants to build. They only build it if enough people say “I want one” first.",
    tip: "Each room shows a different stage of that story. Let's walk through them.",
  },
  {
    room: "unmade",
    title: "1. Ideas looking for people",
    body: "Here, ideas are waiting. To join one, you take a seat by putting down a deposit. The little chairs in front of an object show how many seats are taken.",
    tip: "Click any object to open it and see its price, its seats and its deadline.",
  },
  {
    room: "workshop",
    title: "2. Enough people joined: it gets built",
    body: "When every seat is taken, the idea moves here. The creator is paid a part now and the rest later, while they build.",
    tip: "If the creator disappears, the backers can vote to stop it and take back what is left.",
  },
  {
    room: "realized",
    title: "3. It was built",
    body: "These ideas made it to the end. The building time ran out, the backers did not stop it, and the creator received the money.",
  },
  {
    room: "almost",
    title: "4. Not enough people joined",
    body: "These ideas did not fill their seats in time. Everyone got their deposit back, and the earliest backers also got a bonus, paid by the creator.",
    tip: "That bonus is the point: the creator locks it up before asking, so joining early is never for nothing.",
  },
  {
    room: "annex",
    title: "5. Rooms built by creators",
    body: "Anyone who starts an idea can build it a room of its own here. Pick an empty square, pick a floor colour, done.",
  },
  {
    room: "unmade",
    title: "Now it's your turn",
    body: "Walk with W A S D or by clicking the floor. The board by the door lists every idea. The curator's desk is where you start your own.",
    tip: "This is a demo on a test network with play money: press “Connect”, then “Get demo dollars”, and try taking a seat. Nothing here has been audited.",
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
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3 sm:bottom-14 sm:justify-end sm:p-5"
    >
      <Frame className="pointer-events-auto w-full max-w-xl">
        <div className="p-5 text-paper sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[11px] uppercase tracking-widest text-paper/60">
              Guided tour · stop {step + 1} of {TOUR.length}
            </p>
            <div aria-hidden className="flex gap-1">
              {TOUR.map((_, index) => (
                <span key={index} className={`h-1.5 w-5 ${index <= step ? "bg-lime" : "bg-paper/20"}`} />
              ))}
            </div>
          </div>
          <h2 className="mt-2 text-xl font-semibold leading-tight text-lime sm:text-2xl">{stop.title}</h2>
          <p className="mt-2 text-base leading-7 text-paper">{stop.body}</p>
          {stop.tip && <p className="mt-2 border-l-2 border-lime pl-3 text-sm leading-6 text-paper/75">{stop.tip}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => (last ? onClose() : onStep(step + 1))}
              className="h-10 bg-lime px-5 font-mono text-xs font-semibold uppercase tracking-wider text-carbon hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
            >
              {last ? "Start exploring" : "Next"}
            </button>
            {step > 0 && (
              <button type="button" onClick={() => onStep(step - 1)} className="hud-button">
                Back
              </button>
            )}
            {!last && (
              <button type="button" onClick={onClose} className="hud-button ml-auto">
                Skip the tour <span className="hidden font-mono text-[10px] opacity-60 sm:inline">esc</span>
              </button>
            )}
          </div>
        </div>
      </Frame>
    </section>
  );
}
