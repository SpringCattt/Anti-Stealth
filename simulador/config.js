// Anti-Stealth v2.1: todas las constantes de la simulación. Se carga antes que el resto de scripts.
// Unidades: distancias en casillas, tiempos en segundos, ángulos en radianes (0 = este, PI/2 = sur, eje y hacia abajo).
// Fuera de aquí, a propósito: rangos de genes (genes.js), pesos de fitness (fitness.js) y parámetros del genético (genetico.js).

const GRADOS = Math.PI / 180;

// --- Bucle de tiempo fijo ---
const TICKS_POR_SEGUNDO = 60;
const TICK_MS = 1000 / TICKS_POR_SEGUNDO;    // 16.67 ms reales por paso lógico
const DT = 1 / TICKS_POR_SEGUNDO;            // 0.01666 s simulados por paso lógico
const MAX_ACUMULADO_MS = 250;                // tope del acumulador: tras una pausa se pierden ticks en vez de encadenar cientos
const HEADLESS = typeof window === 'undefined'; // Node (genético) = sin render; navegador = Three.js
const SEMILLA_FIJA = 1;                      // semilla por defecto de la ronda (genético y pruebas: repetible)

// --- Alturas discretas (celdas y agentes) ---
const ALTURA = { SUELO: 0, CAJA: 1, MURO: 3, AGACHADO: 1, DE_PIE: 2 };
// Código de MAPA_DISENO -> altura de la celda. El resto de códigos (. g B S G E) son suelo transitable.
const ALTURA_DE_CODIGO = { '#': ALTURA.MURO, c: ALTURA.CAJA };
// Capas de raycasting 2D: un rayo a altura h choca con las celdas de altura >= h (el humo cuenta como muro).
const RAYO_BAJO = 1;   // choca con cajas (1) y muros (3)
const RAYO_ALTO = 2;   // ignora cajas, solo muros

// --- Rotación física (anti-aimbot). El genético NO controla estas velocidades. ---
const VEL_GIRO = {
  PATROL: 75 * GRADOS,     // barrido normal
  ALERT: 200 * GRADOS,     // viendo a un enemigo o investigando una alerta
  PENALIZED: 110 * GRADOS, // tope mientras se canaliza el aturdidor o se corre
};
const RETARDO_REACCION_S = 0.25; // sonido o radio fuera de la vista: espera antes de girar en modo ALERT
const ALERTA_DURACION_S = 3;     // tras el último estímulo, vuelve a PATROL pasado este tiempo
const PARANOIA_DURACION_S = 2.7; // lo que dura un chequeo de espalda (180° a 75°/s = 2.4 s, más margen)

// --- Visión ---
const VISION = {
  guardian: { apertura: 90 * GRADOS, alcance: 9, caida: true },     // cono amplio con caída de luz
  infiltrador: { apertura: 40 * GRADOS, alcance: 13, caida: false }, // visión nocturna: estrecho y largo, sin caída
  camara: { apertura: 40 * GRADOS, alcance: 10, caida: false },      // gadget: cono estrecho a altura 2 que barre
};
const LUZ_MIN = 0.25;                // intensidad de la luz del Guardián en el borde del alcance (1 en su posición)
const PASO_RAYO_RENDER = 0.5 * GRADOS; // separación de los rayos que dibujan el cono (solo visual; con 2° el cono iba a saltos al barrer una puerta)
const MEMORIA_LUZ_S = 4;             // lo que dura la huella de luz que recuerdan los Infiltradores

// --- Movimiento y ruido ---
const RADIO_AGENTE = 0.3;
const MODOS = {
  sigilo: { velocidad: 1.5, ruido: 1.5, altura: ALTURA.AGACHADO }, // agachado
  caminar: { velocidad: 3.5, ruido: 4, altura: ALTURA.DE_PIE },
  correr: { velocidad: 6, ruido: 9, altura: ALTURA.DE_PIE },       // gira con tope PENALIZED
};
const RUIDO_INTERVALO_S = 0.5; // un agente en movimiento (o reanimando) emite un ruido cada este tiempo
const RUIDO_MEMORIA_S = 3;     // lo que dura un ruido en la pizarra
const REPLAN_S = 1;            // cada cuánto se recalcula la ruta A* aunque la meta no cambie

// --- Pizarra (blackboard / radio) ---
const LKP_S = 5.0;             // Last Known Position: lo que dura un contacto visual tras perderse la vista
const RADIO_PELIGRO = 3;       // alrededor de un contacto, ruido o caído, las casillas cuestan w_peligro más
const PELIGRO_CAIDO_S = 10;    // un aliado caído marca peligro durante este tiempo

// --- Combate por barra de exposición (0..100, en %/s) ---
const BARRA_MAX = 100;
let VEL_APUNTANDO = 3.5; // velocidad máxima de un Guardián mientras apunta el aturdidor (no puede correr y apuntar)
const ATURDIDOR = { rango: 4.5, subida: 66.6, bajada: 40 };        // Guardián -> Infiltrador en su cono: 1.5 s (alcance 4.5: con 6 cubría una sala entera desde la puerta)
const NEUTRALIZACION = { rango: 1.5, subida: 100, bajada: 50 };    // Infiltrador por detrás y sin ser visto: 1.0 s
// true: los Guardianes ganan en cuanto no queda ningún Infiltrador activo (todos caídos a la vez).
// false: solo si están todos eliminados (MAX_DERRIBOS); los inconscientes se levantan a los DESPERTAR_S.
let GANA_CON_TODOS_CAIDOS = false;
let DESPERTAR_S = 20; // un inconsciente se levanta solo pasado este tiempo (0 = solo con reanimación). let: lo barre el ajuste
let MAX_DERRIBOS = 4;        // al cuarto derribo queda eliminado (con 5 los infiltradores entrenados ganaban el 78 %)

// --- Interacciones (duración en s; todas cancelables si el agente se aleja o cae) ---
const RANGO_INTERACCION = 1.2;  // distancia máxima a un cuerpo para reanimar o confiscar
const REANIMAR_S = 5;           // emite ruido RUIDO_REANIMAR mientras dura
const RUIDO_REANIMAR = 4;
const COOLDOWN_BOTIN_S = 3;     // tras reanimarse no puede recoger botín
const SAQUEO_S = 2;             // llenar la bolsa en un punto B
const RECOGER_SUELO_S = 1.5;    // Infiltrador recogiendo botín del suelo
const CONFISCAR_S = 3;          // Guardián recogiendo del suelo o confiscando un cuerpo
const DEVOLVER_S = 6;           // Guardián devolviendo botín a un punto B

// --- Economía ---
const RADIO_CUSTODIA = 6;         // casillas: un Guardián a <= RADIO_CUSTODIA de un punto B con botín lo está custodiando (fitness)
const VALOR_BOTIN = 100;          // por punto B
const BOLSA_CAPACIDAD = 35; // con 100 para ganar hacen falta 3 viajes (con 60 bastaban 2: demasiado fácil en 3 minutos)
let BOLSA_VEL_MIN = 0.75;         // con la bolsa llena va al 75 % (lineal); con 0.5 cargar era una sentencia
const BOLSA_SUELTA = 0.5;         // al caer suelta el 50 % al suelo y retiene el resto en el cuerpo

// --- Exterior (hierba 'g') para Guardianes ---
// Desactivado: con spawn y extracción en las 4 esquinas exteriores los Guardianes pueden salir. true = regla antigua.
let HIERBA_PROHIBIDA_GUARDIAN = false;
const HIERBA_REVELA_S = 2;       // > 2 s seguidos: su posición queda revelada a los Infiltradores el resto de la ronda
const HIERBA_DERRIBA_S = 5;       // > 5 s seguidos: cae inconsciente
const COSTE_HIERBA_GUARDIAN = 30; // coste A* extra de una casilla de hierba para los Guardianes

// --- Patrulla ---
const VIGILANCIA_MAX_S = 4;       // barrido en cada punto de patrulla cuando patrol_bias = 0

// --- Gadgets (4 por equipo y ronda) ---
const GADGETS_POR_EQUIPO = 4;
const LANZAMIENTO_MAX = 8;        // casillas a las que un Infiltrador puede lanzar humo o señuelo (con línea de vista)
let RECARGA_GADGET_S = 30;       // los Infiltradores recuperan 1 herramienta cada 30 s (hasta GADGETS_POR_EQUIPO)
const GADGET_COOLDOWN_S = 4;      // un Infiltrador no lanza dos herramientas seguidas antes de esto
// Barrido de las cámaras: ±amplitud alrededor del ángulo base a velocidad (rad/s), parando pausa s en cada extremo.
// Sabotaje: un Infiltrador junto a una cámara la apaga en SABOTAJE_S (queda apagada hasta que un Guardián la
// reactive, quedándose junto a ella REACTIVAR_S). Los Guardianes solo saben que está apagada cuando uno la ve.
let CAMARA_DETECCION_S = 1.5; // s seguidos en el cono de una cámara para que dé la alarma
const SABOTAJE_S = 3;
const REACTIVAR_S = 3;
const CAMARA_BARRIDO = { amplitud: 45 * GRADOS, velocidad: 30 * GRADOS, pausa: 0.5 };
// Sensor = trampa escondida: detecta a quien camina o corre a <= radio en 360° (sin que le afecten humo, oscuridad
// ni cajas) pero solo da una alerta en su propio sitio (no la posición del Infiltrador); luego se recarga.
// Un Infiltrador solo lo descubre a <= vistaInfiltrador (o al hacerlo saltar). Cada hueco de gadget da porHueco sensores.
const SENSOR = { radio: 2, recarga: 12, vistaInfiltrador: 2.5, porHueco: 2 };
// Bloquea la visión como un muro de altura 3, pero: tarda "mecha" s en salir (no es un botón de escape instantáneo),
// el lanzamiento hace un ruido de radio "ruido" y a <= "vistaCerca" casillas se sigue viendo a través.
const HUMO = { radio: 2.5, duracion: 8, mecha: 1.5, ruido: 6, vistaCerca: 1.5 };
const SENUELO = { ruido: 7, duracion: 5 };  // ruidos falsos de radio 7 cada RUIDO_INTERVALO_S
const PEM = { radio: 4, duracion: 10 };     // desactiva los gadgets enemigos

// --- Partida ---
const AGENTES_POR_EQUIPO = 3;     // base de entrenamiento 3 contra 3; escalable a 5 (index.html?n=5)
let BOTIN_PARA_GANAR = 100;
let TIEMPO_RONDA_S = 180;
const BONO_PRIMERA_EXTRACCION_S = 30;
// Fase previa (no cuenta en el reloj): los Guardianes llevan sus gadgets a su sitio y se colocan; los Infiltradores
// esperan en S. Los gadgets que no se hayan colocado al acabarla se pierden.
const PREPARACION_S = 12;
const FLANCO_ALERTA = 3;
const HUIDA_MEMORIA_S = 1; // un Infiltrador descubierto sigue huyendo hasta llevar esto sin que lo vean
const MEMORIA_PATRULLA_S = 45; // cuánto recuerda un equipo por dónde ha visto pasar enemigos (memoria de patrullas)
const CORTE_MAX_S = 10;          // s máximos que un Guardián vigila una puerta cortando la salida
const CORTE_ENFRIAMIENTO_S = 20; // tras cortar, s sin volver a hacerlo
const RADIO_BUSQUEDA = 6;      // casillas alrededor de la última posición conocida donde un Guardián busca escondites
const HUIDA_COMPROMISO_S = 0.4; // tiempo mínimo que mantiene el refugio elegido (evita oscilar entre dos)
const RADIO_HUIDA = 10; // pasos máximos que busca un Infiltrador descubierto para encontrar cubierta
let CAMARAS_COMO_LUZ = true; // los Infiltradores evitan el cono de una cámara que tienen a la vista, como una linterna
const LUZ_REFRESCO_TICKS = 6; // la luz que ven los Infiltradores se recalcula cada 0.1 s (era el 70 % del coste de una ronda) // casillas a las que se quedan del punto los Guardianes que acuden con otro a una alerta
// --- Política neuronal (red.js) ---
// Cada TICKS_DECISION la red de cada agente elige una acción de su menú y un modo de movimiento. La acción 0 es la
// rutina (la IA programada); el modo 0 deja el que ponga la acción. Las entradas las dan los métodos observar().
const OCULTAS_RED = 12;
const TICKS_DECISION = 15; // 0.25 s
const ACCIONES_INF = ['rutina', 'irSaquear', 'irExtraer', 'esconderse', 'esperar', 'atacarYa', 'irSabotear', 'humo', 'distraerYa', 'pem'];
const ACCIONES_GUA = ['rutina', 'custodiar', 'cortarYa', 'buscarYa', 'esperar', 'patrullar', 'investigarYa', 'emboscarSalida', 'perseguirCargado'];
const MODOS_RED = [null, 'sigilo', 'caminar', 'correr'];
const ENTRADAS_INF = 21;
const ENTRADAS_GUA = 18;
// --- Aguante (los dos bandos) ---
// Correr lo gasta (gasto/s); caminar lo recupera despacio y quieto o agachado más rápido. A 0 no se puede correr hasta
// tener otra vez minimoParaCorrer. Sin esto correr era gratis y el genético aprendía a correr siempre.
const AGUANTE = { max: 100, gasto: 20, recuperaCaminando: 8, recuperaQuieto: 15, minimoParaCorrer: 30 };
const TICKS_RONDA = (PREPARACION_S + TIEMPO_RONDA_S + BONO_PRIMERA_EXTRACCION_S) * TICKS_POR_SEGUNDO; // tope absoluto de una ronda
