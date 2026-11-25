// Carga la simulación en el ámbito global (como el navegador con <script src>) y expone lo que usan las pruebas y el
// genético. Uso: const E = require('./cargar.js'). El orden es el mismo que el de index.html, sin render.js ni principal.js.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = [
  '../mapa_casa.js', 'config.js', 'red.js', 'genes.js', 'raycast.js', 'astar.js', 'pizarra.js', 'agente.js',
  'guardian.js', 'infiltrador.js', 'gadgets.js', 'fitness.js', 'nucleo.js', 'genetico.js',
];
for (const f of ARCHIVOS) {
  const ruta = path.join(RAIZ, f);
  vm.runInThisContext(fs.readFileSync(ruta, 'utf8'), { filename: ruta });
}
// Las const y class de los scripts viven en el ámbito léxico global (no en globalThis): se leen con otro script.
const NOMBRES = `MAPA_DISENO, mapaAlturas, transitable, aDistancia, celdaEn, centroCelda, distanciaRayo, lineaDeVista, intensidadVision,
  marcarIluminadas, buscarRuta, rotateTowards, BarraExposicion, TeamBlackboard, Agente, Guardian, Infiltrador, GameEngine,
  lanzarGadget, celdasEnRadio, planificarGadgetsGuardianes, evaluarFitness, PESOS_FITNESS, crearSimulacion, simular, avanzar, mulberry32, limitarGenes,
  RANGOS_INFILTRADOR, RANGOS_GUARDIAN, GENES_INFILTRADOR_POR_DEFECTO, GENES_GUARDIAN_POR_DEFECTO,
  individuoAleatorio, torneo, cruce, mutar, siguienteGeneracion, coevolucionar, coevolucion, jugarRonda, contarRondas, PARAMS_GA_POR_DEFECTO,
  GRADOS, TICK_MS, DT, MAX_ACUMULADO_MS, TICKS_RONDA, TIEMPO_RONDA_S, BONO_PRIMERA_EXTRACCION_S, ALTURA, VEL_GIRO, VISION,
  ATURDIDOR, NEUTRALIZACION, MAX_DERRIBOS, REANIMAR_S, COOLDOWN_BOTIN_S, CONFISCAR_S, DEVOLVER_S, RECOGER_SUELO_S,
  SAQUEO_S, BOLSA_CAPACIDAD, BOLSA_VEL_MIN, VALOR_BOTIN, BOTIN_PARA_GANAR, HIERBA_REVELA_S, HIERBA_DERRIBA_S,
  GADGETS_POR_EQUIPO, HUMO, SENUELO, PEM, SENSOR, LKP_S, MODOS, AGENTES_POR_EQUIPO,
  PREPARACION_S, FLANCO_ALERTA, LUZ_REFRESCO_TICKS, DESPERTAR_S, LANZAMIENTO_MAX, SABOTAJE_S, REACTIVAR_S, CAMARA_DETECCION_S, RECARGA_GADGET_S, MEMORIA_PATRULLA_S, CORTE_MAX_S,
  evaluarRed, rangosRed, elegir, OCULTAS_RED, ACCIONES_INF, ACCIONES_GUA, MODOS_RED, ENTRADAS_INF, ENTRADAS_GUA, AGUANTE`;
// Por dónde pasan los Infiltradores (pruebas/grabar_rastros.js): los Guardianes colocan sus gadgets con ello.
const RUTA_RASTROS = path.join(RAIZ, 'rastros.json');
if (fs.existsSync(RUTA_RASTROS)) vm.runInThisContext('RASTROS = ' + fs.readFileSync(RUTA_RASTROS, 'utf8'));
const G = vm.runInThisContext(`({ ${NOMBRES} })`);

// Ronda del genético: mapa real, sin render; la semilla la pone el genético.
// fijarRastros(datos | null): cambia RASTROS (para las pruebas de colocación). Devuelve los que había.
const fijarRastros = datos => { const antes = vm.runInThisContext('RASTROS'); globalThis.__rastros = datos; vm.runInThisContext('RASTROS = globalThis.__rastros'); return antes; };
module.exports = { ...G, fijarRastros, crearRonda: (gi, gg, semilla) => G.crearSimulacion(gi, gg, { semilla }) };
