// ¿Han aprendido de verdad? Enfrenta los equipos de "nuevos" y "viejos" contra los de uno o más archivos de referencia
// (el primero de ellos es "viejos") y da el % de victorias de los Infiltradores en cada cruce, con su margen (95 %).
//  - Infiltrador: media de (nuevo vs cada Guardián de referencia) - media de (viejo vs los mismos). > 0 = ha mejorado.
//  - Guardián:    media de (cada Infiltrador de referencia vs viejo) - media de (los mismos vs nuevo). > 0 = ha mejorado.
// Con una sola referencia es "nuevos contra viejos". Con varias (campeones anteriores) evita aceptar como mejora lo que
// solo gana al último rival (piedra-papel-tijera): hay que rendir al menos igual contra todos.
// Uso: node pruebas/comparar.js nuevos.json viejos.json [más_referencias.json ...] [rondas por cruce = 300] [--json]
// Reparte las rondas entre procesos (uno por núcleo físico). Con --json escribe el resumen como JSON en la última línea.
'use strict';
const { spawn } = require('child_process');
const os = require('os'), fs = require('fs');

const args = process.argv.slice(2).filter(a => a !== '--json');
const N = /^\d+$/.test(args[args.length - 1] || '') ? Number(args.pop()) : 300;
const [rutaNuevos, ...referencias] = args; // referencias[0] = viejos
// Cruces [infiltrador, guardián]: nuevo y viejo de cada bando contra cada referencia del otro.
const CRUCES = referencias.flatMap((_, r) => [['nuevo', `r${r}`], ['viejo', `r${r}`], [`r${r}`, 'nuevo'], [`r${r}`, 'viejo']]);

if (process.env.PARTE !== undefined) {
  // Proceso hijo: juega su parte de las semillas de cada cruce y devuelve las victorias.
  const E = require('./cargar.js');
  const leer = ruta => JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const equipos = { nuevo: leer(rutaNuevos), viejo: leer(referencias[0]) };
  referencias.forEach((ruta, r) => { equipos[`r${r}`] = leer(ruta); });
  const parte = Number(process.env.PARTE), partes = Number(process.env.PARTES);
  const victorias = CRUCES.map(([i, g]) => {
    const gi = E.limitarGenes(equipos[i].mejorInfiltrador.genes, E.RANGOS_INFILTRADOR), gg = E.limitarGenes(equipos[g].mejorGuardian.genes, E.RANGOS_GUARDIAN);
    let w = 0;
    for (let s = 1 + parte; s <= N; s += partes) {
      const m = E.crearSimulacion(gi, gg, { semilla: 5000 + s });
      E.simular(m, E.TICKS_RONDA);
      if (m.ganador === 'infiltradores') w++;
    }
    return w;
  });
  console.log(JSON.stringify(victorias));
} else {
  if (!rutaNuevos || !referencias.length) { console.error('Uso: node pruebas/comparar.js nuevos.json viejos.json [más.json ...] [rondas] [--json]'); process.exit(1); }
  const partes = Math.max(1, Math.floor(os.availableParallelism() / 2));
  Promise.all(Array.from({ length: partes }, (_, k) => new Promise((ok, mal) => {
    let salida = '';
    const h = spawn(process.execPath, [__filename, ...process.argv.slice(2)], { env: { ...process.env, PARTE: String(k), PARTES: String(partes) } });
    h.stdout.on('data', d => salida += d);
    h.stderr.pipe(process.stderr);
    h.on('close', codigo => codigo ? mal(new Error('proceso ' + k + ' falló')) : ok(JSON.parse(salida)));
  }))).then(hechas => {
    const pct = CRUCES.map((c, k) => 100 * hechas.reduce((s, v) => s + v[k], 0) / N);
    const nombre = x => x === 'nuevo' || x === 'viejo' ? x : `ref ${Number(x.slice(1)) + 1}`;
    const margen = p => 196 * Math.sqrt((p / 100) * (1 - p / 100) / N);
    CRUCES.forEach(([i, g], k) => console.log(`Infiltrador ${nombre(i).padEnd(6)} vs Guardián ${nombre(g).padEnd(6)} | infiltradores ${pct[k].toFixed(0).padStart(3)} % ± ${margen(pct[k]).toFixed(0)}`));
    const media = f => { const v = CRUCES.map((c, k) => (f(c) ? pct[k] : null)).filter(x => x !== null); return v.reduce((a, b) => a + b, 0) / v.length; };
    const infiltrador = media(([i, g]) => i === 'nuevo' && g[0] === 'r') - media(([i, g]) => i === 'viejo' && g[0] === 'r');
    const guardian = media(([i, g]) => g === 'viejo' && i[0] === 'r') - media(([i, g]) => g === 'nuevo' && i[0] === 'r');
    const ruido = 196 * Math.sqrt(0.25 * 2 / (N * referencias.length)); // margen de la diferencia de medias, en el peor caso
    console.log(`Infiltrador: ${infiltrador > 0 ? 'mejor' : 'no mejor'} (${infiltrador.toFixed(0)} puntos de media contra ${referencias.length} Guardián(es) de referencia; ruido ±${ruido.toFixed(0)})`);
    console.log(`Guardián:    ${guardian > 0 ? 'mejor' : 'no mejor'} (${guardian.toFixed(0)} puntos de media contra ${referencias.length} Infiltrador(es) de referencia; ruido ±${ruido.toFixed(0)})`);
    if (process.argv.includes('--json')) console.log(JSON.stringify({ infiltrador, guardian, ruido, cruces: CRUCES.map((c, k) => ({ infiltrador: c[0], guardian: c[1], pct: pct[k] })) }));
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
