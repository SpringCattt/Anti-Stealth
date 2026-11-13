// Política neuronal: un perceptrón con una capa oculta (tanh) por bando. Sus pesos son genes (p0, p1, ...) que el
// genético evoluciona igual que el resto. Entradas: lo que sabe el agente (sus métodos observar). Salidas: una
// puntuación por acción y otra por modo de movimiento; gana la mayor (a igualdad, la de menor índice).
// Con todos los pesos a 0 las salidas empatan y gana la acción 0 ("rutina") y el modo 0 ("el de la acción"): la red
// empieza jugando exactamente como la IA programada y el entrenamiento aprende cuándo desviarse.
// Requiere config.js (OCULTAS_RED).

// Rangos de los pesos de una red con nEntradas -> OCULTAS_RED -> nSalidas (con sesgos).
function rangosRed(nEntradas, nSalidas) {
  const n = (nEntradas + 1) * OCULTAS_RED + (OCULTAS_RED + 1) * nSalidas, rangos = {};
  for (let i = 0; i < n; i++) rangos['p' + i] = [-3, 3];
  return rangos;
}

function pesosCero(rangos) {
  return Object.fromEntries(Object.keys(rangos).map(k => [k, 0]));
}

// Pesos de la red de un genoma en un Float64Array (en el orden p0, p1, ...). Se cachea por objeto de genes.
const CACHE_PESOS = new WeakMap();
function pesosDe(genes, n) {
  let w = CACHE_PESOS.get(genes);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = genes['p' + i] || 0;
    CACHE_PESOS.set(genes, w);
  }
  return w;
}

// Salidas de la red para unas entradas. Devuelve un Float64Array de nSalidas.
function evaluarRed(genes, entradas, nSalidas) {
  const nE = entradas.length, w = pesosDe(genes, (nE + 1) * OCULTAS_RED + (OCULTAS_RED + 1) * nSalidas);
  const oculta = new Float64Array(OCULTAS_RED), salida = new Float64Array(nSalidas);
  let k = 0;
  for (let h = 0; h < OCULTAS_RED; h++) {
    let s = w[k++]; // sesgo
    for (let i = 0; i < nE; i++) s += w[k++] * entradas[i];
    oculta[h] = Math.tanh(s);
  }
  for (let o = 0; o < nSalidas; o++) {
    let s = w[k++];
    for (let h = 0; h < OCULTAS_RED; h++) s += w[k++] * oculta[h];
    salida[o] = s;
  }
  return salida;
}

// Índice de la mayor puntuación entre salidas[desde .. desde + n - 1] (a igualdad, el menor).
function elegir(salidas, desde, n) {
  let mejor = 0;
  for (let i = 1; i < n; i++) if (salidas[desde + i] > salidas[desde + mejor]) mejor = i;
  return mejor;
}
