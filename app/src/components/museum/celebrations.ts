/**
 * What the floor does when somebody takes a seat: light comes down on the exhibit, a ring runs
 * out across the floor, confetti goes up, and the amount floats over it. A handful can play at
 * once and the rest wait their turn; pledges for one exhibit that come close together are one
 * celebration with the amounts added up.
 *
 * Everything here is made once and used again. Nothing is created while it plays.
 */
import * as THREE from "three";

import { NO_INK } from "@/components/museum/outline";
import { VISUAL } from "@/components/museum/visual-config";

export interface Cheer {
  /** The exhibit's id. */
  id: string;
  /** What to float over it, already written out: "+$10.00". */
  words: string;
  /** Whether this is the visitor's own doing. */
  mine: boolean;
  /** A bigger one, for an exhibit that just arrived somewhere new. */
  grand?: boolean;
}

interface Slot {
  beam: THREE.Mesh;
  ring: THREE.Mesh;
  text: HTMLDivElement;
  arrow: HTMLDivElement;
  /** Where in the shared confetti this slot's pieces start. */
  first: number;
  id: string | null;
  spent: number;
  length: number;
  grand: boolean;
  x: number;
  y: number;
  z: number;
}

interface Waiting extends Cheer {
  /** When it was asked for, in seconds on the scene's own clock. */
  at: number;
  amount: number;
}

const GRAVITY = 7.5;

export class Celebrations {
  private readonly slots: Slot[] = [];
  private readonly waiting: Waiting[] = [];
  private readonly confetti: THREE.InstancedMesh;
  private readonly pieces: number;
  // For every piece of confetti: where it is, how fast it goes, how it spins.
  private readonly where: Float32Array;
  private readonly speed: Float32Array;
  private readonly spin: Float32Array;
  private readonly puppet = new THREE.Object3D();
  private readonly point = new THREE.Vector3();
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly labels: HTMLElement,
    private readonly camera: THREE.Camera,
    private readonly host: HTMLElement,
    /** How much of the confetti this machine gets, from 0 to 1. */
    share: number,
    private readonly calm: boolean,
  ) {
    this.pieces = Math.max(12, Math.round(VISUAL.confetti * share));
    const total = this.pieces * VISUAL.cheersAtOnce;
    this.where = new Float32Array(total * 3);
    this.speed = new Float32Array(total * 3);
    this.spin = new Float32Array(total);
    this.confetti = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.14, 0.09),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      total,
    );
    const colour = new THREE.Color();
    for (let index = 0; index < total; index++) {
      this.confetti.setColorAt(index, colour.set(VISUAL.confettiColors[index % VISUAL.confettiColors.length]));
      this.hide(index);
    }
    this.confetti.frustumCulled = false;
    this.confetti.layers.set(NO_INK);
    this.confetti.instanceMatrix.needsUpdate = true;
    scene.add(this.confetti);

    // A shaft of light: bright at the foot, gone at the top.
    const fade = document.createElement("canvas");
    fade.width = 4;
    fade.height = 64;
    const paint = fade.getContext("2d") as CanvasRenderingContext2D;
    const up = paint.createLinearGradient(0, 0, 0, 64);
    up.addColorStop(0, "rgba(255,255,255,0)");
    up.addColorStop(1, "rgba(255,255,255,1)");
    paint.fillStyle = up;
    paint.fillRect(0, 0, 4, 64);
    const shaft = new THREE.CanvasTexture(fade);
    const beamShape = new THREE.CylinderGeometry(0.75, 0.75, 9, 28, 1, true).translate(0, 4.5, 0);
    const ringShape = new THREE.RingGeometry(0.9, 1.08, 56).rotateX(-Math.PI / 2);

    for (let index = 0; index < VISUAL.cheersAtOnce; index++) {
      const beam = new THREE.Mesh(
        beamShape,
        new THREE.MeshBasicMaterial({
          color: VISUAL.beamColor,
          map: shaft,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      const ring = new THREE.Mesh(
        ringShape,
        new THREE.MeshBasicMaterial({ color: VISUAL.beamColor, transparent: true, opacity: 0, depthWrite: false }),
      );
      for (const mesh of [beam, ring]) {
        mesh.visible = false;
        mesh.layers.set(NO_INK);
        scene.add(mesh);
      }
      const text = document.createElement("div");
      text.className =
        "absolute left-0 top-0 hidden whitespace-nowrap rounded-full border-2 border-carbon bg-lime px-3 py-1 text-base font-extrabold text-carbon shadow-lg";
      const arrow = document.createElement("div");
      arrow.className =
        "absolute left-0 top-0 hidden h-9 w-9 items-center justify-center rounded-full border-2 border-carbon bg-lime text-lg font-extrabold text-carbon shadow-lg";
      arrow.textContent = "➤";
      labels.append(text, arrow);
      this.slots.push({ beam, ring, text, arrow, first: index * this.pieces, id: null, spent: 0, length: 0, grand: false, x: 0, y: 0, z: 0 });
    }
  }

  private hide(index: number) {
    this.puppet.position.set(0, -50, 0);
    this.puppet.scale.setScalar(0);
    this.puppet.updateMatrix();
    this.confetti.setMatrixAt(index, this.puppet.matrix);
  }

  /**
   * Asks for a celebration. One already waiting for the same exhibit takes this one in, if it
   * was asked for a moment ago; its words become the total.
   */
  cheer(cheer: Cheer, amount: number, words: (total: number) => string) {
    const same = this.waiting.find((entry) => entry.id === cheer.id && this.clock - entry.at <= VISUAL.cheerMerge && !entry.grand && !cheer.grand);
    if (same) {
      same.amount += amount;
      same.words = words(same.amount);
      same.mine = same.mine || cheer.mine;
      return;
    }
    this.waiting.push({ ...cheer, amount, at: this.clock });
  }

  /** Whether anything is playing or waiting to. */
  get busy(): boolean {
    return this.waiting.length > 0 || this.slots.some((slot) => slot.id !== null);
  }

  private start(slot: Slot, entry: Waiting, place: THREE.Vector3, top: number) {
    slot.id = entry.id;
    slot.spent = 0;
    slot.grand = Boolean(entry.grand);
    slot.length = slot.grand ? VISUAL.finaleSeconds : VISUAL.cheerSeconds;
    slot.x = place.x;
    slot.y = top;
    slot.z = place.z;
    slot.beam.position.set(place.x, 0.1, place.z);
    slot.beam.scale.set(slot.grand ? 1.7 : 1, 1, slot.grand ? 1.7 : 1);
    slot.ring.position.set(place.x, 0.09, place.z);
    slot.beam.visible = slot.ring.visible = true;
    slot.text.textContent = entry.words;
    slot.text.classList.remove("hidden");
    // Confetti starts in a knot over the exhibit and is thrown outwards and up.
    for (let piece = 0; piece < this.pieces; piece++) {
      const at = (slot.first + piece) * 3;
      const round = Math.random() * Math.PI * 2;
      const out = (slot.grand ? 2.6 : 1.7) * (0.35 + Math.random() * 0.65);
      this.where[at] = place.x;
      this.where[at + 1] = top + 0.9;
      this.where[at + 2] = place.z;
      this.speed[at] = Math.cos(round) * out;
      this.speed[at + 1] = (slot.grand ? 6.5 : 4.6) * (0.55 + Math.random() * 0.45);
      this.speed[at + 2] = Math.sin(round) * out;
      this.spin[slot.first + piece] = Math.random() * 6.28;
    }
  }

  /**
   * Moves every celebration on, and starts the ones whose turn has come. `places` and `tops`
   * say where each exhibit stands and how high its plinth is.
   */
  update(seconds: number, places: Map<string, THREE.Vector3>, tops: (id: string) => number) {
    this.clock += seconds;

    // Hand free slots to whoever has waited long enough not to be joined by a later pledge.
    for (const slot of this.slots) {
      if (slot.id !== null) continue;
      const next = this.waiting.findIndex(
        (entry) => entry.grand || this.clock - entry.at >= Math.min(0.6, VISUAL.cheerMerge) || this.calm,
      );
      if (next < 0) break;
      const [entry] = this.waiting.splice(next, 1);
      const place = places.get(entry.id);
      // An exhibit with no floor to stand on has nowhere to be celebrated.
      if (place) this.start(slot, entry, place, tops(entry.id));
    }

    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    let moved = false;
    for (const slot of this.slots) {
      if (slot.id === null) continue;
      slot.spent += seconds;
      const along = slot.spent / slot.length;
      if (along >= 1) {
        slot.id = null;
        slot.beam.visible = slot.ring.visible = false;
        slot.text.classList.add("hidden");
        slot.arrow.classList.add("hidden");
        slot.arrow.classList.remove("flex");
        for (let piece = 0; piece < this.pieces; piece++) this.hide(slot.first + piece);
        moved = true;
        continue;
      }

      // The light comes on fast and goes slowly; the ring runs out and thins.
      const light = Math.min(1, along * 8) * Math.max(0, 1 - along * 1.6);
      (slot.beam.material as THREE.MeshBasicMaterial).opacity = (slot.grand ? 0.75 : 0.5) * light;
      const reach = 1 + along * (slot.grand ? 5.5 : 3.6);
      slot.ring.scale.set(reach, 1, reach);
      (slot.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - along * 1.5));

      if (!this.calm) {
        for (let piece = 0; piece < this.pieces; piece++) {
          const index = slot.first + piece;
          const at = index * 3;
          this.speed[at + 1] -= GRAVITY * seconds;
          this.where[at] += this.speed[at] * seconds;
          this.where[at + 1] = Math.max(0.03, this.where[at + 1] + this.speed[at + 1] * seconds);
          this.where[at + 2] += this.speed[at + 2] * seconds;
          this.spin[index] += seconds * 7;
          this.puppet.position.set(this.where[at], this.where[at + 1], this.where[at + 2]);
          this.puppet.rotation.set(this.spin[index], this.spin[index] * 0.7, this.spin[index] * 1.3);
          this.puppet.scale.setScalar(Math.max(0, 1 - Math.max(0, along - 0.7) / 0.3));
          this.puppet.updateMatrix();
          this.confetti.setMatrixAt(index, this.puppet.matrix);
        }
        moved = true;
      }

      // The words rise from the exhibit; if it is off the screen, an arrow at the edge points to it.
      this.point.set(slot.x, slot.y + 1.9 + along * 1.4, slot.z).project(this.camera);
      const x = ((this.point.x + 1) / 2) * width;
      const y = ((1 - this.point.y) / 2) * height;
      const inView = x > 30 && x < width - 30 && y > 30 && y < height - 30;
      slot.text.classList.toggle("hidden", !inView);
      slot.text.style.opacity = String(Math.min(1, along * 10) * Math.max(0, 1 - Math.max(0, along - 0.75) / 0.25));
      slot.text.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      slot.arrow.classList.toggle("hidden", inView);
      slot.arrow.classList.toggle("flex", !inView);
      if (!inView) {
        const ex = Math.min(width - 26, Math.max(26, x));
        const ey = Math.min(height - 80, Math.max(26, y));
        const turn = Math.atan2(y - height / 2, x - width / 2);
        const beat = this.calm ? 1 : 1 + 0.12 * Math.sin(slot.spent * 9);
        slot.arrow.style.transform = `translate(${Math.round(ex)}px, ${Math.round(ey)}px) translate(-50%, -50%) rotate(${turn.toFixed(2)}rad) scale(${beat.toFixed(2)})`;
      }
    }
    if (moved) this.confetti.instanceMatrix.needsUpdate = true;
  }

  /**
   * How far off the floor a figure standing at a point should be right now: a couple of small
   * hops if a celebration has just started close by, nothing otherwise.
   */
  hop(x: number, z: number): number {
    if (this.calm) return 0;
    let best = 0;
    for (const slot of this.slots) {
      if (slot.id === null || slot.spent > 1) continue;
      if (Math.hypot(slot.x - x, slot.z - z) > VISUAL.hopRadius) continue;
      best = Math.max(best, Math.abs(Math.sin(slot.spent * 9.4)) * 0.32 * (1 - slot.spent));
    }
    return best;
  }

  dispose() {
    for (const slot of this.slots) {
      slot.text.remove();
      slot.arrow.remove();
    }
    this.scene.remove(this.confetti);
  }
}
