/**
 * The stand-in objects: what stands on a plinth for a campaign, since campaigns carry no
 * pictures. Shared by the museum floor and by the close look at one exhibit.
 *
 * Each is a small model rather than one plain shape: a body in the campaign's own colour, pale
 * parts, and brass fittings. The pale and the brass of one object are each a single mesh, so a
 * room full of them costs three draws an exhibit and not a dozen.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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

// The fittings every object shares. Made once; disposing of them only frees what the graphics
// card holds, and they are sent again the next time they are drawn.
const PALE = new THREE.MeshStandardMaterial({ color: "#fbf3df", roughness: 0.55 });
const BRASS = new THREE.MeshStandardMaterial({ color: "#d9ab35", roughness: 0.3, metalness: 0.65 });
const PALE_ENDED = new THREE.MeshStandardMaterial({ color: "#cfc9bb", roughness: 0.9 });
const BRASS_ENDED = new THREE.MeshStandardMaterial({ color: "#8f8a7c", roughness: 0.8, metalness: 0.2 });

/**
 * What an exhibit's object is made of. Its colour comes from its kind; a campaign that ended
 * unmade loses the colour, and one still looking for backers glows a little.
 */
export function standInMaterial(status: Status, kind: Kind): THREE.MeshStandardMaterial {
  const tint = TINTS[kind];
  switch (status) {
    case "funding":
      return new THREE.MeshStandardMaterial({ color: tint, roughness: 0.35, emissive: tint, emissiveIntensity: 0.22 });
    case "building":
      return new THREE.MeshStandardMaterial({ color: tint, roughness: 0.45, metalness: 0.2, emissive: tint, emissiveIntensity: 0.05 });
    case "completed":
      return new THREE.MeshStandardMaterial({ color: tint, roughness: 0.2, metalness: 0.15, emissive: tint, emissiveIntensity: 0.1 });
    default:
      return new THREE.MeshStandardMaterial({ color: "#a39e93", roughness: 0.95, emissive: "#f0efe7", emissiveIntensity: 0 });
  }
}

type Part = THREE.BufferGeometry;
const at = (geometry: Part, x: number, y: number, z = 0): Part => geometry.translate(x, y, z);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const drum = (top: number, bottom: number, h: number, sides = 32) => new THREE.CylinderGeometry(top, bottom, h, sides);
const ball = (radius: number) => new THREE.SphereGeometry(radius, 28, 20);
const hoop = (radius: number, tube: number) => new THREE.TorusGeometry(radius, tube, 14, 48);

/** The parts of each object: its coloured body, its pale parts and its brass. */
function parts(kind: Kind): { body: Part[]; pale: Part[]; brass: Part[] } {
  switch (kind) {
    case "screen":
      // A monitor on a stand, with a keyboard in front of it.
      return {
        body: [at(box(0.96, 0.62, 0.08).rotateX(-0.14), 0, 0.64, 0), at(drum(0.05, 0.07, 0.3, 16), 0, 0.2, -0.02)],
        pale: [at(box(0.82, 0.48, 0.02).rotateX(-0.14), 0, 0.645, 0.048), at(box(0.62, 0.035, 0.2), 0, 0.02, 0.3)],
        brass: [at(drum(0.24, 0.27, 0.05), 0, 0.025, -0.02), at(box(0.3, 0.02, 0.02).rotateX(-0.14), 0, 0.39, 0.085)],
      };
    case "orb":
      // A globe in a brass cradle.
      return {
        body: [at(ball(0.4), 0, 0.6, 0)],
        pale: [at(drum(0.2, 0.3, 0.12), 0, 0.06, 0), at(ball(0.07), 0, 1.03, 0)],
        brass: [at(hoop(0.46, 0.03).rotateX(Math.PI / 2 - 0.4), 0, 0.6, 0), at(drum(0.05, 0.07, 0.16, 16), 0, 0.18, 0)],
      };
    case "tower":
      // Three tiers with a band round each and a finial on top.
      return {
        body: [at(drum(0.36, 0.4, 0.28, 8), 0, 0.16, 0), at(drum(0.25, 0.29, 0.28, 8), 0, 0.47, 0), at(drum(0.13, 0.18, 0.3, 8), 0, 0.79, 0)],
        pale: [at(drum(0.44, 0.46, 0.04), 0, 0.02, 0), at(ball(0.07), 0, 1.02, 0)],
        brass: [at(drum(0.31, 0.31, 0.04), 0, 0.315, 0), at(drum(0.2, 0.2, 0.04), 0, 0.625, 0), at(drum(0.03, 0.03, 0.1, 12), 0, 0.96, 0)],
      };
    case "ring":
      // A hoop held upright on a post, with a smaller one inside it.
      return {
        body: [at(hoop(0.36, 0.1), 0, 0.62, 0)],
        pale: [at(drum(0.24, 0.3, 0.1), 0, 0.05, 0)],
        brass: [at(hoop(0.17, 0.035).rotateY(Math.PI / 2), 0, 0.62, 0), at(drum(0.045, 0.06, 0.16, 16), 0, 0.17, 0)],
      };
    case "arch":
      // Two pillars on footings, a lintel, and a keystone.
      return {
        body: [at(box(0.17, 0.74, 0.24), -0.3, 0.45, 0), at(box(0.17, 0.74, 0.24), 0.3, 0.45, 0), at(box(0.9, 0.16, 0.28), 0, 0.9, 0)],
        pale: [at(box(0.27, 0.08, 0.34), -0.3, 0.04, 0), at(box(0.27, 0.08, 0.34), 0.3, 0.04, 0), at(box(0.98, 0.05, 0.34), 0, 1.005, 0)],
        brass: [at(box(0.16, 0.2, 0.3), 0, 0.9, 0), at(box(0.21, 0.04, 0.28), -0.3, 0.8, 0), at(box(0.21, 0.04, 0.28), 0.3, 0.8, 0)],
      };
    case "prism":
      // A pyramid on a slab, capped in brass.
      return {
        body: [at(new THREE.ConeGeometry(0.44, 0.74, 4).rotateY(Math.PI / 4), 0, 0.47, 0)],
        pale: [at(box(0.74, 0.1, 0.74), 0, 0.05, 0)],
        brass: [at(new THREE.ConeGeometry(0.13, 0.22, 4).rotateY(Math.PI / 4), 0, 0.86, 0), at(box(0.66, 0.03, 0.66), 0, 0.115, 0)],
      };
    case "stack":
      // Three boxes, each turned a little, with a plate between them.
      return {
        body: [at(box(0.62, 0.24, 0.62), 0, 0.14, 0), at(box(0.48, 0.24, 0.48).rotateY(0.5), 0.04, 0.43, 0), at(box(0.34, 0.24, 0.34).rotateY(1.1), -0.02, 0.72, 0)],
        pale: [at(box(0.7, 0.03, 0.7), 0, 0.015, 0), at(ball(0.08), -0.02, 0.92, 0)],
        brass: [at(box(0.54, 0.03, 0.54).rotateY(0.5), 0.04, 0.285, 0), at(box(0.4, 0.03, 0.4).rotateY(1.1), -0.02, 0.575, 0)],
      };
    case "knot":
      // A knot floating over a post.
      return {
        body: [at(new THREE.TorusKnotGeometry(0.25, 0.085, 96, 14), 0, 0.64, 0)],
        pale: [at(drum(0.22, 0.3, 0.1), 0, 0.05, 0)],
        brass: [at(drum(0.04, 0.06, 0.2, 16), 0, 0.2, 0), at(ball(0.055), 0, 0.31, 0)],
      };
  }
}

/**
 * The object itself, about a metre tall, standing on the floor of its group. `keep` is handed
 * every geometry made, so the caller can dispose of them later. The first mesh in the group is
 * the body, made of `material`; the others are fittings.
 */
export function standIn(
  kind: Kind,
  material: THREE.Material,
  keep: <T extends THREE.BufferGeometry>(geometry: T) => T = (geometry) => geometry,
  /** Whether the campaign ended unmade: its fittings lose their shine along with its colour. */
  ended = false,
): THREE.Group {
  const group = new THREE.Group();
  const { body, pale, brass } = parts(kind);
  const layers: [Part[], THREE.Material][] = [
    [body, material],
    [pale, ended ? PALE_ENDED : PALE],
    [brass, ended ? BRASS_ENDED : BRASS],
  ];
  for (const [pieces, made] of layers) {
    // Welded shapes have to agree on whether they share corners; these do not all.
    const welded = mergeGeometries(pieces.map((piece) => (piece.index ? piece.toNonIndexed() : piece)));
    for (const piece of pieces) piece.dispose();
    const mesh = new THREE.Mesh(keep(welded), made);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}
