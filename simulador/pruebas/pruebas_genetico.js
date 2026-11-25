// Pruebas de genetico.js:  node pruebas/pruebas_genetico.js
'use strict';
const assert = require('assert');
const E = require('./cargar.js');
let fallos = 0;
const prueba = (n, fn) => { try { fn(); console.log('OK     ' + n); } catch (e) { fallos++; console.log('FALLO  ' + n + '\n       ' + e.message); } };
const enRango = (g, R) => Object.entries(R).every(([k, [a, b]]) => g[k] >= a && g[k] <= b);

prueba('PRNG: misma semilla = misma secuencia; semillas distintas difieren', () => {
  const a = E.mulberry32(5), b = E.mulberry32(5), c = E.mulberry32(6);
  const sa = Array.from({ length: 20 }, a), sb = Array.from({ length: 20 }, b);
  assert.deepStrictEqual(sa, sb);
  assert.notDeepStrictEqual(sa, Array.from({ length: 20 }, c));
  assert(sa.every(x => x >= 0 && x < 1));
});

prueba('Genes aleatorios, cruzados y mutados (mutación brutal) quedan en rango', () => {
  const rnd = E.mulberry32(1);
  for (const R of [E.RANGOS_INFILTRADOR, E.RANGOS_GUARDIAN]) {
    for (let i = 0; i < 500; i++) {
      const a = E.individuoAleatorio(rnd, R), b = E.individuoAleatorio(rnd, R);
      assert(enRango(a, R) && enRango(E.cruce(a, b, rnd, R), R) && enRango(E.mutar(a, rnd, R, 1, 5), R));
    }
  }
});

prueba('Torneo sesgado hacia el fitness alto (k=3)', () => {
  const rnd = E.mulberry32(2), fit = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const media = Array.from({ length: 2000 }, () => fit[E.torneo(fit, rnd)]).reduce((s, x) => s + x) / 2000;
  assert(media > 6.5, 'media ' + media);
});

prueba('Elitismo: con fitness fijo el mejor nunca empeora y la élite pasa intacta', () => {
  const R = E.RANGOS_INFILTRADOR, rnd = E.mulberry32(3), f = g => -Math.abs(g.wait_time_s - 4) - Math.abs(g.w_light - 10);
  let pob = Array.from({ length: 12 }, () => E.individuoAleatorio(rnd, R)), mejor = -Infinity;
  for (let gen = 0; gen < 25; gen++) {
    const fit = pob.map(f), m = Math.max(...fit);
    assert(m >= mejor, `gen ${gen}: ${m} < ${mejor}`);
    mejor = m;
    const elite = pob[fit.indexOf(m)];
    pob = E.siguienteGeneracion(pob, fit, rnd, R, { probMutacion: 0.3, escalaMutacion: 0.1 });
    assert.deepStrictEqual(pob[0], elite);
  }
  assert(mejor > -3, 'no mejora: ' + mejor);
});

const PEQ = { semilla: 7, poblacion: 3, generaciones: 2, rivales: 1 };
prueba('Co-evolución corta: repetible con la misma semilla, genes en rango, rondas = contarRondas', () => {
  const a = E.coevolucionar(E.crearRonda, PEQ), b = E.coevolucionar(E.crearRonda, PEQ);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.rondas, E.contarRondas({ ...E.PARAMS_GA_POR_DEFECTO, ...PEQ }));
  assert(enRango(a.mejorInfiltrador.genes, E.RANGOS_INFILTRADOR) && enRango(a.mejorGuardian.genes, E.RANGOS_GUARDIAN));
  assert.notDeepStrictEqual(a.curva, E.coevolucionar(E.crearRonda, { ...PEQ, semilla: 8 }).curva);
});

prueba('Arranque en caliente: el individuo 0 es la copia, hasta la mitad copias mutadas, el resto al azar', () => {
  const base = { infiltrador: E.GENES_INFILTRADOR_POR_DEFECTO, guardian: E.GENES_GUARDIAN_POR_DEFECTO }, n = 4, r = 1;
  const lote = E.coevolucion({ semilla: 3, poblacion: n, generaciones: 1, rivales: r, inicial: base }).next().value;
  const inf = k => lote[k * (r + 1)].gi, gua = k => lote[n * (r + 1) + k * (r + 1)].gg; // rondas de cada individuo
  const iguales = (a, b) => Object.keys(b).filter(k => a[k] === b[k]).length / Object.keys(b).length;
  for (const [ind, genes] of [[inf, base.infiltrador], [gua, base.guardian]]) {
    assert.deepStrictEqual(ind(0), genes, 'el 0 es la copia exacta');
    assert(iguales(ind(1), genes) > 0.8 && iguales(ind(1), genes) < 1, 'el 1 es una copia con pocas mutaciones');
    assert(iguales(ind(3), genes) < 0.2, 'el último es al azar');
  }
});

(async () => {
  // Repartir las rondas entre hilos no puede cambiar el resultado (el PRNG del genético no depende de quién juega).
  try {
    const { coevolucionarEnParalelo } = require('./paralelo.js');
    assert.deepStrictEqual(await coevolucionarEnParalelo(PEQ, null, 3), E.coevolucionar(E.crearRonda, PEQ));
    console.log('OK     Co-evolución en 3 hilos = la de un hilo');
  } catch (e) { fallos++; console.log('FALLO  Co-evolución en 3 hilos = la de un hilo\n       ' + e.message); }
  console.log(fallos ? `\n${fallos} fallida(s)` : '\nTodas las pruebas pasan');
  process.exitCode = fallos ? 1 : 0;
})();
