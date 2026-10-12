/**
 * One exhibit seen up close: its object on a plinth that turns, in the light of a gallery.
 * Drag turns it, the wheel moves closer or further. Nothing here knows what the campaign is
 * beyond which object stands for it and which state it is in.
 */
import * as THREE from "three";

import { standIn, standInMaterial } from "@/components/museum/objects";
import type { Look } from "@/lib/museum/plan";
import type { Status } from "@/lib/tanda-jadi";

const LIME = "#d8f59a";
const PAPER = "#f0efe7";

export class Inspector {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private readonly turntable = new THREE.Group();
  private readonly observer: ResizeObserver;
  private frame = 0;
  private last = performance.now();
  private distance = 7.4;
  private tilt = 0.32;
  private drag: { x: number; y: number } | null = null;
  // After a drag the object rests for a moment before it starts turning by itself again.
  private rest = 0;

  constructor(
    private readonly host: HTMLElement,
    look: Look,
    status: Status,
    private readonly calm: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.style.cursor = "grab";
    host.appendChild(this.renderer.domElement);

    // A bright gallery: daylight from above, a warm lamp, and a little light back from the floor.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.add(new THREE.HemisphereLight("#f4fbff", "#c9a877", 1.5));
    const lamp = new THREE.SpotLight("#fff3da", 55, 14, 0.55, 0.7, 1.4);
    lamp.position.set(-1.8, 5.5, 2.8);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.radius = 4;
    this.scene.add(lamp, lamp.target);
    const rim = new THREE.DirectionalLight(status === "funding" ? LIME : PAPER, 1.1);
    rim.position.set(3, 1.5, -3);
    this.scene.add(rim);

    const ended = status === "failed" || status === "braked";
    const object = standIn(look.kind, standInMaterial(status, look.tint), undefined, ended, look.trim);
    object.scale.setScalar(1.3);
    object.position.y = 0.62;

    // The plinth it stands on: a stone foot, a painted column, a wooden top edged in brass.
    const stone = new THREE.MeshStandardMaterial({ color: "#d9cfb8", roughness: 0.85 });
    const paint = new THREE.MeshStandardMaterial({ color: "#fbf3df", roughness: 0.6 });
    const wood = new THREE.MeshStandardMaterial({ color: "#8a5a3a", roughness: 0.55 });
    const brass = new THREE.MeshStandardMaterial({ color: "#d9ab35", roughness: 0.3, metalness: 0.65 });
    const piece = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = y;
      mesh.castShadow = mesh.receiveShadow = true;
      this.turntable.add(mesh);
    };
    piece(new THREE.CylinderGeometry(1.2, 1.28, 0.12, 64), stone, 0.06);
    piece(new THREE.CylinderGeometry(0.98, 1.08, 0.36, 64), paint, 0.3);
    piece(new THREE.CylinderGeometry(1.08, 1.02, 0.1, 64), wood, 0.53);
    piece(new THREE.TorusGeometry(1.07, 0.03, 10, 96).rotateX(Math.PI / 2), brass, 0.585);
    piece(new THREE.TorusGeometry(1.0, 0.02, 10, 96).rotateX(Math.PI / 2), brass, 0.13);
    this.turntable.add(object);
    this.turntable.position.y = -1.3;
    this.scene.add(this.turntable);

    // The gallery floor shows through from the page; this only catches the plinth's shadow.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.5, 48).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    floor.position.y = -1.3;
    floor.receiveShadow = true;
    this.scene.add(floor);

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
    this.rest = Math.max(0, this.rest - seconds);
    if (!this.calm && !this.drag && this.rest === 0) this.turntable.rotation.y += 0.35 * seconds;

    this.camera.position.set(0, Math.sin(this.tilt) * this.distance, Math.cos(this.tilt) * this.distance);
    this.camera.lookAt(0, -0.35, 0);
    this.renderer.render(this.scene, this.camera);
  };

  private readonly onDown = (event: PointerEvent) => {
    this.drag = { x: event.clientX, y: event.clientY };
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = "grabbing";
  };

  private readonly onMove = (event: PointerEvent) => {
    if (!this.drag) return;
    this.turntable.rotation.y += (event.clientX - this.drag.x) * 0.01;
    this.tilt = THREE.MathUtils.clamp(this.tilt + (event.clientY - this.drag.y) * 0.005, 0.05, 1.1);
    this.drag = { x: event.clientX, y: event.clientY };
  };

  private readonly onUp = () => {
    this.drag = null;
    this.rest = 2.5;
    this.renderer.domElement.style.cursor = "grab";
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 1 / 1.1 : 1.1);
  };

  /** Moves the camera closer (below one) or further away. */
  zoomBy(factor: number) {
    this.distance = THREE.MathUtils.clamp(this.distance * factor, 4, 10);
  }

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
        for (const material of materials) {
          (material as THREE.MeshBasicMaterial).map?.dispose();
          material.dispose();
        }
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}
