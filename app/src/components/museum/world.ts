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

import { canStand, CORRIDORS, ENTRANCE, type Room, type RoomId, ROOMS } from "@/lib/museum/plan";

const GRASS = "#8cc070";
const PAVING = "#e6dcc6";
const STONE = "#e0d0b0";
const STONE_DARK = "#b9a57f";
const STONE_CAP = "#f4ead2";
const WOOD = "#c58f58";
const WOOD_DARK = "#6b4a32";
const CARPET = "#b5443b";
const GOLD = "#d0a52e";
const HEDGE = "#4f9a45";
const INK = "#4d3f2c";
const PAPER = "#f0efe7";
const LIME = "#d8f59a";

export const SKY = GRASS;
export const FAR_WALL = 2.4;
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
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    matte(GRASS, 1),
  );
  grass.position.y = -0.5;
  grass.receiveShadow = true;
  scene.add(grass);

  // The square the building stands on, and the path up to its door.
  const square = { minX: -17, maxX: 24.5, minZ: -21, maxZ: 23.5 };
  const squareWidth = square.maxX - square.minX;
  const squareDepth = square.maxZ - square.minZ;
  slab(squareWidth, 0.12, squareDepth, (square.minX + square.maxX) / 2, -0.46, (square.minZ + square.maxZ) / 2, cobbles(squareWidth, squareDepth), false);
  slab(30, 0.12, 4.4, -32, -0.46, 0, cobbles(30, 4.4), false);

  // Lawns in the corners the wings leave free, each with a hedge round it.
  const lawns = [
    { minX: 7.3, maxX: 23.4, minZ: -19.8, maxZ: -6.9 },
    { minX: 9.7, maxX: 23.4, minZ: 6.7, maxZ: 22.4 },
    { minX: -15.9, maxX: -7.1, minZ: -19.8, maxZ: -7.5 },
    { minX: -15.9, maxX: -9.7, minZ: 3.4, maxZ: 22.4 },
    { minX: -15.9, maxX: -9.7, minZ: -7.5, maxZ: -3.4 },
  ];
  const lawnGrass = matte("#7fb765", 1);
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
    const count = Math.round(((lawn.maxX - lawn.minX) * (lawn.maxZ - lawn.minZ)) / 26);
    for (let tries = 0; tries < count * 6 && trees.length < 400; tries++) {
      const x = lawn.minX + 1.3 + random() * (lawn.maxX - lawn.minX - 2.6);
      const z = lawn.minZ + 1.3 + random() * (lawn.maxZ - lawn.minZ - 2.6);
      if (clear(x, z)) trees.push({ x, z, size: 0.8 + random() * 0.6 });
      if (trees.filter((tree) => tree.x >= lawn.minX && tree.x <= lawn.maxX && tree.z >= lawn.minZ && tree.z <= lawn.maxZ).length >= count) break;
    }
  }
  const near = trees.length;
  for (let tries = 0; tries < 900 && trees.length < near + 110; tries++) {
    const x = -48 + random() * 100;
    const z = -48 + random() * 100;
    const onSquare = x > square.minX - 2 && x < square.maxX + 2 && z > square.minZ - 2 && z < square.maxZ + 2;
    const onPath = x < square.minX && Math.abs(z) < 4.2;
    if (!onSquare && !onPath && clear(x, z)) trees.push({ x, z, size: 1 + random() * 0.9 });
  }
  const trunkShape = new THREE.CylinderGeometry(0.16, 0.22, 1, 6);
  const crownShape = new THREE.IcosahedronGeometry(1, 1);
  const bark = matte("#7a5a3c");
  const foliage = matte("#ffffff", 1);
  const matrix = new THREE.Matrix4();
  const greens = ["#3f8f4a", "#4c9d4f", "#5aa653", "#367f44"];
  const plantTrees = (list: typeof trees, casts: boolean) => {
    const trunks = new THREE.InstancedMesh(trunkShape, bark, list.length);
    const crowns = new THREE.InstancedMesh(crownShape, foliage, list.length);
    list.forEach((tree, index) => {
      const ground = lawns.some(
        (lawn) => tree.x >= lawn.minX && tree.x <= lawn.maxX && tree.z >= lawn.minZ && tree.z <= lawn.maxZ,
      )
        ? -0.31
        : -0.5;
      const height = 1.3 * tree.size;
      matrix.compose(new THREE.Vector3(tree.x, ground + height / 2, tree.z), new THREE.Quaternion(), new THREE.Vector3(tree.size, height, tree.size));
      trunks.setMatrixAt(index, matrix);
      const radius = 1.3 * tree.size;
      matrix.compose(new THREE.Vector3(tree.x, ground + height + radius * 0.75, tree.z), new THREE.Quaternion(), new THREE.Vector3(radius, radius * 1.15, radius));
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
    place(THICK + 0.18, 0.12, height + 0.06, stoneCap, 0.1, false);
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
    unmade: planks(16, 12, WOOD),
    workshop: tiles(11, 10, "#e3e9ec", "#a9bcc8"),
    realized: tiles(11, 10, "#f3ecdc", "#e3d8c0", 1.1),
    almost: planks(16, 12, "#96765a"),
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
      slab(1.0, 0.14, 1.0, x, height + 0.07, z, stoneCap, false);
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

    // Its name on a board outside the near corner, turned to face whoever is looking.
    const board = new THREE.Group();
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 1.15),
      new THREE.MeshBasicMaterial({
        map: lettering(1024, 256, "#171917", [
          { text: room.code, size: 170, weight: 700, color: LIME, x: 36, y: 186 },
          { text: room.name.toUpperCase(), size: 74, weight: 600, color: PAPER, x: 190, y: 156 },
        ]),
      }),
    );
    face.position.y = 1.5;
    const back = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.35, 0.12), woodDark);
    back.position.set(0, 1.5, -0.07);
    back.castShadow = true;
    board.add(back, face);
    for (const dx of [-1.9, 1.9]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), woodDark);
      leg.position.set(dx, 0.45, -0.07);
      leg.castShadow = true;
      board.add(leg);
    }
    board.position.set(room.x + room.width / 2 + 1.5, -0.4, room.z + room.depth / 2 + 1.5);
    board.rotation.y = Math.PI / 4;
    scene.add(board);

    // Hedges along the outside of the low walls.
    slab(room.width - 1.4, 0.55, 0.5, room.x, -0.12, room.z + room.depth / 2 + 0.95, hedge);
    slab(0.5, 0.55, room.depth - 1.4, room.x + room.width / 2 + 0.95, -0.12, room.z, hedge);
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
  for (const dx of [-2.4, 2.4]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.3, 0.16), woodDark);
    leg.position.set(dx, -1.35, -0.08);
    leg.castShadow = true;
    plate.add(leg);
  }
  plate.position.set(-12.8, 1.6, -4.4);
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
  const lamp = (x: number, z: number, ground = 0) => {
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
  slab(0.55, 1.6, 1.3, shopWest + 0.58, 0.8, workshop.z - 3.7, matte("#3d6f9e", 0.6));
  for (const [dz, color] of [[2.6, "#e56b9b"], [3.3, "#f7b801"], [4.0, "#2ec4b6"]] as const) {
    slab(0.32, 0.26, 0.4, shopWest + 0.6, 1.03, workshop.z + dz, matte(color, 0.6));
  }
  for (const [dx, dz, size] of [[3.4, -4.2, 0.7], [4.3, -4.25, 0.5], [3.8, -4.2, 0.45]] as const) {
    slab(size, size, size, workshop.x + dx, size / 2, workshop.z + dz, wood);
  }
  // A painted line round the working floor: mind your step.
  const paint = new THREE.MeshBasicMaterial({ color: "#ff6338" });
  const inner = { w: workshop.width - 3.2, d: workshop.depth - 2.6 };
  laid(inner.w, 0.09, workshop.x + 0.4, workshop.z - inner.d / 2, paint);
  laid(inner.w, 0.09, workshop.x + 0.4, workshop.z + inner.d / 2, paint);
  laid(0.09, inner.d, workshop.x + 0.4 - inner.w / 2, workshop.z, paint);
  laid(0.09, inner.d, workshop.x + 0.4 + inner.w / 2, workshop.z, paint);
  bench(workshop.x, workshop.z + workshop.depth / 2 - 0.55, true);

  const realized = ROOMS[2];
  runner(realized.width - 1.8, realized.depth - 2.4, realized.x, realized.z, matte("#2f5d8a", 1));
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
  runner(almost.width - 1.2, 1.9, almost.x, almost.z - 1.7, matte("#4d7a66", 1));
  runner(almost.width - 1.2, 1.9, almost.x, almost.z + 1.7, matte("#4d7a66", 1));
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

// -----------------------------------------------------------------------------------------------
// Set dressing that moves
// -----------------------------------------------------------------------------------------------

const SHIRTS = ["#e4572e", "#17bebb", "#ffc914", "#76b041", "#5b5f97", "#ff8cc6", "#2e86ab", "#f4f1de"];
const SKINS = ["#f1c9a5", "#d9a37a", "#b97a56", "#8d5a3b"];

interface Stroller {
  figure: THREE.Group;
  room: Room;
  goal: { x: number; z: number };
  wait: number;
  speed: number;
}

/**
 * Figures that wander the rooms so the museum does not feel empty. They are scenery: they
 * stand for nobody, hold no wallet and never touch a campaign, and the page says so.
 */
export class Strollers {
  private readonly figures: Stroller[] = [];
  private readonly random = seeded(99);

  constructor(scene: THREE.Scene, count: number) {
    for (let index = 0; index < count; index++) {
      const room = ROOMS[index % ROOMS.length];
      const figure = new THREE.Group();
      const shirt = new THREE.MeshStandardMaterial({ color: SHIRTS[index % SHIRTS.length], roughness: 0.8 });
      const skin = new THREE.MeshStandardMaterial({ color: SKINS[index % SKINS.length], roughness: 0.8 });
      const legs = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 0.3, 10),
        new THREE.MeshStandardMaterial({ color: "#3b3f4a", roughness: 0.9 }),
      );
      legs.position.y = 0.15;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.34, 12), shirt);
      body.position.y = 0.47;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), skin);
      head.position.y = 0.76;
      for (const mesh of [legs, body, head]) mesh.castShadow = true;
      figure.add(legs, body, head);
      const start = this.somewhere(room, []);
      figure.position.set(start.x, 0, start.z);
      scene.add(figure);
      this.figures.push({ figure, room, goal: start, wait: this.random() * 4, speed: 0.7 + this.random() * 0.5 });
    }
  }

  private somewhere(room: Room, exhibits: { x: number; z: number }[]) {
    for (let tries = 0; tries < 30; tries++) {
      const x = room.x + (this.random() - 0.5) * (room.width - 2.4);
      const z = room.z + (this.random() - 0.5) * (room.depth - 2.4);
      if (canStand(x, z, exhibits)) return { x, z };
    }
    return { x: room.x, z: room.z };
  }

  /** Moves everyone on by one frame. Each strolls to a spot, looks about for a while, and picks another. */
  step(seconds: number, time: number, exhibits: { x: number; z: number }[]) {
    for (const stroller of this.figures) {
      const { figure } = stroller;
      if (stroller.wait > 0) {
        stroller.wait -= seconds;
        if (stroller.wait <= 0) stroller.goal = this.somewhere(stroller.room, exhibits);
        continue;
      }
      const dx = stroller.goal.x - figure.position.x;
      const dz = stroller.goal.z - figure.position.z;
      const left = Math.hypot(dx, dz);
      const reach = stroller.speed * seconds;
      if (left <= reach + 0.02) {
        stroller.wait = 2 + this.random() * 6;
        continue;
      }
      const x = figure.position.x + (dx / left) * reach;
      const z = figure.position.z + (dz / left) * reach;
      // Anything in the way ends the stroll; the next one starts from here.
      if (!canStand(x, z, exhibits)) {
        stroller.wait = 0.5 + this.random() * 2;
        continue;
      }
      figure.position.set(x, Math.abs(Math.sin(time * 9 + figure.id)) * 0.03, z);
      figure.rotation.y = Math.atan2(dx, dz);
    }
  }
}
