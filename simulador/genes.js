// Requiere config.js y red.js. Genes de cada equipo: rango válido [mín, máx] y valores por defecto. Todos los agentes de un equipo comparten genoma.
// El genético muestrea y muta dentro de estos rangos; limitarGenes recorta lo que se salga.
// Solo comportamiento: la física (giro, velocidades, ruido) está en config.js y no la toca el genético.

const RANGOS_INFILTRADOR = {
  w_light: [0, 50],             // coste A* extra de una casilla iluminada ahora: distancia · (1 + w_light)
  w_huella: [0, 20],            // coste extra de una casilla iluminada hace menos de MEMORIA_LUZ_S
  w_peligro: [0, 50],           // coste extra cerca de contactos, ruidos y caídos de la pizarra
  wait_time_s: [0, 10],         // espera máxima en la sombra si lo próximo de la ruta está iluminado
  umbral_sigilo: [0, 15],       // con un Guardián conocido más cerca que esto, va agachado
  umbral_correr: [0, 40],       // con una amenaza más cerca que esto (y más lejos que umbral_sigilo), camina
  paranoia_interval: [1, 20],   // cada cuántos segundos mira a su espalda
  codicia: [0.2, 1],            // fracción de la bolsa a llenar antes de ir a extraer
  prioridad_reanimar: [0, 1],   // peso de reanimar a un aliado frente a ir a por botín
  agresividad: [0, 1],          // radio (· 8 casillas) en el que va a por la espalda de un Guardián que ve
  uso_gadgets: [0, 1],          // PEM (>= 0.25) y señuelo (>= 0.5); el humo va por sus genes humo_*
  umbral_huida: [0, 100],       // si un Guardián lo ve y su barra llega a esto, deja lo que hace y corre a cubierto
  dispersion: [0, 1],           // cuánto evita ir a por el mismo botín que un compañero (0 = van en grupo)
  humo_saqueo: [0, 1],          // >= 0.5: tapa con humo el botín vigilado antes de saquearlo
  humo_cruce: [0, 1],           // >= 0.5: tapa con humo el tramo iluminado de su ruta para cruzarlo
  humo_huida: [0, 1],           // >= 0.5: al ser descubierto lanza humo entre él y el Guardián
  prudencia: [0, 1],            // modo sin amenazas cerca: < 1/3 corre, < 2/3 camina, si no agachado
  radio_cautela: [0, 15],       // a qué distancia un Guardián visto u oído cuenta como amenaza (acecho y oído)
  alerta_oido_s: [0, 10],       // s que va agachado tras oír a un Guardián a <= radio_cautela
  paciencia_s: [0, 20],         // s máximos que acecha quieto a una amenaza cercana antes de seguir
  senuelo_distraccion: [0, 1],  // >= 0.5: señuelo para alejar al Guardián que vigila el botín
  sabotaje: [0, 1],             // peso de ir a apagar una cámara cercana frente a ir a por botín (0 = nunca)
  cebo_sensor: [0, 1],          // peso de ir a hacer saltar a propósito un sensor conocido (atrae a los Guardianes)
  w_memoria: [0, 30],           // coste A* extra por donde el equipo ha visto pasar Guardianes (memoria de patrullas)
  evitar_vigilado: [0, 1],      // cuánto prefiere botines que no vigila una cámara o un Guardián conocido
  radio_giro: [0, 40],          // gira la cabeza hacia un aviso del equipo solo si está a <= esto (0 = nunca)
};

const RANGOS_GUARDIAN = {
  sweepAngle: [0, Math.PI],     // amplitud TOTAL del barrido en cada punto de patrulla
  patrol_bias: [0, 1],          // 0 = vigila VIGILANCIA_MAX_S en cada punto, 1 = patrulla sin detenerse
  investigar: [0, 1],           // fracción del equipo (los más cercanos) que acude a cada alerta
  umbral_sigilo: [0, 10],       // va agachado al acercarse a menos de esto de una alerta
  umbral_correr: [0, 30],       // corre si la alerta está más lejos que esto
  paranoia_interval: [1, 20],   // cada cuántos segundos mira a su espalda
  prioridad_reanimar: [0, 1],   // >= 0.5: reanimar antes que investigar; < 0.5: después
  proporcion_camaras: [0, 1],   // de los 4 gadgets, fracción de cámaras (el resto, sensores)
  camaras_en_cuellos: [0, 1],   // 1 = gadgets en los cuellos de botella de las rutas; 0 = encima del botín
  solapamiento_gadgets: [0, 1], // valor que conserva lo ya vigilado: 0 = se reparten, 1 = se acumulan en el mejor sitio
  prioridad_camaras: [0, 1],    // >= 0.5: reactivar una cámara saboteada antes que investigar; < 0.5: después
  radio_giro: [0, 40],          // gira la cabeza hacia un aviso del equipo solo si está a <= esto (0 = nunca)
  busqueda_s: [0, 20],          // s registrando escondites cerca de la última posición conocida (0 = no busca)
  anticipacion: [0, 1],         // cuánto se adelanta a la velocidad del contacto (0 = va a donde lo vio)
  cortar: [0, 1],               // >= 0.5: un Guardián libre corta la salida (puerta hacia la extracción)
};

// Por defecto: campeones de un genético corto en mapa_casa.js con las reglas actuales (valores exactos: redondear cambia el resultado), para que la
// página y las pruebas partan de un emparejamiento equilibrado (~50 %). Regenerar si cambian mapa o reglas.
const GENES_INFILTRADOR_POR_DEFECTO = {
  w_light: 32.96924474031313, w_huella: 8.062166791360365, w_peligro: 28.42538803225362, wait_time_s: 5.763720481552192, umbral_sigilo: 5.121681029290904, umbral_correr: 27.934690448286528, paranoia_interval: 3.700056600946336, codicia: 0.6316323338026648, prioridad_reanimar: 0.1494294203573841, agresividad: 0.7417676264772957, uso_gadgets: 0.828873527825122, umbral_huida: 25.49278281912013, dispersion: 0.3687660946413774, humo_saqueo: 0.4943528888523382, humo_cruce: 0.8254319697514763, humo_huida: 0.610757618226254, prudencia: 0.45562958930908726, radio_cautela: 6.405532281194444, alerta_oido_s: 6.62565091523909, paciencia_s: 14.691428785628693, senuelo_distraccion: 0.8028782903679301, sabotaje: 0.10122784865957989, cebo_sensor: 0.1142737626537645, w_memoria: 4.521181476984791, evitar_vigilado: 0.5980442677377921, radio_giro: 13.589639791690653,
};
const GENES_GUARDIAN_POR_DEFECTO = {
  sweepAngle: 3.0329117168182, patrol_bias: 0.56638302114839, investigar: 0.1805836611302346, umbral_sigilo: 6.435422698629084, umbral_correr: 0.6106336015434617, paranoia_interval: 16.51243150322974, prioridad_reanimar: 0.7975920210304168, proporcion_camaras: 0.7840160052336459, camaras_en_cuellos: 0.26907621896685036, solapamiento_gadgets: 0.2810608416806356, prioridad_camaras: 0.08871287750519802, radio_giro: 11.410003941225723, busqueda_s: 7.133942381093306, anticipacion: 0.5943609048020908, cortar: 0.2963752422007936,
};

// Pesos de la política neuronal de cada bando (p0, p1, ...). A 0 por defecto: la red elige siempre la rutina.
Object.assign(RANGOS_INFILTRADOR, rangosRed(ENTRADAS_INF, ACCIONES_INF.length + MODOS_RED.length));
Object.assign(RANGOS_GUARDIAN, rangosRed(ENTRADAS_GUA, ACCIONES_GUA.length + MODOS_RED.length));
Object.assign(GENES_INFILTRADOR_POR_DEFECTO, pesosCero(rangosRed(ENTRADAS_INF, ACCIONES_INF.length + MODOS_RED.length)));
Object.assign(GENES_GUARDIAN_POR_DEFECTO, pesosCero(rangosRed(ENTRADAS_GUA, ACCIONES_GUA.length + MODOS_RED.length)));

// Copia los genes recortados a su rango. Un gen ausente o no numérico es un genoma mal construido: se lanza error.
function limitarGenes(genes, rangos) {
  const limpio = {};
  for (const [nombre, [min, max]] of Object.entries(rangos)) {
    const valor = genes[nombre];
    if (typeof valor !== 'number' || !Number.isFinite(valor)) throw new Error(`Gen inválido: ${nombre} = ${valor}`);
    limpio[nombre] = Math.min(max, Math.max(min, valor));
  }
  return limpio;
}
