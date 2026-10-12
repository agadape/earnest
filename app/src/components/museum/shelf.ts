/**
 * A creator's shelf: the creator as a small figure, and beside them every object they have put
 * in the museum, standing in a row on a long wooden shelf in the light of a gallery. The row
 * can be dragged along. It shows what there is to see; what each campaign is and how it went is
 * said in words next to it.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { standIn, standInMaterial } from "@/components/museum/objects";
import { person } from "@/components/museum/people";
import type { Look } from "@/lib/museum/plan";
import type { Status } from "@/lib/tanda-jadi";

const GAP = 1.55;

export class Shelf {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 1, 0.1, 80);
  private readonly row = new THREE.Group();
  private readonly objects: THREE.Object3D[] = [];
  private readonly observer: ResizeObserver;
  private readonly width: number;
  private frame = 0;
  private last = performance.now();
  private clock = 0;
  // Where along the row the view is, and where it is heading.
  private at = 0;
  private goal = 0;
  private drag: number | null = null;
  private marked = -1;

  constructor(
    private readonly host: HTMLElement,
    things: { look: Look; status: Status }[],
    /** A number that picks the creator's shirt, skin and hair: the same wallet, the same figure. */
    who: number,
    private readonly calm: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.style.cursor = "grab";
    host.appendChild(this.renderer.domElement);

    // Something for the brass and the glass to reflect: a plain lit room, blurred. It is made
    // once and costs nothing a frame.
    const reflections = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = reflections.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    reflections.dispose();
    this.scene.add(new THREE.HemisphereLight("#f4fbff", "#c9a877", 1.3));
    const lamp = new THREE.DirectionalLight("#fff3da", 2.4);
    lamp.position.set(-3, 7, 5);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.radius = 4;
    this.scene.add(lamp, lamp.target);

    const count = Math.max(1, things.length);
    this.width = (count - 1) * GAP;
    Object.assign(lamp.shadow.camera, { left: -this.width / 2 - 4, right: this.width / 2 + 4, top: 5, bottom: -3, near: 1, far: 30 });

    // The shelf: a long board on a stone foot, edged in brass.
    const wood = new THREE.MeshStandardMaterial({ color: "#8a5a3a", roughness: 0.55 });
    const stone = new THREE.MeshStandardMaterial({ color: "#d9cfb8", roughness: 0.85 });
    const brass = new THREE.MeshStandardMaterial({ color: "#d9ab35", roughness: 0.3, metalness: 0.65 });
    const long = this.width + 2.2;
    const part = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number, z = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.row.add(mesh);
    };
    part(new THREE.BoxGeometry(long, 0.5, 1.5), stone, 0.25);
    part(new THREE.BoxGeometry(long + 0.16, 0.12, 1.66), wood, 0.56);
    part(new THREE.BoxGeometry(long + 0.2, 0.04, 0.04), brass, 0.6, 0.83);

    things.forEach(({ look, status }, index) => {
      const ended = status === "failed" || status === "braked";
      const object = standIn(look.kind, standInMaterial(status, look.tint), undefined, ended, look.trim);
      object.position.set(index * GAP - this.width / 2, 0.62, 0);
      object.userData.base = 0.62;
      this.row.add(object);
      this.objects.push(object);
    });

    // The creator, standing at the head of the shelf.
    const shirts = ["#e4572e", "#17bebb", "#ffc914", "#76b041", "#5b5f97", "#ff8cc6", "#2e86ab"];
    const figure = person(new THREE.MeshStandardMaterial({ color: shirts[who % shirts.length], roughness: 0.8 }), who, 2.3);
    figure.position.set(-this.width / 2 - 2.1, 0, 0.5);
    figure.rotation.y = 0.5;
    this.row.add(figure);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(long + 14, 12).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.26 }),
    );
    floor.receiveShadow = true;
    this.row.add(floor);
    this.scene.add(this.row);

    // Start where the creator stands, with the first of their things in view.
    this.at = this.goal = this.reach(-Infinity);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    this.frame = requestAnimationFrame(this.loop);
  }

  /** Keeps a place along the row between the creator at one end and the last object at the other. */
  private reach(x: number): number {
    return THREE.MathUtils.clamp(x, -this.width / 2 - 1.2, this.width / 2);
  }

  /** Brings one object into the middle of the view and lifts it a little, or lets go with -1. */
  mark(index: number) {
    this.marked = index;
    const object = this.objects[index];
    if (object) this.goal = this.reach(object.position.x);
  }

  private resize() {
    const { clientWidth, clientHeight } = this.host;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  private readonly loop = (time: number) => {
    this.frame = requestAnimationFrame(this.loop);
    const seconds = Math.min(0.05, Math.max(0, (time - this.last) / 1000));
    this.last = time;
    this.clock += seconds;
    this.at += (this.goal - this.at) * (this.calm ? 1 : 1 - Math.pow(0.002, seconds));
    this.objects.forEach((object, index) => {
      const lifted = index === this.marked;
      if (!this.calm) object.rotation.y += (lifted ? 1.4 : 0.3) * seconds;
      const base = object.userData.base as number;
      object.position.y += ((lifted ? base + 0.22 : base) - object.position.y) * Math.min(1, seconds * 8);
    });
    this.camera.position.set(this.at, 2.9, 9.5);
    this.camera.lookAt(this.at, 1.05, 0);
    this.renderer.render(this.scene, this.camera);
  };

  private readonly onDown = (event: PointerEvent) => {
    this.drag = event.clientX;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = "grabbing";
  };

  private readonly onMove = (event: PointerEvent) => {
    if (this.drag === null) return;
    this.goal = this.reach(this.goal - (event.clientX - this.drag) * 0.012);
    this.drag = event.clientX;
  };

  private readonly onUp = () => {
    this.drag = null;
    this.renderer.domElement.style.cursor = "grab";
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.goal = this.reach(this.goal + (event.deltaY + event.deltaX) * 0.004);
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    el.removeEventListener("wheel", this.onWheel);
    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}
