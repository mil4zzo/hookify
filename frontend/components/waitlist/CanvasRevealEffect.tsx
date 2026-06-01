"use client";

/**
 * Efeito de fundo "dot-matrix" animado via shader WebGL.
 *
 * Implementado em three.js PURO (sem @react-three/fiber) de propósito: o
 * react-reconciler que o fiber usa quebra no pipeline do Next 15 App Router
 * (erro "ReactCurrentOwner" — internals de React incompatíveis). O three não
 * depende de React, então um WebGLRenderer + loop de RAF renderiza o mesmo
 * shader sem tocar nos internals do React.
 *
 * Pesado (~three) — carregado exclusivamente na /waitlist-v2 via next/dynamic
 * com ssr:false. Só transform/opacity no GPU; respeita prefers-reduced-motion.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

const DEFAULT_OPACITIES = [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1];

function buildColorsArray(colors: number[][]): number[][] {
  let arr = [colors[0], colors[0], colors[0], colors[0], colors[0], colors[0]];
  if (colors.length === 2) {
    arr = [colors[0], colors[0], colors[0], colors[1], colors[1], colors[1]];
  } else if (colors.length === 3) {
    arr = [colors[0], colors[0], colors[1], colors[1], colors[2], colors[2]];
  }
  return arr.map((c) => [c[0] / 255, c[1] / 255, c[2] / 255]);
}

const VERTEX_SHADER = /* glsl */ `
precision mediump float;
uniform vec2 u_resolution;
out vec2 fragCoord;
void main() {
  gl_Position = vec4(position.x, position.y, 0.0, 1.0);
  fragCoord = (position.xy + vec2(1.0)) * 0.5 * u_resolution;
  fragCoord.y = u_resolution.y - fragCoord.y;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;
in vec2 fragCoord;

uniform float u_time;
uniform float u_opacities[10];
uniform vec3 u_colors[6];
uniform float u_total_size;
uniform float u_dot_size;
uniform vec2 u_resolution;
uniform int u_reverse;

out vec4 fragColor;

float PHI = 1.61803398874989484820459;
float random(vec2 xy) {
    return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
}

void main() {
    vec2 st = fragCoord.xy;
    st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
    st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

    float opacity = step(0.0, st.x);
    opacity *= step(0.0, st.y);

    vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

    float frequency = 5.0;
    float show_offset = random(st2);
    float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
    opacity *= u_opacities[int(rand * 10.0)];
    opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
    opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

    vec3 color = u_colors[int(show_offset * 6.0)];

    float animation_speed_factor = 0.5;
    vec2 center_grid = u_resolution / 2.0 / u_total_size;
    float dist_from_center = distance(center_grid, st2);

    float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);

    float max_grid_dist = distance(center_grid, vec2(0.0, 0.0));
    float timing_offset_outro = (max_grid_dist - dist_from_center) * 0.02 + (random(st2 + 42.0) * 0.2);

    float current_timing_offset;
    if (u_reverse == 1) {
        current_timing_offset = timing_offset_outro;
        opacity *= 1.0 - step(current_timing_offset, u_time * animation_speed_factor);
        opacity *= clamp((step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
    } else {
        current_timing_offset = timing_offset_intro;
        opacity *= step(current_timing_offset, u_time * animation_speed_factor);
        opacity *= clamp((1.0 - step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
    }

    fragColor = vec4(color, opacity);
    fragColor.rgb *= fragColor.a;
}
`;

export const CanvasRevealEffect = ({
  animationSpeed = 10,
  opacities = DEFAULT_OPACITIES,
  colors = [[0, 255, 255]],
  containerClassName,
  dotSize = 3,
  showGradient = true,
  reverse = false,
}: {
  animationSpeed?: number;
  opacities?: number[];
  colors?: number[][];
  containerClassName?: string;
  dotSize?: number;
  showGradient?: boolean;
  reverse?: boolean;
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (typeof window === "undefined" || !mount) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    } catch {
      // WebGL indisponível: deixa o fundo preto do container, sem quebrar a página.
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.Camera();

    const uniforms: Record<string, THREE.IUniform> = {
      u_time: { value: 0 },
      u_opacities: { value: opacities },
      u_colors: { value: buildColorsArray(colors).map((c) => new THREE.Vector3(c[0], c[1], c[2])) },
      u_total_size: { value: 20 },
      u_dot_size: { value: dotSize },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_reverse: { value: reverse ? 1 : 0 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    const resize = () => {
      const w = mount.clientWidth || window.innerWidth;
      const h = mount.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      // Acompanha a referência original (resolução em pixels físicos do buffer).
      uniforms.u_resolution.value.set(w * dpr, h * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const start = performance.now();
    let raf = 0;
    const animationSpeedFactor = Math.max(0.1, animationSpeed) / 10;

    const render = () => {
      uniforms.u_time.value = ((performance.now() - start) / 1000) * animationSpeedFactor;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };

    if (reduceMotion) {
      // Sem animação: renderiza um frame "estabilizado".
      uniforms.u_time.value = 1000;
      renderer.render(scene, camera);
    } else {
      raf = requestAnimationFrame(render);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // Recriar todo o cenário quando qualquer parâmetro visual muda é o comportamento desejado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reverse, dotSize, animationSpeed]);

  return (
    <div className={`h-full relative w-full ${containerClassName ?? ""}`}>
      <div ref={mountRef} className="absolute inset-0 h-full w-full" />
      {showGradient && (
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
      )}
    </div>
  );
};

export default CanvasRevealEffect;
