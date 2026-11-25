// A* dinámico en la rejilla. Requiere raycast.js (transitable).
// Vecindad de 8; una diagonal solo se permite si las dos ortogonales que rodea son transitables (no corta esquinas).
// Coste de ENTRAR en una casilla = distancia (1 o √2) · (1 + extra[casilla]). extra lo construye cada agente:
//   Infiltrador: w_light si está iluminada + w_huella si lo estuvo hace poco + w_peligro cerca de la pizarra.
//   Guardián: COSTE_HIERBA_GUARDIAN en la hierba exterior.
// extra = Infinity convierte la casilla en muro. Heurística: distancia euclídea a la meta; es admisible y consistente
// porque extra >= 0 y ningún paso cuesta menos que su distancia.

const VECINOS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// Montículo binario mínimo de (f, casilla) en dos arrays paralelos. El orden de los empates lo fija la estructura,
// que es determinista: la misma búsqueda da siempre la misma ruta.
function heapPush(hf, hc, f, c) {
  let i = hf.length;
  hf.push(f); hc.push(c);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (hf[p] <= f) break;
    hf[i] = hf[p]; hc[i] = hc[p];
    i = p;
  }
  hf[i] = f; hc[i] = c;
}

function heapPop(hf, hc) {
  const c = hc[0], f = hf.pop(), ultimo = hc.pop();
  if (hf.length) {
    let i = 0;
    for (;;) {
      let h = 2 * i + 1;
      if (h >= hf.length) break;
      if (h + 1 < hf.length && hf[h + 1] < hf[h]) h++;
      if (hf[h] >= f) break;
      hf[i] = hf[h]; hc[i] = hc[h];
      i = h;
    }
    hf[i] = f; hc[i] = ultimo;
  }
  return c;
}

// Distancia a pie (mismas reglas que buscarRuta, sin coste extra) desde la casilla inicio a todas: Float64Array con
// Infinity donde no se llega. Es un Dijkstra (A* sin meta).
function distanciasDesde(mapa, inicio) {
  const ancho = mapa.ancho, alto = mapa.alto, alt = mapa.altura, SUELO = ALTURA.SUELO, d = new Float64Array(ancho * alto).fill(Infinity);
  const hf = [], hc = [];
  d[inicio] = 0;
  heapPush(hf, hc, 0, inicio);
  while (hf.length) {
    const f = hf[0], actual = heapPop(hf, hc);
    if (f > d[actual]) continue; // entrada antigua
    const x = actual % ancho, y = (actual - x) / ancho;
    for (let k = 0; k < 8; k++) {
      const v = VECINOS[k], dx = v[0], dy = v[1], nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto || alt[nx + ny * ancho] !== SUELO) continue;
      if (dx && dy && (alt[nx + y * ancho] !== SUELO || alt[x + ny * ancho] !== SUELO)) continue;
      const nd = f + v[2], vecino = nx + ny * ancho;
      if (nd < d[vecino]) { d[vecino] = nd; heapPush(hf, hc, nd, vecino); }
    }
  }
  return d;
}

// inicio y meta: índices de casilla. extra: Float32Array/Float64Array del tamaño del mapa, o null.
// Devuelve las casillas desde la siguiente al inicio hasta la meta (incluida), [] si inicio = meta, o null si no hay ruta.
// Los arrays de trabajo se guardan en mapa.astar y se reutilizan entre búsquedas (marcados por número de búsqueda).
function buscarRuta(mapa, inicio, meta, extra = null) {
  const ancho = mapa.ancho, alto = mapa.alto, n = ancho * alto, alt = mapa.altura, SUELO = ALTURA.SUELO;
  const sx = inicio % ancho, sy = (inicio - sx) / ancho, mx = meta % ancho, my = (meta - mx) / ancho;
  if (!transitable(mapa, sx, sy) || !transitable(mapa, mx, my)) return null;
  if (inicio === meta) return [];
  const T = mapa.astar || (mapa.astar = { g: new Float64Array(n), padre: new Int32Array(n), vista: new Uint32Array(n), cerrada: new Uint32Array(n), busqueda: 0 });
  const id = ++T.busqueda, hf = [], hc = [];
  T.vista[inicio] = id;
  T.g[inicio] = 0;
  heapPush(hf, hc, Math.hypot(sx - mx, sy - my), inicio);

  while (hf.length) {
    const actual = heapPop(hf, hc);
    if (T.cerrada[actual] === id) continue; // entrada antigua de una casilla que ya mejoró
    if (actual === meta) {
      const ruta = [];
      for (let c = meta; c !== inicio; c = T.padre[c]) ruta.push(c);
      return ruta.reverse();
    }
    T.cerrada[actual] = id;
    const x = actual % ancho, y = (actual - x) / ancho;
    // Lo mismo que transitable() pero en línea (es el bucle más caliente de la simulación). Si (nx, ny) está dentro,
    // las dos ortogonales de una diagonal también lo están.
    for (let k = 0; k < 8; k++) {
      const v = VECINOS[k], dx = v[0], dy = v[1], distancia = v[2], nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto || alt[nx + ny * ancho] !== SUELO) continue;
      if (dx && dy && (alt[nx + y * ancho] !== SUELO || alt[x + ny * ancho] !== SUELO)) continue;
      const vecino = nx + ny * ancho;
      if (T.cerrada[vecino] === id) continue;
      const nuevoG = T.g[actual] + distancia * (1 + (extra ? extra[vecino] : 0));
      if (nuevoG === Infinity) continue;
      if (T.vista[vecino] !== id || nuevoG < T.g[vecino]) {
        T.vista[vecino] = id;
        T.g[vecino] = nuevoG;
        T.padre[vecino] = actual;
        heapPush(hf, hc, nuevoG + Math.hypot(nx - mx, ny - my), vecino);
      }
    }
  }
  return null;
}
