/**
 * The little people of the museum: the visitor, the other visitors, and the wallets that came
 * before. Each is a shirt in its own colour over legs, a head and hair that are one mesh, with
 * a soft shadow under the feet, since nothing that moves casts a real one. Three draws a person.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { NO_INK } from "@/components/museum/outline";
import { toonMaterial } from "@/components/museum/toon";

const SKINS = ["#f1c9a5", "#d9a37a", "#b97a56", "#8d5a3b"];
const HAIRS = ["#2b211b", "#5a3a26", "#c9a24a", "#8f8a7c"];
const TROUSERS = "#3b3f4a";

/** Paints a whole shape one colour, so shapes of different colours can be welded into one mesh. */
function painted(geometry: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const { r, g, b } = new THREE.Color(color);
  const count = flat.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) colors.set([r, g, b], index * 3);
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}

// Everything but the shirt, by which of the skins and hairs it has. Made on first use and kept.
const rests = new Map<number, THREE.BufferGeometry>();
function rest(variant: number): THREE.BufferGeometry {
  const key = variant % (SKINS.length * HAIRS.length);
  let geometry = rests.get(key);
  if (!geometry) {
    const skin = SKINS[key % SKINS.length];
    const hair = HAIRS[Math.floor(key / SKINS.length)];
    geometry = mergeGeometries([
      painted(new THREE.CylinderGeometry(0.11, 0.12, 0.26, 10).translate(0, 0.13, 0), TROUSERS),
      painted(new THREE.SphereGeometry(0.125, 14, 10).translate(0, 0.68, 0), skin),
      // Hair is a cap over the top and back of the head.
      painted(new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.1).translate(0, 0.695, -0.012), hair),
      painted(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 6).translate(-0.17, 0.4, 0), skin),
      painted(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 6).translate(0.17, 0.4, 0), skin),
    ]);
    rests.set(key, geometry);
  }
  return geometry;
}

let shirt: THREE.BufferGeometry | null = null;
let blob: THREE.BufferGeometry | null = null;
let bodyPaint: THREE.MeshToonMaterial | null = null;
let shade: THREE.MeshBasicMaterial | null = null;

/**
 * One person, standing on the floor of the group returned. Its first child is the part that
 * bobs when it walks; the shadow stays on the ground. `cloth` is the shirt, and is the caller's
 * to recolour and to dispose of.
 */
export function person(cloth: THREE.Material, variant: number, size = 1): THREE.Group {
  shirt ??= new THREE.CylinderGeometry(0.135, 0.165, 0.32, 12).translate(0, 0.41, 0);
  blob ??= new THREE.CircleGeometry(0.26, 20).rotateX(-Math.PI / 2);
  bodyPaint ??= toonMaterial({ vertexColors: true });
  shade ??= new THREE.MeshBasicMaterial({ color: "#1c140c", transparent: true, opacity: 0.28, depthWrite: false });

  const puppet = new THREE.Group();
  puppet.add(new THREE.Mesh(shirt, cloth), new THREE.Mesh(rest(variant), bodyPaint));
  puppet.scale.setScalar(size);
  const shadow = new THREE.Mesh(blob, shade);
  shadow.position.y = 0.075;
  shadow.layers.enable(NO_INK);
  shadow.scale.setScalar(size);
  const group = new THREE.Group();
  group.add(puppet, shadow);
  return group;
}
