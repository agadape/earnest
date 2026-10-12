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
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { standIn, standInMaterial } from "@/components/museum/objects";
import { person } from "@/components/museum/people";
import { buildWorld, FAR_WALL, FOREST, SKY } from "@/components/museum/world";
import {
  canStand,
  type Exhibit,
  PLOT_SIZE,
  PLOTS,
  ROOM_FLOORS,
  type Room,
  roomAt,
  type RoomId,
  ROOMS,
  route,
  seatMarkers,
  standBy,
  STATUS_WORDS,
  STATIONS,
  stepFrom,
} from "@/lib/museum/plan";

const PAPER = "#f0efe7";
const LIME = "#d8f59a";
const ORANGE = "#ff6338";

// Where the camera sits relative to what it looks at: a fixed view from the south-east,
// about 32 degrees above the floor. It never rotates.
const OFFSET = new THREE.Vector3(14, 12.5, 14);
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();
const SCREEN_UP = new THREE.Vector3(-1, 0, -1).normalize();
const PITCH = Math.atan2(OFFSET.y, Math.hypot(OFFSET.x, OFFSET.z));
const ZOOM_MAX = 84;
const BOUNDS = { minX: -13, maxX: 46, minZ: -20, maxZ: 22 };
const WALK = 5.2;
const STRIDE = 11;
const NEAR = 2.9;
const START = { x: -6.4, z: 0 };
// The most figures a crowd is drawn with, however many reactions there are.
const CROWD_MOST = 10;
const CROWD_SHIRTS = ["#e4572e", "#17bebb", "#ffc914", "#76b041", "#5b5f97", "#ff8cc6", "#2e86ab", "#f4f1de"];

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

/** A past visitor's figure: where it is going, how long it is standing still, how fast it walks. */
interface Wanderer {
  figure: THREE.Group;
  tag: HTMLDivElement;
  /** The points still to walk through, door by door, to where it is going. */
  path: [number, number][];
  wait: number;
  speed: number;
  /** How long it has been unable to take a step. */
  stuck: number;
}

// When the only thing moving is the strollers, this many pictures a second is plenty.
const STROLL_FRAMES = 24;

export class MuseumScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
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
  // Everything on the floor a walker has to go round: the exhibits and the two stations.
  private blocked: { x: number; z: number }[] = [...STATIONS];
  private readonly stationPick: THREE.Object3D[] = [];
  private readonly stationTags: HTMLDivElement[] = [];
  // The free plots of the annex, shown and pickable only while a creator is choosing one.
  private readonly plotRoot = new THREE.Group();
  private plotPick: THREE.Object3D[] = [];
  private plotTags: { x: number; z: number; tag: HTMLDivElement }[] = [];
  private readonly plotShape = new THREE.PlaneGeometry(PLOT_SIZE - 0.2, PLOT_SIZE - 0.2).rotateX(-Math.PI / 2);
  private readonly plotFree = new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.3, depthWrite: false });
  private readonly plotChosen = new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.85, depthWrite: false });
  // Other people in the museum right now, as the server last reported them.
  private readonly others = new Map<string, { figure: THREE.Group; tag: HTMLDivElement; x: number; z: number }>();
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
  // Whether anything is moving. When nothing is, and nothing has changed, the museum is not
  // drawn at all: the last picture is still right.
  private lively = true;
  private dirty = true;
  private paused = false;
  // Frames in a row that took too long while something was happening.
  private strain = 0;
  // Whether another visitor is still on the way to where they were last reported.
  private astir = false;
  // Signposts stood on the floor while the introduction plays: this is what is being talked about.
  private marks: { x: number; y: number; z: number; tag: HTMLDivElement }[] = [];
  // Wallets that visited before, strolling the rooms while their owners are away.
  private readonly wanderers = new Map<string, Wanderer>();
  private eased = 0;

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
    // A sharp screen has four pixels where an ordinary one has one; drawing all of them is
    // most of what makes this heavy, and at this distance a little over one is enough.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Shadows are drawn once, when the exhibits are hung: nothing that casts one moves.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
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

    // Daylight: a bright sky, and a sun in the north-west so shadows fall towards the viewer.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.scene.background = new THREE.Color(SKY);
    // A little haze over what is far away, so the wood behind the museum falls back.
    this.scene.fog = new THREE.Fog("#c4e0b4", 158, 270);
    // Something for the brass and the glass to reflect: a plain lit room, blurred. It is made
    // once and costs nothing a frame.
    const reflections = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = reflections.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.16;
    reflections.dispose();
    this.scene.add(new THREE.HemisphereLight("#eaf6ff", "#8aa26f", 1.12));
    const sun = new THREE.DirectionalLight("#fff1d6", 3.1);
    sun.position.set(-4, 26, -10);
    sun.target.position.set(17, 0, 1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 34, bottom: -34, near: 1, far: 100 });
    this.scene.add(sun, sun.target);

    buildWorld(this.scene);
    this.buildStations();
    this.scene.add(this.exhibitRoot, this.plotRoot);

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
    // A little taller than everyone else, so the eye finds them.
    const self = person(this.visitorBody, 1, 1.12);
    const halo = new THREE.RingGeometry(0.3, 0.38, 32);
    halo.rotateX(-Math.PI / 2);
    this.visitorHalo = new THREE.Mesh(halo, new THREE.MeshBasicMaterial({ color: LIME }));
    this.visitorHalo.position.y = 0.03;
    this.visitor.add(...self.children, this.visitorHalo);
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
    this.blocked = [...exhibits, ...STATIONS];

    const paper = this.own(new THREE.MeshStandardMaterial({ color: "#f7f1e1", roughness: 0.7 }));
    const base = this.own(new THREE.MeshStandardMaterial({ color: "#6b4a32", roughness: 0.7 }));
    const archive = this.own(new THREE.MeshStandardMaterial({ color: "#d9cfb8", roughness: 0.9 }));
    const brass = this.own(new THREE.MeshStandardMaterial({ color: "#d0a52e", roughness: 0.35, metalness: 0.6 }));
    const rope = this.own(new THREE.MeshStandardMaterial({ color: "#a3312d", roughness: 0.9 }));
    const boards: Record<string, THREE.Material> = {
      funding: this.own(new THREE.MeshStandardMaterial({ color: LIME, roughness: 0.6 })),
      building: this.own(new THREE.MeshStandardMaterial({ color: "#ffcf5c", roughness: 0.6 })),
      completed: this.own(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 })),
      failed: this.own(new THREE.MeshStandardMaterial({ color: "#cfc7b4", roughness: 0.8 })),
      braked: this.own(new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.6 })),
    };
    const stanchion = this.keep(new THREE.CylinderGeometry(0.045, 0.07, 0.62, 8));
    const cord = this.keep(new THREE.BoxGeometry(2.1, 0.045, 0.045));
    const cordAcross = this.keep(new THREE.BoxGeometry(0.045, 0.045, 2.1));
    const standPost = this.keep(new THREE.BoxGeometry(0.07, 0.62, 0.07));
    const standBoard = this.keep(new THREE.BoxGeometry(0.62, 0.42, 0.05));
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

    // A pool of light on the floor: brightest in the middle, gone at the rim. It does not move.
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
    const bright = lit(0.55);

    const plinthTall = this.keep(new THREE.BoxGeometry(1.3, 0.72, 1.3));
    const plinthLow = this.keep(new THREE.BoxGeometry(1.3, 0.34, 1.3));
    const skirt = this.keep(new THREE.BoxGeometry(1.46, 0.1, 1.46));
    const plinthBand = this.keep(new THREE.BoxGeometry(1.36, 0.05, 1.36));
    const plinthTop = this.keep(new THREE.BoxGeometry(1.42, 0.06, 1.42));
    const post = this.keep(new THREE.CylinderGeometry(0.035, 0.035, 1.7, 6));
    const beam = this.keep(new THREE.BoxGeometry(1.5, 0.06, 0.06));
    const caseBox = this.keep(new THREE.BoxGeometry(1.16, 1.25, 1.16));
    const caseEdges = this.keep(new THREE.EdgesGeometry(caseBox));
    const crateEdges = this.keep(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.2, 1.15, 1.2)));
    const flag = this.keep(new THREE.BoxGeometry(0.22, 0.22, 0.22));
    const halo = this.keep(new THREE.RingGeometry(1.2, 1.27, 56).rotateX(-Math.PI / 2));
    const light = this.keep(new THREE.PlaneGeometry(5.2, 5.2).rotateX(-Math.PI / 2));
    // A creator's own room: a coloured floor, a post at each corner and a frame overhead.
    const reach = PLOT_SIZE / 2 - 0.06;
    const roomFloor = this.keep(new THREE.BoxGeometry(PLOT_SIZE, 0.06, PLOT_SIZE));
    const roomPost = this.keep(new THREE.BoxGeometry(0.12, 2.4, 0.12));
    const roomBeam = this.keep(new THREE.BoxGeometry(PLOT_SIZE, 0.12, 0.12));
    const roomBeamAcross = this.keep(new THREE.BoxGeometry(0.12, 0.12, PLOT_SIZE));
    const roomFloors = ROOM_FLOORS.map((color) => this.own(new THREE.MeshStandardMaterial({ color, roughness: 0.8 })));
    const crowd: { x: number; z: number }[] = [];

    // What every exhibit has the same of is drawn once for all of them, not once each.
    const many = new Map<
      string,
      { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; casts: boolean }
    >();
    const place = (
      key: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      casts: boolean,
      stretch = 1,
    ) => {
      let batch = many.get(key);
      if (!batch) {
        batch = { geometry, material, matrices: [], casts };
        many.set(key, batch);
      }
      batch.matrices.push(
        new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, stretch)),
      );
    };

    const seatsLit: THREE.Matrix4[] = [];
    const seatsOpen: THREE.Matrix4[] = [];
    const seatsKept: THREE.Matrix4[] = [];

    for (const exhibit of exhibits) {
      const { status } = exhibit;
      const ended = status === "failed" || status === "braked";
      const group = new THREE.Group();
      group.position.set(exhibit.x, 0, exhibit.z);
      this.places.set(exhibit.id, group.position.clone());

      // A spotlight, and only on what is still asking for backers: light on everything is
      // light on nothing.
      if (status === "funding") place("pool", light, bright, exhibit.x, 0.07, exhibit.z, false);

      if (exhibit.plot !== undefined) {
        const style = (exhibit.style ?? 0) % roomFloors.length;
        place(`room-floor-${style}`, roomFloor, roomFloors[style], exhibit.x, 0.03, exhibit.z, false);
        for (const [dx, dz] of [[-reach, -reach], [reach, -reach], [-reach, reach], [reach, reach]]) {
          place("room-post", roomPost, base, exhibit.x + dx, 1.2, exhibit.z + dz, true);
        }
        for (const dz of [-reach, reach]) place("room-beam", roomBeam, base, exhibit.x, 2.46, exhibit.z + dz, false);
        for (const dx of [-reach, reach]) place("room-beam-across", roomBeamAcross, base, exhibit.x + dx, 2.46, exhibit.z, false);
      }

      // The more reactions, the more figures gathered round it: on the two sides the view
      // looks at, fanning out from the east.
      const gathered = Math.min(CROWD_MOST, exhibit.reactions);
      for (let index = 0; index < gathered; index++) {
        const angle = 0.5 + (index - (gathered - 1) / 2) * 0.46;
        const radius = 1.75 + (index % 2) * 0.4;
        crowd.push({ x: exhibit.x + Math.cos(angle) * radius, z: exhibit.z + Math.sin(angle) * radius });
      }

      const height = ended ? 0.34 : 0.72;
      place("skirt", skirt, base, exhibit.x, 0.05, exhibit.z, false);
      const plinth = new THREE.Mesh(ended ? plinthLow : plinthTall, ended ? archive : paper);
      plinth.position.y = height / 2 + 0.1;
      plinth.castShadow = plinth.receiveShadow = true;
      group.add(plinth);

      // Brass posts and a rope round three sides; the front is open, where the seats are.
      for (const [dx, dz] of [[-1.05, -1.05], [1.05, -1.05], [-1.05, 0.72], [1.05, 0.72]]) {
        place("stanchion", stanchion, brass, exhibit.x + dx, 0.31, exhibit.z + dz, true);
      }
      place("cord", cord, rope, exhibit.x, 0.52, exhibit.z - 1.05, false);
      for (const dx of [-1.05, 1.05]) {
        place("cord-side", cordAcross, rope, exhibit.x + dx, 0.52, exhibit.z - 0.165, false, 1.77 / 2.1);
      }
      // A stand with a card on it; the card's colour says which state the campaign is in.
      place("stand", standPost, base, exhibit.x - 1.25, 0.31, exhibit.z + 1.2, false);
      const card = new THREE.Mesh(standBoard, boards[status]);
      card.position.set(-1.25, 0.72, 1.2);
      card.rotation.set(-0.5, Math.PI / 4, 0, "YXZ");
      card.castShadow = true;
      group.add(card);
      // A wooden top with a brass band under it, so a plinth is not just a box.
      place("plinth-band", plinthBand, brass, exhibit.x, height + 0.07, exhibit.z, false);
      place("plinth-top", plinthTop, base, exhibit.x, height + 0.13, exhibit.z, true);
      const top = height + 0.16;

      // One material per exhibit, so one can light up without the others.
      const material = this.own(standInMaterial(status, exhibit.tint));
      const object = standIn(exhibit.kind, material, (geometry) => this.keep(geometry), ended, exhibit.trim);
      object.position.y = top;
      object.scale.setScalar(1.25);
      object.userData.material = material;
      object.userData.rest = material.emissiveIntensity;
      object.userData.turns = status === "funding";
      group.add(object);
      this.objects.set(exhibit.id, object);

      const plain: THREE.Object3D[] = [];
      if (status === "funding") {
        const ring = new THREE.Mesh(halo, limeFlat);
        ring.position.y = 0.075;
        group.add(ring);
        plain.push(ring);
      }
      if (status === "building") {
        // Scaffolding: it is being worked on.
        for (const [dx, dz] of [[-0.72, -0.72], [0.72, -0.72], [-0.72, 0.72], [0.72, 0.72]]) {
          place("scaffold-post", post, dark, exhibit.x + dx, 0.85, exhibit.z + dz, true);
        }
        for (const [dz, y] of [[-0.72, 1.7], [0.72, 1.7], [-0.72, 0.95], [0.72, 0.95]]) {
          place("scaffold-beam", beam, dark, exhibit.x, y, exhibit.z + dz, false);
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

    if (crowd.length > 0) {
      const figure = this.keep(
        mergeGeometries([
          new THREE.CylinderGeometry(0.13, 0.17, 0.5, 10).translate(0, 0.25, 0),
          new THREE.SphereGeometry(0.13, 10, 8).translate(0, 0.63, 0),
        ]),
      );
      const cloth = this.own(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 }));
      const people = new THREE.InstancedMesh(figure, cloth, crowd.length);
      crowd.forEach((spot, index) => {
        people.setMatrixAt(index, new THREE.Matrix4().setPosition(spot.x, 0, spot.z));
        people.setColorAt(index, new THREE.Color(CROWD_SHIRTS[index % CROWD_SHIRTS.length]));
      });
      people.instanceMatrix.needsUpdate = true;
      people.castShadow = true;
      this.exhibitRoot.add(people);
    }

    for (const batch of many.values()) {
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = batch.casts;
      mesh.receiveShadow = true;
      this.exhibitRoot.add(mesh);
    }
    this.renderer.shadowMap.needsUpdate = true;

    // What was pointed at may be gone. A visitor standing where a plinth now is steps aside.
    if (this.pointed && !this.places.has(this.pointed)) this.pointed = null;
    if (!canStand(this.visitor.position.x, this.visitor.position.z, this.blocked)) this.stepAside();
    this.light();
  }

  /** Lights what is pointed at, stood next to or open, and rings it. */
  private light() {
    this.dirty = true;
    this.hot = this.pointed ?? this.near;
    const hot =
      this.hot && this.hot !== this.selected
        ? (this.places.get(this.hot) ?? STATIONS.find((station) => station.id === this.hot))
        : undefined;
    this.hoverRing.visible = Boolean(hot);
    if (hot) this.hoverRing.position.set(hot.x, 0.08, hot.z);
    const open = this.selected ? this.places.get(this.selected) : undefined;
    this.selectRing.visible = Boolean(open);
    if (open) this.selectRing.position.set(open.x, 0.085, open.z);

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

  /**
   * Stands signposts on the floor, each pointing down at a spot with a few words, and takes
   * away the ones that stood before. An empty list clears them.
   */
  setMarks(list: { x: number; z: number; text: string; high?: boolean }[]) {
    for (const mark of this.marks) mark.tag.remove();
    this.marks = list.map((entry) => {
      const tag = document.createElement("div");
      tag.className = "museum-mark absolute left-0 top-0";
      const words = document.createElement("span");
      words.textContent = entry.text;
      tag.appendChild(words);
      this.labels.appendChild(tag);
      return { x: entry.x, y: entry.high ? 3.6 : 2.4, z: entry.z, tag };
    });
    this.dirty = true;
  }

  /**
   * Turns the camera to a room, or to the whole building, and leaves the visitor where they
   * are. For showing someone round without walking them anywhere.
   */
  lookAt(id: RoomId | null) {
    const room = id ? ROOMS.find((candidate) => candidate.id === id) : undefined;
    if (!room) {
      this.overview();
      return;
    }
    this.following = false;
    this.goal.set(room.x, 0, room.z);
    this.zoomGoal = this.fitZoom(room) * 0.82;
  }

  /** The whole building in view. */
  overview() {
    this.following = false;
    this.goal.set(4.5, 0, 1);
    this.zoomGoal = Math.max(this.minZoom(), this.fitZoom() * 0.45);
  }

  /** Where the visitor stands, to tell the others. */
  whereabouts(): { x: number; z: number } {
    return { x: this.visitor.position.x, z: this.visitor.position.z };
  }

  /** Shows everyone else who is in the museum now. Figures appear, move and leave with the list. */
  setOthers(list: { id: string; name: string; wallet: boolean; x: number; z: number }[]) {
    const present = new Set(list.map((entry) => entry.id));
    for (const [id, other] of this.others) {
      if (present.has(id)) continue;
      this.scene.remove(other.figure);
      other.tag.remove();
      this.others.delete(id);
      this.dirty = true;
    }
    for (const entry of list) {
      let other = this.others.get(entry.id);
      if (!other) {
        const material = new THREE.MeshStandardMaterial({
          color: entry.wallet ? "#8ecae6" : "#c9c5b8",
          roughness: 0.6,
        });
        let variant = 0;
        for (const letter of entry.id) variant = (variant * 31 + letter.charCodeAt(0)) % 9973;
        const figure = person(material, variant);
        figure.position.set(entry.x, 0, entry.z);
        this.scene.add(figure);
        const tag = document.createElement("div");
        tag.className =
          "absolute left-0 top-0 whitespace-nowrap bg-paper/90 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-carbon";
        this.labels.appendChild(tag);
        other = { figure, tag, x: entry.x, z: entry.z };
        this.others.set(entry.id, other);
      }
      other.x = entry.x;
      other.z = entry.z;
      other.tag.textContent = entry.name;
      this.dirty = true;
    }
  }

  /**
   * Shows the wallets that visited before as figures strolling the rooms, each with its
   * short address. They come and go with the list; they are not people who are here now.
   */
  setWanderers(list: { id: string; name: string }[]) {
    const wanted = new Set(list.map((entry) => entry.id));
    for (const [id, wanderer] of this.wanderers) {
      if (wanted.has(id)) continue;
      this.scene.remove(wanderer.figure);
      wanderer.tag.remove();
      this.wanderers.delete(id);
    }
    list.forEach((entry, index) => {
      if (this.wanderers.has(entry.id)) return;
      // The same wallet always wears the same colour and starts in the same room.
      let sum = 0;
      for (const letter of entry.id) sum = (sum * 31 + letter.charCodeAt(0)) % 9973;
      const cloth = new THREE.MeshStandardMaterial({ color: CROWD_SHIRTS[sum % CROWD_SHIRTS.length], roughness: 0.8 });
      const figure = person(cloth, sum, 0.94);
      const room = ROOMS[(sum + index) % ROOMS.length];
      const start = this.somewhere(room);
      figure.position.set(start.x, 0, start.z);
      this.scene.add(figure);
      const tag = document.createElement("div");
      tag.className =
        "absolute left-0 top-0 hidden whitespace-nowrap bg-carbon/55 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-paper/80";
      tag.textContent = entry.name;
      this.labels.appendChild(tag);
      this.wanderers.set(entry.id, { figure, tag, path: [], wait: Math.random() * 2, speed: 1.5 + Math.random() * 0.9, stuck: 0 });
    });
    this.dirty = true;
  }

  /** A free spot on a room's floor. */
  private somewhere(room: Room): { x: number; z: number } {
    for (let tries = 0; tries < 30; tries++) {
      const x = room.x + (Math.random() - 0.5) * (room.width - 2.4);
      const z = room.z + (Math.random() - 0.5) * (room.depth - 2.4);
      if (canStand(x, z, this.blocked)) return { x, z };
    }
    return { x: room.x, z: room.z + 0.2 };
  }

  /**
   * Moves every stroller on. Each one picks somewhere to go, often in another room, walks there
   * through the doors, looks about for a moment, and picks again.
   */
  private stroll(seconds: number) {
    for (const wanderer of this.wanderers.values()) {
      const { figure } = wanderer;
      const at = { x: figure.position.x, z: figure.position.z };
      if (wanderer.wait > 0) {
        wanderer.wait -= seconds;
        if (wanderer.wait <= 0) {
          const here = ROOMS.find((room) => room.id === roomAt(at.x, at.z)) ?? ROOMS[0];
          const room = Math.random() < 0.5 ? ROOMS[Math.floor(Math.random() * ROOMS.length)] : here;
          wanderer.path = route(at, this.somewhere(room));
          wanderer.stuck = 0;
        }
        continue;
      }
      const next = wanderer.path[0];
      if (!next) {
        wanderer.wait = 0.6 + Math.random() * 2.4;
        figure.position.y = 0;
        continue;
      }
      const dx = next[0] - at.x;
      const dz = next[1] - at.z;
      const left = Math.hypot(dx, dz);
      const reach = wanderer.speed * seconds;
      if (left <= Math.max(reach, 0.15)) {
        wanderer.path.shift();
        continue;
      }
      const step = stepFrom(at, (dx / left) * reach, (dz / left) * reach, this.blocked);
      // Nowhere to go from here for a while: give this errand up and choose another.
      if (!step) {
        wanderer.stuck += seconds;
        if (wanderer.stuck > 0.5) wanderer.path = [];
        continue;
      }
      wanderer.stuck = 0;
      figure.position.set(step.x, Math.abs(Math.sin(this.clock * 10 + figure.id)) * 0.04, step.z);
    }
  }

  /** The two things in the hall that are not exhibits: the board of every campaign, and the desk where one is opened. */
  private buildStations() {
    const wood = new THREE.MeshStandardMaterial({ color: "#6b4a32", roughness: 0.7 });
    const light = new THREE.MeshStandardMaterial({ color: "#c58f58", roughness: 0.7 });
    const add = (station: string, mesh: THREE.Mesh, parent: THREE.Object3D) => {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.exhibit = station;
      this.stationPick.push(mesh);
      parent.add(mesh);
    };

    const [boardAt, deskAt] = STATIONS;
    const board = new THREE.Group();
    board.position.set(boardAt.x, 0, boardAt.z);
    board.rotation.y = Math.PI / 4;
    for (const dx of [-0.95, 0.95]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.12), wood);
      leg.position.set(dx, 1, 0);
      add(boardAt.id, leg, board);
    }
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.3, 0.1), wood);
    panel.position.set(0, 1.4, 0);
    add(boardAt.id, panel, board);
    // Notices pinned to it, one colour for each way a campaign can stand.
    const notices: [number, number, string][] = [
      [-0.65, 1.65, LIME],
      [-0.05, 1.68, "#ffcf5c"],
      [0.58, 1.62, "#ffffff"],
      [-0.6, 1.12, "#cfc7b4"],
      [0.02, 1.15, ORANGE],
      [0.62, 1.1, LIME],
    ];
    for (const [x, y, color] of notices) {
      const sheet = new THREE.Mesh(
        new THREE.BoxGeometry(0.44, 0.4, 0.03),
        new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
      );
      sheet.position.set(x, y, 0.07);
      add(boardAt.id, sheet, board);
    }
    this.scene.add(board);

    const desk = new THREE.Group();
    desk.position.set(deskAt.x, 0, deskAt.z);
    desk.rotation.y = Math.PI / 4;
    const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 0.9), light);
    top.position.set(0, 0.86, 0);
    add(deskAt.id, top, desk);
    const front = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 0.1), wood);
    front.position.set(0, 0.4, 0.38);
    add(deskAt.id, front, desk);
    const plans = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.03, 0.5),
      new THREE.MeshStandardMaterial({ color: "#3d6f9e", roughness: 0.8 }),
    );
    plans.position.set(-0.4, 0.94, 0);
    add(deskAt.id, plans, desk);
    // The curator, who stands behind it. Not a visitor: part of the building.
    const coat = new THREE.MeshStandardMaterial({ color: LIME, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.6, 16), coat);
    body.position.set(0.35, 0.72, -0.55);
    add(deskAt.id, body, desk);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      new THREE.MeshStandardMaterial({ color: "#d9a37a", roughness: 0.8 }),
    );
    head.position.set(0.35, 1.2, -0.55);
    add(deskAt.id, head, desk);
    this.scene.add(desk);

    for (const station of STATIONS) {
      const tag = document.createElement("div");
      tag.className =
        "absolute left-0 top-0 hidden whitespace-nowrap border border-carbon bg-lime px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-carbon";
      tag.textContent = station.label;
      this.labels.appendChild(tag);
      this.stationTags.push(tag);
    }
  }

  /**
   * Shows the free plots of the annex so one can be picked, with the chosen one marked, or
   * hides them again when given `null`.
   */
  setPlacing(free: number[] | null, chosen: number | null, floor = LIME) {
    this.plotRoot.clear();
    this.plotPick = [];
    for (const tag of this.plotTags) tag.tag.remove();
    this.plotTags = [];
    // The chosen plot is shown in the colour its floor would have.
    this.plotChosen.color.set(floor);
    for (const index of free ?? []) {
      const plot = PLOTS[index];
      if (!plot) continue;
      const mesh = new THREE.Mesh(this.plotShape, index === chosen ? this.plotChosen : this.plotFree);
      mesh.position.set(plot.x, 0.1, plot.z);
      mesh.userData.exhibit = `@plot:${index}`;
      this.plotRoot.add(mesh);
      this.plotPick.push(mesh);
      // Its number, the same one the plan beside the floor uses.
      const tag = document.createElement("div");
      tag.className = `absolute left-0 top-0 border px-1.5 py-0.5 font-mono text-xs font-semibold ${
        index === chosen ? "border-carbon bg-lime text-carbon" : "border-lime/70 bg-carbon/80 text-lime"
      }`;
      tag.textContent = String(index + 1);
      this.labels.appendChild(tag);
      this.plotTags.push({ x: plot.x, z: plot.z, tag });
    }
    this.dirty = true;
  }

  /** Stops drawing while something else covers the whole floor, and starts again after. */
  setPaused(paused: boolean) {
    this.paused = paused;
    this.dirty = true;
  }

  /**
   * Notices a machine that cannot keep up and asks less of it: first fewer pixels, then no
   * shadows. It only ever steps down, so the picture does not flicker between settings.
   */
  private unburden(gap: number) {
    if (this.eased >= 2) return;
    this.strain = gap > 1 / 26 ? this.strain + 1 : 0;
    if (this.strain < 45) return;
    this.strain = 0;
    this.eased += 1;
    if (this.eased === 1) {
      this.renderer.setPixelRatio(1);
      this.resize();
    } else {
      this.renderer.shadowMap.enabled = false;
      this.dirty = true;
      this.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) (child.material as THREE.Material).needsUpdate = true;
      });
    }
  }

  /** Who is walking: a connected wallet, by its short address, or a guest who has none. */
  setVisitor(wallet: string | null) {
    this.visitorBody.color.set(wallet ? "#d8f59a" : "#e9e6dc");
    this.visitorHalo.visible = wallet !== null;
    this.visitorTag.textContent = wallet ? `You · ${wallet}` : "Guest";
    this.dirty = true;
  }

  setInsets(left: number, right: number, bottom: number) {
    this.insetLeft = left;
    this.insetRight = right;
    this.insetBottom = bottom;
    this.dirty = true;
  }

  zoomBy(factor: number) {
    this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * factor, this.minZoom(), ZOOM_MAX);
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
      this.dirty = true;
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
        if (canStand(nx, nz, this.blocked)) {
          this.visitor.position.set(nx, 0, nz);
          return;
        }
      }
    }
    this.visitor.position.set(START.x, 0, START.z);
  }

  /** One step in a direction on the floor, going round whatever is in the way. */
  private step(dx: number, dz: number): boolean {
    const next = stepFrom({ x: this.visitor.position.x, z: this.visitor.position.z }, dx, dz, this.blocked);
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
      if (canStand(next[0], next[1], this.blocked)) this.visitor.position.set(next[0], 0, next[1]);
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
    this.dirty = true;
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
    const down = ((room.width + room.depth) / Math.SQRT2) * Math.sin(PITCH) + FAR_WALL * Math.cos(PITCH);
    return THREE.MathUtils.clamp(Math.min(width / (across + 2), height / (down + 2.5)), this.minZoom(), ZOOM_MAX);
  }

  /**
   * The furthest out the view may go: far enough for the whole building, never so far that
   * the edge of the wood comes into the picture, wherever the view has been dragged to.
   */
  private minZoom() {
    const { clientWidth, clientHeight } = this.host;
    // Seen from this corner the wood is a diamond; this is how far from its middle the
    // view's own middle can get, measured the same way.
    const strayed =
      Math.SQRT2 *
      Math.max(
        FOREST.x - BOUNDS.minX,
        BOUNDS.maxX - FOREST.x,
        FOREST.z - BOUNDS.minZ,
        BOUNDS.maxZ - FOREST.z,
      );
    const room = FOREST.half * Math.SQRT2 - strayed - 6;
    return (clientWidth / 2 + clientHeight / 2 / Math.sin(PITCH)) / room;
  }

  private resize() {
    const { clientWidth, clientHeight } = this.host;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight);
    this.zoomGoal = Math.max(this.zoomGoal, this.minZoom());
    this.dirty = true;
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
    if (this.paused) {
      this.last = time;
      return;
    }
    const gap = Math.max(0, (time - this.last) / 1000);
    const strolling = this.wanderers.size > 0 && !this.calm;
    const moving =
      this.held.size > 0 ||
      this.path.length > 0 ||
      this.drag !== null ||
      this.astir ||
      this.target.distanceToSquared(this.goal) > 1e-4 ||
      Math.abs(this.zoom - this.zoomGoal) > 0.02;
    // Nothing moved and nothing changed: the picture on screen is still the right one.
    if (!moving && !this.dirty) {
      this.lively = false;
      // Strollers alone are drawn at an easy pace, and nothing at all is drawn without them.
      if (!strolling) this.last = time;
      if (!strolling || gap < 1 / STROLL_FRAMES) return;
    }
    this.last = time;
    // The first frame after a rest says nothing about how fast this machine is.
    if (this.lively) this.unburden(gap);
    this.lively = moving;
    this.dirty = false;
    const seconds = Math.min(0.06, gap);
    this.clock += seconds;
    if (strolling) this.stroll(seconds);

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
    const stops: [string, { x: number; z: number }][] = [
      ...this.places,
      ...STATIONS.map((station) => [station.id, station] as [string, { x: number; z: number }]),
    ];
    for (const [id, place] of stops) {
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

    if (!this.calm) {
      this.visitor.children[0].position.y = walked ? Math.abs(Math.sin(this.clock * 13)) * 0.05 : 0;
      // What is still asking for backers turns slowly, whenever the floor is being drawn anyway.
      for (const object of this.objects.values()) {
        if (object.userData.turns) object.rotation.y += 0.45 * seconds;
      }
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
    this.camera.position.copy(centre).addScaledVector(OFFSET, 6);
    this.camera.lookAt(centre);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);

    const readable = this.zoom > 16;
    for (const exhibit of this.hung) {
      const tag = this.tags.get(exhibit.id);
      if (!tag) continue;
      // One label at a time, for what is pointed at or stood next to: a room full of labels
      // is a room full of labels on top of each other.
      const shown = readable && !this.selected && exhibit.id === this.hot;
      tag.classList.toggle("hidden", !shown);
      if (!shown) continue;
      const at = this.project(exhibit.x - 0.75, 0.05, exhibit.z + 0.95);
      tag.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-100%, 0)`;
    }
    STATIONS.forEach((station, index) => {
      const tag = this.stationTags[index];
      const shown = readable && !this.selected && this.room === "unmade" && this.marks.length === 0;
      tag.classList.toggle("hidden", !shown);
      if (!shown) return;
      const at = this.project(station.x, 2.3, station.z);
      tag.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`;
    });
    for (const plot of this.plotTags) {
      const at = this.project(plot.x, 0.1, plot.z);
      plot.tag.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`;
    }
    for (const mark of this.marks) {
      const at = this.project(mark.x, mark.y, mark.z);
      mark.tag.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`;
    }
    // With signposts up, the usual small labels would only be in their way.
    const quiet = this.marks.length > 0 || this.plotTags.length > 0;
    for (const wanderer of this.wanderers.values()) {
      const shown = readable && !this.selected && !quiet;
      wanderer.tag.classList.toggle("hidden", !shown);
      if (!shown) continue;
      const at = this.project(wanderer.figure.position.x, 1.0, wanderer.figure.position.z);
      wanderer.tag.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`;
    }
    this.astir = false;
    for (const other of this.others.values()) {
      const figure = other.figure.position;
      const pull = this.calm ? 1 : 1 - Math.pow(0.002, seconds);
      const moving = Math.hypot(other.x - figure.x, other.z - figure.z) > 0.03;
      if (moving) this.astir = true;
      figure.x += (other.x - figure.x) * pull;
      figure.z += (other.z - figure.z) * pull;
      figure.y = moving && !this.calm ? Math.abs(Math.sin(this.clock * 11)) * 0.04 : 0;
      const at = this.project(figure.x, 1.05, figure.z);
      other.tag.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`;
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
    const hit = this.raycaster.intersectObjects([...this.plotPick, ...this.pickable, ...this.stationPick], false)[0];
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
    // While a plot is being chosen, a click that misses the plots does nothing: walking off
    // would take the view away from them.
    if (this.plotPick.length > 0) return;
    if (this.selected) this.handlers.onSelect(null);
    const spot = this.floorUnder(event);
    if (spot && canStand(spot.x, spot.z, this.blocked)) {
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
    // Hand the graphics context back at once: a browser only allows a handful, and a page that
    // is left and returned to must not run out.
    this.renderer.forceContextLoss();
    this.labels.remove();
    el.remove();
  }
}
