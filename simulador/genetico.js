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

// Genes de colocación de un gadget (gadget3_x, gadget3_y, gadget3_giro -> "3"); null si no es uno de ellos.
const gadgetDe = k => (/^gadget(\d+)_/.exec(k) || [])[1] ?? null;

// Cruce aritmético por gen: hijo = a·t + b·(1-t), con t propio de cada gen. Salvo los gadgets: cada uno se copia entero
// de un padre (promediar un sensor en la puerta norte y otro en la sur lo dejaba en medio, donde nadie lo había puesto).
function cruce(a, b, rnd, rangos) {
  const h = {}, deA = {};
  for (const k of Object.keys(rangos)) {
    const g = gadgetDe(k);
    if (g === null) { const t = rnd(); h[k] = a[k] * t + b[k] * (1 - t); continue; }
    deA[g] ??= rnd() < 0.5;
    h[k] = deA[g] ? a[k] : b[k];
  }
  return limitarGenes(h, rangos);
}

// Mutación gaussiana: cada gen con probabilidad prob, desviación = escala · (máx - mín). Los pesos de la red (p0, p1...)
// son cientos: entre ellos, ~12 mutaciones por hijo (no un 30 % de todo). Los genes de la rutina mutan con prob: antes
// compartían el ~2.5 % de los pesos y apenas cambiaban, y son los que deciden cómo juega (la red casi siempre elige la rutina).
// Los gadgets: de media se mueve uno por hijo, unas pocas casillas (MUTACION_GADGET del mapa). Con el 30 % y saltos
// grandes, cada hijo movía ~7 gadgets ~9 casillas y una buena colocación no sobrevivía de una generación a otra.
const MUTACION_GADGET = 0.03;
function mutar(genes, rnd, rangos, prob, escala) {
  const m = { ...genes }, claves = Object.entries(rangos), nPesos = claves.filter(([k]) => /^p\d+$/.test(k)).length;
  const pPeso = Math.min(prob, 12 / Math.max(1, nPesos)), nGadgets = new Set(claves.map(([k]) => gadgetDe(k)).filter(g => g !== null)).size;
  const mueve = {};
  for (const [k, [min, max]] of claves) {
    const g = gadgetDe(k);
    if (g !== null) {
      mueve[g] ??= rnd() < 1 / nGadgets; // el gadget entero (x, y y giro) se mueve o no
      if (mueve[g]) m[k] += gaussiana(rnd) * MUTACION_GADGET * (max - min);
    } else if (rnd() < (/^p\d+$/.test(k) ? pPeso : prob)) m[k] += gaussiana(rnd) * escala * (max - min);
  }
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

// Rondas totales. Rivales por evaluación = K mejores + 1 aleatorio + 1 del salón de la fama (si ya tiene a alguien: con
// salón inicial vacío, el primer campeón entra al acabar la generación SALON_CADA - 1).
function contarRondas(p, salonInicial = 0) {
  const conSalon = salonInicial ? p.generaciones : Math.max(0, p.generaciones - SALON_CADA);
  return p.generaciones * p.poblacion * (p.rivales + 1) * 2 + p.poblacion * 2 * conSalon;
}
const SALON_MAX = 30; // campeones que se guardan por bando
const SALON_CADA = 4;  // entra el campeón de 1 de cada SALON_CADA generaciones (y el de la última)
const VALIDACION_SALON = 5, VALIDACION_SEMILLAS = 2; // validación final: campeones del salón y partidas por rival
const VALIDACION_SEMILLAS_REF = 12; // partidas por rival cuando se valida contra referencias (con 4 elegía al que tuvo suerte)

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
// inicial, toda la población es al azar.
// Salón de la fama (opciones.salon = { infiltradores: [genes...], guardianes: [genes...] }, de entrenamientos anteriores):
// el campeón de cada generación entra en él, y cada individuo juega además contra un campeón al azar del salón del
// bando contrario. Así no puede "olvidar" cómo ganar a estilos de antes solo porque el rival del momento sea otro
// (sin él, continuar un entrenamiento daba vueltas: 47 % -> 57 % y los Guardianes perdían lo aprendido). Como mucho
// SALON_MAX por bando: al pasarse sale uno al azar que no sea el primero (se conserva lo más antiguo y lo más nuevo).
function* coevolucion(opciones = {}, alGeneracion = null) {
  const { inicial = null, salon: salonInicial = null, referencias = null, ...resto } = opciones;
  const p = { ...PARAMS_GA_POR_DEFECTO, ...resto, ...(inicial && { continuacion: true }) };
  const salon = { infiltradores: [...(salonInicial?.infiltradores || [])], guardianes: [...(salonInicial?.guardianes || [])] };
  p.salonInicial = salon.infiltradores.length + salon.guardianes.length;
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
  const ultimoFit = { I: null, G: null }; // fitness de la última generación (para la validación)

  // K mejores (o al azar en la gen 0) + 1 aleatorio de la población anterior + 1 del salón (si hay).
  const elegirRivales = (mejores, poblacion, campeones) => {
    const azar = () => poblacion[Math.floor(rnd() * poblacion.length)];
    const r = mejores ? mejores.slice() : Array.from({ length: p.rivales }, azar);
    r.push(azar());
    if (campeones.length) r.push(campeones[Math.floor(rnd() * campeones.length)]);
    return r;
  };
  const entrarEnSalon = (lista, genes) => {
    lista.push(genes);
    if (lista.length > SALON_MAX) lista.splice(1 + Math.floor(rnd() * (lista.length - 2)), 1);
  };

  for (let gen = 0; gen < p.generaciones; gen++) {
    const ultima = gen === p.generaciones - 1;
    // Rondas de la generación: todos los individuos de un bando juegan contra los MISMOS rivales y con las MISMAS
    // semillas (salen del PRNG del genético: sigue siendo repetible). Con pocas rondas por individuo y una victoria que
    // vale 1000, si a cada uno le tocaban rivales y partidas distintos, la suerte pesaba más que ser mejor y la
    // selección iba casi a ciegas. de[k] = [esInfiltrador, índice] de la ronda k.
    const lote = [], de = [];
    const apuntar = (pob, rivalesDe, esInfiltrador) => {
      const rivales = rivalesDe(), semillas = rivales.map(() => Math.floor(rnd() * 2 ** 32));
      pob.forEach((genes, i) => rivales.forEach((rival, k) => {
        lote.push(esInfiltrador ? { gi: genes, gg: rival, semilla: semillas[k] } : { gi: rival, gg: genes, semilla: semillas[k] });
        de.push([esInfiltrador, i]);
      }));
    };
    const salonG = salon.guardianes.map(g => limitarGenes(g, RANGOS_GUARDIAN)), salonI = salon.infiltradores.map(g => limitarGenes(g, RANGOS_INFILTRADOR));
    apuntar(pobI, () => elegirRivales(mejoresG, poblG0, salonG), true);
    apuntar(pobG, () => elegirRivales(mejoresI, poblI0, salonI), false);
    const resultados = yield lote;
    const fitI = new Array(pobI.length).fill(0), fitG = new Array(pobG.length).fill(0);
    const nI = new Array(pobI.length).fill(0), nG = new Array(pobG.length).fill(0);
    de.forEach(([esInfiltrador, i]) => { if (esInfiltrador) nI[i]++; else nG[i]++; });
    resultados.forEach((r, k) => {
      const [esInfiltrador, i] = de[k];
      if (esInfiltrador) fitI[i] += r.infiltrador / nI[i]; else fitG[i] += r.guardian / nG[i]; // media de sus rondas
      rondas++;
      if (r.meta) metas++; // "meta" = victoria por botín extraído
      if (r.derribo) derribados++; // algún Infiltrador derribado en la ronda
      if (ultima) { rondasUltima++; if (r.meta) metasUltima++; }
    });
    const iI = fitI.indexOf(Math.max(...fitI)), iG = fitG.indexOf(Math.max(...fitG));
    ultimoFit.I = fitI; ultimoFit.G = fitG;
    // El mejor de ESTA generación: el fitness depende de los rivales del momento, así que comparar con generaciones
    // anteriores premiaría a los que se enfrentaron a rivales flojos (los primeros).
    mejorI = { genes: { ...pobI[iI] }, fitness: fitI[iI], generacion: gen };
    mejorG = { genes: { ...pobG[iG] }, fitness: fitG[iG], generacion: gen };
    curva.push({ generacion: gen, infiltrador: fitI[iI], guardian: fitG[iG] });
    if (gen % SALON_CADA === SALON_CADA - 1 || ultima) { // no todos: así el salón guarda varios entrenamientos de historia
      entrarEnSalon(salon.infiltradores, mejorI.genes);
      entrarEnSalon(salon.guardianes, mejorG.genes);
    }
    if (alGeneracion) alGeneracion({ ...curva[gen], rondas, mejorInfiltrador: mejorI, mejorGuardian: mejorG, parametros: p, salon });
    const mejoresDe = (pob, fit) => pob.map((g, i) => [g, fit[i]]).sort((a, b) => b[1] - a[1]).slice(0, p.rivales).map(x => x[0]);
    mejoresI = mejoresDe(pobI, fitI); mejoresG = mejoresDe(pobG, fitG);
    poblI0 = pobI; poblG0 = pobG;
    if (!ultima) {
      pobI = siguienteGeneracion(pobI, fitI, rnd, RANGOS_INFILTRADOR, p);
      pobG = siguienteGeneracion(pobG, fitG, rnd, RANGOS_GUARDIAN, p);
    }
  }

  // Validación (opciones.validacion = n): el mejor de la última generación salió de 4-5 partidas y puede ser solo el que
  // tuvo suerte con ellas. Los n mejores de cada bando juegan contra los mejores rivales de la última generación y
  // hasta VALIDACION_SALON campeones del salón, con VALIDACION_SEMILLAS partidas cada uno (las mismas para todos), y se
  // queda el que mejor media saca. Es el que se guarda y el que entra en el salón. Con arranque en caliente, el campeón
  // de partida también es candidato: si en todo el entrenamiento no salió nada mejor, se queda él (con pocas partidas por
  // generación el ruido podía echarlo de la población y el entrenamiento devolvía algo peor de lo que recibió).
  // Con opciones.referencias = { infiltradores, guardianes } (campeones con los que luego se decide si el entrenamiento
  // sirvió), los rivales de la validación son esos, con VALIDACION_SEMILLAS_REF partidas cada uno, y cuenta sobre todo
  // ganar: así se elige al que mejor rinde justo contra lo que después se le va a pedir.
  if (p.validacion > 0) {
    const escoger = (lista, n) => { const copia = lista.slice(), r = []; while (r.length < n && copia.length) r.push(copia.splice(Math.floor(rnd() * copia.length), 1)[0]); return r; };
    const conRefs = referencias && referencias.infiltradores.length && referencias.guardianes.length;
    const rivalesI = conRefs ? referencias.guardianes.map(g => limitarGenes(g, RANGOS_GUARDIAN)) : [...mejoresG, ...escoger(salon.guardianes.map(g => limitarGenes(g, RANGOS_GUARDIAN)), VALIDACION_SALON)];
    const rivalesG = conRefs ? referencias.infiltradores.map(g => limitarGenes(g, RANGOS_INFILTRADOR)) : [...mejoresI, ...escoger(salon.infiltradores.map(g => limitarGenes(g, RANGOS_INFILTRADOR)), VALIDACION_SALON)];
    const candidatos = (pob, fit, base, rangos) => {
      const r = pob.map((g, i) => [g, fit[i]]).sort((a, b) => b[1] - a[1]).slice(0, p.validacion).map(x => x[0]);
      return base ? [...r, limitarGenes(base, rangos)] : r;
    };
    const candI = candidatos(pobI, ultimoFit.I, inicial && inicial.infiltrador, RANGOS_INFILTRADOR);
    const candG = candidatos(pobG, ultimoFit.G, inicial && inicial.guardian, RANGOS_GUARDIAN);
    const semillas = Array.from({ length: conRefs ? VALIDACION_SEMILLAS_REF : VALIDACION_SEMILLAS }, () => Math.floor(rnd() * 2 ** 32));
    const lote = [], de = [];
    candI.forEach((genes, i) => rivalesI.forEach(rival => semillas.forEach(semilla => { lote.push({ gi: genes, gg: rival, semilla }); de.push([true, i]); })));
    candG.forEach((genes, i) => rivalesG.forEach(rival => semillas.forEach(semilla => { lote.push({ gi: rival, gg: genes, semilla }); de.push([false, i]); })));
    const resultados = yield lote;
    const sumaI = candI.map(() => 0), sumaG = candG.map(() => 0), ganaI = candI.map(() => 0), ganaG = candG.map(() => 0);
    resultados.forEach((r, k) => {
      const [esI, i] = de[k];
      if (esI) { sumaI[i] += r.infiltrador; ganaI[i] += r.meta ? 1 : 0; } else { sumaG[i] += r.guardian; ganaG[i] += r.meta ? 0 : 1; }
      rondas++;
    });
    // Contra las referencias manda ganar (el fitness solo desempata); si no, el fitness. Elegir al que más gana entre
    // varios con partidas limitadas favorece al que tuvo suerte, así que el campeón de partida (el último candidato) solo
    // se cambia si otro le saca más de una desviación típica de la diferencia (√(n/2) victorias).
    const mejorDe = (cands, s, gana, n) => {
      const nota = s.map((f, i) => (conRefs ? gana[i] * 1e6 : 0) + f);
      let i = nota.indexOf(Math.max(...nota));
      const original = inicial ? cands.length - 1 : -1;
      if (conRefs && original >= 0 && i !== original && gana[i] - gana[original] < Math.sqrt(n / 2)) i = original;
      return { genes: { ...cands[i] }, fitness: s[i] / n, ...(conRefs && { victorias: gana[i] / n }), generacion: p.generaciones - 1, validado: true, ...(i === original && { sinCambios: true }) };
    };
    mejorI = mejorDe(candI, sumaI, ganaI, rivalesI.length * semillas.length);
    mejorG = mejorDe(candG, sumaG, ganaG, rivalesG.length * semillas.length);
    salon.infiltradores[salon.infiltradores.length - 1] = mejorI.genes; // en vez del campeón sin validar de la última
    salon.guardianes[salon.guardianes.length - 1] = mejorG.genes;
  }
  return {
    parametros: p, rondas, curva, mejorInfiltrador: mejorI, mejorGuardian: mejorG, salon,
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
