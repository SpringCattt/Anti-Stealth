// Algoritmo genético co-evolutivo (equipo Infiltrador vs equipo Guardián: un genoma por equipo).
// Script normal; requiere genes.js (limitarGenes, RANGOS_*), config.js (TICKS_RONDA) y nucleo.js (simular, mulberry32).
// Rivales de cada evaluación: los K mejores del bando contrario de la generación anterior + 1 al azar de esa misma población
// (los mejores dan presión; el aleatorio evita sobreajustarse a un solo estilo). En la generación 0 no hay "anterior": K+1 al azar.
// Fitness de un individuo = media de sus rondas. Con rivales cambiantes el fitness no es estacionario: el elitismo conserva el
// mejor GENOMA, pero su fitness medido puede variar entre generaciones; mejorInfiltrador/mejorGuardian guardan el mejor histórico medido.

function gaussiana(rnd) { // Box-Muller
  return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
}

function individuoAleatorio(rnd, rangos) {
  const genes = {};
  // Los pesos de la red (p0, p1, ...) empiezan cerca de 0: la red arranca casi siempre en la rutina y aprende a desviarse.
  for (const [k, [min, max]] of Object.entries(rangos)) genes[k] = /^p\d+$/.test(k) ? gaussiana(rnd) * 0.3 : min + (max - min) * rnd();
  return limitarGenes(genes, rangos);
}

// Torneo de tamaño k: el mejor fitness de k elegidos al azar (con reemplazo). Devuelve el índice.
function torneo(fitness, rnd, k = 3) {
  let mejor = Math.floor(rnd() * fitness.length);
  for (let i = 1; i < k; i++) {
    const c = Math.floor(rnd() * fitness.length);
    if (fitness[c] > fitness[mejor]) mejor = c;
  }
  return mejor;
}

// Cruce aritmético por gen: hijo = a·t + b·(1-t), con t propio de cada gen.
function cruce(a, b, rnd, rangos) {
  const h = {};
  for (const k of Object.keys(rangos)) { const t = rnd(); h[k] = a[k] * t + b[k] * (1 - t); }
  return limitarGenes(h, rangos);
}

// Mutación gaussiana: cada gen con probabilidad prob, desviación = escala · (máx - mín).
function mutar(genes, rnd, rangos, prob, escala) {
  const m = { ...genes }, claves = Object.entries(rangos);
  const p = Math.min(prob, 12 / claves.length); // con cientos de pesos, ~12 mutaciones por hijo (no un 30 % de todo)
  for (const [k, [min, max]] of claves) if (rnd() < p) m[k] += gaussiana(rnd) * escala * (max - min);
  return limitarGenes(m, rangos);
}

// Siguiente generación con elitismo (el mejor pasa intacto, en el índice 0) + torneo + cruce + mutación.
function siguienteGeneracion(poblacion, fitness, rnd, rangos, { probMutacion, escalaMutacion }) {
  const elite = fitness.indexOf(Math.max(...fitness));
  const nueva = [{ ...poblacion[elite] }];
  while (nueva.length < poblacion.length) {
    const a = poblacion[torneo(fitness, rnd)], b = poblacion[torneo(fitness, rnd)];
    nueva.push(mutar(cruce(a, b, rnd, rangos), rnd, rangos, probMutacion, escalaMutacion));
  }
  return nueva;
}

const PARAMS_GA_POR_DEFECTO = { semilla: 1, poblacion: 16, generaciones: 12, rivales: 2, probMutacion: 0.3, escalaMutacion: 0.1 };

// Rondas totales: generaciones · poblacion · (rivales+1) · 2 bandos. Rivales por evaluación = K mejores + 1 aleatorio.
function contarRondas(p) { return p.generaciones * p.poblacion * (p.rivales + 1) * 2; }

// Una ronda del genético: { gi, gg, semilla } -> lo que el genético necesita de ella (en Node la juega un hilo aparte).
function jugarRonda(crearRonda, { gi, gg, semilla }) {
  const sim = crearRonda(gi, gg, semilla);
  simular(sim, TICKS_RONDA);
  return { infiltrador: sim.fitness.infiltrador, guardian: sim.fitness.guardian, meta: sim.ganador === 'infiltradores', derribo: sim.stats.infiltradores.caidas > 0 };
}

// La co-evolución como generador: cada generación entrega (yield) la lista de rondas a jugar y recibe sus resultados en
// el mismo orden. Quién las juega (aquí mismo o varios hilos) no cambia nada: el PRNG del genético solo elige rivales y
// semillas, así que el resultado es el mismo. alGeneracion(info) opcional para mostrar progreso.
// opciones.inicial = { infiltrador, guardian } (genes de un entrenamiento anterior): arranque en caliente. El individuo 0
// de cada bando es esa copia, hasta la mitad son copias mutadas y el resto al azar (para no perder variedad). Sin
// inicial, toda la población es al azar (y el resultado no cambia respecto a antes de existir esta opción).
function* coevolucion(opciones = {}, alGeneracion = null) {
  const { inicial = null, ...resto } = opciones;
  const p = { ...PARAMS_GA_POR_DEFECTO, ...resto, ...(inicial && { continuacion: true }) };
  const rnd = mulberry32(p.semilla);
  const poblacionInicial = (rangos, base) => Array.from({ length: p.poblacion }, (_, k) => {
    if (!base || k >= p.poblacion / 2) return individuoAleatorio(rnd, rangos);
    const copia = limitarGenes(base, rangos);
    return k === 0 ? copia : mutar(copia, rnd, rangos, p.probMutacion, p.escalaMutacion);
  });
  let pobI = poblacionInicial(RANGOS_INFILTRADOR, inicial && inicial.infiltrador);
  let pobG = poblacionInicial(RANGOS_GUARDIAN, inicial && inicial.guardian);
  let mejoresI = null, mejoresG = null; // K mejores de la generación anterior (null en la generación 0)
  let poblI0 = pobI, poblG0 = pobG;     // población de la que sale el rival aleatorio
  const curva = [];
  let mejorI = null, mejorG = null, rondas = 0, metas = 0, derribados = 0, metasUltima = 0, rondasUltima = 0;

  // K mejores (o al azar en la gen 0) + 1 aleatorio de la población anterior.
  const elegirRivales = (mejores, poblacion) => {
    const azar = () => poblacion[Math.floor(rnd() * poblacion.length)];
    const r = mejores ? mejores.slice() : Array.from({ length: p.rivales }, azar);
    r.push(azar());
    return r;
  };

  for (let gen = 0; gen < p.generaciones; gen++) {
    const ultima = gen === p.generaciones - 1;
    // Rondas de la generación: cada individuo contra sus rivales, con una semilla distinta cada vez (sale del PRNG
    // del genético: sigue siendo repetible). de[k] = [esInfiltrador, índice] de la ronda k.
    const lote = [], de = [];
    const apuntar = (pob, rivalesDe, esInfiltrador) => pob.forEach((genes, i) => {
      for (const rival of rivalesDe()) {
        const semilla = Math.floor(rnd() * 2 ** 32);
        lote.push(esInfiltrador ? { gi: genes, gg: rival, semilla } : { gi: rival, gg: genes, semilla });
        de.push([esInfiltrador, i]);
      }
    });
    apuntar(pobI, () => elegirRivales(mejoresG, poblG0), true);
    apuntar(pobG, () => elegirRivales(mejoresI, poblI0), false);
    const resultados = yield lote;
    const fitI = new Array(pobI.length).fill(0), fitG = new Array(pobG.length).fill(0), n = p.rivales + 1;
    resultados.forEach((r, k) => {
      const [esInfiltrador, i] = de[k];
      if (esInfiltrador) fitI[i] += r.infiltrador / n; else fitG[i] += r.guardian / n; // media de sus rondas
      rondas++;
      if (r.meta) metas++; // "meta" = victoria por botín extraído
      if (r.derribo) derribados++; // algún Infiltrador derribado en la ronda
      if (ultima) { rondasUltima++; if (r.meta) metasUltima++; }
    });
    const iI = fitI.indexOf(Math.max(...fitI)), iG = fitG.indexOf(Math.max(...fitG));
    // El mejor de ESTA generación: el fitness depende de los rivales del momento, así que comparar con generaciones
    // anteriores premiaría a los que se enfrentaron a rivales flojos (los primeros).
    mejorI = { genes: { ...pobI[iI] }, fitness: fitI[iI], generacion: gen };
    mejorG = { genes: { ...pobG[iG] }, fitness: fitG[iG], generacion: gen };
    curva.push({ generacion: gen, infiltrador: fitI[iI], guardian: fitG[iG] });
    if (alGeneracion) alGeneracion({ ...curva[gen], rondas, mejorInfiltrador: mejorI, mejorGuardian: mejorG, parametros: p });
    const mejoresDe = (pob, fit) => pob.map((g, i) => [g, fit[i]]).sort((a, b) => b[1] - a[1]).slice(0, p.rivales).map(x => x[0]);
    mejoresI = mejoresDe(pobI, fitI); mejoresG = mejoresDe(pobG, fitG);
    poblI0 = pobI; poblG0 = pobG;
    if (!ultima) {
      pobI = siguienteGeneracion(pobI, fitI, rnd, RANGOS_INFILTRADOR, p);
      pobG = siguienteGeneracion(pobG, fitG, rnd, RANGOS_GUARDIAN, p);
    }
  }
  return {
    parametros: p, rondas, curva, mejorInfiltrador: mejorI, mejorGuardian: mejorG,
    pctMetaTotal: 100 * metas / rondas, pctDerriboTotal: 100 * derribados / rondas,
    pctMetaUltimaGeneracion: 100 * metasUltima / rondasUltima,
  };
}

// Versión de un solo hilo: juega cada lote aquí mismo. crearRonda(genesInfiltrador, genesGuardian, semilla) -> sim nueva.
function coevolucionar(crearRonda, opciones = {}, alGeneracion = null) {
  const it = coevolucion(opciones, alGeneracion);
  let paso = it.next();
  while (!paso.done) paso = it.next(paso.value.map(j => jugarRonda(crearRonda, j)));
  return paso.value;
}
