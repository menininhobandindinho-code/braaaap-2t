// Modo 3D do Braaaap 2T: o mesmo jogo (pista, física, rivais e HUD do index.html) desenhado em 3D,
// com acabamento de pixel art na tela: resolução baixa, paleta fixa com pontilhado e contorno escuro.
//
// Mundo: 1 unidade = 1 texel do mapa de 1024×1024. No three.js, X = x do jogo, Y = altura, Z = y do jogo.
// O piloto vem de modelos/piloto.glb (ferramentas/blender/modelo3d.py), com as peças separadas para animar.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as clonarComEsqueleto } from 'three/addons/utils/SkeletonUtils.js';

const ESCALA_PILOTO = 3.5;                 // modelo em metros (1,9 m) → 6,6 unidades, a altura do sprite no 2D
const K_JOGO = 3.5;                       // unidades do jogo por metro (index.html)
const RES_W = 640, RES_H = 360;           // resolução do quadro antes de ampliar (escolhida pelo humano: "alta")
// câmera fixa, que não gira: olha sempre na mesma direção do chão, do alto e na diagonal
export const ANGULO_TELA = -Math.PI * 0.75;   // direção do jogo que aparece "para cima" na tela
const CAM_ELEV = 0.8, CAM_FOV = 26;
// distância da câmera fixa: mais perto que antes para as posições do piloto aparecerem; + e − ajustam (fica salvo)
const ZOOM_MIN = 28, ZOOM_MAX = 80;
let camDist = 44;
try { const z = +localStorage.getItem('braaaap-zoom'); if (z >= ZOOM_MIN && z <= ZOOM_MAX) camDist = z; } catch (e) {}
const PERTO = typeof location !== 'undefined' && /perto/.test(location.search);
// câmeras de inspeção (revisão das poses do rig): ?cam=tras segue atrás da moto, ?cam=lado acompanha de lado
// câmera padrão (pedido do humano em 28/09): 'diagonal', afastada, atrás e meio de lado, olhando de cima, como em
// Lonely Mountains: Downhill. As outras ficam no ciclo do Select/Share (ou tecla C), e a escolha fica salva.
const CAMERAS = ['diagonal', 'fixa', 'lado', 'tras'];
let CAM_INSP = typeof location !== 'undefined' ? (location.search.match(/cam=(tras|lado|fixa|diagonal)/) || [])[1] : undefined;
if (!CAM_INSP) { try { CAM_INSP = localStorage.getItem('braaaap-camera') || undefined; } catch (e) {} }
if (!CAMERAS.includes(CAM_INSP)) CAM_INSP = 'diagonal';
// tecla C ou Select/Share do controle: alterna câmera do jogo → de lado (estilo replay, para ver o piloto) → de trás
const trocaCamera = () => {
  CAM_INSP = CAMERAS[(CAMERAS.indexOf(CAM_INSP) + 1) % CAMERAS.length];
  try { localStorage.setItem('braaaap-camera', CAM_INSP); } catch (e) {}
  return CAM_INSP;
};
if (typeof addEventListener !== 'undefined') addEventListener('keydown', ev => {
  if (ev.code !== 'KeyC' || ev.repeat) return;
  trocaCamera();
});

// paleta do acabamento (sRGB): fim de tarde, terra vermelha, caatinga seca e as cores da ficha
const PALETA = [
  '#1a0e10', '#2a2440', '#3a3460', '#5a4470', '#8e6680', '#6a4a5a', '#b86c78', '#d88870', '#e8a070', '#f0b878', '#f8d8a0', '#fff0c0',
  '#3c1c12', '#5c2818', '#7a3a20', '#9a4a26', '#b85c30', '#d0743c', '#e0905a', '#c89878',
  '#2c3418', '#445020', '#5e6a2c', '#7e7e3c', '#a89858', '#c8b476',
  '#d82830', '#8c1820', '#2c4cc0', '#182a74', '#f0f0f0', '#141018', '#8a8e98', '#3a3a44', '#e8b020', '#d87028',
  '#2c9c40', '#1c6030', '#30a0c0', '#1c5a78', '#c09030',
];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const srgb = h => new THREE.Color(h);    // THREE.Color guarda em linear; o hex é lido como sRGB

// ------------------------------------------------------------------ chão com granulado de pixel
function comGranulado(mat) {
  mat.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMundo;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMundo;\nfloat h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
      .replace('#include <map_fragment>', '#include <map_fragment>\n{ float n = h21(floor(vMundo.xz * 3.0)), m = h21(floor(vMundo.xz * 0.7) + 7.0); diffuseColor.rgb *= 0.84 + 0.22 * n + 0.1 * m; }');
  };
  return mat;
}

// mapa do chão do 3D: 2 texels por unidade, trilha de barro com sulcos, beira de terra solta e caatinga seca.
// Sem sombreado pintado (a luz do 3D faz isso) e sem faixa de giz.
function montarMapa(M) {
  const { TEX, HW, dist, nIdx, cx, cy, tx, ty, N, curv, wrap } = M;
  const R = 2, T = TEX * R, px = new Uint8Array(T * T * 4);
  const C = {
    barroE: [132, 56, 28], barroC: [188, 94, 46], poeira: [206, 140, 92], sulco: [66, 26, 16], lábio: [178, 110, 68],
    solta: [176, 118, 74], palha: [184, 168, 100], oliva: [100, 112, 50], tufo: [58, 72, 32], terra: [156, 80, 42],
    pedra: [156, 144, 126], pedraE: [78, 68, 60], giz: [226, 218, 200], preto: [30, 24, 26],
  };
  const SULCOS = [-9, -5.5, -2, 1.5, 5, 8.5];
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let Y = 0; Y < T; Y++) for (let X = 0; X < T; X++) {
    const x = (X + 0.5) / R, y = (Y + 0.5) / R, o1 = (Y >> 1) * TEX + (X >> 1), d0 = dist[o1], h = hash(X, Y);
    let c, lat = 1e3, along = 0, i = 0;
    if (d0 < HW + 30) { i = nIdx[o1]; const dx = x - cx[i], dy = y - cy[i]; lat = dx * -ty[i] + dy * tx[i]; along = i + dx * tx[i] + dy * ty[i]; }
    const e = lat < 1e3 ? Math.abs(lat) - HW + (vnoise(x / 5 + 31, y / 5) - 0.5) * 3.4 : 99;   // borda irregular, sem degrau
    if (e < 0) {
      c = mixc(C.barroE, C.barroC, vnoise(x / 18, y / 18) * 0.75 + h * 0.25);
      if (vnoise(x / 40 + 5, y / 40) > 0.6) c = mixc(c, C.poeira, 0.35);
      for (const s0 of SULCOS) {
        const sl = s0 + Math.sin(along * 0.045 + s0) * 1.3, dd = lat - sl;
        if (Math.abs(dd) < 0.45) c = mixc(c, C.sulco, 0.75); else if (dd > 0 && dd < 0.95) c = mixc(c, C.lábio, 0.35);
      }
      if (Math.abs(curv[wrap(i + 14)]) > 0.008 && Math.sin(along * 1.6) > 0.55) c = mixc(c, C.sulco, 0.28);   // costeletas de frenagem antes da curva
      if (h > 0.992) c = C.pedra; else if (h < 0.004) c = C.pedraE;
      if (i < 8 || i > N - 2) c = ((Math.floor(lat / 4) + Math.floor(along / 4)) & 1) ? C.giz : C.preto;     // largada
    } else if (e < 3.5) {
      c = mixc(C.solta, C.palha, e / 3.5 + (h - 0.5) * 0.4);
      if (h > 0.96) c = C.barroE;
    } else {
      c = mixc(C.oliva, C.palha, vnoise(x / 40 + 50, y / 40) * 0.9 + h * 0.1);
      if (vnoise(x / 26 + 9, y / 26 + 3) > 0.7) c = mixc(c, C.terra, 0.6);
      if (h > 0.9) c = C.tufo; else if (h < 0.03) c = mixc(c, C.tufo, 0.5);
      if (h > 0.996) c = C.pedra;
    }
    const o = (Y * T + X) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(px, T, T, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}

function montarChao(M, texMapa) {
  const { TEX, HW, dist } = M;
  const morro = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const d = ix >= 0 && iz >= 0 && ix < TEX && iz < TEX ? Math.min(dist[iz * TEX + ix], 1e3) : 1e3;
    return smooth(HW + 25, HW + 150, d) * ((vnoise(x / 90, z / 90) * 0.7 + vnoise(x / 30 + 9, z / 30) * 0.3) * 22 - 5);
  };
  const mat = comGranulado(new THREE.MeshLambertMaterial({ map: texMapa }));
  const plano = new THREE.PlaneGeometry(1800, 1800, 225, 225);
  plano.rotateX(-Math.PI / 2);
  const p = plano.attributes.position, uv = plano.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + 512, z = p.getZ(i) + 512;
    p.setXYZ(i, x, morro(x, z), z);
    uv.setXY(i, x / TEX, z / TEX);
  }
  plano.computeVertexNormals();
  const chao = new THREE.Mesh(plano, mat);
  chao.receiveShadow = true;

  // faixa da pista seguindo o eixo: o relevo exato da física (rampas, mesas e costelas)
  const { N, cx, cy, tx, ty, hgt } = M;
  // beira em talude (M.beira, a mesma da física): pontos mais juntos perto da pista, até onde o talude mais largo acaba
  const fora = [2, 4, 6, 8, 10, 12, 14, M.TALUDE_MAX];
  const lats = fora.map(d => -(HW + d)).reverse(); lats.push(-HW);
  for (let l = -HW + 4; l < HW; l += 4) lats.push(l);
  lats.push(HW); for (const d of fora) lats.push(HW + d);
  const C = lats.length, pos = new Float32Array((N + 1) * C * 3), uvs = new Float32Array((N + 1) * C * 2), idx = [];
  for (let s = 0; s <= N; s++) {
    const i = s % N, nx = -ty[i], ny = tx[i], h = hgt[i];
    for (let c = 0; c < C; c++) {
      const l = lats[c], a = Math.abs(l), x = cx[i] + nx * l, z = cy[i] + ny * l;
      const y = M.beira(h, a);
      const o = s * C + c;
      pos.set([x, y + 0.03, z], o * 3); uvs.set([x / TEX, z / TEX], o * 2);
      if (s < N && c < C - 1) { const a0 = o, b0 = o + 1, a1 = o + C, b1 = o + C + 1; idx.push(a0, a1, b0, b0, a1, b1); }
    }
  }
  const fita = new THREE.BufferGeometry();
  fita.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  fita.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  fita.setIndex(idx);
  fita.computeVertexNormals();
  const pista = new THREE.Mesh(fita, mat);
  pista.receiveShadow = true;
  return { chao, pista, morro, mat };
}

// ------------------------------------------------------------------ objetos da beira (instanciados)
function montarObjetos(M, morro, toon) {
  const tipos = {
    tree: [
      [new THREE.CylinderGeometry(0.35, 0.6, 7, 5).translate(0, 3.5, 0), '#5c3a24'],
      [new THREE.IcosahedronGeometry(1, 0).scale(7, 2.6, 7).translate(0, 8.5, 0), '#5e6a2c'],
      [new THREE.IcosahedronGeometry(1, 0).scale(4.5, 2, 4.5).translate(1.5, 10.3, -1), '#7e7e3c'],
    ],
    bush: [[new THREE.IcosahedronGeometry(1, 0).scale(2.4, 1.5, 2.4).translate(0, 1, 0), '#445020']],
    tire: [[new THREE.TorusGeometry(1.1, 0.45, 5, 10).rotateX(Math.PI / 2).translate(0, 0.45, 0), '#1c1a1e']],
    hay: [[new THREE.BoxGeometry(3.2, 2, 2).translate(0, 1, 0), '#c8b476']],
  };
  const grupo = new THREE.Group(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  for (const [tipo, partes] of Object.entries(tipos)) {
    const lista = M.objs.filter(o => o.type === tipo);
    if (!lista.length) continue;
    for (const [geo, cor] of partes) {
      const im = new THREE.InstancedMesh(geo, toon(cor), lista.length);
      lista.forEach((o, k) => {
        const r = hash(k * 7 + 1, o.x | 0), esc = tipo === 'tree' ? 0.75 + r * 0.6 : tipo === 'bush' ? 0.7 + r * 0.7 : 1;
        q.setFromEuler(e.set(0, r * 6.283, 0)); v.set(o.x, morro(o.x, o.y), o.y); s.set(esc, esc, esc);
        im.setMatrixAt(k, m4.compose(v, q, s));
      });
      im.castShadow = true; im.receiveShadow = tipo !== 'tree';
      grupo.add(im);
    }
  }
  return grupo;
}

// ------------------------------------------------------------------ sertão: capim, pedras, mandacarus e cerca de arame
function montarSertao(M, morro, toon) {
  const { TEX, HW, dist, N, cx, cy, tx, ty } = M;
  const grupo = new THREE.Group(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const d = (x, y) => { const ix = x | 0, iy = y | 0; return ix >= 0 && iy >= 0 && ix < TEX && iy < TEX ? dist[iy * TEX + ix] : 1e3; };
  let semente = 7;
  const rnd = () => ((semente = Math.imul(semente ^ (semente >>> 15), 2246822507) + 0x9E3779B9 | 0) >>> 0) / 4294967296;
  const instancias = (geo, mat, lista, cores) => {
    const im = new THREE.InstancedMesh(geo, mat, lista.length);
    lista.forEach((t, k) => { im.setMatrixAt(k, m4.compose(v.set(t.x, t.y, t.z), q.setFromEuler(e.set(t.rx || 0, t.ry || 0, 0)), s.set(t.sx, t.sy, t.sz))); if (cores) im.setColorAt(k, cores[k]); });
    im.castShadow = true; im.receiveShadow = true;
    grupo.add(im);
    return im;
  };
  // capim em touceiras, mais denso colado na pista
  const capim = [], coresCapim = [], tons = ['#a89a58', '#6e7434', '#4e5a28', '#c0ae6c'].map(h => new THREE.Color(h));
  for (let k = 0; k < 3500; k++) {
    const i = (rnd() * N) | 0, lado = rnd() < 0.5 ? -1 : 1, lat = lado * (HW + 1.2 + rnd() ** 2 * 16);
    const x = cx[i] - ty[i] * lat, y = cy[i] + tx[i] * lat;
    if (d(x, y) < HW + 1 || i < 12 || i > N - 6) continue;
    const a = 0.6 + rnd() * 0.7;
    capim.push({ x, y: morro(x, y), z: y, ry: rnd() * 6.3, sx: a, sy: a * (0.7 + rnd() * 0.6), sz: a });
    coresCapim.push(tons[(rnd() * tons.length) | 0]);
  }
  // touceira: cinco folhas finas abertas em leque
  const folha = (ang, inc, h) => new THREE.ConeGeometry(0.16, h, 3).translate(0, h / 2, 0).rotateZ(inc).rotateY(ang).toNonIndexed();
  const touceira = mergeGeometries([0, 1.3, 2.5, 3.8, 5.0].map((a, k) => folha(a, 0.25 + (k % 2) * 0.2, 1.0 + (k % 3) * 0.3)));
  instancias(touceira, toon('#ffffff'), capim, coresCapim);
  // pedras
  const pedras = [];
  for (let k = 0; k < 360; k++) {
    const x = 20 + rnd() * 984, y = 20 + rnd() * 984;
    if (d(x, y) < HW + 3) continue;
    const a = 0.5 + rnd() ** 3 * 2.5;
    pedras.push({ x, y: morro(x, y), z: y, ry: rnd() * 6.3, rx: rnd() * 0.4, sx: a * 1.3, sy: a * 0.7, sz: a });
  }
  instancias(new THREE.DodecahedronGeometry(1, 0), toon('#8a7e70'), pedras);
  // mandacaru: tronco e dois braços
  const tronco = new THREE.CylinderGeometry(0.42, 0.5, 6, 6).translate(0, 3, 0);
  const braco = (lado, h, alto) => mergeGeometries([
    new THREE.CylinderGeometry(0.3, 0.3, 1.3, 6).rotateZ(Math.PI / 2).translate(lado * 0.8, h, 0),
    new THREE.CylinderGeometry(0.3, 0.32, alto, 6).translate(lado * 1.35, h + alto / 2 - 0.15, 0),
  ]);
  const cacto = mergeGeometries([tronco, braco(-1, 2.4, 2.2), braco(1, 3.3, 1.8)].map(g => g.toNonIndexed()));
  const mandacarus = [];
  for (let k = 0; k < 120 && mandacarus.length < 80; k++) {
    const x = 20 + rnd() * 984, y = 20 + rnd() * 984;
    if (d(x, y) < HW + 12) continue;
    const a = 0.8 + rnd() * 0.6;
    mandacarus.push({ x, y: morro(x, y), z: y, ry: rnd() * 6.3, sx: a, sy: a, sz: a });
  }
  instancias(cacto, toon('#5a7a4a'), mandacarus);
  // cerca de arame dos dois lados, com mourão a cada 5 unidades
  const mouroes = [], fios = [];
  for (let i = 0; i < N; i += 5) {
    const j = (i + 5) % N;
    for (const lado of [-1, 1]) {
      const lat = lado * (HW + 11);
      const x = cx[i] - ty[i] * lat, y = cy[i] + tx[i] * lat, x2 = cx[j] - ty[j] * lat, y2 = cy[j] + tx[j] * lat;
      if (d(x, y) < HW + 9 || d(x2, y2) < HW + 9) continue;               // não atravessa outro trecho da pista
      const inc = (hash(i, lado) - 0.5) * 0.12;
      mouroes.push({ x, y: 0, z: y, ry: rnd() * 3, rx: inc, sx: 1, sy: 0.85 + rnd() * 0.3, sz: 1 });
      const L = Math.hypot(x2 - x, y2 - y), ang = -Math.atan2(y2 - y, x2 - x);
      for (const hf of [0.9, 1.6]) fios.push({ x: (x + x2) / 2, y: hf, z: (y + y2) / 2, ry: ang, sx: L, sy: 1, sz: 1 });
    }
  }
  instancias(new THREE.BoxGeometry(0.3, 2.2, 0.3).translate(0, 1.1, 0), toon('#6a4a30'), mouroes);
  instancias(new THREE.BoxGeometry(1, 0.07, 0.07), toon('#4a4650'), fios);
  return grupo;
}

// ------------------------------------------------------------------ poeira e torrões: pontos quadrados com transparência pontilhada
const BAYER_GLSL = `float bayer(vec2 p) { ivec2 q = ivec2(mod(p, 4.0));
  const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[q.x + q.y * 4] + 0.5) / 16.0; }`;
function montarParticulas(max) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), cor = new Float32Array(max * 3), tam = new Float32Array(max), alfa = new Float32Array(max);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('cor', new THREE.BufferAttribute(cor, 3));
  geo.setAttribute('tam', new THREE.BufferAttribute(tam, 1));
  geo.setAttribute('alfa', new THREE.BufferAttribute(alfa, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { escala: { value: 300 }, maximo: { value: 32 } },
    vertexShader: `attribute vec3 cor; attribute float tam; attribute float alfa; uniform float escala, maximo; varying vec3 vCor; varying float vAlfa;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(tam * escala / -mv.z, 1.0, maximo); vCor = cor; vAlfa = alfa; }`,
    fragmentShader: `varying vec3 vCor; varying float vAlfa; ${BAYER_GLSL}
      void main() { vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard; if (vAlfa < bayer(gl_FragCoord.xy)) discard; gl_FragColor = vec4(vCor, 1.0); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, geo, pos, cor, tam, alfa, mat };
}

// ------------------------------------------------------------------ contato com o chão: sombra de contato e trilha dos pneus
// Sombra escura e pontilhada logo abaixo da moto (some quando ela sobe) e o sulco que o pneu de trás deixa na terra,
// que vai sumindo aos poucos. Os dois colam a moto no chão na câmera alta.
function montarSombraContato() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { forca: { value: 0.75 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float forca; varying vec2 vUv; ${BAYER_GLSL}
      void main() { vec2 d = (vUv - 0.5) * 2.0; float r = dot(d, d); if (r > 1.0) discard;
        float a = forca * (1.0 - r * r); if (a < bayer(gl_FragCoord.xy)) discard; gl_FragColor = vec4(0.1, 0.045, 0.035, 1.0); }`,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const malha = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
  malha.renderOrder = 1; malha.frustumCulled = false;
  return malha;
}
const MAX_MARCAS = 3000;
function montarTrilha() {
  const geo = new THREE.PlaneGeometry(0.5, 1.1).rotateX(-Math.PI / 2);
  const nasc = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MARCAS).fill(-1e4), 1);
  geo.setAttribute('nasc', nasc);
  const mat = new THREE.ShaderMaterial({
    uniforms: { agora: { value: 0 } },
    vertexShader: `attribute float nasc; uniform float agora; varying float vA;
      void main() { vA = 0.7 * clamp(1.0 - (agora - nasc) / 45.0, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vA; ${BAYER_GLSL} void main() { if (vA < bayer(gl_FragCoord.xy)) discard; gl_FragColor = vec4(0.22, 0.09, 0.05, 1.0); }`,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const im = new THREE.InstancedMesh(geo, mat, MAX_MARCAS);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let k = 0; k < MAX_MARCAS; k++) im.setMatrixAt(k, zero);
  im.frustumCulled = false; im.renderOrder = 1;
  return { im, nasc, mat, prox: 0 };
}

// ------------------------------------------------------------------ acabamento: contorno pela profundidade + paleta com pontilhado
function montarAcabamento() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tCor: { value: null }, tProf: { value: null }, res: { value: new THREE.Vector2() }, near: { value: 0.5 }, far: { value: 2000 },
      pal: { value: PALETA.map(h => new THREE.Vector3(...new THREE.Color(h).convertLinearToSRGB().toArray())) },
      palN: { value: PALETA.length }, dith: { value: 0.09 }, usarPal: { value: true }, contorno: { value: true },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `#include <packing>
      uniform sampler2D tCor, tProf; uniform vec2 res; uniform float near, far, dith; uniform vec3 pal[${PALETA.length}];
      uniform int palN; uniform bool usarPal, contorno; varying vec2 vUv; ${BAYER_GLSL}
      float prof(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tProf, uv).x, near, far); }
      vec3 paraSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() {
        vec2 px = 1.0 / res;
        vec3 c = paraSRGB(clamp(texture2D(tCor, vUv).rgb, 0.0, 1.0));
        if (contorno) {
          float dc = prof(vUv);
          float dn = min(min(prof(vUv + vec2(px.x, 0.0)), prof(vUv - vec2(px.x, 0.0))), min(prof(vUv + vec2(0.0, px.y)), prof(vUv - vec2(0.0, px.y))));
          if (dn < 220.0 && dc - dn > 1.2 + dn * 0.05) c = mix(c, vec3(0.1, 0.05, 0.06), 0.85);
        }
        if (usarPal) {
          c += (bayer(gl_FragCoord.xy) - 0.5) * dith;
          float best = 1e9; vec3 bc = c;
          for (int i = 0; i < ${PALETA.length}; i++) { if (i >= palN) break; vec3 d = c - pal[i]; float e = dot(d * d, vec3(0.35, 0.5, 0.15)); if (e < best) { best = e; bc = pal[i]; } }
          c = bc;
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const cena = new THREE.Scene();
  cena.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  return { cena, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat };
}

// ------------------------------------------------------------------ piloto: troca os materiais por sombreado em 3 degraus
// Aceita o modelo do contrato (peças separadas, cores por material) e também modelo de peça única
// com textura, gerado por IA ou baixado: normaliza o tamanho (1,9 m), apoia no chão e centraliza.
// Rig (piloto-rig.glb, docs/blender/RIG-MOTO.md): poses de 1 quadro misturadas por cima do "neutro".
// Clipes que já trazem o em_pe dentro (recuo_costelas 0,85, carga_salto 0,5, absorver, curva_em_pe_*, whip_* 1):
// o peso do em_pe é descontado para não somar duas vezes. curva_em_pe_* troca curva + em_pe quando ele está em pé na curva.
const RIG_POSES = ['curva_esq', 'curva_dir', 'curva_fechada_esq', 'curva_fechada_dir', 'compressao', 'wheelie', 'em_pe', 'recuo_costelas',
  'carga_salto', 'absorver', 'curva_em_pe_esq', 'curva_em_pe_dir', 'whip_esq', 'whip_dir', 'pe_fora_esq', 'pe_fora_dir'];
const RIG_QUEDA = ['queda_voando', 'queda_no_chao', 'levantando', 'em_pe_ao_lado', 'subindo'];
function prepararClipes(gltf) {
  if (!gltf.animations.length) return null;
  const clipes = Object.fromEntries(gltf.animations.map(c => { c.duration = 1; return [c.name, c]; }));   // duração 0 no arquivo: a chave única vale para qualquer tempo
  if (!clipes.neutro) return null;
  const aditivo = {};
  for (const n of RIG_POSES) if (clipes[n]) aditivo[n] = THREE.AnimationUtils.makeClipAdditive(clipes[n].clone(), 0, clipes.neutro);
  // queda e volta para a moto (rig v12, poses_queda.py): clipes absolutos só nos ossos do piloto abaixo do quadril
  // (o quadril e a moto são levados pelo código em animarQueda)
  const quadril = gltf.scene.getObjectByName('quadril'), doPiloto = new Set();
  if (quadril) quadril.traverse(o => { if (o !== quadril) doPiloto.add(o.name); });
  const queda = {};
  for (const n of RIG_QUEDA) if (clipes[n]) {
    const c = clipes[n].clone(); c.tracks = c.tracks.filter(tr => doPiloto.has(tr.name.slice(0, tr.name.lastIndexOf('.'))));
    queda[n] = c;
  }
  return { neutro: clipes.neutro, aditivo, queda };
}

function prepararPiloto(gltf, toon, hue, clipes) {
  const modelo = clipes ? clonarComEsqueleto(gltf.scene) : gltf.scene.clone(true);
  modelo.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const velhos = Array.isArray(o.material) ? o.material : [o.material];
    const novos = velhos.map(m => {
      const c = m.color ? m.color.clone() : new THREE.Color(1, 1, 1);
      if (hue && /vermelho|vinho|azul|marinho|laranja/.test(m.name)) c.offsetHSL(hue / 360, 0, 0);   // rival: piloto e plásticos da moto em outra cor
      else if (hue && m.map) c.copy(srgb('#ff9a9a').offsetHSL(hue / 360, 0, 0));   // modelo com textura: rival ganha um tom
      return toon(c, m.map);
    });
    o.material = Array.isArray(o.material) ? novos : novos[0];
  });
  if (!clipes) {   // modelo sem rig: pode vir de qualquer fonte, então normaliza; o rig segue o contrato (metros, origem no chão)
    const caixa = new THREE.Box3().setFromObject(modelo), tam = caixa.getSize(new THREE.Vector3()), meio = caixa.getCenter(new THREE.Vector3());
    const k = tam.y > 0 ? 1.9 / tam.y : 1;
    modelo.scale.multiplyScalar(k);
    modelo.position.set(-meio.x * k, -caixa.min.y * k, -meio.z * k);
  }
  let rig = null;
  if (clipes) {
    const mix = new THREE.AnimationMixer(modelo), acoes = {}, peso = {}, quedas = {}, pesoQ = {};
    const neutro = mix.clipAction(clipes.neutro); neutro.play();
    for (const [n, c] of Object.entries(clipes.aditivo)) {
      const a = mix.clipAction(c); a.blendMode = THREE.AdditiveAnimationBlendMode; a.setEffectiveWeight(0); a.play();
      acoes[n] = a; peso[n] = 0;
    }
    for (const [n, c] of Object.entries(clipes.queda || {})) { const a = mix.clipAction(c); a.setEffectiveWeight(0); a.play(); quedas[n] = a; pesoQ[n] = 0; }
    rig = { mix, acoes, peso, neutro, quedas, pesoQ, vAnt: 0 };
  }
  const raiz = new THREE.Group();
  raiz.add(modelo);
  raiz.scale.setScalar(ESCALA_PILOTO);
  const no = n => raiz.getObjectByName(n) || new THREE.Object3D();   // peça que o modelo não tem vira um nó vazio
  const piloto = no('piloto'), tronco = no('tronco');
  // rodas: no rig, as malhas mp_roda_* ficam centradas no eixo (x local = eixo); giram por cima da pose dos clipes
  const rodas = clipes ? ['mp_roda_f', 'mp_roda_t'].map(n => raiz.getObjectByName(n)).filter(Boolean).map(o => ({ o, q0: o.quaternion.clone(), ang: 0, sinal: 0 })) : [];
  const quadril = clipes ? raiz.getObjectByName('quadril') : null;   // raiz do corpo do piloto no rig (filho do chassi)
  return { raiz, rig, rodas, quadril, rodaF: clipes ? new THREE.Object3D() : no('roda_f'), rodaT: clipes ? new THREE.Object3D() : no('roda_t'), piloto, tronco, cabeca: no('cabeca'),
    pitch: 0, comp: 0, noAr: false, base: { piloto: piloto.position.clone(), tronco: tronco.rotation.clone() } };
}

// ------------------------------------------------------------------ início
export async function iniciar(M, tela) {
  const canvas = document.createElement('canvas');
  canvas.id = 'game3d';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;';
  tela.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;

  const cena = new THREE.Scene();
  const bruma = srgb('#e0a07a');
  cena.background = bruma;
  cena.fog = new THREE.Fog(bruma, 160, 640);

  // luz de fim de tarde: sol baixo na direção do sol pintado no céu
  // Sol de fim de tarde vindo de cima e da esquerda da tela (a câmera é fixa): a sombra cai para baixo e para a direita,
  // à vista, e o volume da moto aparece. Com o sol atrás da câmera, a sombra ficava escondida atrás da moto e ela
  // parecia solta do chão.
  const aSol = ANGULO_TELA - Math.PI / 4;
  const ELEV_SOL = 0.62;   // alto o bastante para a sombra não riscar a tela inteira
  const dirSol = new THREE.Vector3(Math.cos(aSol) * Math.cos(ELEV_SOL), Math.sin(ELEV_SOL), Math.sin(aSol) * Math.cos(ELEV_SOL));
  cena.add(new THREE.HemisphereLight(srgb('#b8a8c8'), srgb('#5a4a38'), 1.5));
  const sol = new THREE.DirectionalLight(srgb('#ffe2b8'), 2.7);
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  Object.assign(sol.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
  sol.shadow.bias = -0.002;
  cena.add(sol, sol.target);

  const degraus = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
  degraus.magFilter = degraus.minFilter = THREE.NearestFilter; degraus.needsUpdate = true;
  const toon = (cor, mapa) => new THREE.MeshToonMaterial({ color: cor instanceof THREE.Color ? cor : srgb(cor), gradientMap: degraus, map: mapa || null });

  const texMapa = montarMapa(M);
  const { chao, pista, morro } = montarChao(M, texMapa);
  cena.add(chao, pista, montarObjetos(M, morro, toon), montarSertao(M, morro, toon));
  const part = montarParticulas(700);
  cena.add(part.pts);

  // o modelo vem como módulo .js (o .glb em base64), porque o link publicado não serve arquivos .glb
  // modelo com rig (tarefa 6 do PLANO); ?modelo=antigo ou falha na carga volta para o piloto.glb sem rig
  let modulo;
  try { modulo = /modelo=antigo/.test(location.search) ? null : await import('./modelos/piloto-rig.js'); } catch (e) { console.warn('rig indisponível, usando piloto.js', e); }
  if (!modulo) modulo = await import('./modelos/piloto.js');
  const b64 = modulo.default, bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(bin.buffer, '');
  const clipes = prepararClipes(gltf);
  // o jogo recria P e AIS a cada corrida: guarda só a posição na lista e busca o piloto atual a cada quadro
  const corredor = k => k ? M.AIS[k - 1] : M.P;
  const pilotos = [M.P, ...M.AIS].map((_, k) => {
    const p = prepararPiloto(gltf, toon, k ? M.RIVALS[k - 1].hue : 0, clipes);
    p.sombra = montarSombraContato(); p.trilhaDist = 0;
    cena.add(p.raiz, p.sombra);
    return { k, p };
  });
  const trilha = montarTrilha();
  cena.add(trilha.im);

  const acab = montarAcabamento();
  const W = RES_W, H = RES_H;
  const cam = new THREE.PerspectiveCamera(CAM_FOV, W / H, 1, 1000);
  renderer.setSize(W, H, false);
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter,
    depthTexture: new THREE.DepthTexture(W, H) });
  acab.mat.uniforms.res.value.set(W, H);
  acab.mat.uniforms.tCor.value = rt.texture; acab.mat.uniforms.tProf.value = rt.depthTexture;

  const alvo = new THREE.Vector3(), olho = new THREE.Vector3();
  let baseY = 0, ultimo = performance.now(), camRumo = 0, camLadoOk = false;
  const camLado = new THREE.Vector3(), camLadoSuave = new THREE.Vector3();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');

  // pesos das poses do rig a partir da física
  const alvo0 = {};
  // Queda (r.crash, 2 s de tombo na física): voando por cima do guidão até ~0,7 s, depois caído. Volta (r.remonta,
  // 1,8 s): levantando de joelho, em pé ao lado da moto, subindo, e a pilotagem volta no fim.
  function pesarQueda(R, r, dt) {
    const Q = R.quedas; if (!Q || !Q.queda_voando) return 0;
    const alvo = { queda_voando: 0, queda_no_chao: 0, levantando: 0, em_pe_ao_lado: 0, subindo: 0 };
    if (r.crash > 0) { const ts = 2 - r.crash; if (ts < 0.7) alvo.queda_voando = 1; else alvo.queda_no_chao = 1; }
    else if (r.remonta > 0) {
      const g = 1 - r.remonta / 1.8;
      if (g < 0.3) alvo.levantando = 1; else if (g < 0.6) alvo.em_pe_ao_lado = 1; else if (g < 0.9) alvo.subindo = 1;
    }
    let soma = 0;
    for (const n in alvo) {
      R.pesoQ[n] += (alvo[n] - R.pesoQ[n]) * Math.min(1, dt * (n === 'queda_voando' ? 14 : 7));
      soma += R.pesoQ[n];
    }
    const k = soma > 1 ? 1 / soma : 1;
    for (const n in alvo) Q[n].setEffectiveWeight(R.pesoQ[n] * k);
    const q = Math.min(1, soma);
    R.neutro.setEffectiveWeight(1 - q);
    return q;
  }
  function pesarRig(p, r, dt) {
    const { hgt, wrap, HW } = M, R = p.rig, v = r.v || 0, lean = r.crash > 0 ? 0 : r.lean;
    const fora = 1 - pesarQueda(R, r, dt);   // quanto da pilotagem vale (0 no meio da queda)
    const fech = Math.min(1, Math.max(0, 1 - v / 45));               // devagar e esterçando = curva fechada, pé de dentro para fora
    const acel = (v - R.vAnt) / Math.max(dt, 1e-3); R.vAnt = v;
    const costelas = Math.abs(r.lat) < HW + 1 && Math.abs(hgt[wrap(r.idx + 3)] - hgt[wrap(r.idx - 3)]) > 0.25;
    const S = r.sinais;
    if (S) {   // jogador na física do laboratório: sinais de verdade (prototipo-pilotagem/SINAIS-PARA-RIG.md)
      const inc = r.crash > 0 ? 0 : Math.max(-1, Math.min(1, -S.inclinacao / 0.55));   // + = deitada à direita
      const fe = Math.min(1, Math.abs(S.peFora));                                     // pé de dentro para fora = curva fechada
      const comp = Math.max(0, Math.min(1, ((S.compressaoF + S.compressaoT) / 2 - 0.3) / 0.6));
      // Posições da pesquisa (docs/pesquisa/PILOTAGEM-REAL.md):
      // - freada em pé com o quadril atrás (pesoLong < 0) e corpo puxado para trás: recuo_costelas;
      // - carga antes do salto (preload): agacha empurrando as pernas, carga_salto;
      // - costelas e pouso: em pé, absorve com joelhos e cotovelos quando a suspensão afunda, absorver;
      // - em pé na curva: moto deitada embaixo, corpo no centro, curva_em_pe_*;
      // - whip no ar: moto deitada de lado e piloto mais reto que ela, whip_*.
      const recuo = Math.max(0, Math.min(1, Math.max(-S.pesoLong * 1.2, r.corpoAtras || 0))) * (1 - 0.7 * fe);
      const carga = Math.max(0, Math.min(1, S.preload || 0)) * (1 - recuo);
      const emPe = S.emPe;   // em pé/sentado já vem decidido pelo jogo (posturaEmPe, index.html)
      const noAr = !!r.air;
      const wh = noAr ? Math.max(-1, Math.min(1, (r.whip || 0) / 0.6)) : 0;
      // corpo com mola: a suspensão (compressão e velocidade) empurra uma mola amortecida (~2 Hz, um pouco elástica);
      // joelhos e cotovelos dobram, passam um pouco e voltam, como o piloto absorvendo cada ondulação (vídeos de referência)
      const cm = (S.compressaoF + S.compressaoT) / 2, vs = ((S.velSuspF || 0) + (S.velSuspT || 0)) / 2;
      // trepidação da terra: ondulação pequena presa à distância percorrida (anda com a velocidade, repete no mesmo lugar)
      const dist = r.prog || 0, trep = v > 4 ? 0.22 * (0.5 + 0.5 * Math.sin(dist * 1.7) * Math.sin(dist * 0.63 + 1.3)) * Math.min(1, v / 12) : 0;
      const molaAlvo = noAr ? 0 : Math.max(0, Math.min(1, (cm - 0.30) * 3 + Math.max(0, vs) * 0.6 + trep));
      R.molaV = (R.molaV || 0) + ((molaAlvo - (R.mola || 0)) * 150 - (R.molaV || 0) * 15) * dt;
      R.mola = Math.max(0, Math.min(1.15, (R.mola || 0) + R.molaV * dt));
      const absorve = Math.min(1, R.mola) * emPe * (1 - recuo) * (1 - carga);
      // A inclinação vem sempre da física (inc). O pé para fora só reparte essa inclinação entre curva aberta e fechada:
      // os clipes de curva trazem a moto deitada, e o peFora chega ~0,5 s antes da inclinação; ligar o clipe fechado pelo
      // pé deitava a moto antes da hora e depois trocava de clipe, e o corpo ia de um lado para o outro.
      const a = Math.min(1, Math.abs(inc)), ladoFe = S.peFora === 0 ? 0 : Math.sign(S.peFora) === Math.sign(inc) ? 1 : 0;
      const feC = fe * ladoFe;                                   // pé de fora do mesmo lado da curva
      const curvaAberta = a * (1 - feC);
      const cep = curvaAberta * emPe;   // em pé na curva
      // quanto do em_pe já vem dentro dos outros clipes; se passar de um em pé inteiro, reduz todos na mesma proporção
      // (somar recuo + curva em pé, por exemplo, levantava o piloto uma vez e meia: quadril alto e pernas esticadas)
      const soma0 = recuo * 0.85 + carga * 0.5 + absorve + cep + Math.abs(wh), kE = soma0 > 1 ? 1 / soma0 : 1, soma = soma0 * kE;
      Object.assign(alvo0, {
        curva_dir: inc > 0 ? curvaAberta * (1 - emPe) : 0, curva_esq: inc < 0 ? curvaAberta * (1 - emPe) : 0,
        curva_em_pe_dir: inc > 0 ? cep * kE : 0, curva_em_pe_esq: inc < 0 ? cep * kE : 0,
        curva_fechada_dir: inc > 0 ? a * feC : 0, curva_fechada_esq: inc < 0 ? a * feC : 0,
        compressao: comp * (1 - 0.85 * fe), recuo_costelas: recuo * kE, carga_salto: carga * kE, absorver: absorve * kE,
        whip_dir: Math.max(0, wh) * kE, whip_esq: Math.max(0, -wh) * kE,
        // curva sentada: perna de dentro esticada à frente (pesquisa, curva plana), cheia já no começo da curva
        pe_fora_dir: inc > 0 ? Math.min(1, Math.max(a * 2.5, feC)) * (1 - emPe) : 0,
        pe_fora_esq: inc < 0 ? Math.min(1, Math.max(a * 2.5, feC)) * (1 - emPe) : 0,
        em_pe: Math.max(0, emPe - soma),
        wheelie: 0,   // o empino vem da arfagem da física, no giro do modelo inteiro
      });
      if (!r.ai) globalThis.__rigJogador = { peso: R.peso, alvo: alvo0, mola: R.mola };   // depuração: pesos do rig do jogador
      for (const n in R.acoes) {
        R.peso[n] += ((alvo0[n] || 0) - R.peso[n]) * Math.min(1, dt * (/^curva/.test(n) ? 6 : n === 'absorver' ? 25 : 10));   // curvas suaves, mola rápida
        R.acoes[n].setEffectiveWeight(R.peso[n] * fora);
      }
      R.mix.update(dt);
      return;
    }
    const alvo = {
      curva_dir: Math.max(0, lean) * (1 - fech), curva_esq: Math.max(0, -lean) * (1 - fech),
      curva_fechada_dir: Math.max(0, lean) * fech, curva_fechada_esq: Math.max(0, -lean) * fech,
      // compressão no pouso, menor na curva fechada (senão a bota de fora entra no chão: RIG-MOTO.md)
      compressao: (p.comp / 0.28) * (1 - 0.85 * fech * Math.abs(lean)),
      em_pe: r.air ? 0.8 : costelas ? 0.7 * (1 - Math.min(1, p.comp / 0.28)) : 0,
      absorver: !r.air && costelas ? 0.7 * Math.min(1, p.comp / 0.28) : 0,   // rival também absorve no pouso e nas costelas
      wheelie: !r.air && r.crash <= 0 && acel > 25 && v < 35 ? 0.55 * (1 - v / 35) : 0,   // arrancada forte empina um pouco
    };
    for (const n in R.acoes) {
      R.peso[n] += ((alvo[n] || 0) - R.peso[n]) * Math.min(1, dt * (n === 'wheelie' ? 4 : 9));
      R.acoes[n].setEffectiveWeight(R.peso[n] * fora);
    }
    R.mix.update(dt);
  }

  function posarPilotos(dt) {
    const { hgt, wrap, HW } = M;
    for (const { k: n, p } of pilotos) {
      const r = corredor(n);
      const R = p.raiz;
      R.visible = !(r.inv > 0 && !(r.remonta > 0) && (performance.now() / 50 | 0) % 2);
      R.position.set(r.x, r.z, r.y);
      let alvoPitch;
      if (r.sinais) alvoPitch = r.sinais.arfagem;   // física do laboratório: arfagem de verdade (empino, pouso, saltos)
      else if (r.air) alvoPitch = Math.max(-0.5, Math.min(0.45, r.vz * 0.028));
      else alvoPitch = Math.abs(r.lat) < HW + 1 ? Math.atan2(hgt[wrap(r.idx + 2)] - hgt[wrap(r.idx - 2)], 4) : 0;
      p.pitch += (alvoPitch - p.pitch) * Math.min(1, dt * 12);
      if (p.noAr && !r.air) p.comp = 0.28;                       // pouso: a suspensão afunda e o piloto agacha
      p.noAr = r.air; p.comp = Math.max(0, p.comp - dt);
      const whip = r.air ? r.whip : 0;
      // com rig, quem inclina a moto na curva é o clipe; sem rig, gira o modelo inteiro
      // com rig, o clipe whip_* já deita a moto 45° com o piloto mais reto: o modelo inteiro gira bem menos
      let roll = (p.rig ? 0 : -r.lean * 0.55) - whip * (p.rig && r.sinais ? 0.35 : 1.1), yaw = -r.a - Math.PI / 2 + whip * 0.45, pitch = p.pitch;
      if (p.rig) pesarRig(p, r, dt);
      const animaQueda = !!p.quadril && (r.crash > 0 || r.remonta > 0);
      if (r.crash > 0 && !animaQueda) { roll += Math.sin(r.tumble) * 1.2; pitch += Math.sin(r.tumble * 0.7) * 0.6; }
      R.rotation.copy(e.set(pitch, yaw, roll));
      if (animaQueda) animarQueda(p, r, R); else if (p.queda) p.queda.fase = '';
      const k = p.comp / 0.28;
      p.piloto.position.set(p.base.piloto.x, p.base.piloto.y - 0.14 * k, p.base.piloto.z);
      p.tronco.rotation.set(p.base.tronco.x - 0.25 * k, p.base.tronco.y, p.base.tronco.z + whip * 0.5 + r.lean * 0.15);
      const giro = (r.v || 0) * dt / (0.34 * ESCALA_PILOTO);
      p.rodaF.rotation.x -= giro; p.rodaT.rotation.x -= giro;
      if (p.rodas.length) colarNoChao(p, r, dt);
    }
    trilha.mat.uniforms.agora.value = relogio;
  }

  // Queda e volta para a moto (rig v12): a moto tomba de lado e arrasta; o piloto sai por cima do guidão (clipe
  // queda_voando), gira no ar e fica de bruços no chão (queda_no_chao). Depois (r.remonta, 1,8 s) ele fica de joelho
  // (levantando), em pé ao lado da moto (em_pe_ao_lado), ergue a moto, passa a perna (subindo) e volta a pilotar.
  // Os clipes (pesarQueda) dobram braços e pernas; aqui o código leva o quadril: altura e giro de cada fase, em metros.
  const qV = new THREE.Quaternion(), qV2 = new THREE.Quaternion(), qT = new THREE.Quaternion(), pV = new THREE.Vector3(), pV2 = new THREE.Vector3(), eV = new THREE.Euler(0, 0, 0, 'YXZ');
  const mV = new THREE.Matrix4(), mV2 = new THREE.Matrix4(), ESC = new THREE.Vector3(ESCALA_PILOTO, ESCALA_PILOTO, ESCALA_PILOTO);
  const QUADRIL = { deitado: 0.2, joelho: 0.55, emPe: 0.86, subindo: 0.98 };   // altura do quadril (m) em cada fase
  // posição e giro no mundo de um quadro com base (pos, yaw), deslocado (metros, eixos da moto: x lado, y cima, -z frente)
  // e girado (arfagem x, rolagem z)
  function quadroPiloto(pos, yaw, dx, dy, dz, gx, gz, outP, outQ) {
    qV2.setFromEuler(eV.set(0, yaw, 0));
    outP.set(dx, dy, dz).multiplyScalar(ESCALA_PILOTO).applyQuaternion(qV2).add(pos);
    outQ.copy(qV2).multiply(qT.setFromEuler(eV.set(gx, 0, gz)));
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  function animarQueda(p, r, R) {
    const Q = p.queda || (p.queda = {}), lado = r.quedaLado || 1;
    if (r.crash > 0) {
      const ts = Math.max(0, 2 - r.crash);   // s desde a queda (a física dá 2 s de tombo)
      if (Q.fase !== 'cai') {                 // começo: onde o quadril estava em relação à moto (metros) e o giro dele
        R.updateMatrixWorld(true);
        Q.rel = (Q.rel || new THREE.Matrix4()).copy(R.matrixWorld).invert().multiply(p.quadril.matrixWorld);
        Q.relP = (Q.relP || new THREE.Vector3()).setFromMatrixPosition(Q.rel);
        Q.relR = (Q.relR || new THREE.Matrix4()).extractRotation(Q.rel);
        Q.pos0 = R.position.clone(); Q.yaw0 = R.rotation.y; Q.fase = 'cai';
      }
      Q.tomba = lado * 1.35 * smooth(0, 0.35, ts);
      R.rotation.set(0, R.rotation.y, Q.tomba); Q.pos = R.position.clone(); Q.yaw = R.rotation.y;
      // quadril: sai do banco por cima do guidão, para a frente e para o lado da queda, num arco, girando até ficar de
      // bruços; cai a ~20 cm do chão (o tronco deitado)
      const voa = smooth(0, 0.7, ts), arco = ts < 0.7 ? Math.sin(Math.PI * ts / 0.7) * 1.1 : 0, gira = -Math.PI / 2 * smooth(0.05, 0.6, ts);
      const rp = Q.relP;
      quadroPiloto(Q.pos0, Q.yaw0, lerp(rp.x, -lado * 0.9, voa), lerp(rp.y, QUADRIL.deitado, voa) + arco, lerp(rp.z, rp.z - 2.4, voa),
        gira, lado * 0.5 * Math.sin(Math.min(1, ts / 0.6) * Math.PI), pV, Q.q || (Q.q = new THREE.Quaternion()));
      Q.p = (Q.p || new THREE.Vector3()).copy(pV); qV.copy(Q.q);
    } else {
      if (Q.fase !== 'cai' && Q.fase !== 'sobe') return;   // remonta sem ter visto a queda: nada a animar
      Q.fase = 'sobe';
      const g = 1 - Math.max(0, r.remonta) / 1.8, ergue = smooth(0.35, 0.65, g);
      // moto: do lugar e do giro em que tombou até onde a física a pôs de pé, erguendo aos poucos
      pV2.copy(Q.pos).lerp(R.position, ergue); R.position.copy(pV2);
      let dyaw = R.rotation.y - Q.yaw; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      const yaw = Q.yaw + dyaw * ergue;
      R.rotation.set(0, yaw, Q.tomba * (1 - ergue));
      // piloto ao lado da moto (do lado em que ela caiu): de bruços → de joelho → em pé → perna por cima → sentado
      const rp = Q.relP, levanta = smooth(0, 0.3, g), sobe = smooth(0.3, 0.6, g), passa = smooth(0.6, 0.9, g), senta = smooth(0.85, 1, g);
      const altura = lerp(lerp(QUADRIL.joelho, QUADRIL.emPe, sobe), QUADRIL.subindo, passa), lat = lado * lerp(0.75, 0.3, passa);
      quadroPiloto(pV2, yaw, lerp(lat, rp.x, senta), lerp(altura, rp.y, senta), lerp(0, rp.z, senta), 0, 0, pV, qV);
      pV.lerp(Q.p, 1 - levanta); qV.slerp(Q.q, 1 - levanta);
    }
    // quadril no mundo = quadro (posição do quadril) × giro que ele tinha na moto; vira local do pai (o chassi, que tombou)
    R.updateMatrixWorld(true);
    mV.compose(pV, qV, ESC).multiply(Q.relR);
    mV2.copy(p.quadril.parent.matrixWorld).invert().multiply(mV);
    mV2.decompose(p.quadril.position, p.quadril.quaternion, p.quadril.scale);
  }

  // rodas do rig: giram (a de trás patina com a física do laboratório), encostam no chão e deixam trilha; sombra de contato
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), qG = new THREE.Quaternion(), qS = new THREE.Quaternion(), EIXO_X = new THREE.Vector3(1, 0, 0);
  const m4 = new THREE.Matrix4(), qM = new THREE.Quaternion(), eM = new THREE.Euler(0, 0, 0, 'YXZ'), vM = new THREE.Vector3(), sM = new THREE.Vector3(1, 1, 1);
  let relogio = 0;
  const RAIO_RODA = 0.345 * ESCALA_PILOTO;
  function colarNoChao(p, r, dt) {
    const R = p.raiz, S = r.sinais, fx = Math.cos(r.a), fz = Math.sin(r.a);
    p.rodas.forEach((w, n) => {
      const giro = S ? (n ? S.giroT : S.giroF) : (r.v || 0) / K_JOGO / 0.34;
      if (!w.sinal) {   // sentido do giro: eixo da roda contra "cima × frente"
        R.updateMatrixWorld(true); w.o.getWorldQuaternion(qG); vA.copy(EIXO_X).applyQuaternion(qG);
        w.sinal = Math.sign(vA.x * fz - vA.z * fx) || 1;
      }
      w.ang = (w.ang + w.sinal * giro * dt) % (Math.PI * 2);
      w.o.quaternion.copy(w.q0).multiply(qS.setFromAxisAngle(EIXO_X, w.ang));
    });
    R.updateMatrixWorld(true);
    // ponto mais baixo de cada pneu contra o chão debaixo dele
    let folga = Infinity, somaX = 0, somaZ = 0, somaG = 0;
    const cont = [];
    for (const w of p.rodas) {
      w.o.getWorldPosition(vA); w.o.getWorldQuaternion(qG); vB.copy(EIXO_X).applyQuaternion(qG);
      const g = M.chao(vA.x, vA.z), baixo = vA.y - RAIO_RODA * Math.sqrt(Math.max(0, 1 - vB.y * vB.y));
      folga = Math.min(folga, baixo - g); cont.push([vA.x, vA.z, g]); somaX += vA.x; somaZ += vA.z; somaG += g;
    }
    const noChao = !r.air && !(r.crash > 0) && !(r.remonta > 0);
    if (noChao && Math.abs(folga) < 2) { R.position.y -= folga; R.updateMatrixWorld(true); }
    // sombra de contato: embaixo do meio da moto, inclinada com o chão; menor e mais fraca quanto mais alto
    const mx = somaX / cont.length, mz = somaZ / cont.length, mg = somaG / cont.length;
    const alto = Math.max(0, R.position.y - mg), k = Math.max(0.35, 1 - alto / 20);   // no ar a sombra encolhe mas fica: é ela que mostra a altura
    const [a, b] = cont, dx = a[0] - b[0], dz = a[1] - b[1], L = Math.hypot(dx, dz) || 1;
    eM.set(0, Math.atan2(-dz, dx), Math.atan2(a[2] - b[2], L));
    p.sombra.position.set(mx, mg + 0.06, mz); p.sombra.rotation.copy(eM);
    p.sombra.scale.set((L + 3.2) * (0.7 + 0.3 * k), 1, 2.6 * (0.7 + 0.3 * k));
    p.sombra.material.uniforms.forca.value = 0.8 * k;
    p.sombra.visible = R.visible && k > 0.05;
    // trilha do pneu de trás: uma marca a cada ~1 unidade andada, só com a roda na terra
    const [tx, tz, tg] = cont[1] || cont[0];
    p.trilhaDist += (r.v || 0) * dt;
    if (noChao && p.trilhaDist > 1 && Math.abs(r.lat) < M.HW + 3.5) {
      p.trilhaDist = 0;
      const n = trilha.prox; trilha.prox = (n + 1) % MAX_MARCAS;
      const ga = M.chao(tx + fx, tz + fz), gb = M.chao(tx - fx, tz - fz);
      qM.setFromEuler(eM.set(Math.atan2(ga - gb, 2), -r.a - Math.PI / 2, 0));
      trilha.im.setMatrixAt(n, m4.compose(vM.set(tx, tg + 0.05, tz), qM, sM.set(1, 1, 1)));
      trilha.nasc.setX(n, relogio); trilha.nasc.needsUpdate = true; trilha.im.instanceMatrix.needsUpdate = true;
    }
  }

  function posarCamera(dt) {
    const P = M.P;
    baseY += (P.z * 0.55 - baseY) * Math.min(1, dt * 4);
    // câmera fixa: sempre do mesmo lado, segue o piloto sem girar
    const a = ANGULO_TELA, D = PERTO ? 22 : camDist, el = CAM_ELEV;   // ?perto: câmera de inspeção para revisar poses
    olho.set(P.x - Math.cos(a) * D * Math.cos(el), baseY + D * Math.sin(el), P.y - Math.sin(a) * D * Math.cos(el));
    alvo.set(P.x, baseY + 1.5, P.y);
    if (CAM_INSP !== 'fixa') {   // rumo da moto suavizado, para a câmera não sacudir
      let d = P.a - camRumo; d = Math.atan2(Math.sin(d), Math.cos(d)); camRumo += d * Math.min(1, dt * 3);
      const fx = Math.cos(camRumo), fy = Math.sin(camRumo);
      if (CAM_INSP === 'tras') { olho.set(P.x - fx * 34, baseY + 11, P.y - fy * 34); alvo.set(P.x + fx * 6, baseY + 3.5, P.y + fy * 6); }
      else if (CAM_INSP === 'diagonal') {   // ~16 m atrás, ~7 m para o lado e ~11 m acima (uns 35° de cima); mira à frente
        camLado.set(P.x - fx * 50 + fy * 22, baseY + 38, P.y - fy * 50 - fx * 22);
        if (!camLadoOk) { camLadoSuave.copy(camLado); camLadoOk = true; }
        camLadoSuave.lerp(camLado, Math.min(1, dt * 2.5));
        olho.copy(camLadoSuave); alvo.set(P.x + fx * 12, baseY + 1.5, P.y + fy * 12);
      }
      else {   // de lado, estilo replay: perto (~4 m), baixa (~1,6 m), um pouco atrás, seguindo com atraso suave
        camLado.set(P.x - fx * 8 - fy * 13, (P.z || 0) + 5.5, P.y - fy * 8 + fx * 13);
        if (!camLadoOk) { camLadoSuave.copy(camLado); camLadoOk = true; }
        camLadoSuave.lerp(camLado, Math.min(1, dt * 4));
        olho.copy(camLadoSuave); alvo.set(P.x + fx * 3, (P.z || 0) + 2.6, P.y + fy * 3);
      }
    } else camLadoOk = false
    const tremor = M.shake() > 0 ? Math.sin(performance.now() * 0.07) * M.shake() * 1.2 : 0;
    cam.position.copy(olho); cam.position.y += tremor;
    cam.lookAt(alvo);
    sol.position.copy(alvo).addScaledVector(dirSol, 200);
    sol.target.position.copy(alvo);
  }

  const cores = { puff: srgb('#c88a5a'), pena: srgb('#f0f0ec') };
  function atualizarParticulas() {
    const lista = M.parts;
    let n = 0;
    for (const q of lista) {
      if (n >= 700) break;
      part.pos.set([q.x, q.z, q.y], n * 3);
      const c = q.t === 'puff' ? cores.puff : q.c ? srgb(`rgb(${q.c})`) : cores.puff;
      part.cor.set([c.r, c.g, c.b], n * 3);
      part.tam[n] = q.t === 'puff' ? q.s * 0.8 : q.s * 1.6;
      part.alfa[n] = q.t === 'puff' ? Math.min(1, q.life / q.max * 1.3) * 0.45 : 1;
      n++;
    }
    part.geo.setDrawRange(0, n);
    for (const a of ['position', 'cor', 'tam', 'alfa']) part.geo.attributes[a].needsUpdate = true;
    part.mat.uniforms.escala.value = H / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    part.mat.uniforms.maximo.value = H * 0.09;   // poeira colada na câmera não cobre a tela
  }

  return {
    anguloTela: ANGULO_TELA,
    trocaCamera,
    zoom(passo) {
      camDist = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camDist * (passo > 0 ? 1.15 : 1 / 1.15)));
      try { localStorage.setItem('braaaap-zoom', String(Math.round(camDist))); } catch (e) {}
    },
    acabamento(on) { acab.mat.uniforms.usarPal.value = on; acab.mat.uniforms.contorno.value = on; },
    render() {
      const agora = performance.now(), dt = Math.min(0.1, (agora - ultimo) / 1000); ultimo = agora; relogio += dt;
      posarPilotos(dt);
      posarCamera(dt);
      atualizarParticulas();
      acab.mat.uniforms.near.value = cam.near; acab.mat.uniforms.far.value = cam.far;
      renderer.setRenderTarget(rt);
      renderer.render(cena, cam);
      renderer.setRenderTarget(null);
      renderer.render(acab.cena, acab.cam);
    },
  };
}
