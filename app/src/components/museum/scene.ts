/**
 * The museum as a three.js scene: the building, an exhibit for each campaign that was hung, a
 * marker for the visitor, and the camera. It draws and reports what is pointed at; it knows
 * nothing about wallets or transactions, and it never decides what a campaign's state is.
 *
 * Loaded only in the browser and only by the museum page, so the rest of the site does not
 * carry three.js.
 */
import * as THREE from "three";

import {
  CORRIDORS,
  type Exhibit,
  type Kind,
  type Room,
  type RoomId,
  ROOMS,
  seatMarkers,
} from "@/lib/museum/plan";

const CARBON = "#171917";
const CONCRETE = "#565a54";
const CONCRETE_DARK = "#383b37";
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
const BOUNDS = { minX: -11, maxX: 23, minZ: -20, maxZ: 22 };
const WALL = 1.6;
const CURB = 0.22;

export interface SceneHandlers {
  /** The exhibit under the pointer, with where the pointer is inside the scene's element. */
  onHover(id: string | null, x: number, y: number): void;
  onSelect(id: string | null): void;
  /** The room the camera is over now. */
  onRoom(room: RoomId): void;
}

export class MuseumScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly raycaster = new THREE.Raycaster();
  private readonly observer: ResizeObserver;
  private readonly target = new THREE.Vector3(0, 0, 1);
  private readonly goal = new THREE.Vector3(0, 0, 1);
  private zoom = 30;
  private zoomGoal = 30;
  private frame = 0;
  private dirty = true;
  private room: RoomId = "unmade";
  // True while the camera travels to a room that was asked for by name.
  private travelling = false;

  // Everything that belongs to the exhibits and is thrown away when they change.
  private readonly exhibitRoot = new THREE.Group();
  private exhibitGeometry: THREE.BufferGeometry[] = [];
  private exhibitMaterials: THREE.Material[] = [];
  private pickable: THREE.Object3D[] = [];
  private readonly spinners = new Map<string, THREE.Object3D>();
  private readonly places = new Map<string, THREE.Vector3>();
  private hot: string | null = null;
  private selected: string | null = null;

  private readonly hoverRing: THREE.Mesh;
  private readonly selectRing: THREE.Mesh;
  private readonly visitor = new THREE.Group();
  private readonly visitorGoal = new THREE.Vector3();

  // Space the page's own panels cover, so a focused exhibit is centred in what is left.
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

    this.scene.background = new THREE.Color(CARBON);
    this.scene.add(new THREE.HemisphereLight(PAPER, "#3a3d39", 1.5));
    const sun = new THREE.DirectionalLight("#fff3da", 2.7);
    sun.position.set(-10, 22, 9);
    sun.target.position.set(6, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 70 });
    this.scene.add(sun, sun.target);

    this.build();
    this.scene.add(this.exhibitRoot);

    const ring = new THREE.RingGeometry(0.98, 1.1, 48);
    ring.rotateX(-Math.PI / 2);
    this.hoverRing = new THREE.Mesh(
      ring,
      new THREE.MeshBasicMaterial({ color: PAPER, transparent: true, opacity: 0.75 }),
    );
    this.selectRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: LIME }));
    for (const mesh of [this.hoverRing, this.selectRing]) {
      mesh.position.y = 0.02;
      mesh.visible = false;
      this.scene.add(mesh);
    }
    this.buildVisitor();

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.fit();

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

  /** A wall along one edge of a room, left open where a corridor passes through it. */
  private wall(room: Room, side: "n" | "s" | "e" | "w", height: number, material: THREE.Material) {
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
      if (to - from < 0.05) continue;
      const middle = (from + to) / 2;
      if (along) this.slab(to - from, height, 0.3, middle, height / 2, fixed, material);
      else this.slab(0.3, height, to - from, fixed, height / 2, middle, material);
    }
  }

  private build() {
    const floors: Record<RoomId, string> = {
      unmade: CONCRETE,
      workshop: "#4c5145",
      realized: "#62655e",
      almost: "#454843",
    };
    const wallMaterial = new THREE.MeshStandardMaterial({ color: CONCRETE_DARK, roughness: 0.95 });
    const curbMaterial = new THREE.MeshStandardMaterial({ color: "#2f322f", roughness: 0.95 });
    const corridorMaterial = new THREE.MeshStandardMaterial({ color: "#4a4d48", roughness: 1 });

    for (const room of ROOMS) {
      const floor = new THREE.MeshStandardMaterial({ color: floors[room.id], roughness: 0.96 });
      this.slab(room.width, 0.4, room.depth, room.x, -0.2, room.z, floor, false);
      // Tall on the two far sides, cut low on the two near ones so the room can be looked into.
      this.wall(room, "n", WALL, wallMaterial);
      this.wall(room, "w", WALL, wallMaterial);
      this.wall(room, "s", CURB, curbMaterial);
      this.wall(room, "e", CURB, curbMaterial);
      this.sign(room);
    }
    for (const corridor of CORRIDORS) {
      this.slab(corridor.width, 0.4, corridor.depth, corridor.x, -0.2, corridor.z, corridorMaterial, false);
    }

    // What sets the rooms apart without a word: a workbench, a strip of light, archive shelves.
    const steel = new THREE.MeshStandardMaterial({ color: "#6d726a", roughness: 0.6, metalness: 0.3 });
    const workshop = ROOMS[1];
    this.slab(0.7, 0.9, 5.4, workshop.x - workshop.width / 2 + 0.9, 0.45, workshop.z, steel);
    const realized = ROOMS[2];
    const glow = new THREE.MeshBasicMaterial({ color: PAPER });
    this.slab(realized.width - 2, 0.05, 0.14, realized.x, 1.25, realized.z - realized.depth / 2 + 0.2, glow, false);
    const almost = ROOMS[3];
    for (const dx of [-5.6, -1.9, 1.9, 5.6]) {
      this.slab(2.6, 1.1, 0.5, almost.x + dx, 0.55, almost.z - almost.depth / 2 + 0.6, steel);
    }
  }

  /** The room's letter and name, painted on its floor along the near edge. */
  private sign(room: Room) {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = PAPER;
    context.globalAlpha = 0.9;
    context.font = '700 150px "Segoe UI", system-ui, -apple-system, Arial, sans-serif';
    context.textBaseline = "middle";
    context.fillText(room.code, 24, 132);
    context.globalAlpha = 0.5;
    context.font = '600 92px "Segoe UI", system-ui, -apple-system, Arial, sans-serif';
    context.fillText(room.name.toUpperCase(), 190, 138);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const width = Math.min(room.width - 1.5, 11);
    const geometry = new THREE.PlaneGeometry(width, width / 8);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    mesh.position.set(room.x - room.width / 2 + 0.9 + width / 2, 0.012, room.z + room.depth / 2 - 1);
    this.scene.add(mesh);
  }

  private buildVisitor() {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.17, 0.42, 20),
      new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.6 }),
    );
    body.position.y = 0.21;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 20, 14),
      new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.6 }),
    );
    head.position.y = 0.54;
    const halo = new THREE.RingGeometry(0.26, 0.33, 32);
    halo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(halo, new THREE.MeshBasicMaterial({ color: LIME }));
    ring.position.y = 0.02;
    body.castShadow = head.castShadow = true;
    this.visitor.add(body, head, ring);
    this.visitor.visible = false;
    this.scene.add(this.visitor);
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
    for (const material of this.exhibitMaterials) material.dispose();
    this.exhibitGeometry = [];
    this.exhibitMaterials = [];
    this.pickable = [];
    this.spinners.clear();
    this.places.clear();

    const paper = this.own(new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.75 }));
    const archive = this.own(new THREE.MeshStandardMaterial({ color: "#c4c5bb", roughness: 0.9 }));
    const dark = this.own(new THREE.MeshStandardMaterial({ color: "#454843", roughness: 0.5, metalness: 0.5 }));
    const glass = this.own(
      new THREE.MeshStandardMaterial({ color: "#dfeee6", transparent: true, opacity: 0.16, roughness: 0.1, depthWrite: false }),
    );
    const orange = this.own(new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.6 }));
    const limeFlat = this.own(new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.55 }));

    const plinthTall = this.keep(new THREE.BoxGeometry(1.3, 0.7, 1.3));
    const plinthLow = this.keep(new THREE.BoxGeometry(1.3, 0.36, 1.3));
    const post = this.keep(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6));
    const beam = this.keep(new THREE.BoxGeometry(1.36, 0.05, 0.05));
    const caseBox = this.keep(new THREE.BoxGeometry(1.14, 1.2, 1.14));
    const flag = this.keep(new THREE.BoxGeometry(0.2, 0.2, 0.2));
    const halo = this.keep(new THREE.RingGeometry(1.18, 1.24, 48).rotateX(-Math.PI / 2));

    const seatsLit: THREE.Matrix4[] = [];
    const seatsOpen: THREE.Matrix4[] = [];
    const seatsKept: THREE.Matrix4[] = [];

    for (const exhibit of exhibits) {
      const { status } = exhibit;
      const ended = status === "failed" || status === "braked";
      const group = new THREE.Group();
      group.position.set(exhibit.x, 0, exhibit.z);
      this.places.set(exhibit.id, group.position.clone());

      const height = ended ? 0.36 : 0.7;
      const plinth = new THREE.Mesh(ended ? plinthLow : plinthTall, ended ? archive : paper);
      plinth.position.y = height / 2;
      plinth.castShadow = plinth.receiveShadow = true;
      group.add(plinth);

      // One material per exhibit, so one can light up without the others.
      const material = this.own(
        status === "funding"
          ? new THREE.MeshStandardMaterial({ color: LIME, roughness: 0.4, emissive: LIME, emissiveIntensity: 0.12 })
          : status === "building"
            ? new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.4, metalness: 0.6, emissive: LIME, emissiveIntensity: 0 })
            : status === "completed"
              ? new THREE.MeshStandardMaterial({ color: "#fbfaf4", roughness: 0.35, emissive: PAPER, emissiveIntensity: 0.08 })
              : new THREE.MeshStandardMaterial({ color: "#8f938a", roughness: 0.95, emissive: PAPER, emissiveIntensity: 0 }),
      );
      const object = this.object(exhibit.kind, material);
      object.position.y = height;
      object.userData.material = material;
      object.userData.rest = material.emissiveIntensity;
      group.add(object);
      this.spinners.set(exhibit.id, object);

      if (status === "funding") {
        const ring = new THREE.Mesh(halo, limeFlat);
        ring.position.y = 0.015;
        group.add(ring);
      }
      if (status === "building") {
        // Scaffolding: it is being worked on.
        for (const [dx, dz] of [[-0.68, -0.68], [0.68, -0.68], [-0.68, 0.68], [0.68, 0.68]]) {
          const mesh = new THREE.Mesh(post, dark);
          mesh.position.set(dx, 0.75, dz);
          mesh.castShadow = true;
          group.add(mesh);
        }
        for (const dz of [-0.68, 0.68]) {
          const mesh = new THREE.Mesh(beam, dark);
          mesh.position.set(0, 1.5, dz);
          group.add(mesh);
        }
      }
      if (status === "completed") {
        const mesh = new THREE.Mesh(caseBox, glass);
        mesh.position.y = height + 0.6;
        group.add(mesh);
      }
      if (status === "braked") {
        // Not the same ending as its neighbours: backers stopped this one.
        const mesh = new THREE.Mesh(flag, orange);
        mesh.position.set(0.5, height + 0.1, 0.5);
        group.add(mesh);
      }

      // A row of seats in front: lit where one is taken.
      const seats = seatMarkers(exhibit.campaign);
      for (let index = 0; index < seats.total; index++) {
        const matrix = new THREE.Matrix4().setPosition(
          exhibit.x + (index - (seats.total - 1) / 2) * 0.24,
          0.07,
          exhibit.z + 1.05,
        );
        if (index >= seats.filled) seatsOpen.push(matrix);
        else if (status === "funding" || status === "building") seatsLit.push(matrix);
        else seatsKept.push(matrix);
      }

      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material !== limeFlat && child.material !== glass) {
          child.userData.exhibit = exhibit.id;
          this.pickable.push(child);
        }
      });
      this.exhibitRoot.add(group);
    }

    const seat = this.keep(new THREE.BoxGeometry(0.16, 0.14, 0.16));
    const rows: [THREE.Matrix4[], THREE.Material][] = [
      [seatsLit, this.own(new THREE.MeshBasicMaterial({ color: LIME }))],
      [seatsKept, this.own(new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.8 }))],
      [seatsOpen, this.own(new THREE.MeshStandardMaterial({ color: "#2b2d2a", roughness: 0.9 }))],
    ];
    for (const [matrices, material] of rows) {
      if (matrices.length === 0) continue;
      const mesh = new THREE.InstancedMesh(seat, material, matrices.length);
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      this.exhibitRoot.add(mesh);
    }

    // What was pointed at or open may be gone, or may have moved to another room.
    if (this.hot && !this.places.has(this.hot)) this.hot = null;
    this.placeRings();
    this.moveVisitor();
    this.dirty = true;
  }

  private placeRings() {
    const hot = this.hot && this.hot !== this.selected ? this.places.get(this.hot) : undefined;
    this.hoverRing.visible = Boolean(hot);
    if (hot) this.hoverRing.position.set(hot.x, 0.02, hot.z);
    const open = this.selected ? this.places.get(this.selected) : undefined;
    this.selectRing.visible = Boolean(open);
    if (open) this.selectRing.position.set(open.x, 0.025, open.z);

    for (const [id, object] of this.spinners) {
      const material = object.userData.material as THREE.MeshStandardMaterial;
      const lit = id === this.hot || id === this.selected;
      material.emissiveIntensity = lit ? 0.55 : (object.userData.rest as number);
    }
    this.dirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // What the page asks for
  // -------------------------------------------------------------------------------------------

  /** Marks an exhibit as open and brings it to the middle of the free part of the view. */
  setSelected(id: string | null) {
    this.selected = id;
    const place = id ? this.places.get(id) : undefined;
    if (place) {
      this.goal.copy(place);
      this.zoomGoal = Math.max(this.zoomGoal, Math.min(58, this.fitZoom() * 1.9));
    }
    this.placeRings();
    this.moveVisitor();
  }

  /** Points at an exhibit without opening it, for someone moving through the list by keyboard. */
  setHot(id: string | null) {
    this.hot = id;
    this.placeRings();
  }

  focusRoom(id: RoomId) {
    const room = ROOMS.find((candidate) => candidate.id === id);
    if (!room) return;
    this.goal.set(room.x, 0, room.z);
    this.zoomGoal = this.fitZoom(room);
    // Said at once rather than when the camera arrives: the page should not wait on frames.
    this.travelling = true;
    if (this.room !== id) {
      this.room = id;
      this.handlers.onRoom(id);
      if (!this.selected) this.moveVisitor();
    }
    this.dirty = true;
  }

  /** The whole building in view. */
  overview() {
    this.goal.set(5, 0, 1);
    this.zoomGoal = Math.max(ZOOM_MIN, this.fitZoom() * 0.45);
    this.dirty = true;
  }

  setVisitor(present: boolean) {
    this.visitor.visible = present;
    this.moveVisitor(true);
    this.dirty = true;
  }

  setInsets(left: number, right: number, bottom: number) {
    this.insetLeft = left;
    this.insetRight = right;
    this.insetBottom = bottom;
    this.dirty = true;
  }

  zoomBy(factor: number) {
    this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * factor, ZOOM_MIN, ZOOM_MAX);
    this.dirty = true;
  }

  /** Moves the view by a distance on screen, in pixels. */
  panBy(dx: number, dy: number) {
    this.travelling = false;
    this.goal
      .addScaledVector(SCREEN_RIGHT, -dx / this.zoom)
      .addScaledVector(SCREEN_UP, dy / this.zoom / Math.sin(PITCH));
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, BOUNDS.minX, BOUNDS.maxX);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, BOUNDS.minZ, BOUNDS.maxZ);
    this.dirty = true;
  }

  /** Where an exhibit is on screen, inside the scene's element. */
  screenOf(id: string): { x: number; y: number } | null {
    const place = this.places.get(id);
    if (!place) return null;
    const point = place.clone().setY(1.7).project(this.camera);
    return {
      x: ((point.x + 1) / 2) * this.host.clientWidth,
      y: ((1 - point.y) / 2) * this.host.clientHeight,
    };
  }

  private moveVisitor(jump = false) {
    const place = this.selected ? this.places.get(this.selected) : undefined;
    const room = ROOMS.find((candidate) => candidate.id === this.room) as Room;
    if (place) this.visitorGoal.set(place.x + 1.15, 0, place.z + 1.5);
    else this.visitorGoal.set(room.x + 1.2, 0, room.z + room.depth / 2 - 2);
    if (jump || this.calm) this.visitor.position.copy(this.visitorGoal);
    this.dirty = true;
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

  private fit() {
    // A little wider than the hall, so the doors to the other rooms show.
    this.zoom = this.zoomGoal = this.fitZoom() * 0.86;
    this.dirty = true;
  }

  private resize() {
    const { clientWidth, clientHeight } = this.host;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight);
    this.dirty = true;
  }

  private readonly loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const ease = this.calm ? 1 : 0.12;

    const moving =
      this.target.distanceToSquared(this.goal) > 1e-5 || Math.abs(this.zoom - this.zoomGoal) > 0.01;
    if (moving) {
      this.target.lerp(this.goal, ease);
      this.zoom += (this.zoomGoal - this.zoom) * ease;
      this.dirty = true;
    }
    if (this.visitor.visible && this.visitor.position.distanceToSquared(this.visitorGoal) > 1e-4) {
      this.visitor.position.lerp(this.visitorGoal, this.calm ? 1 : 0.08);
      this.dirty = true;
    }
    // Only what is pointed at or open turns, so an idle museum costs nothing to show.
    if (!this.calm) {
      for (const id of [this.hot, this.selected]) {
        const object = id ? this.spinners.get(id) : undefined;
        if (object) {
          object.rotation.y += 0.012;
          this.dirty = true;
        }
      }
    }
    if (!moving) this.travelling = false;
    if (!this.dirty) return;
    this.dirty = false;

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
    this.renderer.render(this.scene, this.camera);

    const over = this.travelling ? this.room : this.roomAt(this.target);
    if (over !== this.room) {
      this.room = over;
      this.handlers.onRoom(over);
      if (!this.selected) this.moveVisitor();
    }
  };

  private roomAt(point: THREE.Vector3): RoomId {
    let best = ROOMS[0];
    let least = Infinity;
    for (const room of ROOMS) {
      // Distance to the room's floor, zero anywhere on it.
      const dx = Math.max(0, Math.abs(point.x - room.x) - room.width / 2);
      const dz = Math.max(0, Math.abs(point.z - room.z) - room.depth / 2);
      const distance = Math.hypot(dx, dz);
      if (distance < least) {
        least = distance;
        best = room;
      }
    }
    return best.id;
  }

  // -------------------------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------------------------

  private pick(event: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const point = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(point, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickable, false)[0];
    return (hit?.object.userData.exhibit as string | undefined) ?? null;
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
    if (id !== this.hot) {
      this.hot = id;
      this.placeRings();
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
    // A tap or a click: open what is under it, or put down what was open.
    this.handlers.onSelect(this.pick(event));
  };

  private readonly onLeave = () => {
    if (this.hot) {
      this.hot = null;
      this.placeRings();
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
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          (material as THREE.MeshBasicMaterial).map?.dispose();
          material.dispose();
        }
      }
    });
    this.renderer.dispose();
    el.remove();
  }
}
