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
- **Other visitors are not shown.** There is no shared presence. The figure with the label is
  the person looking: a guest, or a connected wallet carrying its address. The dozen or so
  other figures strolling the rooms are scenery, like the trees outside; they stand for nobody,
  and the page says so next to the directory. The lit seats in front of an exhibit are real: they are the seats taken on chain.
- **Walking was tested as rules, not watched.** The tests step a visitor across a full museum.
  The browser used for checking does not run animation frames in the background, so nobody has
  yet watched the figure walk on this machine.
- **Frame rate was not measured.** The scene is small and draws every frame. It was looked at
  on one laptop and at phone width in an emulated viewport, not on a phone.
- **The floor signs use a system font**, drawn once to a texture.
