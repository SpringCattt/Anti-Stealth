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

prueba('Mutación: los genes de la rutina mutan con prob; los pesos de la red, ~12 por hijo', () => {
  const R = E.RANGOS_INFILTRADOR, rnd = E.mulberry32(5), base = E.GENES_INFILTRADOR_POR_DEFECTO;
  const pesos = Object.keys(R).filter(k => /^p\d+$/.test(k)), rutina = Object.keys(R).filter(k => !/^p\d+$/.test(k));
  let cR = 0, cP = 0;
  for (let i = 0; i < 400; i++) {
    const m = E.mutar(base, rnd, R, 0.3, 0.1);
    cR += rutina.filter(k => m[k] !== base[k]).length; cP += pesos.filter(k => m[k] !== base[k]).length;
  }
  const fR = cR / (400 * rutina.length), porHijo = cP / 400;
  assert(fR > 0.2 && fR < 0.35, 'rutina: ' + fR.toFixed(2)); // un poco menos de 0.3: alguno queda igual al recortarse al rango
  assert(porHijo > 9 && porHijo < 15, 'pesos por hijo: ' + porHijo.toFixed(1));
});

prueba('Gadgets: el cruce copia cada uno entero de un padre; la mutación mueve ~1 por hijo y poco', () => {
  const R = E.RANGOS_GUARDIAN, rnd = E.mulberry32(6), a = E.GENES_GUARDIAN_POR_DEFECTO;
  const b = { ...a }; for (const k of Object.keys(R)) if (k.startsWith('gadget')) b[k] = 1 - a[k];
  const n = Object.keys(R).filter(k => k.endsWith('_x') && k.startsWith('gadget')).length;
  for (let i = 0; i < 50; i++) {
    const h = E.cruce(a, b, rnd, R);
    for (let g = 0; g < n; g++) {
      const de = [a, b].filter(p => ['x', 'y', 'giro'].every(c => h[`gadget${g}_${c}`] === p[`gadget${g}_${c}`]));
      assert(de.length >= 1, `gadget ${g} mezclado`);
    }
  }
  let movidos = 0, salto = 0;
  for (let i = 0; i < 400; i++) {
    const m = E.mutar(a, rnd, R, 0.3, 0.1);
    for (let g = 0; g < n; g++) if (m[`gadget${g}_x`] !== a[`gadget${g}_x`] || m[`gadget${g}_y`] !== a[`gadget${g}_y`]) {
      movidos++; salto = Math.max(salto, Math.abs(m[`gadget${g}_x`] - a[`gadget${g}_x`]));
    }
  }
  assert(movidos / 400 > 0.7 && movidos / 400 < 1.3, 'gadgets movidos por hijo: ' + movidos / 400);
  assert(salto < 0.2, 'salto máximo ' + salto);
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
  assert.strictEqual(a.salon.infiltradores.length, 1, 'entra el campeón de la última generación');
  const conSalon = E.coevolucionar(E.crearRonda, { ...PEQ, salon: a.salon });
  assert.strictEqual(conSalon.rondas, E.contarRondas({ ...E.PARAMS_GA_POR_DEFECTO, ...PEQ }, 2), 'con salón inicial hay rival del salón desde la gen 0');
  assert.strictEqual(conSalon.salon.guardianes.length, 2, 'el salón se acumula entre entrenamientos');
  const largo = E.coevolucion({ ...PEQ, generaciones: 9 });
  let paso = largo.next(), gens = 0;
  while (!paso.done) { paso = largo.next(paso.value.map(() => ({ infiltrador: 0, guardian: 0, meta: false, derribo: false }))); gens++; }
  assert.strictEqual(paso.value.salon.guardianes.length, 3, 'uno de cada SALON_CADA generaciones (3, 7) y la última (8)');
  assert(enRango(a.mejorInfiltrador.genes, E.RANGOS_INFILTRADOR) && enRango(a.mejorGuardian.genes, E.RANGOS_GUARDIAN));
  assert.notDeepStrictEqual(a.curva, E.coevolucionar(E.crearRonda, { ...PEQ, semilla: 8 }).curva);
});

prueba('Validación: el campeón guardado es el de mejor media en las partidas extra, de entre los n mejores', () => {
  const v = E.coevolucionar(E.crearRonda, { ...PEQ, poblacion: 4, validacion: 2 });
  assert(v.mejorInfiltrador.validado && v.mejorGuardian.validado);
  assert(enRango(v.mejorInfiltrador.genes, E.RANGOS_INFILTRADOR) && enRango(v.mejorGuardian.genes, E.RANGOS_GUARDIAN));
  assert.deepStrictEqual(v.salon.guardianes[v.salon.guardianes.length - 1], v.mejorGuardian.genes, 'el validado entra en el salón');
  assert(v.rondas > E.contarRondas({ ...E.PARAMS_GA_POR_DEFECTO, ...PEQ, poblacion: 4 }), 'juega partidas extra');
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
