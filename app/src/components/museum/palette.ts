/**
 * The museum's colours, in one place. The scene and the page draw from the same few: a brand
 * green and its bright lime, warm off-white stone, one trim, one wood, brass, and ink. A room's
 * floor says what stage its exhibits are at, so colour carries meaning and is not decoration.
 */
export const PALETTE = {
  /** The green of the Earnest mark: the accent for what is in progress. */
  brand: "#0b6e4f",
  brandSoft: "#6fa58c",
  lime: "#d8f59a",
  ink: "#171917",
  paper: "#f0efe7",

  wall: "#efe6d2",
  wallFoot: "#b9a57f",
  /** The course along the top of every wall, darker than the wall so its outline reads. */
  wallTop: "#8a6a4a",
  wood: "#b98652",
  woodDark: "#6b4a32",
  brass: "#d9ab35",

  grass: "#9bc97a",
  lawn: "#8dbd6d",
  /** Trees are darker and greyer than the grass, so they sit behind it. */
  trees: ["#3d7a48", "#356b40", "#4a8650"],
  soil: "#8a5f3c",
  rock: "#5b4a3a",
  paving: "#e6dcc6",

  /** Behind the island: warm off-white at the top, pale sage at the foot. */
  skyTop: "#f6f1e4",
  skyFoot: "#dfe8d3",

  floors: {
    /** Ideas that do not exist yet: pale, almost ghostly. */
    unmade: { planks: "#ece7da", runner: "#6fa58c" },
    /** In progress: neutral, with the brand accent. */
    workshop: { light: "#e9e5d9", dark: "#d2ccbb" },
    /** Made: warm, rich wood. */
    realized: { planks: "#c98a3e", runner: "#0b6e4f" },
    /** Did not get made: muted. */
    almost: { planks: "#aaa394", runner: "#8f9a8a" },
    annex: { light: "#ece6d6", dark: "#d6cfbb" },
  },
} as const;
