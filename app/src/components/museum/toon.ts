/**
 * Toon shading: light falls in three flat bands instead of a smooth slope, which is what makes
 * the museum read as drawn and not rendered. One place turns the ordinary materials into toon
 * ones, so nothing has to be converted by hand.
 */
import * as THREE from "three";

import { VISUAL } from "@/components/museum/visual-config";

let ramp: THREE.DataTexture | null = null;

/** The three bands, as a picture three pixels wide that is never smoothed. */
export function toonRamp(): THREE.DataTexture {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array(VISUAL.toonBands), VISUAL.toonBands.length, 1, THREE.RedFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;
  }
  return ramp;
}

/** A toon material from scratch. */
export function toonMaterial(parameters: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...parameters });
}

/**
 * The toon twin of a material: same colour, picture, glow, see-through and cutting planes.
 * Materials that are not lit (flat colours, lines, shadows) are handed back as they are.
 */
function twin(source: THREE.Material): THREE.Material {
  if (!(source instanceof THREE.MeshStandardMaterial)) return source;
  const made = toonMaterial({
    color: source.color,
    map: source.map,
    emissive: source.emissive,
    emissiveIntensity: source.emissiveIntensity,
    transparent: source.transparent,
    opacity: source.opacity,
    depthWrite: source.depthWrite,
    side: source.side,
    vertexColors: source.vertexColors,
  });
  made.clippingPlanes = source.clippingPlanes;
  return made;
}

/**
 * Gives everything under `root` its toon twin. `twins` remembers which material became which,
 * so a material shared by many meshes is converted once and stays shared.
 */
export function toonify(root: THREE.Object3D, twins: Map<THREE.Material, THREE.Material>) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) return;
    const source = child.material as THREE.Material;
    let made = twins.get(source);
    if (!made) {
      made = twin(source);
      twins.set(source, made);
    }
    child.material = made;
  });
}
