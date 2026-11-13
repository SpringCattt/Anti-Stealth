// Genera mapa_casa.js (en la raíz del repo): planta de una casa grande con jardín.
// Uso: node herramientas/generar_casa.js [semilla=7] [entradas=4]
//  - Jardín de hierba alrededor; spawn S y extracción E en las 4 esquinas del jardín.
//  - Casa partida en salas (BSP) con muros de 1 casilla y puertas de 2; algunas puertas extra para que haya bucles.
//  - Solo "entradas" puertas en la fachada (repartidas por lados distintos).
//  - Cajas bajas 'c' al azar dentro de las salas (nunca delante de una puerta).
//  - Guardianes G en la sala más céntrica; botines B en las 3 salas más profundas (por pasos desde las esquinas).
'use strict';
const fs = require('fs'), path = require('path');

const semilla = Number(process.argv[2]) || 7, ENTRADAS = Number(process.argv[3]) || 4;
const ANCHO = 90, ALTO = 64, JARDIN = 8;               // márgenes de hierba entre el borde y la casa
const SALA_MIN = 9, PUERTA = 2, CAJAS = 0.035;          // lado mínimo de sala, ancho de puerta, fracción de cajas

function mulberry32(s) {
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generar(semilla) {
  const rnd = mulberry32(semilla), ent = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const C = Array.from({ length: ALTO }, (_, y) => Array.from({ length: ANCHO }, (_, x) =>
    x === 0 || y === 0 || x === ANCHO - 1 || y === ALTO - 1 ? '#' : 'g'));
  const x0 = JARDIN, y0 = JARDIN, x1 = ANCHO - 1 - JARDIN, y1 = ALTO - 1 - JARDIN; // muros exteriores de la casa
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) C[y][x] = x === x0 || x === x1 || y === y0 || y === y1 ? '#' : '.';

  // BSP: cada corte levanta un muro con una puerta (y a veces dos, para que haya rutas alternativas).
  const salas = [], puertas = [];
  const abrir = (x, y) => { C[y][x] = '.'; puertas.push([x, y]); };
  const partir = (ax, ay, bx, by) => { // interior de la sala: [ax..bx] x [ay..by]
    const w = bx - ax + 1, h = by - ay + 1;
    const vertical = w > h ? true : h > w ? false : rnd() < 0.5;
    const lado = vertical ? w : h;
    if (lado < 2 * SALA_MIN + 1) { salas.push({ ax, ay, bx, by }); return; }
    const corte = (vertical ? ax : ay) + ent(SALA_MIN, lado - SALA_MIN - 1);
    const largo = vertical ? h : w, nPuertas = largo > 18 && rnd() < 0.6 ? 2 : 1;
    if (vertical) for (let y = ay; y <= by; y++) C[y][corte] = '#';
    else for (let x = ax; x <= bx; x++) C[corte][x] = '#';
    for (let k = 0; k < nPuertas; k++) {
      const tramo = Math.floor(largo / nPuertas), p = (vertical ? ay : ax) + k * tramo + ent(1, Math.max(1, tramo - PUERTA - 1));
      for (let d = 0; d < PUERTA; d++) vertical ? abrir(corte, Math.min(by, p + d)) : abrir(Math.min(bx, p + d), corte);
    }
    if (vertical) { partir(ax, ay, corte - 1, by); partir(corte + 1, ay, bx, by); }
    else { partir(ax, ay, bx, corte - 1); partir(ax, corte + 1, bx, by); }
  };
  partir(x0 + 1, y0 + 1, x1 - 1, y1 - 1);

  // Entradas en la fachada: lados distintos (norte, sur, oeste, este), posición al azar lejos de las esquinas.
  const lados = ['n', 's', 'o', 'e'].sort(() => rnd() - 0.5).slice(0, ENTRADAS);
  while (lados.length < ENTRADAS) lados.push(['n', 's', 'o', 'e'][ent(0, 3)]);
  for (const l of lados) {
    if (l === 'n' || l === 's') {
      const y = l === 'n' ? y0 : y1, x = ent(x0 + 6, x1 - 6 - PUERTA);
      for (let d = 0; d < PUERTA; d++) abrir(x + d, y);
    } else {
      const x = l === 'o' ? x0 : x1, y = ent(y0 + 6, y1 - 6 - PUERTA);
      for (let d = 0; d < PUERTA; d++) abrir(x, y + d);
    }
  }

  // Cajas: dentro de las salas, nunca a <= 2 casillas de una puerta ni pegadas al muro de una puerta.
  const cercaPuerta = (x, y) => puertas.some(([px, py]) => Math.abs(px - x) <= 2 && Math.abs(py - y) <= 2);
  for (const s of salas) {
    const n = Math.round((s.bx - s.ax + 1) * (s.by - s.ay + 1) * CAJAS);
    for (let k = 0; k < n; k++) {
      const x = ent(s.ax + 1, s.bx - 1), y = ent(s.ay + 1, s.by - 1), largo = rnd() < 0.4 ? 2 : 1, horiz = rnd() < 0.5;
      for (let d = 0; d < largo; d++) {
        const cx = horiz ? x + d : x, cy = horiz ? y : y + d;
        if (cx <= s.bx && cy <= s.by && !cercaPuerta(cx, cy)) C[cy][cx] = 'c';
      }
    }
  }
  // Algunas cajas sueltas en el jardín (cobertura al acercarse a la casa), lejos de las esquinas.
  for (let k = 0; k < 18; k++) {
    const x = ent(6, ANCHO - 7), y = ent(4, ALTO - 5);
    if (C[y][x] === 'g' && !cercaPuerta(x, y)) C[y][x] = 'c';
  }

  // Esquinas: spawn/extracción 3x2.
  const S = [];
  for (const [ex, ey] of [[1, 1], [ANCHO - 4, 1], [1, ALTO - 3], [ANCHO - 4, ALTO - 3]]) {
    for (let y = ey; y < ey + 2; y++) for (let x = ex; x < ex + 3; x++) { C[y][x] = 'S'; S.push([x, y]); }
  }

  // Profundidad = pasos (4-vecinos) desde la esquina más cercana.
  const libre = (x, y) => x >= 0 && y >= 0 && x < ANCHO && y < ALTO && C[y][x] !== '#' && C[y][x] !== 'c';
  const prof = Array.from({ length: ALTO }, () => new Array(ANCHO).fill(-1)), cola = S.map(p => p.slice());
  for (const [x, y] of cola) prof[y][x] = 0;
  for (let k = 0; k < cola.length; k++) {
    const [x, y] = cola[k];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (libre(nx, ny) && prof[ny][nx] < 0) { prof[ny][nx] = prof[y][x] + 1; cola.push([nx, ny]); }
    }
  }
  // Centro de cada sala (casilla libre más cercana al centro) con su profundidad.
  const centros = salas.map(s => {
    let mejor = null, d = Infinity;
    for (let y = s.ay; y <= s.by; y++) for (let x = s.ax; x <= s.bx; x++) {
      const dc = Math.hypot(x - (s.ax + s.bx) / 2, y - (s.ay + s.by) / 2);
      if (libre(x, y) && prof[y][x] >= 0 && dc < d) { d = dc; mejor = [x, y]; }
    }
    return mejor && { x: mejor[0], y: mejor[1], prof: prof[mejor[1]][mejor[0]] };
  });
  if (centros.some(c => !c)) return null; // alguna sala sin conexión: otra semilla

  // Guardianes en la sala más cercana al centro de la casa; botines en las 3 más profundas (sin repetir sala ni G).
  const cx = ANCHO / 2, cy = ALTO / 2;
  const gi = centros.reduce((b, c, i) => Math.hypot(c.x - cx, c.y - cy) < Math.hypot(centros[b].x - cx, centros[b].y - cy) ? i : b, 0);
  const orden = centros.map((c, i) => i).filter(i => i !== gi).sort((a, b) => centros[b].prof - centros[a].prof);
  const B = [];
  for (const i of orden) {
    if (B.length === 3) break;
    if (B.every(([bx, by]) => Math.hypot(bx - centros[i].x, by - centros[i].y) > 14)) B.push([centros[i].x, centros[i].y]);
  }
  if (B.length < 3) return null;
  const g = centros[gi], G = [];
  for (let y = g.y; y < g.y + 2; y++) for (let x = g.x - 1; x <= g.x + 1; x++) if (libre(x, y)) G.push([x, y]);
  for (const [x, y] of B) C[y][x] = 'B';
  for (const [x, y] of G) C[y][x] = 'G';
  return { C, S, B, G, salas: salas.length, prof: B.map(([x, y]) => prof[y][x]) };
}

let r = null, s = semilla;
for (; !r; s++) r = generar(s);
const L = a => '[' + a.map(p => '[' + p + ']').join(',') + ']';
const salida = path.join(__dirname, '..', '..', 'mapa_casa.js');
fs.writeFileSync(salida,
  `// Planta de casa grande generada por simulador/herramientas/generar_casa.js (semilla ${s - 1}, ${ENTRADAS} entradas).\n` +
  `// MAPA_DISENO.celdas[z][x]. Se edita en Godot (editor_mapa); regenerar con generar_casa.js lo sobrescribe.\n` +
  `const MAPA_DISENO = {\n  ancho: ${ANCHO},\n  alto: ${ALTO},\n  celdas: [\n` +
  r.C.map(f => '    [' + f.map(c => JSON.stringify(c)).join(',') + ']').join(',\n') +
  `\n  ],\n  marcadores: {\n    B: ${L(r.B)},\n    S: ${L(r.S)},\n    E: ${L(r.S)},\n    G: ${L(r.G)}\n  }\n};\n`);
console.log(`semilla ${s - 1}: ${r.salas} salas, botines a ${r.prof.join(', ')} pasos de la esquina más cercana -> ${salida}`);
console.log(r.C.map(f => f.join('')).join('\n'));
