"use client";

import type { RoomId } from "@/lib/museum/plan";

/**
 * The opening scene, shown the first time a wallet connects in this browser: the camera goes
 * from room to room by itself while a line of text at the foot of the picture says what each
 * one is for. The visitor does nothing but go on to the next line, by a click anywhere or the
 * space bar, and at the end chooses what to do first. Nothing can be done wrong in it and it
 * can be left at any moment.
 */
export const SCENES: {
  /** Where the camera goes. Missing: the whole building. */
  room?: RoomId;
  line: string;
  /** A second, quieter line. */
  aside?: string;
}[] = [
  { line: "This is a museum of ideas.", aside: "Things people want to make, but haven't yet." },
  { room: "unmade", line: "Like an idea? Take a seat.", aside: "A seat costs a small deposit." },
  { room: "workshop", line: "All seats taken? It gets made." },
  { room: "almost", line: "Not enough people? You get your deposit back.", aside: "The first ones in get a bonus too." },
  { room: "annex", line: "Makers can build their own room here." },
  { room: "unmade", line: "Ready? Pick where to start.", aside: "Demo only: play money, not audited." },
];

export function Cutscene({
  scene,
  onScene,
  onClose,
  onOpenIdea,
  visitor,
}: {
  scene: number;
  onScene: (scene: number) => void;
  /** Leaves the cutscene and hands the floor back. */
  onClose: () => void;
  /** Leaves it and opens an idea that is taking pledges, if there is one. */
  onOpenIdea?: () => void;
  /** How the visitor is addressed: a short wallet address, or nothing. */
  visitor: string | null;
}) {
  const shot = SCENES[scene];
  if (!shot) return null;
  const last = scene === SCENES.length - 1;
  const next = () => (last ? undefined : onScene(scene + 1));

  return (
    <section
      aria-label="Introduction"
      onClick={next}
      className={`absolute inset-0 z-40 flex flex-col justify-between ${last ? "" : "cursor-pointer"}`}
    >
      {/* The two black bars of a film, with what a film would put on them. */}
      <div className="flex h-[11vh] min-h-14 items-center justify-between bg-black px-4 sm:px-8">
        <p className="font-mono text-[11px] uppercase tracking-widest text-paper/60">
          Earnest{visitor && scene === 0 ? ` · hello, ${visitor}` : ""}
        </p>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="border border-paper/30 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-paper/80 hover:border-lime hover:text-lime focus-visible:outline-2 focus-visible:outline-lime"
        >
          Skip intro <span className="hidden opacity-60 sm:inline">esc</span>
        </button>
      </div>

      <div className="bg-black px-4 pb-6 pt-5 sm:px-8 sm:pb-8">
        <div className="mx-auto max-w-3xl text-center">
          {/* Keyed by the scene so each line fades in afresh. */}
          <div key={scene} aria-live="polite" className="cutscene-line">
            <p className="text-xl font-semibold leading-snug text-paper sm:text-3xl">{shot.line}</p>
            {shot.aside && <p className="mt-2 text-sm leading-6 text-paper/70 sm:text-base">{shot.aside}</p>}
          </div>

          {last ? (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              {onOpenIdea && (
                <button
                  type="button"
                  autoFocus
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenIdea();
                  }}
                  className="h-11 bg-lime px-6 font-mono text-xs font-semibold uppercase tracking-wider text-carbon hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
                >
                  Show me an idea
                </button>
              )}
              <button
                type="button"
                autoFocus={!onOpenIdea}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
                className="h-11 border border-paper/40 px-6 font-mono text-xs font-semibold uppercase tracking-wider text-paper hover:border-lime hover:text-lime focus-visible:outline-2 focus-visible:outline-lime"
              >
                Let me walk around
              </button>
            </div>
          ) : (
            <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-lime">
              Click anywhere or press space to go on
            </p>
          )}

          <div className="mt-4 flex items-center justify-center gap-3">
            {scene > 0 && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onScene(scene - 1);
                }}
                className="font-mono text-[11px] uppercase tracking-widest text-paper/50 hover:text-paper"
              >
                ← back
              </button>
            )}
            <div aria-hidden className="flex gap-1">
              {SCENES.map((_, index) => (
                <span key={index} className={`h-1 w-6 ${index <= scene ? "bg-lime" : "bg-paper/20"}`} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
