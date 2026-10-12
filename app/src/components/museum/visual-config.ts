/**
 * Everything about how the museum floor looks and moves that is worth tuning by eye, in one
 * place. Colours live in `palette.ts`; this is the rest: light, shading, outline, the size of
 * people, how exhibits print, and how a pledge is celebrated.
 */
export const VISUAL = {
  // ----- Light ---------------------------------------------------------------------------
  exposure: 1.1,
  sky: "#d6e4ff",
  /** The light that comes back up from below. It tints shade warm and a little purple. */
  ground: "#9a7f9c",
  skyLight: 1.2,
  sun: "#fff1d6",
  sunLight: 3.0,
  /** How much metal and glass reflect of the room made for them. Toon shading ignores it. */
  reflections: 0.16,
  shadowMap: 2048,
  /** How soft a shadow's edge is. Toon shading wants it crisp. */
  shadowSoftness: 1,
  /** How far a surface is pushed off itself before it can shade itself. Too little and walls get stripes. */
  shadowBias: -0.0012,
  shadowNormalBias: 0.12,

  // ----- Toon shading --------------------------------------------------------------------
  /** How bright each of the three bands of light is, from shade to full light, out of 255. */
  toonBands: [158, 208, 255],

  // ----- Outline -------------------------------------------------------------------------
  /**
   * Whether the finished picture goes through the outline pass. It draws the whole floor a
   * second time every frame, which was too much for an ordinary laptop, so it is off unless
   * the address asks for it with `?ink=1`.
   */
  post: false,
  ink: "#1f1a17",
  /** How wide the line is, in screen pixels at one pixel per pixel. */
  inkWidth: 1.1,
  inkStrength: 0.9,
  /** How big a jump in depth, and how big a turn of a surface, counts as an edge. */
  inkDepthEdge: 0.0009,
  inkNormalEdge: 0.55,

  // ----- People and exhibits -------------------------------------------------------------
  /** How many times life size the people are drawn, so they can be found at a glance. */
  people: 1.7,
  /** How long an exhibit takes to print itself up to where its seats are, in seconds. */
  printSeconds: 1.2,
  /** How bright the pool of light under an exhibit is, and under one still asking for backers. */
  pool: 0.2,
  poolAsking: 0.55,

  // ----- A pledge, celebrated ------------------------------------------------------------
  /** How many celebrations play at once; the rest wait their turn. */
  cheersAtOnce: 3,
  /** Pledges for one exhibit this close together, in seconds, are one celebration. */
  cheerMerge: 3,
  cheerSeconds: 3,
  /** Pieces of confetti in one celebration, before a modest machine's share is taken. */
  confetti: 96,
  confettiColors: ["#d8f59a", "#0b6e4f", "#d9ab35", "#f0efe7", "#6fa58c"],
  beamColor: "#d8f59a",
  /** How near a figure has to stand to an exhibit to hop when it is pledged to. */
  hopRadius: 4.5,

  // ----- An exhibit that fills, moving on --------------------------------------------------
  flightSeconds: 4.2,
  /** How high over the walls it goes. */
  flightHeight: 7,
  finaleSeconds: 2.6,
};
