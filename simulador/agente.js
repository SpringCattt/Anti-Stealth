// Agente base: rotación física, retardo de reacción, alturas, barra de exposición, navegación A* y paranoia.
// Requiere config.js, raycast.js y astar.js. Guardian e Infiltrador heredan de aquí y solo implementan pensar(motor).
// El motor resuelve el movimiento (colisiones), la percepción, el combate y las acciones; el agente solo decide.

// Gira de current hacia target como mucho maxSpeed·dt, siempre por el camino más corto.
function rotateTowards(currentAngle, targetAngle, maxSpeed, dt) {
  const diff = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
  const paso = maxSpeed * dt;
  return Math.abs(diff) <= paso ? targetAngle : currentAngle + Math.sign(diff) * paso;
}

// Barra 0..BARRA_MAX: sube mientras está expuesta y decae si no. actualizar devuelve true al llenarse.
class BarraExposicion {
  constructor({ subida, bajada }) {
    this.subida = subida;
    this.bajada = bajada;
    this.valor = 0;
  }

  actualizar(expuesta, dt) {
    this.valor = Math.min(BARRA_MAX, Math.max(0, this.valor + (expuesta ? this.subida : -this.bajada) * dt));
    return this.valor >= BARRA_MAX;
  }
}

class Agente {
  // id: índice en motor.agentes. equipo: 'guardianes' | 'infiltradores'. genes: los del equipo (ver genes.js).
  constructor(id, equipo, x, y, angulo, pizarra, genes) {
    this.id = id;
    this.equipo = equipo;
    this.esGuardian = equipo === 'guardianes';
    this.vision = this.esGuardian ? VISION.guardian : VISION.infiltrador;
    // La barra mide lo que le hace el equipo contrario: al Infiltrador el aturdidor, al Guardián la neutralización.
    this.barra = new BarraExposicion(this.esGuardian ? NEUTRALIZACION : ATURDIDOR);
    this.pizarra = pizarra;
    pizarra.miembros.push(this);
    this.genes = genes;

    this.x = x; this.y = y; this.angulo = angulo;
    this.anguloDeseado = angulo;  // lo fija pensar() cuando no hay alerta
    this.dirX = 0; this.dirY = 0; // intención de movimiento (cualquier longitud; el motor la normaliza)
    this.modo = 'caminar';        // 'sigilo' | 'caminar' | 'correr'
    this.bolsa = 0;               // botín que lleva (el Guardián, lo confiscado)

    this.estado = 'activo';       // 'activo' | 'inconsciente' | 'eliminado'
    this.derribos = 0;
    this.canalizando = false;     // Guardián usando el aturdidor (lo marca el motor cada tick)
    this.enemigoVisto = null;     // agente enemigo más cercano a la vista en este tick
    this.estimulos = [];          // { x, y, tipo, espera } pendientes de reacción
    this.foco = null;             // punto hacia el que gira en ALERT
    this.alerta = 0;              // s que le quedan en ALERT
    this.tiempoRuido = 0;

    this.ruta = null;             // casillas pendientes (A*)
    this.meta = -1;               // casilla a la que va la ruta
    this.replan = 0;              // s hasta recalcular la ruta
    this.accion = null;           // { tipo, objetivo, duracion, progreso } la avanza el motor
    this.cooldownBotin = 0;       // s sin poder recoger botín (tras reanimarse)
    this.tiempoHierba = 0;        // s seguidos en la hierba (solo cuenta para Guardianes)
    this.revelado = false;        // Guardián revelado a los Infiltradores por pisar hierba
    this.paranoia = 0;            // s desde el último chequeo de espalda
    this.mirarAtras = 0;          // s que le quedan mirando a la espalda
  }

  get altura() { return MODOS[this.modo].altura; }
  get activo() { return this.estado === 'activo'; }
  get moviendose() { return this.dirX !== 0 || this.dirY !== 0; }

  // PENALIZED es un tope: baja ALERT a 110 °/s pero no sube PATROL de 75.
  get modoGiro() {
    const base = this.enemigoVisto || this.alerta > 0 ? 'ALERT' : 'PATROL';
    const penalizado = this.canalizando || (this.modo === 'correr' && this.moviendose);
    return penalizado && VEL_GIRO[base] > VEL_GIRO.PENALIZED ? 'PENALIZED' : base;
  }

  get velocidad() {
    const lleno = Math.min(1, this.bolsa / BOLSA_CAPACIDAD);
    const v = MODOS[this.modo].velocidad * (1 - (1 - BOLSA_VEL_MIN) * lleno);
    // Apuntando el aturdidor (canalizando) no se puede correr: como mucho VEL_APUNTANDO.
    return this.canalizando ? Math.min(v, VEL_APUNTANDO) : v;
  }

  // Sonido o radio fuera de la vista: reacciona pasados RETARDO_REACCION_S. Inconsciente no oye nada.
  // Aviso del equipo (pizarra). La información ya está en la pizarra; girar la cabeza hacia él es opcional: solo si el
  // punto está a <= radio_giro (gen), y entonces con el retardo de reacción.
  recibirEstimulo(x, y, tipo) {
    if (this.activo && Math.hypot(x - this.x, y - this.y) <= this.genes.radio_giro) this.estimulos.push({ x, y, tipo, espera: RETARDO_REACCION_S });
  }

  // Contacto visual directo: reacción inmediata (sin cola).
  ver(enemigo) {
    this.enemigoVisto = enemigo;
    this.foco = { x: enemigo.x, y: enemigo.y };
    this.alerta = ALERTA_DURACION_S;
  }

  derribar() {
    this.derribos++;
    this.estado = this.derribos >= MAX_DERRIBOS ? 'eliminado' : 'inconsciente';
    this.tiempoCaido = 0; // s inconsciente (a DESPERTAR_S se levanta solo)
    this.dirX = this.dirY = 0;
    this.barra.valor = 0;
    this.estimulos = [];
    this.accion = null;
    this.ruta = null;
    this.alerta = 0;
    this.tiempoHierba = 0;
  }

  reanimar() {
    this.estado = 'activo';
    this.cooldownBotin = COOLDOWN_BOTIN_S;
    this.modo = 'caminar';
  }

  parar() {
    this.dirX = this.dirY = 0;
  }

  distanciaA(p) {
    return Math.hypot(p.x - this.x, p.y - this.y);
  }

  // Coste extra por casilla para el A* de este agente (null = ninguno). Lo redefine cada bando.
  costeRuta(motor) {
    return null;
  }

  // Sigue (o recalcula) la ruta A* hasta la casilla meta. Devuelve true cuando ya está en su centro.
  // Sin ruta posible se queda quieto y lo reintenta cada REPLAN_S.
  irA(motor, meta) {
    const mapa = motor.mapa, aqui = celdaEn(mapa, this.x, this.y);
    this.replan -= DT;
    if (meta !== this.meta || this.replan <= 0 || !this.ruta) {
      this.meta = meta;
      this.replan = REPLAN_S;
      this.ruta = buscarRuta(mapa, aqui, meta, this.costeRuta(motor)) || [];
    }
    while (this.ruta.length) {
      const [cx, cy] = centroCelda(mapa, this.ruta[0]);
      if (Math.hypot(cx - this.x, cy - this.y) < 0.15) { this.ruta.shift(); continue; }
      this.dirX = cx - this.x;
      this.dirY = cy - this.y;
      this.anguloDeseado = Math.atan2(this.dirY, this.dirX);
      return false;
    }
    const [mx, my] = centroCelda(mapa, meta);
    // Ya en la casilla meta (el A* da ruta vacía) pero lejos del centro: va hacia él en vez de quedarse clavado.
    if (aqui === meta && Math.hypot(mx - this.x, my - this.y) >= 0.15) {
      this.dirX = mx - this.x;
      this.dirY = my - this.y;
      this.anguloDeseado = Math.atan2(this.dirY, this.dirX);
      return false;
    }
    this.parar();
    return aqui === meta;
  }

  // Lo llama el motor cada tick antes de mover: decisiones del bando + chequeo de espalda (paranoia_interval).
  decidir(motor) {
    if (!this.activo) return;
    if (!this.accion) this.pensar(motor);
    else this.parar();
    this.paranoia += DT;
    if (this.mirarAtras > 0) {
      this.mirarAtras -= DT;
    } else if (this.paranoia >= this.genes.paranoia_interval && !this.enemigoVisto) {
      this.paranoia = 0;
      this.mirarAtras = PARANOIA_DURACION_S;
    }
  }

  pensar(motor) {}

  // Cola de reacción, temporizador de alerta y giro físico. Lo llama el motor una vez por tick.
  actualizarGiro(dt) {
    if (!this.activo) return;
    for (const e of this.estimulos) e.espera -= dt;
    while (this.estimulos.length && this.estimulos[0].espera <= 0) {
      const e = this.estimulos.shift();
      if (!this.enemigoVisto) { this.foco = { x: e.x, y: e.y }; this.alerta = ALERTA_DURACION_S; }
    }
    if (!this.enemigoVisto) this.alerta = Math.max(0, this.alerta - dt);

    const objetivo = this.enemigoVisto
      ? Math.atan2(this.enemigoVisto.y - this.y, this.enemigoVisto.x - this.x)
      : this.alerta > 0 && this.foco && this.mirarAtras <= 0
        ? Math.atan2(this.foco.y - this.y, this.foco.x - this.x)
        : this.anguloDeseado + (this.mirarAtras > 0 ? Math.PI : 0);
    this.angulo = rotateTowards(this.angulo, objetivo, VEL_GIRO[this.modoGiro], dt);
  }
}
