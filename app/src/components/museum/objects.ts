/**
 * The stand-in objects: what stands on a plinth for a campaign, since campaigns carry no
 * pictures. Shared by the museum floor and by the close look at one exhibit.
 */
import * as THREE from "three";

import type { Kind } from "@/lib/museum/plan";
import type { Status } from "@/lib/tanda-jadi";

/** A colour for each kind of object, so a room of exhibits is not a room of one colour. */
const TINTS: Record<Kind, string> = {
  screen: "#3fa7d6",
  orb: "#f25f5c",
  tower: "#ffb347",
  ring: "#9b5de5",
  arch: "#2ec4b6",
  prism: "#ff7f50",
  stack: "#f7b801",
  knot: "#e56b9b",
};

/**
 * What an exhibit's object is made of. Its colour comes from its kind; a campaign that ended
 * unmade loses the colour, and one still looking for backers glows a little.
 */
export function standInMaterial(status: Status, kind: Kind): THREE.MeshStandardMaterial {
  const tint = TINTS[kind];
  switch (status) {
    case "funding":
      return new THREE.MeshStandardMaterial({ color: tint, roughness: 0.4, emissive: tint, emissiveIntensity: 0.22 });
    case "building":
      return new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5, metalness: 0.2, emissive: tint, emissiveIntensity: 0.05 });
    case "completed":
      return new THREE.MeshStandardMaterial({ color: tint, roughness: 0.25, metalness: 0.15, emissive: tint, emissiveIntensity: 0.1 });
    default:
      return new THREE.MeshStandardMaterial({ color: "#a39e93", roughness: 0.95, emissive: "#f0efe7", emissiveIntensity: 0 });
  }
}

/**
 * The object itself, about a metre tall, standing on the floor of its group. `keep` is handed
 * every geometry made, so the caller can dispose of them later.
 */
export function standIn(
  kind: Kind,
  material: THREE.Material,
  keep: <T extends THREE.BufferGeometry>(geometry: T) => T = (geometry) => geometry,
): THREE.Group {
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(keep(geometry), material);
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
