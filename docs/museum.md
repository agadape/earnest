# The museum: how it is built and why

The front page of Earnest is a small building in three dimensions. Each campaign is an exhibit
in it. This note records how the rendering approach was chosen and how the museum is wired to
the rest of the app.

## What was tried

The app is Next.js 16 with React 19 and Tailwind 4, and had no 3D or animation library. Two
approaches were built as throwaway pages with the same scene: two rooms joined by a doorway,
three exhibits of different shapes, pointing and clicking, a panel for the selected exhibit, a
visitor marker that walks to it, and a camera that eases towards it. Both were run in the
project's own dev server and looked at in a browser.

| | three.js, used directly | CSS 3D transforms |
|---|---|---|
| Rendered and looked at | yes | yes |
| Depth and light | real lights and soft shadows | flat faces shaded by hand, no shadows |
| Exhibit shapes | any primitive: torus, knot, cone, stacked solids | boxes and flat discs |
| Fixed isometric view | orthographic camera | fixed pair of rotations |
| Picking | ray cast against the meshes, written by hand | free: the exhibits are buttons |
| Keyboard and screen readers | nothing by itself | free, for the same reason |
| Camera moves | ease any value in the frame loop | CSS transitions on a transform |
| Cost | one dependency, 140 kB gzipped (measured) | none |

A third candidate, React Three Fiber, was not built. It would add a second package and a React
reconciler on top of three.js for a scene that is one class with a dozen methods, and its
peer range pins React below 19.4. It would have made pointer events declarative; the hand-written
picking is about thirty lines. This is a judgement, not a measurement.

No animation library was added. The frame loop eases the camera and the visitor; panels use the
browser's own layout. Nothing here needed timelines.

## Scores

1 is worst, 5 is best. "unverified" means it was not measured.

| Criterion | three.js | CSS 3D | React Three Fiber |
|---|---|---|---|
| Fits the existing stack | 4 | 5 | 4 (not built) |
| Visual quality | 5 | 2 | 5 (same renderer) |
| Interaction | 4 | 4 | 4 (not built) |
| Camera and spatial control | 5 | 3 | 5 (not built) |
| Performance | unverified on real devices | unverified | unverified |
| Accessibility | 2 alone, 4 with the list beside it | 5 | same as three.js |
| Amount of custom code | 3 | 4 | 3 (not built) |
| Dependency cost | 3 | 5 | 2 |
| Risk to wallet and campaign flows | 5 | 5 | 5 |
| Phones | 4 (looked at 390 px wide) | 3 | unverified |

## Decision

three.js, used directly, with no animation library. The deciding point is the picture: the
museum has to read as a building with light in it, and only a real renderer did that. What CSS
gave for free, focusable exhibits, is rebuilt next to the floor: every room and every exhibit
is also a button in an ordinary list, so the museum works by keyboard and without the picture.

Added: `three`, `@types/three`. Removed: nothing. The spike pages were deleted.

## How it fits together

| Part | Where | What it does |
|---|---|---|
| Floor plan and hanging rule | `app/src/lib/museum/plan.ts` | Rooms, places, which room a campaign's state puts it in, which stand-in object it gets. No rendering. Tested in `plan.test.ts`. |
| Scene | `app/src/components/museum/scene.ts` | The building, exhibits, the walking visitor and the camera in three.js. Reports what is pointed at, stood next to and clicked. Knows nothing about wallets. Loaded only on the museum page. |
| Page | `app/src/components/museum/museum.tsx` | Reads the campaigns, hangs them, lays the room name, the list of exhibits, the directory and the exhibit panel over the floor. |
| Exhibit panel | the existing `CampaignView`, in a narrow column | Every action a campaign page has: pledge, sell a seat, brake, updates. No second copy of that logic. |
| Catalog | `/catalog` | The same campaigns as a list. Also what is shown where WebGL is missing. |

Getting around: W, A, S, D or the arrow keys walk the visitor and the camera follows; a click or
tap on the floor walks there; Enter opens the exhibit the visitor stands next to; dragging looks
around and the wheel zooms. Choosing a room from the directory or an exhibit from the list sends
the visitor there through the doors. Where the floor can be stood on, and the way through the
doors, are rules in `plan.ts`, and the tests walk a full museum from the door to every exhibit.

Rooms follow the campaign's own state and nothing else:

| Room | Holds |
|---|---|
| A, The Unmade Hall | taking pledges |
| B, The Workshop | every seat taken, being built |
| C, The Realized Wing | build period ended without a brake |
| D, The Almost Wing | did not fill; and, marked apart, stopped by its backers |

## Limits

- **The objects are stand-ins.** Campaigns carry a title and a link, no pictures. The object is
  picked from the title and the address, and the panel says so.
- **Rooms have a fixed number of places** (8, 6, 6 and 12). The newest campaigns are hung; the
  rest are counted in the room's label and found in the catalog.
- **Presence is light and unchecked.** Every open museum posts where its visitor stands to
  `/api/presence` once a second and gets the others back; they are drawn with a name over
  them. It lives in Vercel's runtime cache, one short-lived entry per visitor, so nothing is
  stored after a visit and there is no history. A name is whatever the browser sent: a short
  wallet address or the word Guest. Nobody signs anything to be shown, so a figure's name
  proves nothing about who it is, and positions are a second old. It was tested with two and
  three callers at once, a guest and a wallet, on the live site; it was not load tested.
- **Rooms and reactions are notes on chain, not rows in a database.** A reaction, and a
  creator's claim on an annex plot, is a transaction the writer signs: a line of text through
  the memo program and a transfer of nothing to one fixed address, so the notes can be found
  again by reading that address's history (`app/src/lib/ledger.ts`). The program was not
  changed and knows nothing of them. A claim counts when the campaign's own creator signed it
  and the plot was free at that moment; the first to sign has the plot, a later claim moves
  the room, and the app looks up who signed each claim before believing it. Reactions are not
  looked up: one wallet can react as often as it pays the fee for, so a count is of signed
  reactions, not of people, and the figures drawn round an exhibit (one per reaction, ten at
  most) stand for nobody. The annex has 24 plots; a museum with more creators than that needs
  a second annex nobody has built. Only the newest three thousand notes are read. Checked on
  devnet: a claim by a wallet that is not the creator and a claim on a taken plot were both
  ignored, and a room was built from the app with the demo wallet.
- **Reactions can live in a database instead.** With `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` set and `supabase/reactions.sql` run, reactions are kept in a
  Supabase table through `/api/reactions`: a wallet signs a message, which costs nothing, the
  server checks the signature and its age, and the table's key allows one reaction of each
  kind per wallet and campaign; a second press takes it back. That trades something away: the
  rows are the site's to keep honest and nobody outside can check them, where the notes on
  chain can be checked by anyone. Wallets are free to make, so a count is of wallets, not of
  people. Rooms stay on chain either way, because who may place one is the creator's signature
  on a transaction. Without the two variables nothing changes: reactions are read from the
  chain as before. The route was tested against a stand-in for the database, not against
  Supabase itself.
- **Past visitors stroll the rooms.** With the database set up and `supabase/visitors.sql`
  run, a wallet is written down when a browser that has it connected opens the museum, and
  the fourteen seen most recently walk the rooms as figures with a faint short address. They
  are there so the building is not empty, and the page says what they are: wallets that
  visited before, not people here now. Nobody signs to be written down, so an address in
  that table is whatever a browser sent. They also end the rest the floor got when nothing
  moved: with strollers it is drawn up to 24 times a second, and not at all for someone who
  asked their system for less motion. Their walking was not watched, for the same reason
  the visitor's was not.
- **There is a tutorial, in the manner of a game's first level.** Asked for by a first reader
  who did not know where to start. Eight stops in plain words; at three of them the visitor has
  to do the thing (walk, open an exhibit, close it) and the tutorial goes on by itself when they
  have, with a way past for anyone who cannot. While it runs the rest of what is laid over the
  floor is put away. It is offered first on the plaque at the door and again from the directory
  (`tour.tsx`). Opening and closing were tried in a browser; noticing that the visitor walked
  was not, since the browser used for checking draws no frames.
- **Nothing is a page of its own.** `/catalog` and `/new` redirect into the museum, where
  the campaign board and the curator's desk open as panels over the floor. `/campaign/<address>`
  and `/creator/<address>` still answer, because they are the addresses that get shared and
  the first carries the preview picture, but what they show is the museum with that exhibit in
  the chamber or that creator's file open. Only where the browser has no 3D does a campaign
  fall back to plain words. The embed card is the one thing outside: it is made to sit in
  somebody else's page.
- **The floor is drawn only when it changes.** Nothing on it moves by itself any more: the
  strolling figures and the hovering objects were removed, and shadows are drawn once when
  the exhibits are hung, so figures cast none. A museum nobody is walking through costs no
  drawing at all. How many frames a second that buys on a given machine was not measured.
- **Walking was tested as rules, not watched.** The tests step a visitor across a full museum.
  The browser used for checking does not run animation frames in the background, so nobody has
  yet watched the figure walk on this machine.
- **Frame rate was not measured.** The scene is small and draws every frame. It was looked at
  on one laptop and at phone width in an emulated viewport, not on a phone.
- **The floor signs use a system font**, drawn once to a texture.
