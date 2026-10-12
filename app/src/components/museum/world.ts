/**
 * Everything in the museum that is not an exhibit: the park it stands in, its stone walls cut
 * low on the near sides so the rooms can be looked into, a different floor in every room, the
 * furniture, and the figures that stroll about as set dressing.
 *
 * None of it carries information about a campaign. It is here so that the museum reads as a
 * place.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { PALETTE } from "@/components/museum/palette";
import { CORRIDORS, ENTRANCE, PLOT_SIZE, PLOTS, type Room, type RoomId, ROOMS } from "@/lib/museum/plan";

const PAVING = "#e6dcc6";
const STONE = PALETTE.wall;
const STONE_DARK = "#b9a57f";
const STONE_CAP = "#f4ead2";
const WOOD = "#c58f58";
const WOOD_DARK = "#6b4a32";
const CARPET = PALETTE.floors.unmade.runner;
const GOLD = "#d0a52e";
const HEDGE = PALETTE.trees[2];
const INK = "#4d3f2c";
const PAPER = "#f0efe7";
const LIME = "#d8f59a";

export const FAR_WALL = 2.4;
/** The island the museum stands on: a rectangle of ground with rounded corners. */
export const ISLAND = { minX: -28, maxX: 59, minZ: -31, maxZ: 33, corner: 10 };
const NEAR_WALL = 0.95;
const THICK = 0.5;

/** A repeatable random number, so the park looks the same on every visit. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function painted(
  size: number,
  draw: (context: CanvasRenderingContext2D, size: number) => void,
  repeatX: number,
  repeatY: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d") as CanvasRenderingContext2D, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Floorboards: long planks with staggered ends, each a slightly different brown. */
function planks(width: number, depth: number, color: string) {
  const map = painted(
    256,
    (context, size) => {
      const random = seeded(7);
      for (let row = 0; row < 8; row++) {
        let x = -random() * 120;
        while (x < size) {
          const length = 90 + random() * 90;
          const shade = 215 + Math.floor(random() * 40);
          context.fillStyle = `rgb(${shade},${shade},${shade})`;
          context.fillRect(x, row * 32, length - 2, 30);
          x += length;
        }
      }
    },
    width / 4,
    depth / 4,
  );
  return new THREE.MeshStandardMaterial({ color, map, roughness: 0.7 });
}

/** Square tiles in two colours. */
function tiles(width: number, depth: number, light: string, dark: string, size = 1.5) {
  const map = painted(
    128,
    (context) => {
      context.fillStyle = light;
      context.fillRect(0, 0, 128, 128);
      context.fillStyle = dark;
      context.fillRect(0, 0, 64, 64);
      context.fillRect(64, 64, 64, 64);
      context.strokeStyle = "rgba(0,0,0,0.12)";
      context.lineWidth = 2;
      context.strokeRect(0, 0, 64, 64);
      context.strokeRect(64, 64, 64, 64);
      context.strokeRect(64, 0, 64, 64);
      context.strokeRect(0, 64, 64, 64);
    },
    width / (size * 2),
    depth / (size * 2),
  );
  return new THREE.MeshStandardMaterial({ map, roughness: 0.55 });
}

/** Paving stones for the square outside. */
function cobbles(width: number, depth: number) {
  const map = painted(
    128,
    (context) => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 128, 128);
      context.strokeStyle = "rgba(0,0,0,0.16)";
      context.lineWidth = 2;
      for (let row = 0; row < 4; row++) {
        const shift = row % 2 === 0 ? 0 : 32;
        for (let column = -1; column < 3; column++) {
          context.strokeRect(column * 64 + shift, row * 32, 64, 32);
        }
      }
    },
    width / 3,
    depth / 3,
  );
  return new THREE.MeshStandardMaterial({ color: PAVING, map, roughness: 0.9 });
}

/** Words drawn once onto a picture that can be hung up. */
function lettering(
  width: number,
  height: number,
  background: string | null,
  lines: { text: string; size: number; weight: number; color: string; x: number; y: number }[],
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  context.textBaseline = "alphabetic";
  for (const line of lines) {
    context.fillStyle = line.color;
    context.font = `${line.weight} ${line.size}px "Segoe UI", system-ui, -apple-system, Arial, sans-serif`;
    context.fillText(line.text, line.x, line.y);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Builds the park and the building into `scene`. */
export function buildWorld(scene: THREE.Scene) {
  const matte = (color: string, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness });
  const stone = matte(STONE);
  const stoneDark = matte(STONE_DARK);
  const stoneCap = matte(STONE_CAP, 0.8);
  const wallTop = matte(PALETTE.wallTop, 0.8);
  const wood = matte(WOOD, 0.7);
  const woodDark = matte(WOOD_DARK, 0.7);
  const hedge = matte(HEDGE, 1);
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.35, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: "#6f93a8", roughness: 0.2, metalness: 0.3 });

  // Nothing built here ever moves, so everything of one material is welded into one mesh.
  // The building is a few hundred boxes; drawn one by one they cost a few hundred draws, twice
  // over when shadows are on. Welded, they cost a dozen.
  const welds = new Map<THREE.Material, { casting: THREE.BufferGeometry[]; flat: THREE.BufferGeometry[] }>();
  const weld = (geometry: THREE.BufferGeometry, material: THREE.Material, casts: boolean) => {
    let entry = welds.get(material);
    if (!entry) {
      entry = { casting: [], flat: [] };
      welds.set(material, entry);
    }
    (casts ? entry.casting : entry.flat).push(geometry.index ? geometry.toNonIndexed() : geometry);
  };
  const slab = (
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    casts = true,
  ) => weld(new THREE.BoxGeometry(width, height, depth).translate(x, y, z), material, casts);
  /** Something flat laid on a floor: a carpet, a painted line. */
  const laid = (width: number, depth: number, x: number, z: number, material: THREE.Material, y = 0.006) => {
    weld(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2).translate(x, y, z), material, false);
  };

  // ----- The park -------------------------------------------------------------------------
  // The museum stands on an island of its own, like a model on a table: grass on top, then
  // soil, then rock, each a little smaller than the one above.
  const layer = (inset: number, top: number, thick: number, color: string, catches: boolean) => {
    const w = ISLAND.maxX - ISLAND.minX - inset * 2;
    const d = ISLAND.maxZ - ISLAND.minZ - inset * 2;
    const r = Math.max(2, ISLAND.corner - inset);
    const outline = new THREE.Shape();
    outline.moveTo(-w / 2 + r, -d / 2);
    outline.lineTo(w / 2 - r, -d / 2);
    outline.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
    outline.lineTo(w / 2, d / 2 - r);
    outline.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
    outline.lineTo(-w / 2 + r, d / 2);
    outline.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
    outline.lineTo(-w / 2, -d / 2 + r);
    outline.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(outline, { depth: thick, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.2, bevelSegments: 2, curveSegments: 10 })
        .rotateX(-Math.PI / 2)
        .translate((ISLAND.minX + ISLAND.maxX) / 2, top - thick, (ISLAND.minZ + ISLAND.maxZ) / 2),
      matte(color, 1),
    );
    mesh.receiveShadow = catches;
    scene.add(mesh);
  };
  layer(0, -0.7, 0.9, PALETTE.grass, true);
  layer(0.7, -1.6, 2.2, PALETTE.soil, false);
  layer(2.4, -3.8, 2.6, PALETTE.rock, false);

  // The square the building stands on, and the path up to its door.
  const square = { minX: -17, maxX: 48.5, minZ: -21, maxZ: 23.5 };
  const squareWidth = square.maxX - square.minX;
  const squareDepth = square.maxZ - square.minZ;
  slab(squareWidth, 0.12, squareDepth, (square.minX + square.maxX) / 2, -0.46, (square.minZ + square.maxZ) / 2, cobbles(squareWidth, squareDepth), false);
  const pathLength = square.minX - ISLAND.minX - 1.2;
  slab(pathLength, 0.12, 4.4, square.minX - pathLength / 2, -0.46, 0, cobbles(pathLength, 4.4), false);

  // Lawns in the corners the wings leave free, each with a hedge round it.
  const lawns = [
    { minX: 7.3, maxX: 23.4, minZ: -19.8, maxZ: -6.9 },
    { minX: 9.7, maxX: 23.4, minZ: 6.7, maxZ: 22.4 },
    { minX: -15.9, maxX: -7.1, minZ: -19.8, maxZ: -7.5 },
    { minX: -15.9, maxX: -9.7, minZ: 3.4, maxZ: 22.4 },
    { minX: -15.9, maxX: -9.7, minZ: -7.5, maxZ: -3.4 },
  ];
  const lawnGrass = matte(PALETTE.lawn, 1);
  for (const lawn of lawns) {
    const width = lawn.maxX - lawn.minX;
    const depth = lawn.maxZ - lawn.minZ;
    const x = (lawn.minX + lawn.maxX) / 2;
    const z = (lawn.minZ + lawn.maxZ) / 2;
    slab(width, 0.1, depth, x, -0.36, z, lawnGrass, false);
    slab(width, 0.5, 0.45, x, -0.15, lawn.minZ, hedge);
    slab(width, 0.5, 0.45, x, -0.15, lawn.maxZ, hedge);
    slab(0.45, 0.5, depth, lawn.minX, -0.15, z, hedge);
    slab(0.45, 0.5, depth, lawn.maxX, -0.15, z, hedge);
  }

  // Trees: on the lawns and all round the square. Drawn in two batches, trunks and crowns.
  const random = seeded(42);
  const trees: { x: number; z: number; size: number }[] = [];
  const clear = (x: number, z: number) => trees.every((tree) => Math.hypot(tree.x - x, tree.z - z) > 2.6);
  for (const lawn of lawns) {
    const count = Math.round(((lawn.maxX - lawn.minX) * (lawn.maxZ - lawn.minZ)) / 40);
    for (let tries = 0; tries < count * 6 && trees.length < 400; tries++) {
      const x = lawn.minX + 1.3 + random() * (lawn.maxX - lawn.minX - 2.6);
      const z = lawn.minZ + 1.3 + random() * (lawn.maxZ - lawn.minZ - 2.6);
      if (clear(x, z)) trees.push({ x, z, size: 0.8 + random() * 0.6 });
      if (trees.filter((tree) => tree.x >= lawn.minX && tree.x <= lawn.maxX && tree.z >= lawn.minZ && tree.z <= lawn.maxZ).length >= count) break;
    }
  }
  const near = trees.length;
  // Round the rim of the island they stand in clumps, with gaps between: a frame for the
  // building, not a wood to get lost in.
  const onIsland = (x: number, z: number) => {
    const edge = 2.6;
    const dx = Math.max(ISLAND.minX + ISLAND.corner - x, 0, x - (ISLAND.maxX - ISLAND.corner));
    const dz = Math.max(ISLAND.minZ + ISLAND.corner - z, 0, z - (ISLAND.maxZ - ISLAND.corner));
    return Math.hypot(dx, dz) <= ISLAND.corner - edge;
  };
  for (let clump = 0; clump < 26; clump++) {
    // A point on the band between the square and the edge, by how far round the island it is.
    const turn = (clump / 26) * Math.PI * 2 + random() * 0.12;
    const cx = (ISLAND.minX + ISLAND.maxX) / 2 + Math.cos(turn) * ((ISLAND.maxX - ISLAND.minX) / 2 - 4.5);
    const cz = (ISLAND.minZ + ISLAND.maxZ) / 2 + Math.sin(turn) * ((ISLAND.maxZ - ISLAND.minZ) / 2 - 4.5);
    const many = 2 + Math.floor(random() * 3);
    for (let tree = 0, tries = 0; tree < many && tries < 20; tries++) {
      const x = cx + (random() - 0.5) * 6;
      const z = cz + (random() - 0.5) * 6;
      const onSquare = x > square.minX - 1.5 && x < square.maxX + 1.5 && z > square.minZ - 1.5 && z < square.maxZ + 1.5;
      const onPath = x < square.minX && Math.abs(z) < 4.2;
      if (onSquare || onPath || !onIsland(x, z) || !clear(x, z)) continue;
      trees.push({ x, z, size: 0.8 + random() * 0.45 });
      tree += 1;
    }
  }
  const trunkShape = new THREE.CylinderGeometry(0.16, 0.22, 1, 6);
  const crownShape = new THREE.IcosahedronGeometry(1, 0);
  const bark = matte("#7a5a3c");
  const foliage = matte("#ffffff", 1);
  const matrix = new THREE.Matrix4();
  const greens = PALETTE.trees;
  const plantTrees = (list: typeof trees, casts: boolean) => {
    const trunks = new THREE.InstancedMesh(trunkShape, bark, list.length);
    const crowns = new THREE.InstancedMesh(crownShape, foliage, list.length);
    list.forEach((tree, index) => {
      const ground = lawns.some(
        (lawn) => tree.x >= lawn.minX && tree.x <= lawn.maxX && tree.z >= lawn.minZ && tree.z <= lawn.maxZ,
      )
        ? -0.31
        : -0.7;
      const height = 1.3 * tree.size;
      matrix.compose(new THREE.Vector3(tree.x, ground + height / 2, tree.z), new THREE.Quaternion(), new THREE.Vector3(tree.size, height, tree.size));
      trunks.setMatrixAt(index, matrix);
      const radius = 1.3 * tree.size;
      matrix.compose(
        new THREE.Vector3(tree.x, ground + height + radius * 0.75, tree.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), index * 1.7),
        new THREE.Vector3(radius, radius * 1.15, radius),
      );
      crowns.setMatrixAt(index, matrix);
      crowns.setColorAt(index, new THREE.Color(greens[index % greens.length]));
    });
    for (const mesh of [trunks, crowns]) {
      mesh.castShadow = casts;
      mesh.receiveShadow = casts;
      scene.add(mesh);
    }
  };
  plantTrees(trees.slice(0, near), true);
  plantTrees(trees.slice(near), false);

  // A fountain on the square in front of the door.
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.15, 0.5, 40), stone);
  basin.position.set(-14.2, -0.15, 9.5);
  basin.castShadow = basin.receiveShadow = true;
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(1.75, 1.75, 0.06, 40),
    new THREE.MeshStandardMaterial({ color: "#6ec3df", roughness: 0.15, metalness: 0.2 }),
  );
  water.position.set(-14.2, 0.1, 9.5);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, 1.1, 16), stoneCap);
  spout.position.set(-14.2, 0.55, 9.5);
  spout.castShadow = true;
  scene.add(basin, water, spout);

  // ----- The building ---------------------------------------------------------------------
  /** A stretch of wall: stone, a darker course at its foot and a pale cap on top. */
  const wallPiece = (along: boolean, from: number, to: number, fixed: number, height: number) => {
    const length = to - from;
    if (length < 0.05) return;
    const middle = (from + to) / 2;
    const place = (thickness: number, tall: number, y: number, material: THREE.Material, extra = 0, casts = true) => {
      if (along) slab(length + extra, tall, thickness, middle, y, fixed, material, casts);
      else slab(thickness, tall, length + extra, fixed, y, middle, material, casts);
    };
    place(THICK, height, height / 2, stone);
    place(THICK + 0.14, 0.34, 0.17, stoneDark, 0.02, false);
    place(THICK + 0.2, 0.16, height + 0.08, wallTop, 0.1, false);
  };

  const wall = (room: Room, side: "n" | "s" | "e" | "w", height: number) => {
    const along = side === "n" || side === "s";
    const length = along ? room.width : room.depth;
    const fixed =
      side === "n"
        ? room.z - room.depth / 2
        : side === "s"
          ? room.z + room.depth / 2
          : side === "w"
            ? room.x - room.width / 2
            : room.x + room.width / 2;
    const centre = along ? room.x : room.z;

    // The stretch of this wall a corridor needs open, if one touches it.
    const door = CORRIDORS.find((corridor) => {
      const reach = along ? corridor.depth / 2 : corridor.width / 2;
      const position = along ? corridor.z : corridor.x;
      const across = along ? corridor.x : corridor.z;
      return Math.abs(position - fixed) <= reach + 0.01 && Math.abs(across - centre) < length / 2;
    });
    const pieces: [number, number][] = [];
    if (door) {
      const across = along ? door.x : door.z;
      const half = (along ? door.width : door.depth) / 2;
      pieces.push([centre - length / 2, across - half], [across + half, centre + length / 2]);
    } else {
      pieces.push([centre - length / 2, centre + length / 2]);
    }
    for (const [from, to] of pieces) {
      wallPiece(along, from, to, fixed, height);
      // Windows along the tall walls, on the side that faces into the room.
      if (height > 2 && to - from > 2.4) {
        const count = Math.floor((to - from) / 2.4);
        for (let index = 0; index < count; index++) {
          const at = from + ((index + 0.5) * (to - from)) / count;
          const inward = THICK / 2 + 0.02;
          if (along) {
            slab(1.0, 1.15, 0.06, at, 1.5, fixed + inward, stoneCap, false);
            slab(0.8, 0.95, 0.07, at, 1.5, fixed + inward + 0.01, glass, false);
          } else {
            slab(0.06, 1.15, 1.0, fixed + inward, 1.5, at, stoneCap, false);
            slab(0.07, 0.95, 0.8, fixed + inward + 0.01, 1.5, at, glass, false);
          }
        }
      }
    }
    // A stone gateway stands in the opening of a tall wall.
    if (door && height > 2) {
      const across = along ? door.x : door.z;
      const half = (along ? door.width : door.depth) / 2;
      for (const edge of [across - half + 0.14, across + half - 0.14]) {
        if (along) slab(0.34, 3, 0.66, edge, 1.5, fixed, stoneDark);
        else slab(0.66, 3, 0.34, fixed, 1.5, edge, stoneDark);
      }
      if (along) slab(half * 2 + 0.3, 0.36, 0.7, across, 3.1, fixed, stoneCap);
      else slab(0.7, 0.36, half * 2 + 0.3, fixed, 3.1, across, stoneCap);
    }
  };

  const carpet = matte(CARPET, 1);
  const trim = matte(GOLD, 0.6);
  /** A carpet with a gold edge down each long side. */
  const runner = (width: number, depth: number, x: number, z: number, material: THREE.Material = carpet) => {
    laid(width, depth, x, z, material, 0.008);
    if (width >= depth) {
      laid(width, 0.09, x, z - depth / 2 + 0.12, trim, 0.011);
      laid(width, 0.09, x, z + depth / 2 - 0.12, trim, 0.011);
    } else {
      laid(0.09, depth, x - width / 2 + 0.12, z, trim, 0.011);
      laid(0.09, depth, x + width / 2 - 0.12, z, trim, 0.011);
    }
  };

  const floors: Record<RoomId, THREE.Material> = {
    unmade: planks(16, 12, PALETTE.floors.unmade.planks),
    workshop: tiles(11, 10, PALETTE.floors.workshop.light, PALETTE.floors.workshop.dark),
    realized: planks(11, 10, PALETTE.floors.realized.planks),
    almost: planks(16, 12, PALETTE.floors.almost.planks),
    annex: tiles(22, 20, PALETTE.floors.annex.light, PALETTE.floors.annex.dark, 1.7),
  };

  for (const room of ROOMS) {
    slab(room.width, 0.4, room.depth, room.x, -0.2, room.z, floors[room.id], false);
    // The footing the building stands on, a step above the square.
    slab(room.width + 1.3, 0.24, room.depth + 1.3, room.x, -0.3, room.z, stoneDark, false);
    wall(room, "n", FAR_WALL);
    wall(room, "w", FAR_WALL);
    wall(room, "s", NEAR_WALL);
    wall(room, "e", NEAR_WALL);
    // A pier at every corner, taller where the walls are tall.
    const corners: [number, number, number][] = [
      [-1, -1, FAR_WALL + 0.5],
      [1, -1, FAR_WALL + 0.2],
      [-1, 1, FAR_WALL + 0.2],
      [1, 1, NEAR_WALL + 0.3],
    ];
    for (const [sx, sz, height] of corners) {
      const x = room.x + (sx * room.width) / 2;
      const z = room.z + (sz * room.depth) / 2;
      slab(0.86, height, 0.86, x, height / 2, z, stoneDark);
      slab(1.04, 0.18, 1.04, x, height + 0.09, z, wallTop, false);
    }

    // The room's letter on its far wall, in ink.
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({
        map: lettering(256, 256, null, [{ text: room.code, size: 230, weight: 700, color: INK, x: 40, y: 210 }]),
        transparent: true,
        depthWrite: false,
      }),
    );
    letter.position.set(room.x + room.width / 2 - 1.6, 1.35, room.z - room.depth / 2 + THICK / 2 + 0.05);
    scene.add(letter);


    // Hedges along the outside of the low walls, except where a door leads out through one.
    const doorSouth = CORRIDORS.some(
      (corridor) => corridor.along === "z" && Math.abs(corridor.z - corridor.depth / 2 - (room.z + room.depth / 2)) < 0.1 && Math.abs(corridor.x - room.x) < room.width / 2,
    );
    const doorEast = CORRIDORS.some(
      (corridor) => corridor.along === "x" && Math.abs(corridor.x - corridor.width / 2 - (room.x + room.width / 2)) < 0.1 && Math.abs(corridor.z - room.z) < room.depth / 2,
    );
    if (!doorSouth) slab(room.width - 1.4, 0.55, 0.5, room.x, -0.12, room.z + room.depth / 2 + 0.95, hedge);
    if (!doorEast) slab(0.5, 0.55, room.depth - 1.4, room.x + room.width / 2 + 0.95, -0.12, room.z, hedge);
  }

  // The plots of the annex, marked out on its floor for whoever builds there.
  const chalk = matte("#fbf6e6", 1);
  for (const plot of PLOTS) {
    const half = PLOT_SIZE / 2;
    laid(PLOT_SIZE, 0.08, plot.x, plot.z - half, chalk, 0.012);
    laid(PLOT_SIZE, 0.08, plot.x, plot.z + half, chalk, 0.012);
    laid(0.08, PLOT_SIZE, plot.x - half, plot.z, chalk, 0.012);
    laid(0.08, PLOT_SIZE, plot.x + half, plot.z, chalk, 0.012);
  }

  for (const corridor of CORRIDORS) {
    slab(corridor.width, 0.4, corridor.depth, corridor.x, -0.2, corridor.z, matte(STONE_CAP), false);
    const lengthwise = corridor.along === "x";
    runner(lengthwise ? corridor.width + 1.6 : 1.9, lengthwise ? 1.9 : corridor.depth + 1.6, corridor.x, corridor.z);
  }

  // The way in: steps, a planter each side, and the name over the door.
  for (let step = 0; step < 3; step++) {
    slab(0.5, 0.13, ENTRANCE.depth + 0.6, ENTRANCE.x - 1.75 - step * 0.5, -0.07 - step * 0.13, ENTRANCE.z, stoneCap, false);
  }
  const nameplate = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 1.4),
    new THREE.MeshBasicMaterial({
      map: lettering(1024, 256, "#171917", [
        { text: "EARNEST", size: 150, weight: 700, color: LIME, x: 40, y: 150 },
        { text: "MUSEUM OF THINGS THAT ALMOST EXISTED", size: 42, weight: 600, color: PAPER, x: 44, y: 216 },
      ]),
    }),
  );
  const plateBack = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.6, 0.14), woodDark);
  const plate = new THREE.Group();
  plateBack.position.z = -0.08;
  plateBack.castShadow = true;
  plate.add(plateBack, nameplate);
  // Over the gateway of the door, above everything that could cover it.
  plate.position.set(ENTRANCE.x + ENTRANCE.width / 2, 4.15, ENTRANCE.z);
  plate.rotation.y = Math.PI / 4;
  scene.add(plate);

  // ----- Furniture ------------------------------------------------------------------------
  const terracotta = matte("#b5654a");
  const leaf = matte("#3f9a4c", 1);
  const leafLight = matte("#62b35a", 1);
  const plant = (x: number, z: number, size = 1) => {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * size, 0.22 * size, 0.42 * size, 12), terracotta);
    pot.position.set(x, 0.21 * size, z);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.46 * size, 1), leaf);
    bush.position.set(x, 0.78 * size, z);
    const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 * size, 1), leafLight);
    tuft.position.set(x + 0.12 * size, 1.12 * size, z - 0.08 * size);
    for (const mesh of [pot, bush, tuft]) {
      weld(mesh.geometry.translate(mesh.position.x, mesh.position.y, mesh.position.z), mesh.material as THREE.Material, true);
    }
  };
  const bench = (x: number, z: number, alongX: boolean) => {
    const seat = alongX ? ([1.9, 0.12, 0.5] as const) : ([0.5, 0.12, 1.9] as const);
    slab(seat[0], seat[1], seat[2], x, 0.42, z, wood);
    for (const offset of [-0.75, 0.75]) {
      slab(alongX ? 0.12 : 0.44, 0.38, alongX ? 0.44 : 0.12, x + (alongX ? offset : 0), 0.19, z + (alongX ? 0 : offset), woodDark);
    }
  };
  const lampGlow = new THREE.MeshBasicMaterial({ color: "#ffe9a8" });
  // The warm patch a lamp throws on the ground: bright under it, gone a little way off.
  const patch = document.createElement("canvas");
  patch.width = patch.height = 64;
  const patchPaint = patch.getContext("2d") as CanvasRenderingContext2D;
  const warm = patchPaint.createRadialGradient(32, 32, 2, 32, 32, 32);
  warm.addColorStop(0, "rgba(255,226,150,0.55)");
  warm.addColorStop(1, "rgba(255,226,150,0)");
  patchPaint.fillStyle = warm;
  patchPaint.fillRect(0, 0, 64, 64);
  const lampPool = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(patch),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lamp = (x: number, z: number, ground = 0) => {
    laid(3.6, 3.6, x, z, lampPool, ground + 0.025);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.1, 8), woodDark);
    post.position.set(x, ground + 1.05, z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), lampGlow);
    head.position.set(x, ground + 2.2, z);
    for (const mesh of [post, head]) {
      weld(mesh.geometry.translate(mesh.position.x, mesh.position.y, mesh.position.z), mesh.material as THREE.Material, false);
    }
  };

  for (const room of ROOMS) {
    const west = room.x - room.width / 2 + 0.55;
    const east = room.x + room.width / 2 - 0.55;
    const north = room.z - room.depth / 2 + 0.55;
    const south = room.z + room.depth / 2 - 0.55;
    plant(west, north, 1.15);
    plant(east, north);
    plant(west, south);
    plant(east, south, 0.9);
    lamp(west + 0.1, room.z - room.depth / 4);
    lamp(room.x + room.width / 4, north + 0.05);
  }

  const hall = ROOMS[0];
  runner(hall.width - 1.2, 2.2, hall.x, hall.z);
  runner(2.2, hall.depth - 1.2, hall.x, hall.z);
  for (const dx of [-4.4, 4.4]) bench(hall.x + dx, hall.z + hall.depth / 2 - 0.55, true);
  for (const dz of [-3.6, 3.6]) bench(hall.x + hall.width / 2 - 0.55, hall.z + dz, false);

  const workshop = ROOMS[1];
  const shopWest = workshop.x - workshop.width / 2;
  slab(0.6, 0.9, 2.6, shopWest + 0.6, 0.45, workshop.z + 3.3, wood);
  slab(0.55, 1.6, 1.3, shopWest + 0.58, 0.8, workshop.z - 3.7, matte(PALETTE.brand, 0.6));
  for (const [dz, color] of [[2.6, PALETTE.brandSoft], [3.3, PALETTE.brass], [4.0, PALETTE.paper]] as const) {
    slab(0.32, 0.26, 0.4, shopWest + 0.6, 1.03, workshop.z + dz, matte(color, 0.6));
  }
  for (const [dx, dz, size] of [[3.4, -4.2, 0.7], [4.3, -4.25, 0.5], [3.8, -4.2, 0.45]] as const) {
    slab(size, size, size, workshop.x + dx, size / 2, workshop.z + dz, wood);
  }
  // A painted line round the working floor: mind your step.
  const paint = new THREE.MeshBasicMaterial({ color: PALETTE.brand });
  const inner = { w: workshop.width - 3.2, d: workshop.depth - 2.6 };
  laid(inner.w, 0.09, workshop.x + 0.4, workshop.z - inner.d / 2, paint);
  laid(inner.w, 0.09, workshop.x + 0.4, workshop.z + inner.d / 2, paint);
  laid(0.09, inner.d, workshop.x + 0.4 - inner.w / 2, workshop.z, paint);
  laid(0.09, inner.d, workshop.x + 0.4 + inner.w / 2, workshop.z, paint);
  bench(workshop.x, workshop.z + workshop.depth / 2 - 0.55, true);

  const realized = ROOMS[2];
  // A runner down the middle, so the warm floor of what was made shows either side of it.
  runner(2.4, realized.depth - 1.6, realized.x, realized.z, matte(PALETTE.floors.realized.runner, 1));
  // Brass posts and a rope across the far end, the way finished things are kept.
  for (const dx of [-4.4, -2.2, 0, 2.2, 4.4]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.9, 10), gold);
    post.position.set(realized.x + dx, 0.45, realized.z - realized.depth / 2 + 1.0);
    post.castShadow = true;
    scene.add(post);
  }
  slab(8.8, 0.05, 0.05, realized.x, 0.8, realized.z - realized.depth / 2 + 1.0, matte(CARPET), false);
  bench(realized.x + realized.width / 2 - 0.55, realized.z, false);

  const almost = ROOMS[3];
  // One runner down the aisle that leads in from the door.
  runner(2.4, almost.depth - 1.2, almost.x, almost.z, matte(PALETTE.floors.almost.runner, 1));
  const back = almost.z - almost.depth / 2 + 0.62;
  for (const dx of [-5.6, -1.9, 1.9, 5.6]) {
    slab(2.8, 1.3, 0.5, almost.x + dx, 0.65, back, woodDark);
    // Boxes of records on the shelves.
    for (const [bx, color] of [[-0.85, "#e8dcc0"], [-0.15, "#c9b48a"], [0.65, "#e8dcc0"]] as const) {
      slab(0.52, 0.36, 0.38, almost.x + dx + bx, 1.49, back, matte(color));
    }
  }
  for (const dx of [-4.4, 4.4]) bench(almost.x + dx, almost.z + almost.depth / 2 - 0.55, true);

  // Lamps and planters out on the square.
  for (const [x, z] of [[-11.5, -3], [-11.5, 3], [9.4, 7.4], [22.6, 6], [6.9, -6.9], [-9, 21.2], [9, 21.2], [22.6, -6]] as const) {
    lamp(x, z, -0.4);
  }
  for (const dz of [-2.4, 2.4]) {
    const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.7, 14), stone);
    tub.position.set(ENTRANCE.x - 1.2, -0.05, dz);
    tub.castShadow = true;
    const shrub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), leaf);
    shrub.position.set(ENTRANCE.x - 1.2, 0.72, dz);
    shrub.castShadow = true;
    scene.add(tub, shrub);
  }

  // Where a wall meets the floor it is a little darker, the way corners are. A strip along the
  // inside of every wall, dark at the wall and gone under a metre out.
  const dusk = document.createElement("canvas");
  dusk.width = 4;
  dusk.height = 64;
  const duskPaint = dusk.getContext("2d") as CanvasRenderingContext2D;
  const falloff = duskPaint.createLinearGradient(0, 0, 0, 64);
  falloff.addColorStop(0, "rgba(40,28,16,0.34)");
  falloff.addColorStop(1, "rgba(40,28,16,0)");
  duskPaint.fillStyle = falloff;
  duskPaint.fillRect(0, 0, 4, 64);
  const corner = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(dusk), transparent: true, depthWrite: false });
  /** A strip of shade `length` long at a point, its dark edge towards the wall it is turned to. */
  const shade = (length: number, x: number, z: number, turn: number) => {
    weld(new THREE.PlaneGeometry(length, 1.1).rotateX(-Math.PI / 2).rotateY(turn).translate(x, 0.016, z), corner, false);
  };
  for (const room of ROOMS) {
    const inX = room.width / 2 - THICK / 2 - 0.55;
    const inZ = room.depth / 2 - THICK / 2 - 0.55;
    shade(room.width - THICK, room.x, room.z - inZ, 0);
    shade(room.width - THICK, room.x, room.z + inZ, Math.PI);
    shade(room.depth - THICK, room.x - inX, room.z, Math.PI / 2);
    shade(room.depth - THICK, room.x + inX, room.z, -Math.PI / 2);
  }

  // ----- Dressing -------------------------------------------------------------------------
  // Bunting along the top of the tall walls, on the side that faces into each room. It skips
  // the gateways.
  const flags = [PALETTE.brand, PALETTE.lime, PALETTE.paper].map((color) => matte(color, 0.8));
  for (const room of ROOMS) {
    const north = room.z - room.depth / 2;
    const west = room.x - room.width / 2;
    let flag = 0;
    for (let x = west + 0.95; x < room.x + room.width / 2 - 0.6; x += 0.85) {
      const gate = CORRIDORS.some(
        (corridor) => corridor.along === "z" && Math.abs(corridor.x - x) < corridor.width / 2 + 0.3 && Math.abs(corridor.z - north) < corridor.depth / 2 + 0.1,
      );
      if (!gate) slab(0.3, 0.32 - (flag % 2) * 0.1, 0.03, x, FAR_WALL - 0.2, north + THICK / 2 + 0.03, flags[flag % flags.length], false);
      flag += 1;
    }
    for (let z = north + 0.95; z < room.z + room.depth / 2 - 0.6; z += 0.85) {
      const gate = CORRIDORS.some(
        (corridor) => corridor.along === "x" && Math.abs(corridor.z - z) < corridor.depth / 2 + 0.3 && Math.abs(corridor.x - west) < corridor.width / 2 + 0.1,
      );
      if (!gate) slab(0.03, 0.32 - (flag % 2) * 0.1, 0.3, west + THICK / 2 + 0.03, FAR_WALL - 0.2, z, flags[flag % flags.length], false);
      flag += 1;
    }
  }

  // Flowers on the lawns, in clumps between the trees. One mesh for all of them.
  const petals = ["#ffffff", "#ffe08a", PALETTE.lime];
  const blooms: { x: number; z: number; size: number; color: string }[] = [];
  for (const lawn of lawns) {
    const clumps = Math.round(((lawn.maxX - lawn.minX) * (lawn.maxZ - lawn.minZ)) / 30);
    for (let clump = 0; clump < clumps; clump++) {
      const cx = lawn.minX + 0.9 + random() * (lawn.maxX - lawn.minX - 1.8);
      const cz = lawn.minZ + 0.9 + random() * (lawn.maxZ - lawn.minZ - 1.8);
      if (trees.some((tree) => Math.hypot(tree.x - cx, tree.z - cz) < 1.1)) continue;
      const color = petals[Math.floor(random() * petals.length)];
      for (let bloom = 0; bloom < 6; bloom++) {
        blooms.push({ x: cx + (random() - 0.5) * 0.9, z: cz + (random() - 0.5) * 0.9, size: 0.09 + random() * 0.06, color });
      }
    }
  }
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), matte("#ffffff", 0.9), blooms.length);
  blooms.forEach((bloom, index) => {
    matrix.compose(new THREE.Vector3(bloom.x, -0.31 + bloom.size, bloom.z), new THREE.Quaternion(), new THREE.Vector3(bloom.size, bloom.size, bloom.size));
    flowers.setMatrixAt(index, matrix);
    flowers.setColorAt(index, new THREE.Color(bloom.color));
  });
  scene.add(flowers);

  // Water playing in the fountain: a pale plume over the spout and a ring where it lands.
  const spray = new THREE.MeshStandardMaterial({ color: "#dff4fb", transparent: true, opacity: 0.7, roughness: 0.2 });
  weld(new THREE.ConeGeometry(0.34, 0.9, 12).translate(-14.2, 1.5, 9.5), spray, false);
  weld(new THREE.TorusGeometry(0.9, 0.06, 8, 32).rotateX(Math.PI / 2).translate(-14.2, 0.14, 9.5), spray, false);
  weld(new THREE.TorusGeometry(1.4, 0.04, 8, 40).rotateX(Math.PI / 2).translate(-14.2, 0.14, 9.5), spray, false);

  for (const [material, entry] of welds) {
    for (const [geometries, casts] of [
      [entry.casting, true],
      [entry.flat, false],
    ] as const) {
      if (geometries.length === 0) continue;
      const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
      mesh.castShadow = casts;
      mesh.receiveShadow = true;
      scene.add(mesh);
      for (const geometry of geometries) geometry.dispose();
    }
  }
}

