/**
 * The museum as a three.js scene: the building, an exhibit for each campaign that was hung, the
 * visitor who walks it, and the camera that follows. It draws and reports what is pointed at,
 * stood next to and clicked; it knows nothing about wallets or transactions, and it never
 * decides what a campaign's state is.
 *
 * Loaded only in the browser and only by the museum page, so the rest of the site does not
 * carry three.js.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  canStand,
  CORRIDORS,
  ENTRANCE,
  type Exhibit,
  type Kind,
  type Room,
  roomAt,
  type RoomId,
  ROOMS,
  route,
  seatMarkers,
  standBy,
  STATUS_WORDS,
  stepFrom,
} from "@/lib/museum/plan";

const CARBON = "#171917";
const STEEL = "#8d9388";
const PAPER = "#f0efe7";
const LIME = "#d8f59a";
const ORANGE = "#ff6338";

// Where the camera sits relative to what it looks at: a fixed view from the south-east,
// about 32 degrees above the floor. It never rotates.
const OFFSET = new THREE.Vector3(14, 12.5, 14);
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();
const SCREEN_UP = new THREE.Vector3(-1, 0, -1).normalize();
const PITCH = Math.atan2(OFFSET.y, Math.hypot(OFFSET.x, OFFSET.z));
const ZOOM_MIN = 11;
const ZOOM_MAX = 84;
const BOUNDS = { minX: -13, maxX: 23, minZ: -20, maxZ: 22 };
const WALL = 1.9;
const CURB = 0.22;
const WALK = 5.2;
const STRIDE = 11;
const NEAR = 2.9;
const START = { x: -6.4, z: 0 };

export type Direction = "up" | "down" | "left" | "right";

export interface SceneHandlers {
  /** The exhibit under the pointer, with where the pointer is inside the scene's element. */
  onHover(id: string | null, x: number, y: number): void;
  onSelect(id: string | null): void;
  /** The room the visitor is in, or the one that was asked for by name. */
  onRoom(room: RoomId): void;
  /** The exhibit the visitor is standing next to. */
  onNear(id: string | null): void;
}

export class MuseumScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly raycaster = new THREE.Raycaster();
  private readonly observer: ResizeObserver;
  private readonly labels: HTMLDivElement;
  private readonly target = new THREE.Vector3(0, 0, 1);
  private readonly goal = new THREE.Vector3(0, 0, 1);
  private zoom = 30;
  private zoomGoal = 30;
  private frame = 0;
  private last = performance.now();
  private clock = 0;
  private room: RoomId = "unmade";

  // Everything that belongs to the exhibits and is thrown away when they change.
  private readonly exhibitRoot = new THREE.Group();
  private exhibitGeometry: THREE.BufferGeometry[] = [];
  private exhibitMaterials: THREE.Material[] = [];
  private pickable: THREE.Object3D[] = [];
  private hung: Exhibit[] = [];
  private readonly objects = new Map<string, THREE.Object3D>();
  private readonly places = new Map<string, THREE.Vector3>();
  private readonly tags = new Map<string, HTMLDivElement>();
  private hot: string | null = null;
  private pointed: string | null = null;
  private near: string | null = null;
  private selected: string | null = null;

  private readonly hoverRing: THREE.Mesh;
  private readonly selectRing: THREE.Mesh;

  // The visitor: where they are, where they are walking to, and which keys are held.
  private readonly visitor = new THREE.Group();
  private readonly visitorBody: THREE.MeshStandardMaterial;
  private readonly visitorHalo: THREE.Mesh;
  private readonly visitorTag: HTMLDivElement;
  private path: [number, number][] = [];
  private readonly held = new Set<Direction>();
  private following = false;
  private stuck = 0;

  // Space the page's own panels cover, so what is looked at is centred in what is left.
  private insetLeft = 0;
  private insetRight = 0;
  private insetBottom = 0;

  private drag: { x: number; y: number; moved: boolean } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly handlers: SceneHandlers,
    private readonly calm: boolean,
  ) {
    // Throws where WebGL is not available; the page shows the catalog instead.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";
    host.appendChild(this.renderer.domElement);

    // Name tags are ordinary elements laid over the picture, so their text stays sharp.
    this.labels = document.createElement("div");
    this.labels.setAttribute("aria-hidden", "true");
    this.labels.className = "pointer-events-none absolute inset-0 overflow-hidden";
    host.appendChild(this.labels);
    this.visitorTag = document.createElement("div");
    this.visitorTag.className =
      "absolute left-0 top-0 whitespace-nowrap bg-carbon/85 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-paper";
    this.labels.appendChild(this.visitorTag);

    this.scene.background = new THREE.Color(CARBON);
    this.scene.add(new THREE.HemisphereLight(PAPER, "#3a3d39", 1.35));
    const sun = new THREE.DirectionalLight("#fff3da", 2.9);
    sun.position.set(-10, 22, 9);
    sun.target.position.set(6, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 80 });
    this.scene.add(sun, sun.target);

    this.build();
    this.scene.add(this.exhibitRoot);

    const ring = new THREE.RingGeometry(1.0, 1.12, 56);
    ring.rotateX(-Math.PI / 2);
    this.hoverRing = new THREE.Mesh(
      ring,
      new THREE.MeshBasicMaterial({ color: PAPER, transparent: true, opacity: 0.8 }),
    );
    this.selectRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: LIME }));
    for (const mesh of [this.hoverRing, this.selectRing]) {
      mesh.position.y = 0.03;
      mesh.visible = false;
      this.scene.add(mesh);
    }

    this.visitorBody = new THREE.MeshStandardMaterial({ color: "#a6aaa0", roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.5, 20), this.visitorBody);
    body.position.y = 0.25;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 14), this.visitorBody);
    head.position.y = 0.64;
    body.castShadow = head.castShadow = true;
    const halo = new THREE.RingGeometry(0.3, 0.38, 32);
    halo.rotateX(-Math.PI / 2);
    this.visitorHalo = new THREE.Mesh(halo, new THREE.MeshBasicMaterial({ color: LIME }));
    this.visitorHalo.position.y = 0.03;
    this.visitor.add(body, head, this.visitorHalo);
    this.visitor.position.set(START.x, 0, START.z);
    this.scene.add(this.visitor);
    this.setVisitor(null);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.zoom = this.zoomGoal = this.fitZoom() * 0.86;

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });

    this.frame = requestAnimationFrame(this.loop);
  }

  // -------------------------------------------------------------------------------------------
  // The building
  // -------------------------------------------------------------------------------------------

  private slab(
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    casts = true,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = casts;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  /** Concrete laid in two-metre slabs: a light field with a darker joint round each. */
  private paving(width: number, depth: number, color: string) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 128, 128);
    // A little unevenness, so the floor does not look printed.
    for (let index = 0; index < 220; index++) {
      context.fillStyle = `rgba(0,0,0,${0.015 + ((index * 37) % 10) / 400})`;
      context.fillRect((index * 53) % 128, (index * 97) % 128, 3 + (index % 5), 2 + (index % 3));
    }
    context.strokeStyle = "rgba(0,0,0,0.3)";
    context.lineWidth = 2;
    context.strokeRect(1, 1, 126, 126);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(width / 2, depth / 2);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ color, map: texture, roughness: 0.95 });
  }

  /** Words drawn once onto a picture that can be laid on a floor or hung on a wall. */
  private lettering(
    lines: { text: string; size: number; weight: number; alpha: number; x: number; y: number }[],
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 512;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.fillStyle = PAPER;
    context.textBaseline = "alphabetic";
    for (const line of lines) {
      context.globalAlpha = line.alpha;
      context.font = `${line.weight} ${line.size}px "Segoe UI", system-ui, -apple-system, Arial, sans-serif`;
      context.fillText(line.text, line.x, line.y);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  }

  /** A wall along one edge of a room, left open where a corridor passes through it. */
  private wall(
    room: Room,
    side: "n" | "s" | "e" | "w",
    height: number,
    material: THREE.Material,
    cap?: THREE.Material,
  ) {
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
    const thick = 0.42;
    for (const [from, to] of pieces) {
      if (to - from < 0.05) continue;
      const middle = (from + to) / 2;
      if (along) {
        this.slab(to - from, height, thick, middle, height / 2, fixed, material);
        if (cap) this.slab(to - from + 0.08, 0.09, thick + 0.14, middle, height + 0.045, fixed, cap, false);
      } else {
        this.slab(thick, height, to - from, fixed, height / 2, middle, material);
        if (cap) this.slab(thick + 0.14, 0.09, to - from + 0.08, fixed, height + 0.045, middle, cap, false);
      }
    }
    // A steel frame stands in the opening of a tall wall, so a door reads as a door.
    if (door && cap) {
      const steel = new THREE.MeshStandardMaterial({ color: "#1c1e1c", roughness: 0.5, metalness: 0.6 });
      const across = along ? door.x : door.z;
      const half = (along ? door.width : door.depth) / 2;
      for (const edge of [across - half + 0.1, across + half - 0.1]) {
        if (along) this.slab(0.2, 2.5, 0.5, edge, 1.25, fixed, steel);
        else this.slab(0.5, 2.5, 0.2, fixed, 1.25, edge, steel);
      }
      if (along) this.slab(half * 2, 0.22, 0.5, across, 2.5, fixed, steel);
      else this.slab(0.5, 0.22, half * 2, fixed, 2.5, across, steel);
    }
  }

  private build() {
    const floors: Record<RoomId, string> = {
      unmade: "#74786f",
      workshop: "#676c5c",
      realized: "#8c8f85",
      almost: "#5a5d57",
    };
    const wallMaterial = new THREE.MeshStandardMaterial({ color: "#3b3e3a", roughness: 0.95 });
    const capMaterial = new THREE.MeshStandardMaterial({ color: "#7d8179", roughness: 0.9 });
    const curbMaterial = new THREE.MeshStandardMaterial({ color: "#2f322f", roughness: 0.95 });
    const steel = new THREE.MeshStandardMaterial({ color: "#6d726a", roughness: 0.55, metalness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: "#242624", roughness: 0.6, metalness: 0.4 });
    const paper = new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.8 });

    // The ground the building stands on, ruled like a drawing.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: "#1b1d1b", roughness: 1 }),
    );
    ground.position.y = -0.42;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(240, 120, "#2a2d2a", "#222422");
    grid.position.y = -0.41;
    this.scene.add(grid);

    for (const room of ROOMS) {
      this.slab(
        room.width,
        0.4,
        room.depth,
        room.x,
        -0.2,
        room.z,
        this.paving(room.width, room.depth, floors[room.id]),
        false,
      );
      // A dark course under the floor, so the building sits on the ground like a model.
      this.slab(room.width + 0.9, 0.2, room.depth + 0.9, room.x, -0.32, room.z, dark, false);
      // Tall on the two far sides, cut low on the two near ones so the room can be looked into.
      this.wall(room, "n", WALL, wallMaterial, capMaterial);
      this.wall(room, "w", WALL, wallMaterial, capMaterial);
      this.wall(room, "s", CURB, curbMaterial);
      this.wall(room, "e", CURB, curbMaterial);
      // A column where the two tall walls meet.
      this.slab(0.7, WALL + 0.5, 0.7, room.x - room.width / 2, (WALL + 0.5) / 2, room.z - room.depth / 2, dark);
      this.sign(room);
    }
    for (const corridor of CORRIDORS) {
      this.slab(
        corridor.width,
        0.4,
        corridor.depth,
        corridor.x,
        -0.2,
        corridor.z,
        this.paving(corridor.width, corridor.depth, "#62665f"),
        false,
      );
    }

    // The way in: a step down to the ground and the name laid out in front of it.
    this.slab(1.2, 0.2, ENTRANCE.depth + 1.2, ENTRANCE.x - 2, -0.3, ENTRANCE.z, dark, false);
    const name = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 2.25).rotateX(-Math.PI / 2),
      this.lettering([
        { text: "EARNEST", size: 250, weight: 700, alpha: 0.9, x: 20, y: 270 },
        { text: "MUSEUM OF THINGS THAT ALMOST EXISTED", size: 74, weight: 600, alpha: 0.55, x: 28, y: 400 },
      ]),
    );
    name.position.set(ENTRANCE.x - 3.2, -0.405, ENTRANCE.z + 4.6);
    this.scene.add(name);

    // What sets the rooms apart without a word.
    const hall = ROOMS[0];
    for (const dx of [-3.6, 3.6]) {
      this.slab(2.6, 0.42, 0.55, hall.x + dx, 0.21, hall.z + hall.depth / 2 - 0.5, dark);
    }

    const workshop = ROOMS[1];
    const west = workshop.x - workshop.width / 2;
    this.slab(0.6, 0.9, 2.4, west + 0.55, 0.45, workshop.z + 3.4, steel);
    this.slab(0.5, 1.5, 1.6, west + 0.5, 0.75, workshop.z - 3.6, dark);
    for (const dz of [2.7, 3.4, 4.1]) {
      this.slab(0.34, 0.3, 0.4, west + 0.55, 1.05, workshop.z + dz, paper);
    }
    // A painted line round the working floor, the one place the orange is spent on a room.
    const paint = new THREE.MeshBasicMaterial({ color: ORANGE });
    const inner = { w: workshop.width - 3.2, d: workshop.depth - 2.6 };
    const lines: [number, number, number, number][] = [
      [inner.w, 0.07, workshop.x + 0.4, workshop.z - inner.d / 2],
      [inner.w, 0.07, workshop.x + 0.4, workshop.z + inner.d / 2],
      [0.07, inner.d, workshop.x + 0.4 - inner.w / 2, workshop.z],
      [0.07, inner.d, workshop.x + 0.4 + inner.w / 2, workshop.z],
    ];
    for (const [w, d, x, z] of lines) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), paint);
      line.position.set(x, 0.006, z);
      this.scene.add(line);
    }

    const realized = ROOMS[2];
    const glow = new THREE.MeshBasicMaterial({ color: "#fffdf2" });
    this.slab(
      realized.width - 2,
      0.07,
      0.16,
      realized.x,
      WALL - 0.35,
      realized.z - realized.depth / 2 + 0.26,
      glow,
      false,
    );
    const runner = new THREE.Mesh(
      new THREE.PlaneGeometry(realized.width - 2.4, realized.depth - 2.6).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: "#a9aca1", roughness: 0.9 }),
    );
    runner.position.set(realized.x, 0.004, realized.z);
    runner.receiveShadow = true;
    this.scene.add(runner);

    const almost = ROOMS[3];
    const back = almost.z - almost.depth / 2 + 0.6;
    for (const dx of [-5.6, -1.9, 1.9, 5.6]) {
      this.slab(2.8, 1.25, 0.5, almost.x + dx, 0.625, back, steel);
      // Boxes of records on the shelves.
      for (const bx of [-0.8, -0.1, 0.7]) {
        this.slab(0.5, 0.36, 0.38, almost.x + dx + bx, 1.44, back, paper);
      }
    }
  }

  /** The room's letter and name: painted along the near edge of its floor, and its letter hung on the far wall. */
  private sign(room: Room) {
    const floor = this.lettering([
      { text: room.code, size: 300, weight: 700, alpha: 0.92, x: 20, y: 330 },
      { text: room.name.toUpperCase(), size: 150, weight: 600, alpha: 0.5, x: 300, y: 310 },
    ]);
    const width = Math.min(room.width - 1.6, 10);
    const painted = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4).rotateX(-Math.PI / 2), floor);
    painted.position.set(room.x - room.width / 2 + 0.9 + width / 2, 0.012, room.z + room.depth / 2 - 1.35);
    this.scene.add(painted);

    // On the wall: the letter alone, large enough to find the room from across the building.
    const wall = this.lettering([{ text: room.code, size: 470, weight: 700, alpha: 0.85, x: 30, y: 430 }]);
    const hung = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), wall);
    hung.position.set(room.x + room.width / 2 - 3.6, WALL / 2 + 0.05, room.z - room.depth / 2 + 0.23);
    this.scene.add(hung);
  }

  // -------------------------------------------------------------------------------------------
  // Exhibits
  // -------------------------------------------------------------------------------------------

  private keep<T extends THREE.BufferGeometry>(geometry: T): T {
    this.exhibitGeometry.push(geometry);
    return geometry;
  }

  private own<T extends THREE.Material>(material: T): T {
    this.exhibitMaterials.push(material);
    return material;
  }

  /** The stand-in object for a campaign, about a metre tall, standing on the floor of its group. */
  private object(kind: Kind, material: THREE.Material): THREE.Group {
    const group = new THREE.Group();
    const add = (geometry: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(this.keep(geometry), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      group.add(mesh);
      return mesh;
    };
    switch (kind) {
      case "screen":
        add(new THREE.BoxGeometry(0.5, 0.06, 0.32), 0, 0.03, 0);
        add(new THREE.BoxGeometry(0.07, 0.3, 0.07), 0, 0.2, 0);
        add(new THREE.BoxGeometry(0.92, 0.58, 0.07), 0, 0.62, 0).rotation.x = -0.14;
        break;
      case "orb":
        add(new THREE.IcosahedronGeometry(0.44, 0), 0, 0.5, 0);
        break;
      case "tower":
        add(new THREE.CylinderGeometry(0.36, 0.4, 0.3, 6), 0, 0.15, 0);
        add(new THREE.CylinderGeometry(0.25, 0.29, 0.3, 6), 0, 0.45, 0);
        add(new THREE.CylinderGeometry(0.13, 0.18, 0.34, 6), 0, 0.77, 0);
        break;
      case "ring":
        add(new THREE.TorusGeometry(0.36, 0.11, 14, 40), 0, 0.5, 0);
        break;
      case "arch":
        add(new THREE.BoxGeometry(0.16, 0.8, 0.22), -0.3, 0.4, 0);
        add(new THREE.BoxGeometry(0.16, 0.8, 0.22), 0.3, 0.4, 0);
        add(new THREE.BoxGeometry(0.86, 0.16, 0.26), 0, 0.88, 0);
        break;
      case "prism":
        add(new THREE.ConeGeometry(0.44, 0.9, 4), 0, 0.45, 0);
        break;
      case "stack":
        add(new THREE.BoxGeometry(0.62, 0.26, 0.62), 0, 0.13, 0);
        add(new THREE.BoxGeometry(0.48, 0.26, 0.48), 0.05, 0.41, 0).rotation.y = 0.5;
        add(new THREE.BoxGeometry(0.34, 0.26, 0.34), -0.03, 0.69, 0).rotation.y = 1.1;
        break;
      case "knot":
        add(new THREE.TorusKnotGeometry(0.26, 0.085, 72, 10), 0, 0.52, 0);
        break;
    }
    return group;
  }

  /** Replaces every exhibit. Cheap enough to do whenever a campaign changes. */
  setExhibits(exhibits: Exhibit[]) {
    this.exhibitRoot.clear();
    for (const geometry of this.exhibitGeometry) geometry.dispose();
    for (const material of this.exhibitMaterials) {
      (material as THREE.MeshBasicMaterial).map?.dispose();
      material.dispose();
    }
    for (const tag of this.tags.values()) tag.remove();
    this.exhibitGeometry = [];
    this.exhibitMaterials = [];
    this.pickable = [];
    this.objects.clear();
    this.places.clear();
    this.tags.clear();
    this.hung = exhibits;

    const paper = this.own(new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.75 }));
    const base = this.own(new THREE.MeshStandardMaterial({ color: "#20221f", roughness: 0.6, metalness: 0.3 }));
    const archive = this.own(new THREE.MeshStandardMaterial({ color: "#c4c5bb", roughness: 0.9 }));
    const dark = this.own(new THREE.MeshStandardMaterial({ color: "#2c2e2b", roughness: 0.5, metalness: 0.5 }));
    const glass = this.own(
      new THREE.MeshStandardMaterial({
        color: "#e6f3ec",
        transparent: true,
        opacity: 0.18,
        roughness: 0.05,
        depthWrite: false,
      }),
    );
    const frame = this.own(new THREE.LineBasicMaterial({ color: "#f6f5ee", transparent: true, opacity: 0.75 }));
    const crate = this.own(new THREE.LineBasicMaterial({ color: "#d0d1c7", transparent: true, opacity: 0.5 }));
    const orange = this.own(new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.6 }));
    const limeFlat = this.own(new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.6 }));

    // A pool of light on the floor under each exhibit: brightest in the middle, gone at the rim.
    const pool = document.createElement("canvas");
    pool.width = pool.height = 128;
    const context = pool.getContext("2d") as CanvasRenderingContext2D;
    const fade = context.createRadialGradient(64, 64, 4, 64, 64, 64);
    fade.addColorStop(0, "rgba(255,250,232,0.9)");
    fade.addColorStop(0.5, "rgba(255,250,232,0.32)");
    fade.addColorStop(1, "rgba(255,250,232,0)");
    context.fillStyle = fade;
    context.fillRect(0, 0, 128, 128);
    const poolTexture = new THREE.CanvasTexture(pool);
    const lit = (opacity: number) =>
      this.own(
        new THREE.MeshBasicMaterial({
          map: poolTexture,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
    const bright = lit(0.5);
    const dim = lit(0.2);

    const plinthTall = this.keep(new THREE.BoxGeometry(1.3, 0.72, 1.3));
    const plinthLow = this.keep(new THREE.BoxGeometry(1.3, 0.34, 1.3));
    const skirt = this.keep(new THREE.BoxGeometry(1.46, 0.1, 1.46));
    const post = this.keep(new THREE.CylinderGeometry(0.035, 0.035, 1.7, 6));
    const beam = this.keep(new THREE.BoxGeometry(1.5, 0.06, 0.06));
    const caseBox = this.keep(new THREE.BoxGeometry(1.16, 1.25, 1.16));
    const caseEdges = this.keep(new THREE.EdgesGeometry(caseBox));
    const crateEdges = this.keep(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.2, 1.15, 1.2)));
    const flag = this.keep(new THREE.BoxGeometry(0.22, 0.22, 0.22));
    const halo = this.keep(new THREE.RingGeometry(1.2, 1.27, 56).rotateX(-Math.PI / 2));
    const light = this.keep(new THREE.PlaneGeometry(5.2, 5.2).rotateX(-Math.PI / 2));

    const seatsLit: THREE.Matrix4[] = [];
    const seatsOpen: THREE.Matrix4[] = [];
    const seatsKept: THREE.Matrix4[] = [];

    for (const exhibit of exhibits) {
      const { status } = exhibit;
      const ended = status === "failed" || status === "braked";
      const group = new THREE.Group();
      group.position.set(exhibit.x, 0, exhibit.z);
      this.places.set(exhibit.id, group.position.clone());

      const glowOnFloor = new THREE.Mesh(light, ended ? dim : bright);
      glowOnFloor.position.y = 0.008;
      group.add(glowOnFloor);

      const height = ended ? 0.34 : 0.72;
      const foot = new THREE.Mesh(skirt, base);
      foot.position.y = 0.05;
      foot.receiveShadow = true;
      const plinth = new THREE.Mesh(ended ? plinthLow : plinthTall, ended ? archive : paper);
      plinth.position.y = height / 2 + 0.1;
      plinth.castShadow = plinth.receiveShadow = true;
      group.add(foot, plinth);
      const top = height + 0.1;

      // One material per exhibit, so one can light up without the others.
      const material = this.own(
        status === "funding"
          ? new THREE.MeshStandardMaterial({ color: LIME, roughness: 0.35, emissive: LIME, emissiveIntensity: 0.18 })
          : status === "building"
            ? new THREE.MeshStandardMaterial({
                color: STEEL,
                roughness: 0.35,
                metalness: 0.65,
                emissive: LIME,
                emissiveIntensity: 0,
              })
            : status === "completed"
              ? new THREE.MeshStandardMaterial({ color: "#fbfaf4", roughness: 0.3, emissive: PAPER, emissiveIntensity: 0.1 })
              : new THREE.MeshStandardMaterial({ color: "#8f938a", roughness: 0.95, emissive: PAPER, emissiveIntensity: 0 }),
      );
      const object = this.object(exhibit.kind, material);
      object.position.y = top;
      object.userData.material = material;
      object.userData.rest = material.emissiveIntensity;
      object.userData.base = top;
      object.userData.floats = status === "funding";
      group.add(object);
      this.objects.set(exhibit.id, object);

      const plain: THREE.Object3D[] = [glowOnFloor];
      if (status === "funding") {
        const ring = new THREE.Mesh(halo, limeFlat);
        ring.position.y = 0.02;
        group.add(ring);
        plain.push(ring);
      }
      if (status === "building") {
        // Scaffolding: it is being worked on.
        for (const [dx, dz] of [[-0.72, -0.72], [0.72, -0.72], [-0.72, 0.72], [0.72, 0.72]]) {
          const mesh = new THREE.Mesh(post, dark);
          mesh.position.set(dx, 0.85, dz);
          mesh.castShadow = true;
          group.add(mesh);
        }
        for (const [dz, y] of [[-0.72, 1.7], [0.72, 1.7], [-0.72, 0.95], [0.72, 0.95]]) {
          const mesh = new THREE.Mesh(beam, dark);
          mesh.position.set(0, y, dz);
          group.add(mesh);
        }
      }
      if (status === "completed") {
        // Behind glass: it was made.
        const mesh = new THREE.Mesh(caseBox, glass);
        mesh.position.y = top + 0.625;
        const edges = new THREE.LineSegments(caseEdges, frame);
        edges.position.y = top + 0.625;
        group.add(mesh, edges);
        plain.push(mesh);
      }
      if (ended) {
        // Crated and kept: it was not made, and it is not thrown away.
        const edges = new THREE.LineSegments(crateEdges, crate);
        edges.position.y = top + 0.575;
        group.add(edges);
      }
      if (status === "braked") {
        // Not the same ending as its neighbours: backers stopped this one.
        const mesh = new THREE.Mesh(flag, orange);
        mesh.position.set(0.52, top + 0.11, 0.52);
        group.add(mesh);
      }

      // A row of seats in front: lit where one is taken.
      const seats = seatMarkers(exhibit.campaign);
      for (let index = 0; index < seats.total; index++) {
        const matrix = new THREE.Matrix4().setPosition(
          exhibit.x + (index - (seats.total - 1) / 2) * 0.27,
          0,
          exhibit.z + 1.15,
        );
        if (index >= seats.filled) seatsOpen.push(matrix);
        else if (status === "funding" || status === "building") seatsLit.push(matrix);
        else seatsKept.push(matrix);
      }

      group.traverse((child) => {
        if (child instanceof THREE.Mesh && !plain.includes(child)) {
          child.userData.exhibit = exhibit.id;
          this.pickable.push(child);
        }
      });
      this.exhibitRoot.add(group);

      // The label a museum would put beside it.
      const tag = document.createElement("div");
      tag.className =
        "absolute left-0 top-0 hidden w-max max-w-44 border-l-2 border-lime bg-carbon/85 px-2 py-1 text-paper";
      const code = document.createElement("p");
      code.className = "font-mono text-[10px] uppercase tracking-wider text-lime";
      code.textContent = `${exhibit.code} · ${STATUS_WORDS[status]}`;
      const title = document.createElement("p");
      title.className = "line-clamp-2 text-xs font-medium leading-4";
      title.textContent = exhibit.campaign.title || "Untitled campaign";
      tag.append(code, title);
      this.labels.appendChild(tag);
      this.tags.set(exhibit.id, tag);
    }

    // A seat is a small chair: something to sit on and something to lean against.
    const chair = this.keep(
      mergeGeometries([
        new THREE.BoxGeometry(0.19, 0.12, 0.19).translate(0, 0.1, 0),
        new THREE.BoxGeometry(0.19, 0.2, 0.05).translate(0, 0.26, -0.07),
      ]),
    );
    const rows: [THREE.Matrix4[], THREE.Material][] = [
      [
        seatsLit,
        this.own(new THREE.MeshStandardMaterial({ color: LIME, roughness: 0.5, emissive: LIME, emissiveIntensity: 0.5 })),
      ],
      [seatsKept, this.own(new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.8 }))],
      [seatsOpen, this.own(new THREE.MeshStandardMaterial({ color: "#2b2d2a", roughness: 0.9 }))],
    ];
    for (const [matrices, material] of rows) {
      if (matrices.length === 0) continue;
      const mesh = new THREE.InstancedMesh(chair, material, matrices.length);
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      this.exhibitRoot.add(mesh);
    }

    // What was pointed at may be gone. A visitor standing where a plinth now is steps aside.
    if (this.pointed && !this.places.has(this.pointed)) this.pointed = null;
    if (!canStand(this.visitor.position.x, this.visitor.position.z, this.hung)) this.stepAside();
    this.light();
  }

  /** Lights what is pointed at, stood next to or open, and rings it. */
  private light() {
    this.hot = this.pointed ?? this.near;
    const hot = this.hot && this.hot !== this.selected ? this.places.get(this.hot) : undefined;
    this.hoverRing.visible = Boolean(hot);
    if (hot) this.hoverRing.position.set(hot.x, 0.03, hot.z);
    const open = this.selected ? this.places.get(this.selected) : undefined;
    this.selectRing.visible = Boolean(open);
    if (open) this.selectRing.position.set(open.x, 0.035, open.z);

    for (const [id, object] of this.objects) {
      const material = object.userData.material as THREE.MeshStandardMaterial;
      const lit = id === this.hot || id === this.selected;
      material.emissiveIntensity = lit ? 0.6 : (object.userData.rest as number);
    }
  }

  // -------------------------------------------------------------------------------------------
  // What the page asks for
  // -------------------------------------------------------------------------------------------

  /** Marks an exhibit as open: the camera goes to it and the visitor walks over. */
  setSelected(id: string | null) {
    this.selected = id;
    const place = id ? this.places.get(id) : undefined;
    if (place) {
      this.following = false;
      this.goal.copy(place);
      this.zoomGoal = Math.max(this.zoomGoal, Math.min(58, this.fitZoom() * 1.9));
      this.walkTo(standBy(place));
    }
    this.light();
  }

  /** Points at an exhibit without opening it, for someone moving through the list by keyboard. */
  setHot(id: string | null) {
    this.pointed = id;
    this.light();
  }

  focusRoom(id: RoomId) {
    const room = ROOMS.find((candidate) => candidate.id === id);
    if (!room) return;
    this.following = false;
    this.goal.set(room.x, 0, room.z);
    this.zoomGoal = this.fitZoom(room);
    // The visitor goes too, and stops just inside the room.
    this.walkTo({ x: room.x + 1.2, z: room.z + room.depth / 2 - 2.2 });
    this.say(id);
  }

  /** The whole building in view. */
  overview() {
    this.following = false;
    this.goal.set(4.5, 0, 1);
    this.zoomGoal = Math.max(ZOOM_MIN, this.fitZoom() * 0.45);
  }

  /** Who is walking: a connected wallet, by its short address, or a guest who has none. */
  setVisitor(wallet: string | null) {
    this.visitorBody.color.set(wallet ? PAPER : "#a6aaa0");
    this.visitorHalo.visible = wallet !== null;
    this.visitorTag.textContent = wallet ? `You · ${wallet}` : "Guest";
  }

  setInsets(left: number, right: number, bottom: number) {
    this.insetLeft = left;
    this.insetRight = right;
    this.insetBottom = bottom;
  }

  zoomBy(factor: number) {
    this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * factor, ZOOM_MIN, ZOOM_MAX);
  }

  /** Moves the view by a distance on screen, in pixels, and stops following the visitor. */
  panBy(dx: number, dy: number) {
    this.following = false;
    this.goal
      .addScaledVector(SCREEN_RIGHT, -dx / this.zoom)
      .addScaledVector(SCREEN_UP, dy / this.zoom / Math.sin(PITCH));
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, BOUNDS.minX, BOUNDS.maxX);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, BOUNDS.minZ, BOUNDS.maxZ);
  }

  /** A direction key went down or came up. Directions are as seen on screen. */
  key(direction: Direction, down: boolean) {
    if (down) {
      this.held.add(direction);
      // Walking by hand drops any errand the visitor was on, and the camera comes along.
      this.path = [];
      this.following = true;
    } else {
      this.held.delete(direction);
    }
  }

  /** Lets go of every key, for when the window loses the keyboard mid-step. */
  release() {
    this.held.clear();
  }

  // -------------------------------------------------------------------------------------------
  // The visitor
  // -------------------------------------------------------------------------------------------

  private walkTo(point: { x: number; z: number }) {
    if (this.calm) {
      this.visitor.position.set(point.x, 0, point.z);
      this.path = [];
      this.say(roomAt(point.x, point.z));
      return;
    }
    this.path = route({ x: this.visitor.position.x, z: this.visitor.position.z }, point);
    this.stuck = 0;
  }

  /** Puts the visitor on the nearest free bit of floor. */
  private stepAside() {
    const { x, z } = this.visitor.position;
    for (let radius = 0.4; radius < 6; radius += 0.4) {
      for (let turn = 0; turn < 12; turn++) {
        const angle = (turn / 12) * Math.PI * 2;
        const nx = x + Math.cos(angle) * radius;
        const nz = z + Math.sin(angle) * radius;
        if (canStand(nx, nz, this.hung)) {
          this.visitor.position.set(nx, 0, nz);
          return;
        }
      }
    }
    this.visitor.position.set(START.x, 0, START.z);
  }

  /** One step in a direction on the floor, going round whatever is in the way. */
  private step(dx: number, dz: number): boolean {
    const next = stepFrom({ x: this.visitor.position.x, z: this.visitor.position.z }, dx, dz, this.hung);
    if (!next) return false;
    this.visitor.position.set(next.x, 0, next.z);
    return true;
  }

  private walk(seconds: number): boolean {
    const direction = new THREE.Vector3();
    if (this.held.has("up")) direction.add(SCREEN_UP);
    if (this.held.has("down")) direction.sub(SCREEN_UP);
    if (this.held.has("right")) direction.add(SCREEN_RIGHT);
    if (this.held.has("left")) direction.sub(SCREEN_RIGHT);

    if (direction.lengthSq() > 0) {
      direction.normalize().multiplyScalar(WALK * seconds);
      return this.step(direction.x, direction.z);
    }

    const next = this.path[0];
    if (!next) return false;
    const dx = next[0] - this.visitor.position.x;
    const dz = next[1] - this.visitor.position.z;
    const left = Math.hypot(dx, dz);
    const reach = STRIDE * seconds;
    if (left <= Math.max(reach, 0.12)) {
      if (canStand(next[0], next[1], this.hung)) this.visitor.position.set(next[0], 0, next[1]);
      this.path.shift();
      return true;
    }
    const moved = this.step((dx / left) * reach, (dz / left) * reach);
    // Something is in the way and sliding does not help: give the errand up.
    this.stuck = moved ? 0 : this.stuck + seconds;
    if (this.stuck > 0.4) this.path = [];
    return moved;
  }

  private say(room: RoomId) {
    if (room === this.room) return;
    this.room = room;
    this.handlers.onRoom(room);
  }

  // -------------------------------------------------------------------------------------------
  // Camera and frames
  // -------------------------------------------------------------------------------------------

  /** The zoom at which a room fills the part of the view the panels leave free. */
  private fitZoom(room: Room = ROOMS[0]) {
    const width = Math.max(240, this.host.clientWidth - this.insetRight - this.insetLeft);
    const height = Math.max(200, this.host.clientHeight - this.insetBottom);
    // How wide and tall the room's floor is once seen from this angle.
    const across = (room.width + room.depth) / Math.SQRT2;
    const down = ((room.width + room.depth) / Math.SQRT2) * Math.sin(PITCH) + WALL * Math.cos(PITCH);
    return THREE.MathUtils.clamp(Math.min(width / (across + 2), height / (down + 2.5)), ZOOM_MIN, ZOOM_MAX);
  }

  private resize() {
    const { clientWidth, clientHeight } = this.host;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight);
  }

  private project(x: number, y: number, z: number) {
    const point = new THREE.Vector3(x, y, z).project(this.camera);
    return {
      x: ((point.x + 1) / 2) * this.host.clientWidth,
      y: ((1 - point.y) / 2) * this.host.clientHeight,
    };
  }

  private readonly loop = (time: number) => {
    this.frame = requestAnimationFrame(this.loop);
    // A tab that was in the background comes back with one very long frame; do not leap.
    const seconds = Math.min(0.05, Math.max(0, (time - this.last) / 1000));
    this.last = time;
    this.clock += seconds;

    const walked = this.walk(seconds);
    const position = this.visitor.position;
    if (this.following) this.goal.set(position.x, 0, position.z);

    const ease = this.calm ? 1 : 1 - Math.pow(0.0012, seconds);
    this.target.lerp(this.goal, ease);
    this.zoom += (this.zoomGoal - this.zoom) * ease;

    // The room is where the visitor is; a camera sent off on its own does not change it.
    if (walked) this.say(roomAt(position.x, position.z));

    // Who the visitor is standing next to.
    let nearest: string | null = null;
    let least = NEAR;
    for (const [id, place] of this.places) {
      const distance = Math.hypot(place.x - position.x, place.z - position.z);
      if (distance < least) {
        least = distance;
        nearest = id;
      }
    }
    if (nearest !== this.near) {
      this.near = nearest;
      this.handlers.onNear(nearest);
      this.light();
    }

    // What is still looking for backers hovers and turns; what is pointed at turns faster.
    if (!this.calm) {
      for (const [id, object] of this.objects) {
        const lively = id === this.hot || id === this.selected;
        if (object.userData.floats || lively) {
          object.rotation.y += (lively ? 1.1 : 0.25) * seconds;
        }
        if (object.userData.floats) {
          object.position.y =
            (object.userData.base as number) + 0.07 + Math.sin(this.clock * 1.6 + object.id) * 0.05;
        }
      }
      this.visitor.children[0].position.y = 0.25 + (walked ? Math.abs(Math.sin(this.clock * 13)) * 0.05 : 0);
    }

    const { clientWidth: width, clientHeight: height } = this.host;
    // The point looked at sits in the middle of what the panels leave free.
    const centre = this.target
      .clone()
      .addScaledVector(SCREEN_RIGHT, (this.insetRight - this.insetLeft) / 2 / this.zoom)
      .addScaledVector(SCREEN_UP, -this.insetBottom / 2 / this.zoom / Math.sin(PITCH));
    this.camera.left = -width / this.zoom / 2;
    this.camera.right = width / this.zoom / 2;
    this.camera.top = height / this.zoom / 2;
    this.camera.bottom = -height / this.zoom / 2;
    this.camera.position.copy(centre).addScaledVector(OFFSET, 3);
    this.camera.lookAt(centre);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);

    // Name tags: only for the room the visitor is in, and only when close enough to read them.
    const readable = this.zoom > 22;
    for (const exhibit of this.hung) {
      const tag = this.tags.get(exhibit.id);
      if (!tag) continue;
      const shown = readable && exhibit.room === this.room && exhibit.id !== this.selected;
      tag.classList.toggle("hidden", !shown);
      if (!shown) continue;
      const at = this.project(exhibit.x - 0.75, 0.05, exhibit.z + 0.95);
      tag.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-100%, 0)`;
    }
    const above = this.project(position.x, 1.05, position.z);
    this.visitorTag.style.transform = `translate(${Math.round(above.x)}px, ${Math.round(above.y)}px) translate(-50%, -100%)`;
  };

  // -------------------------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------------------------

  private aim(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
  }

  private pick(event: PointerEvent): string | null {
    this.aim(event);
    const hit = this.raycaster.intersectObjects(this.pickable, false)[0];
    return (hit?.object.userData.exhibit as string | undefined) ?? null;
  }

  /** The spot on the floor under the pointer. */
  private floorUnder(event: PointerEvent): THREE.Vector3 | null {
    this.aim(event);
    return this.raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      new THREE.Vector3(),
    );
  }

  private readonly onDown = (event: PointerEvent) => {
    this.drag = { x: event.clientX, y: event.clientY, moved: false };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private readonly onMove = (event: PointerEvent) => {
    if (this.drag) {
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 5) return;
      this.drag = { x: event.clientX, y: event.clientY, moved: true };
      this.panBy(dx, dy);
      // A drag follows the hand exactly; easing it would feel like dragging through syrup.
      this.target.copy(this.goal);
      this.renderer.domElement.style.cursor = "grabbing";
      return;
    }
    const id = this.pick(event);
    if (id !== this.pointed) {
      this.pointed = id;
      this.light();
    }
    this.renderer.domElement.style.cursor = id ? "pointer" : "grab";
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.handlers.onHover(id, event.clientX - rect.left, event.clientY - rect.top);
  };

  private readonly onUp = (event: PointerEvent) => {
    const drag = this.drag;
    this.drag = null;
    this.renderer.domElement.style.cursor = "grab";
    if (!drag || drag.moved) return;
    // A tap or a click on an exhibit opens it. On the floor, the visitor walks there.
    const id = this.pick(event);
    if (id) {
      this.handlers.onSelect(id);
      return;
    }
    if (this.selected) this.handlers.onSelect(null);
    const spot = this.floorUnder(event);
    if (spot && canStand(spot.x, spot.z, this.hung)) {
      this.following = true;
      this.walkTo({ x: spot.x, z: spot.z });
    }
  };

  private readonly onLeave = () => {
    if (this.pointed) {
      this.pointed = null;
      this.light();
    }
    this.handlers.onHover(null, 0, 0);
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointerleave", this.onLeave);
    el.removeEventListener("wheel", this.onWheel);
    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          (material as THREE.MeshBasicMaterial).map?.dispose();
          material.dispose();
        }
      }
    });
    this.renderer.dispose();
    this.labels.remove();
    el.remove();
  }
}
