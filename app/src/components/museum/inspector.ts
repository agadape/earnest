/**
 * One exhibit seen up close: its object alone on a turntable, lit from above, against the dark.
 * Drag turns it, the wheel moves closer or further. Nothing here knows what the campaign is
 * beyond which object stands for it and which state it is in.
 */
import * as THREE from "three";

import { standIn, standInMaterial } from "@/components/museum/objects";
import type { Kind } from "@/lib/museum/plan";
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
  private distance = 6;
  private tilt = 0.32;
  private drag: { x: number; y: number } | null = null;
  // After a drag the object rests for a moment before it starts turning by itself again.
  private rest = 0;

  constructor(
    private readonly host: HTMLElement,
    kind: Kind,
    status: Status,
    private readonly calm: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.style.cursor = "grab";
    host.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(PAPER, "#1b1d1b", 0.9));
    const lamp = new THREE.SpotLight("#fff3da", 60, 14, 0.5, 0.6, 1.4);
    lamp.position.set(-1.6, 5.5, 2.6);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    this.scene.add(lamp, lamp.target);
    const rim = new THREE.DirectionalLight(status === "funding" ? LIME : PAPER, 0.9);
    rim.position.set(3, 1.5, -3);
    this.scene.add(rim);

    const object = standIn(kind, standInMaterial(status));
    object.scale.setScalar(1.3);
    object.position.y = 0.2;
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.15, 0.2, 64),
      new THREE.MeshStandardMaterial({ color: "#2b2d2a", roughness: 0.6, metalness: 0.35 }),
    );
    plate.position.y = 0.1;
    plate.receiveShadow = true;
    const edge = new THREE.Mesh(
      new THREE.TorusGeometry(1.06, 0.012, 8, 96).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: LIME }),
    );
    edge.position.y = 0.2;
    this.turntable.add(plate, edge, object);
    this.turntable.position.y = -0.85;
    this.scene.add(this.turntable);

    // A faint disc of light on the dark under the turntable.
    const pool = document.createElement("canvas");
    pool.width = pool.height = 128;
    const context = pool.getContext("2d") as CanvasRenderingContext2D;
    const fade = context.createRadialGradient(64, 64, 6, 64, 64, 64);
    fade.addColorStop(0, "rgba(240,239,231,0.5)");
    fade.addColorStop(1, "rgba(240,239,231,0)");
    context.fillStyle = fade;
    context.fillRect(0, 0, 128, 128);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(pool),
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    glow.position.y = -0.86;
    this.scene.add(glow);

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
    this.camera.lookAt(0, -0.05, 0);
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
    this.distance = THREE.MathUtils.clamp(this.distance * factor, 3.2, 8.5);
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
    el.remove();
  }
}
