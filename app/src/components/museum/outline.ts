/**
 * The ink line: a pass over the finished picture that draws a dark, warm line wherever depth
 * jumps or a surface turns sharply, so every shape has an outline and the big folds in it are
 * drawn too. It looks at where things are and which way they face, not at their colours, so the
 * pattern of a tiled floor or the edge of a carpet draws no line.
 *
 * Things on layer 1 are left out of it: glass, drawings of what is not printed yet, light and
 * confetti. They are still drawn; they just get no line.
 */
import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";

import { VISUAL } from "@/components/museum/visual-config";

/** The layer for things that are drawn but not outlined. */
export const NO_INK = 1;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;
  uniform vec2 reach;
  uniform vec3 ink;
  uniform float strength;
  uniform float depthEdge;
  uniform float normalEdge;
  varying vec2 vUv;

  float depthAt(vec2 offset) {
    return texture2D(tDepth, vUv + offset * reach).x;
  }
  vec3 normalAt(vec2 offset) {
    return texture2D(tNormal, vUv + offset * reach).xyz;
  }

  void main() {
    vec4 colour = texture2D(tDiffuse, vUv);

    // Depth: how far the middle is from the average of its neighbours either side. A slope
    // has none of that; a step from one thing to the thing behind it has a lot.
    float here = depthAt(vec2(0.0));
    float bend =
      abs(depthAt(vec2(1.0, 0.0)) + depthAt(vec2(-1.0, 0.0)) - 2.0 * here) +
      abs(depthAt(vec2(0.0, 1.0)) + depthAt(vec2(0.0, -1.0)) - 2.0 * here);

    // Facing: how much the surface turns between here and next door.
    vec3 facing = normalAt(vec2(0.0));
    float turn =
      distance(normalAt(vec2(1.0, 0.0)), facing) +
      distance(normalAt(vec2(-1.0, 0.0)), facing) +
      distance(normalAt(vec2(0.0, 1.0)), facing) +
      distance(normalAt(vec2(0.0, -1.0)), facing);

    float edge = max(
      smoothstep(depthEdge, depthEdge * 2.5, bend),
      smoothstep(normalEdge, normalEdge * 1.8, turn)
    );
    gl_FragColor = vec4(mix(colour.rgb, ink, edge * strength), colour.a);
  }
`;

export class InkPass extends Pass {
  private readonly facing = new THREE.MeshNormalMaterial();
  private readonly seen: THREE.WebGLRenderTarget;
  private readonly quad: FullScreenQuad;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly was = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    width: number,
    height: number,
    private ratio: number,
  ) {
    super();
    this.seen = new THREE.WebGLRenderTarget(width * ratio, height * ratio, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.seen.depthTexture = new THREE.DepthTexture(width * ratio, height * ratio);
    this.uniforms = {
      tDiffuse: { value: null },
      tNormal: { value: this.seen.texture },
      tDepth: { value: this.seen.depthTexture },
      reach: { value: new THREE.Vector2() },
      ink: { value: new THREE.Color(VISUAL.ink) },
      strength: { value: VISUAL.inkStrength },
      depthEdge: { value: VISUAL.inkDepthEdge },
      normalEdge: { value: VISUAL.inkNormalEdge },
    };
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT }),
    );
    this.setSize(width, height);
  }

  setSize(width: number, height: number) {
    this.seen.setSize(width * this.ratio, height * this.ratio);
    // The line is as wide on a sharp screen as on a plain one.
    (this.uniforms.reach.value as THREE.Vector2).set(VISUAL.inkWidth / width, VISUAL.inkWidth / height);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    // First, the scene again as where things are and which way they face, without the things
    // that are not to be outlined.
    const layers = this.camera.layers.mask;
    const background = this.scene.background;
    const override = this.scene.overrideMaterial;
    renderer.getClearColor(this.was);
    const alpha = renderer.getClearAlpha();

    this.camera.layers.set(0);
    this.scene.background = null;
    this.scene.overrideMaterial = this.facing;
    renderer.setRenderTarget(this.seen);
    renderer.setClearColor(0x8080ff, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    this.camera.layers.mask = layers;
    this.scene.background = background;
    this.scene.overrideMaterial = override;
    renderer.setClearColor(this.was, alpha);

    // Then the picture, with the line drawn over it.
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.seen.dispose();
    this.facing.dispose();
    this.quad.dispose();
  }
}
