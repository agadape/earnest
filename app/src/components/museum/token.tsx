import { type Look, LOOK_TINTS } from "@/lib/museum/plan";

const PALE = "#fbf3df";
const INK = "#171917";
// The same three fittings the models have: brass, silver, dark wood.
const TRIMS = ["#d9ab35", "#cfd6dc", "#5a3a26"];

/**
 * A campaign's object as a small flat drawing, for places that show many at once: the same
 * shape, colour and fittings as the model on the floor, without a 3D picture for each.
 */
export function Token({ look, ended = false, className = "" }: { look: Look; ended?: boolean; className?: string }) {
  const tint = ended ? "#a39e93" : LOOK_TINTS[look.tint % LOOK_TINTS.length];
  const trim = ended ? "#8f8a7c" : TRIMS[look.trim % TRIMS.length];
  const line = { stroke: INK, strokeWidth: 1.8, strokeLinejoin: "round" as const };
  let shape;
  switch (look.kind) {
    case "screen":
      shape = (
        <>
          <rect x="15" y="37" width="18" height="4" rx="2" fill={trim} {...line} />
          <rect x="22" y="30" width="4" height="8" fill={trim} {...line} />
          <rect x="7" y="9" width="34" height="22" rx="3" fill={tint} {...line} />
          <rect x="11" y="13" width="26" height="14" rx="1" fill={PALE} {...line} />
        </>
      );
      break;
    case "orb":
      shape = (
        <>
          <rect x="16" y="37" width="16" height="5" rx="2" fill={PALE} {...line} />
          <circle cx="24" cy="22" r="13" fill={tint} {...line} />
          <ellipse cx="24" cy="22" rx="17" ry="5" fill="none" stroke={trim} strokeWidth="3" transform="rotate(-18 24 22)" />
        </>
      );
      break;
    case "tower":
      shape = (
        <>
          <rect x="8" y="31" width="32" height="10" rx="1" fill={tint} {...line} />
          <rect x="13" y="21" width="22" height="10" rx="1" fill={tint} {...line} />
          <rect x="18" y="11" width="12" height="10" rx="1" fill={tint} {...line} />
          <rect x="11" y="29.5" width="26" height="3" fill={trim} {...line} />
          <rect x="16" y="19.5" width="16" height="3" fill={trim} {...line} />
          <circle cx="24" cy="8" r="3" fill={PALE} {...line} />
        </>
      );
      break;
    case "ring":
      shape = (
        <>
          <rect x="15" y="38" width="18" height="4" rx="2" fill={PALE} {...line} />
          <rect x="22.5" y="31" width="3" height="8" fill={trim} {...line} />
          <circle cx="24" cy="19" r="14" fill={tint} {...line} />
          <circle cx="24" cy="19" r="7" fill="#e0d0b0" {...line} />
          <circle cx="24" cy="19" r="3" fill={trim} {...line} />
        </>
      );
      break;
    case "arch":
      shape = (
        <>
          <path d="M9 41 V20 a15 15 0 0 1 30 0 V41 h-9 V21 a6 6 0 0 0 -12 0 V41 Z" fill={tint} {...line} />
          <rect x="6" y="38" width="15" height="4" rx="1" fill={PALE} {...line} />
          <rect x="27" y="38" width="15" height="4" rx="1" fill={PALE} {...line} />
          <rect x="20.5" y="3" width="7" height="8" rx="1" fill={trim} {...line} />
        </>
      );
      break;
    case "prism":
      shape = (
        <>
          <rect x="5" y="36" width="38" height="6" rx="1" fill={PALE} {...line} />
          <polygon points="24,6 41,36 7,36" fill={tint} {...line} />
          <polygon points="24,6 29,15 19,15" fill={trim} {...line} />
        </>
      );
      break;
    case "stack":
      shape = (
        <>
          <rect x="8" y="30" width="32" height="11" rx="1" fill={tint} {...line} />
          <rect x="13" y="19" width="24" height="11" rx="1" fill={tint} {...line} transform="rotate(-4 25 24)" />
          <rect x="17" y="8" width="15" height="11" rx="1" fill={tint} {...line} transform="rotate(5 24 13)" />
          <rect x="11" y="28.5" width="27" height="3" fill={trim} {...line} />
        </>
      );
      break;
    case "knot":
      shape = (
        <>
          <rect x="16" y="38" width="16" height="4" rx="2" fill={PALE} {...line} />
          <rect x="22.5" y="31" width="3" height="8" fill={trim} {...line} />
          <ellipse cx="24" cy="19" rx="15" ry="7" fill="none" stroke={INK} strokeWidth="8" transform="rotate(35 24 19)" />
          <ellipse cx="24" cy="19" rx="15" ry="7" fill="none" stroke={tint} strokeWidth="5" transform="rotate(35 24 19)" />
          <ellipse cx="24" cy="19" rx="15" ry="7" fill="none" stroke={INK} strokeWidth="8" transform="rotate(-35 24 19)" />
          <ellipse cx="24" cy="19" rx="15" ry="7" fill="none" stroke={tint} strokeWidth="5" transform="rotate(-35 24 19)" />
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={className}>
      {shape}
    </svg>
  );
}
