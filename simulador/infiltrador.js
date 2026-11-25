// IA del Infiltrador. Requiere agente.js y red.js. Cada TICKS_DECISION su red (genes p0, p1, ...) elige una acción de
// ACCIONES_INF y un modo (MODOS_RED) a partir de observar(). La acción 0, "rutina", es la IA programada de abajo; las
// demás fuerzan una conducta (saquear, extraer, esconderse, esperar, atacar, sabotear, humo, distraer).
// Rutina, en cada tick:
//  - Huida: si un Guardián lo ve y su barra >= umbral_huida, suelta lo que hace y corre a la cubierta más cercana.
//  - Amenazas: Guardianes vistos por el equipo (contactos y LKP) y Guardianes oídos (ruidos de la pizarra) a <= radio_cautela.
//  - Modo: agachado con una amenaza a menos de umbral_sigilo (o durante alerta_oido_s tras oír una), caminando a menos de
//    umbral_correr; sin amenazas cerca, su modo base según prudencia (< 1/3 corre, < 2/3 camina, si no agachado).
//  - Acecho (paciencia_s): con una amenaza a <= radio_cautela, se queda quieto y agachado mirándola hasta que se aleje.
//  - Distracción (senuelo_distraccion >= 0.5): antes de saquear un botín vigilado lanza un señuelo al otro lado.
//  - Sabotaje (sabotaje): apagar una cámara encendida a <= 15 casillas compite con el botín con peso sabotaje.
//  - Sensores conocidos (vistos por el equipo; se recargan tras avisar): los cruza agachado si están armados, salvo que
//    vaya a hacerlo a propósito como cebo (cebo_sensor; solo si un compañero va a por botín, para distraer).
//  - Humo táctico (los Infiltradores ven a través; Guardianes y cámaras no). Cada táctica se activa con su gen >= 0.5:
//     humo_saqueo: tapa el botín al que va si una cámara o un Guardián conocido lo vigila;
//     humo_cruce:  tapa el tramo iluminado de su ruta en vez de esperar a que se vaya la luz;
//     humo_huida:  al ser descubierto, lo lanza entre él y quien lo ve.
//  - Otras herramientas (uso_gadgets): señuelo detrás de un Guardián. El PEM lo decide la red (acción pem).
//  - Objetivo (la primera que aplica):
//     1. Espalda de un Guardián que el equipo ve, a menos de agresividad · 8 casillas y mirando hacia otro lado.
//     2. Lo mejor puntuado entre reanimar a un aliado, botín (punto B o suelo) y extraer: peso / (1 + distancia/10),
//        con peso prioridad_reanimar para reanimar y 1 - prioridad_reanimar para lo demás. Extrae cuando la bolsa
//        llega a codicia · BOLSA_CAPACIDAD o cuando ya no queda botín.
//  - Si lo próximo de su ruta está iluminado espera agachado hasta wait_time_s; después cruza.
// La ruta A* encarece luz, huella y peligro de la pizarra con w_light, w_huella y w_peligro (motor.costeInfiltradores).

class Infiltrador extends Agente {
  constructor(id, x, y, angulo, pizarra, genes) {
    super(id, 'infiltradores', x, y, angulo, pizarra, genes);
    this.espera = 0;          // s esperando en la sombra
    this.cooldownGadget = 0;  // s hasta poder lanzar otra herramienta
  }

  costeRuta(motor) {
    return motor.costeInfiltradores();
  }

  // Guardianes activos que lo están viendo ahora (sabe cuándo le da una linterna).
  quienMeVe(motor) {
    return motor.equipos.guardianes.filter(gu => gu.activo && intensidadVision(motor.mapa, gu, this) > 0);
  }

  // Descubierto y con la barra en umbral_huida: suelta la acción en curso (saquear, reanimar...) para huir.
  decidir(motor) {
    if (this.activo && this.accion && this.barra.valor >= this.genes.umbral_huida && this.quienMeVe(motor).length) this.accion = null;
    super.decidir(motor);
  }

  pensar(motor) {
    this.cooldownGadget = Math.max(0, this.cooldownGadget - DT);
    if (motor.ticks >= (this.proximaDecision ?? 0)) {
      const s = evaluarRed(this.genes, this.observar(motor), ACCIONES_INF.length + MODOS_RED.length);
      this.accionRed = elegir(s, 0, ACCIONES_INF.length);
      this.modoRed = elegir(s, ACCIONES_INF.length, MODOS_RED.length);
      this.proximaDecision = motor.ticks + TICKS_DECISION;
    }
    this[ACCIONES_INF[this.accionRed]](motor);
    if (MODOS_RED[this.modoRed]) this.modo = MODOS_RED[this.modoRed];
  }

  // Lo que sabe el agente, en [0, 1] (ENTRADAS_INF valores). Solo información que tiene: su pizarra y lo que ve.
  observar(motor) {
    const p = this.pizarra, t = motor.t, mapa = motor.mapa, guardias = p.contactosVigentes(t);
    const masCerca = lista => { let d = Infinity; for (const a of lista) d = Math.min(d, this.distanciaA(a)); return d; };
    const cercania = (d, max) => (d === Infinity ? 0 : 1 - Math.min(d, max) / max);
    const centros = celdas => celdas.map(c => { const [x, y] = centroCelda(mapa, c); return { x, y }; });
    const libres = centros(motor.puntosB.filter(b => motor.botines.get(b) > 0));
    const bCerca = libres.length ? libres.reduce((a, b) => (this.distanciaA(a) <= this.distanciaA(b) ? a : b)) : null;
    const espalda = guardias.some(c => {
      const gu = motor.agentes[c.id];
      return c.visto && gu.activo && this.distanciaA(gu) <= 8 && Math.abs(difAngulo(Math.atan2(this.y - gu.y, this.x - gu.x), gu.angulo)) >= 100 * GRADOS;
    });
    return [
      this.barra.valor / BARRA_MAX,
      this.quienMeVe(motor).length ? 1 : 0,
      this.bolsa / BOLSA_CAPACIDAD,
      this.cooldownBotin > 0 ? 1 : 0,
      cercania(masCerca(guardias), 20),
      p.ruidos.some(r => t - r.t <= 3 && this.distanciaA(r) <= 10) ? 1 : 0,
      motor.celdaIluminada(celdaEn(mapa, this.x, this.y)) ? 1 : 0,
      (this.ruta || []).slice(0, 3).some(c => motor.celdaIluminada(c)) ? 1 : 0,
      motor.inventario.infiltradores / GADGETS_POR_EQUIPO,
      Math.max(0, motor.tiempoRestante) / TIEMPO_RONDA_S,
      Math.min(1, motor.extraido / BOTIN_PARA_GANAR),
      Math.min(1, p.caidos.length / AGENTES_POR_EQUIPO),
      cercania(masCerca(libres), 40),
      cercania(masCerca(centros(motor.extraccion)), 60),
      bCerca && this.vigilado(motor, bCerca.x, bCerca.y, guardias) ? 1 : 0,
      motor.gadgets.some(g => g.tipo === 'camara' && t >= g.desactivadoHasta && this.distanciaA(g) <= 12) ? 1 : 0,
      espalda ? 1 : 0,
      (this.accionRed || 0) / ACCIONES_INF.length, // lo que estaba haciendo: ayuda a no cambiar de idea a cada decisión
      this.aguante / AGUANTE.max,
      motor.gadgets.some(g => g.tipo === 'camara' && (g.exposicion?.get(this) || 0) > 0) ? 1 : 0, // una cámara lo está mirando
      this.sensorEnRuta(motor) ? 1 : 0,
    ];
  }

  // --- Acciones de la red (la 0, rutina, es la IA programada) ---
  irObjetivo(motor, tipos) {
    const o = this.elegirObjetivo(motor, tipos);
    if (!o) return this.rutina(motor); // nada de ese tipo: rutina
    if (this.irA(motor, o.celda) && o.tipo !== 'extraer') motor.iniciarAccion(this, o.tipo, o.objetivo);
  }
  irSaquear(motor) { this.irObjetivo(motor, ['saquear', 'recoger']); }
  irExtraer(motor) { this.irObjetivo(motor, ['extraer']); }
  irSabotear(motor) { this.irObjetivo(motor, ['sabotear']); }

  // A cubierto de los Guardianes que el equipo ve ahora; si no ve a ninguno, agachado y quieto.
  esconderse(motor) {
    const vistos = this.pizarra.contactosVigentes(motor.t).filter(c => c.visto).map(c => motor.agentes[c.id]).filter(g => g.activo);
    if (vistos.length) return this.huir(motor, vistos);
    this.parar();
    this.modo = 'sigilo';
  }

  // Quieto y agachado, mirando a la amenaza conocida más cercana (vista u oída).
  esperar(motor) {
    this.parar();
    this.modo = 'sigilo';
    const amenazas = [...this.pizarra.contactosVigentes(motor.t), ...this.pizarra.ruidos];
    if (amenazas.length) {
      const a = amenazas.reduce((p, q) => (this.distanciaA(p) <= this.distanciaA(q) ? p : q));
      this.anguloDeseado = Math.atan2(a.y - this.y, a.x - this.x);
    }
  }

  atacarYa(motor) {
    if (!this.atacar(motor, this.pizarra.contactosVigentes(motor.t), 8)) this.rutina(motor);
  }

  // Humo entre él y la amenaza conocida más cercana (a 2 casillas como mucho), o a sus pies si no sabe de ninguna.
  humo(motor) {
    const amenazas = this.pizarra.contactosVigentes(motor.t);
    let x = this.x, y = this.y;
    if (amenazas.length) {
      const a = amenazas.reduce((p, q) => (this.distanciaA(p) <= this.distanciaA(q) ? p : q)), d = Math.max(0.1, this.distanciaA(a));
      x += (a.x - this.x) / d * Math.min(2, d / 2);
      y += (a.y - this.y) / d * Math.min(2, d / 2);
    }
    this.lanzarHumo(motor, x, y);
    this.rutina(motor);
  }

  // PEM si hay un gadget enemigo a su alcance; si no, señuelo detrás del Guardián visto más cercano. Luego, rutina.
  // Señuelo detrás del Guardián visto más cercano (al girarse hacia el ruido da la espalda). Luego, rutina.
  distraerYa(motor) {
    const c = this.pizarra.contactosVigentes(motor.t).find(c => c.visto);
    if (c && this.cooldownGadget <= 0 && motor.inventario.infiltradores > 0) {
      const d = Math.max(0.1, this.distanciaA(c));
      if (motor.lanzarGadget(this, 'senuelo', c.x + (c.x - this.x) / d * 4, c.y + (c.y - this.y) / d * 4)) this.cooldownGadget = GADGET_COOLDOWN_S;
    }
    this.rutina(motor);
  }

  // PEM a sus pies si hay a su alcance un gadget enemigo que le estorba (gadgetMolesto). Cuándo hace falta lo decide la
  // red (sabe si una cámara lo mira, si hay un sensor en su ruta, su aguante...). Luego, rutina.
  pem(motor) {
    if (this.cooldownGadget <= 0 && motor.inventario.infiltradores > 0 && motor.gadgets.some(x => this.gadgetMolesto(motor, x))) {
      if (motor.lanzarGadget(this, 'pem', this.x, this.y)) this.cooldownGadget = GADGET_COOLDOWN_S;
    }
    this.rutina(motor);
  }

  // ¿Hay un sensor conocido y armado en las próximas casillas de su ruta?
  sensorEnRuta(motor) {
    const proximas = (this.ruta || []).slice(0, 4).map(c => centroCelda(motor.mapa, c));
    return [...this.pizarra.sensoresVistos].some(s => sensorArmado(s, motor.t) && proximas.some(([x, y]) => Math.hypot(x - s.x, y - s.y) <= SENSOR.radio));
  }

  // --- Rutina: la IA programada (acción 0) ---
  rutina(motor) {
    const g = this.genes;
    const guardias = this.pizarra.contactosVigentes(motor.t);
    // Amenazas: lo que el equipo ve (contactos) y lo que oye (ruidos de Guardianes en la pizarra).
    const oidos = this.pizarra.ruidos.filter(r => this.distanciaA(r) <= g.radio_cautela);
    if (oidos.some(r => r.t > (this.ultimoOido ?? -Infinity))) { this.ultimoOido = Math.max(...oidos.map(r => r.t)); this.alertaOido = g.alerta_oido_s; }
    this.alertaOido = Math.max(0, (this.alertaOido ?? 0) - DT);
    const amenazas = [...guardias, ...oidos];
    let dAmenaza = Infinity;
    for (const c of amenazas) dAmenaza = Math.min(dAmenaza, this.distanciaA(c));
    const base = g.prudencia < 1 / 3 ? 'correr' : g.prudencia < 2 / 3 ? 'caminar' : 'sigilo';
    this.modo = dAmenaza < g.umbral_sigilo || this.alertaOido > 0 ? 'sigilo' : dAmenaza < g.umbral_correr ? 'caminar' : base;
    this.usarGadgets(motor, guardias);

    // Huida con memoria: si lo ven (con la barra en umbral_huida) apunta a esos Guardianes y sigue huyendo de ellos
    // hasta llevar HUIDA_MEMORIA_S sin que lo vean. Decidirlo tick a tick lo hacía temblar: de pie lo veían (huía),
    // agachado tras una caja no (volvía a su objetivo), de pie otra vez...
    const vistoAhora = this.barra.valor >= g.umbral_huida ? this.quienMeVe(motor) : [];
    if (vistoAhora.length) { this.amenazas = vistoAhora; this.huirHasta = motor.t + HUIDA_MEMORIA_S; }
    const meVen = motor.t < (this.huirHasta ?? -Infinity) ? this.amenazas.filter(gu => gu.activo) : [];
    if (meVen.length) {
      if (g.humo_huida >= 0.5 && vistoAhora.length) {
        // Entre él y el que lo ve más cerca, a 2 casillas como mucho de sí mismo.
        const gu = meVen.reduce((a, b) => (this.distanciaA(a) <= this.distanciaA(b) ? a : b)), d = Math.max(0.1, this.distanciaA(gu));
        const paso = Math.min(2, d / 2);
        this.lanzarHumo(motor, this.x + (gu.x - this.x) / d * paso, this.y + (gu.y - this.y) / d * paso);
      }
      return this.huir(motor, meVen);
    }
    this.refugio = null;
    if (this.atacar(motor, guardias)) return;
    if (this.acechar(motor, amenazas)) return;
    const objetivo = this.elegirObjetivo(motor);
    if (!objetivo) { this.parar(); return; }
    if (objetivo.tipo === 'reanimar' && this.distanciaA(objetivo.objetivo) <= RANGO_INTERACCION) {
      motor.iniciarAccion(this, 'reanimar', objetivo.objetivo);
      return;
    }
    if (g.humo_saqueo >= 0.5 && (objetivo.tipo === 'saquear' || objetivo.tipo === 'recoger') && this.distanciaA(objetivo) <= 6 &&
      this.vigilado(motor, objetivo.x, objetivo.y, guardias)) this.lanzarHumo(motor, objetivo.x, objetivo.y);
    if (g.senuelo_distraccion >= 0.5 && objetivo.tipo === 'saquear' && this.distanciaA(objetivo) <= 10) this.distraer(motor, objetivo, guardias);
    // Sensores conocidos: cerca de uno va agachado (no lo nota), salvo cuando lo quiere hacer saltar de cebo.
    const sensorCerca = [...this.pizarra.sensoresVistos].some(s => sensorArmado(s, motor.t) && this.distanciaA(s) <= SENSOR.radio + 1.5);
    if (objetivo.tipo === 'cebo') { if (this.modo === 'sigilo') this.modo = 'caminar'; }
    else if (sensorCerca) this.modo = 'sigilo';
    if (this.irA(motor, objetivo.celda)) {
      if (objetivo.tipo !== 'extraer' && objetivo.tipo !== 'cebo') motor.iniciarAccion(this, objetivo.tipo, objetivo.objetivo);
      return;
    }
    this.esperarEnSombra(motor);
  }

  // Corre a la casilla más cercana (por pasos, hasta RADIO_HUIDA) que no ve ninguno de los que lo ven; si no hay
  // ninguna, a la más alejada de ellos.
  huir(motor, meVen) {
    const mapa = motor.mapa, inicio = celdaEn(mapa, this.x, this.y), visto = new Map([[inicio, 0]]), cola = [inicio];
    // Lo más rápido: si agachado aquí mismo una caja lo tapa de todos los que lo ven, se agacha y no se mueve.
    const agachado = { x: this.x, y: this.y, altura: ALTURA.AGACHADO };
    if (meVen.every(gu => intensidadVision(mapa, gu, agachado) === 0)) { this.parar(); this.modo = 'sigilo'; this.refugio = null; return; }
    const punto = { x: 0, y: 0, altura: ALTURA.AGACHADO }; // refugio: donde agachado no lo vean
    // Refugio válido: fuera de la vista de todos los que lo ven y sin acercarse a ninguno de ellos (escapar pasando
    // al lado del Guardián, aunque sea fuera de su cono, es correr hacia el aturdidor).
    // nuevo = true al elegir refugio: además de oculto, no puede acercarlo a ningún Guardián. Para mantener uno ya
    // elegido basta con que siga oculto (si no, al alejarse dejaba de cumplir la distancia y oscilaba entre dos).
    const valido = (c, nuevo = true) => {
      if (c === inicio && nuevo) return false; // en su propia casilla lo están viendo aunque el centro quede fuera del cono
      [punto.x, punto.y] = centroCelda(mapa, c);
      return meVen.every(gu => intensidadVision(mapa, gu, punto) === 0 &&
        (!nuevo || Math.hypot(gu.x - punto.x, gu.y - punto.y) >= Math.hypot(gu.x - this.x, gu.y - this.y) - 0.5));
    };
    // Compromiso: el refugio se mantiene HUIDA_COMPROMISO_S aunque el Guardián, al girar para seguirlo, lo meta en su cono
    // (si no, elegía uno a cada lado del cono por turnos y temblaba). Después, mientras siga oculto.
    const comprometido = motor.t < (this.refugioDesde ?? -Infinity) + HUIDA_COMPROMISO_S;
    if (this.refugio != null && (comprometido || valido(this.refugio, false))) { this.modo = 'correr'; this.irA(motor, this.refugio); return; }
    // Al cambiar de refugio, mejor uno hacia el mismo lado que el anterior (sin dar media vuelta), si lo hay.
    let rumbo = null;
    if (this.refugio != null) { const [rx, ry] = centroCelda(mapa, this.refugio); rumbo = Math.atan2(ry - this.y, rx - this.x); }
    const haciaElRumbo = c => {
      if (rumbo === null) return true;
      const [x, y] = centroCelda(mapa, c);
      return Math.abs(difAngulo(Math.atan2(y - this.y, x - this.x), rumbo)) <= Math.PI / 2;
    };
    let refugio = null, lejos = inicio, dLejos = -1, otroLado = null;
    for (let k = 0; k < cola.length && refugio === null; k++) {
      const c = cola[k], pasos = visto.get(c);
      [punto.x, punto.y] = centroCelda(mapa, c);
      if (valido(c)) {
        if (haciaElRumbo(c)) { refugio = c; break; }
        if (otroLado === null) otroLado = c;
      }
      const d = Math.min(...meVen.map(gu => Math.hypot(gu.x - punto.x, gu.y - punto.y)));
      if (d > dLejos) { dLejos = d; lejos = c; }
      if (pasos >= RADIO_HUIDA) continue;
      const cx = c % mapa.ancho, cy = (c - cx) / mapa.ancho;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = (cx + dx) + (cy + dy) * mapa.ancho;
        if (transitable(mapa, cx + dx, cy + dy) && !visto.has(n)) { visto.set(n, pasos + 1); cola.push(n); }
      }
    }
    refugio ??= otroLado;
    if (refugio !== this.refugio) this.refugioDesde = motor.t;
    this.refugio = refugio;
    this.modo = 'correr';
    this.irA(motor, refugio ?? lejos);
  }

  // Ir a por la espalda de un Guardián visto que mira hacia otro lado. El motor carga la barra si está a <= 1.5 y nadie lo ve.
  atacar(motor, guardias, radio = this.genes.agresividad * 8) {
    let presa = null, dMin = radio;
    for (const c of guardias) {
      const gu = motor.agentes[c.id], d = this.distanciaA(gu);
      if (!c.visto || !gu.activo || d > dMin) continue;
      if (Math.abs(difAngulo(Math.atan2(this.y - gu.y, this.x - gu.x), gu.angulo)) < 100 * GRADOS) continue;
      dMin = d;
      presa = gu;
    }
    if (!presa) return false;
    this.modo = 'sigilo';
    if (dMin <= 1) this.parar();
    else {
      const bx = presa.x - Math.cos(presa.angulo), by = presa.y - Math.sin(presa.angulo), mapa = motor.mapa;
      this.irA(motor, transitable(mapa, Math.floor(bx), Math.floor(by)) ? celdaEn(mapa, bx, by) : celdaEn(mapa, presa.x, presa.y));
    }
    this.anguloDeseado = Math.atan2(presa.y - this.y, presa.x - this.x);
    return true;
  }

  // tipos (opcional): solo esos tipos de objetivo y sin las condiciones de la rutina (codicia, pesos de sabotaje...).
  elegirObjetivo(motor, tipos = null) {
    const g = this.genes, mapa = motor.mapa, candidatos = [], quiere = t => !tipos || tipos.includes(t);
    // Con cooldown (recién reanimado) sigue yendo a por el botín; la acción no empieza hasta que se acabe (accionValida).
    const puedeCoger = this.bolsa < BOLSA_CAPACIDAD;
    const hayBotin = motor.puntosB.some(b => motor.botines.get(b) > 0) || motor.suelo.length > 0;
    const lleno = this.bolsa >= g.codicia * BOLSA_CAPACIDAD - 1e-9 || this.bolsa >= BOLSA_CAPACIDAD;

    for (const c of this.pizarra.caidos) {
      if (c.agente !== this && quiere('reanimar')) candidatos.push({ tipo: 'reanimar', objetivo: c.agente, x: c.agente.x, y: c.agente.y, peso: g.prioridad_reanimar });
    }
    if ((tipos || !lleno) && puedeCoger) {
      const guardias = this.pizarra.contactosVigentes(motor.t);
      for (const b of motor.puntosB) {
        if (motor.botines.get(b) > 0 && quiere('saquear')) {
          const [x, y] = centroCelda(mapa, b), vigilado = this.vigilado(motor, x, y, guardias);
          candidatos.push({ tipo: 'saquear', objetivo: b, x, y, peso: (1 - g.prioridad_reanimar) * (vigilado ? 1 - 0.8 * g.evitar_vigilado : 1) });
        }
      }
      if (quiere('recoger')) for (const p of motor.suelo) candidatos.push({ tipo: 'recoger', objetivo: p, x: p.x, y: p.y, peso: 1 - g.prioridad_reanimar });
    }
    if (tipos ? quiere('sabotear') : g.sabotaje > 0) {
      for (const c of motor.gadgets) {
        if (c.tipo === 'camara' && !c.saboteada && this.distanciaA(c) <= 15) candidatos.push({ tipo: 'sabotear', objetivo: c, x: c.x, y: c.y, peso: g.sabotaje });
      }
    }
    if (!tipos && g.cebo_sensor > 0 && motor.equipos.infiltradores.some(a => a !== this && a.activo && a.objetivoActual && motor.botines.has(a.objetivoActual))) {
      for (const s of this.pizarra.sensoresVistos) {
        if (sensorArmado(s, motor.t) && this.distanciaA(s) <= 15) candidatos.push({ tipo: 'cebo', objetivo: s, x: s.x, y: s.y, peso: g.cebo_sensor });
      }
    }
    if (this.bolsa > 0 && (tipos ? quiere('extraer') : lleno || !hayBotin)) {
      // Extracción: penaliza las que tienen peligro conocido cerca (contactos, ruidos, caídos y patrullas recordadas).
      const cerca = this.peligroExtraccion(motor);
      motor.extraccion.forEach((e, k) => {
        const [x, y] = centroCelda(mapa, e);
        candidatos.push({ tipo: 'extraer', objetivo: e, x, y, peso: (1 - g.prioridad_reanimar) / (1 + g.w_peligro / 10 * cerca[k]) });
      });
    }
    // Reparto: cada compañero activo que ya va a por el mismo botín lo puntúa a la baja (dispersion), para no ir en
    // grupo y caer uno detrás de otro ante el mismo Guardián.
    const otros = motor.equipos.infiltradores.filter(a => a !== this && a.activo && a.objetivoActual);
    let mejor = null, puntos = -Infinity;
    for (const c of candidatos) {
      const repetidos = c.tipo === 'saquear' || c.tipo === 'recoger' ? otros.filter(a => a.objetivoActual === c.objetivo).length : 0;
      const p = c.peso / (1 + this.distanciaA(c) / 10) / (1 + 3 * g.dispersion * repetidos);
      if (p > puntos) { puntos = p; mejor = c; }
    }
    if (mejor) mejor.celda = celdaEn(mapa, mejor.x, mejor.y);
    this.objetivoActual = mejor ? mejor.objetivo : null;
    return mejor;
  }

  // Peligros conocidos a <= 12 casillas de cada casilla de extracción (mismo orden que motor.extraccion). Es igual para
  // todo el equipo en un tick (la pizarra no cambia mientras deciden), así que se calcula una vez por tick y equipo.
  peligroExtraccion(motor) {
    const p = this.pizarra;
    if (p.peligroExt && p.peligroExt.ticks === motor.ticks && p.peligroExt.motor === motor) return p.peligroExt.cerca;
    const mapa = motor.mapa, ext = motor.extraccion.map(e => centroCelda(mapa, e)), cerca = new Array(ext.length).fill(0);
    const contar = (x, y) => { for (let k = 0; k < ext.length; k++) if (aDistancia(x - ext[k][0], y - ext[k][1], 12)) cerca[k]++; };
    for (const q of p.puntosPeligro(motor.t)) contar(q.x, q.y);
    for (const c of p.marcas.keys()) { const [x, y] = centroCelda(mapa, c); contar(x, y); }
    p.peligroExt = { motor, ticks: motor.ticks, cerca };
    return cerca;
  }

  // Si alguna de las 2 casillas siguientes de la ruta está iluminada, espera agachado hasta wait_time_s.
  esperarEnSombra(motor) {
    const proximas = (this.ruta || []).slice(0, 2);
    const luz = proximas.some(c => motor.celdaIluminada(c)) && !motor.celdaIluminada(celdaEn(motor.mapa, this.x, this.y));
    if (!luz) { this.espera = 0; return; }
    if (this.genes.humo_cruce >= 0.5) {
      // Tapa el primer tramo iluminado: cuando el humo sale, la linterna ya no llega y cruza (lo espera mientras siga la luz).
      const c = proximas.find(k => motor.celdaIluminada(k));
      if (c !== undefined) { const [x, y] = centroCelda(motor.mapa, c); if (this.lanzarHumo(motor, x, y)) this.espera = 0; }
    }
    if (this.espera < this.genes.wait_time_s) {
      this.espera += DT;
      this.parar();
      this.modo = 'sigilo';
    }
  }

  // Acecho: con una amenaza a <= radio_cautela se queda quieto y agachado mirándola, hasta paciencia_s seguidos. Sigue
  // acechando mientras la amenaza no salga de radio_cautela + 1 (histéresis, para no arrancar y parar a cada paso).
  // No acecha si está en luz conocida (ahí lo verían: mejor moverse).
  acechar(motor, amenazas) {
    const g = this.genes, radio = this.acechando ? g.radio_cautela + 1 : g.radio_cautela;
    const cerca = amenazas.filter(a => this.distanciaA(a) <= radio);
    const enLuz = motor.celdaIluminada(celdaEn(motor.mapa, this.x, this.y));
    if (!cerca.length || enLuz || this.tiempoAcecho >= g.paciencia_s) {
      if (!cerca.length) this.tiempoAcecho = 0; // la amenaza se fue: recupera la paciencia
      this.acechando = false;
      return false;
    }
    const a = cerca.reduce((p, q) => (this.distanciaA(p) <= this.distanciaA(q) ? p : q));
    this.acechando = true;
    this.tiempoAcecho = (this.tiempoAcecho ?? 0) + DT;
    this.parar();
    this.modo = 'sigilo';
    this.anguloDeseado = Math.atan2(a.y - this.y, a.x - this.x);
    return true;
  }

  // Distracción: si un Guardián conocido vigila el botín, lanza un señuelo al otro lado del Guardián (lo aleja del botín).
  distraer(motor, objetivo, guardias) {
    if (this.cooldownGadget > 0 || motor.inventario.infiltradores <= 0) return;
    if (motor.gadgets.some(x => x.tipo === 'senuelo' && x.equipo === 'infiltradores')) return; // ya hay uno sonando
    const c = guardias.find(c => Math.hypot(c.x - objetivo.x, c.y - objetivo.y) <= VISION.guardian.alcance);
    if (!c) return;
    const dx = c.x - objetivo.x, dy = c.y - objetivo.y, d = Math.max(0.1, Math.hypot(dx, dy));
    if (motor.lanzarGadget(this, 'senuelo', c.x + dx / d * 6, c.y + dy / d * 6)) this.cooldownGadget = GADGET_COOLDOWN_S;
  }

  // Gadget enemigo encendido a <= PEM.radio, a la vista (sin muros en medio) y que le estorba: una cámara que AHORA lo
  // mira o cuyo cono actual cubre la casilla a la que va a entrar, o un sensor conocido y armado en su ruta.
  // Si compensa gastar el PEM no lo decide esto: lo decide la red (acción pem).
  gadgetMolesto(motor, g) {
    if (g.equipo !== 'guardianes' || motor.t < g.desactivadoHasta || g.saboteada || this.distanciaA(g) > PEM.radio) return false;
    if (!lineaDeVista(motor.mapa, this.x, this.y, g.x, g.y, RAYO_ALTO, false)) return false;
    if (g.tipo === 'sensor') return this.pizarra.sensoresVistos.has(g) && sensorArmado(g, motor.t) && this.sensorEnRuta(motor);
    if (g.tipo !== 'camara') return false;
    if ((g.exposicion?.get(this) || 0) > 0) return true;
    const siguiente = this.ruta && this.ruta[0];
    if (siguiente === undefined) return false;
    const [x, y] = centroCelda(motor.mapa, siguiente);
    return intensidadVision(motor.mapa, g, { x, y, altura: this.altura }) > 0;
  }

  // ¿Hay ya humo (armándose o activo) que cubra (x, y)? Entonces no gasta otro.
  humoCubre(motor, x, y) {
    return motor.gadgets.some(h => h.tipo === 'humo' && Math.hypot(h.x - x, h.y - y) <= HUMO.radio);
  }

  // Lanza humo hacia (x, y) si puede (cooldown, inventario del equipo) y no hay ya humo allí.
  lanzarHumo(motor, x, y) {
    if (this.cooldownGadget > 0 || motor.inventario.infiltradores <= 0 || this.humoCubre(motor, x, y)) return false;
    if (!motor.lanzarGadget(this, 'humo', x, y)) return false;
    this.cooldownGadget = GADGET_COOLDOWN_S;
    return true;
  }

  // ¿Ve (x, y) alguna cámara encendida o algún Guardián conocido (contacto o LKP) a su alcance con línea de vista?
  vigilado(motor, x, y, guardias) {
    const punto = { x, y, altura: ALTURA.DE_PIE }, mapa = motor.mapa;
    if (motor.gadgets.some(g => g.tipo === 'camara' && motor.t >= g.desactivadoHasta && intensidadVision(mapa, g, punto) > 0)) return true;
    return guardias.some(c => Math.hypot(c.x - x, c.y - y) <= VISION.guardian.alcance && lineaDeVista(mapa, c.x, c.y, x, y, RAYO_ALTO));
  }

  usarGadgets(motor, guardias) {
    const g = this.genes;
    if (this.cooldownGadget > 0 || g.uso_gadgets <= 0 || motor.inventario.infiltradores <= 0) return;
    let lanzado = false;
    // El PEM ya no está en la rutina: es una acción de la red (pem), que decide cuándo hace falta.
    if (g.uso_gadgets >= 0.5 && this.barra.valor === 0) {
      const c = guardias.find(c => c.visto && this.distanciaA(c) <= 8);
      if (c) {
        // Detrás del Guardián, en la prolongación de la línea que los une: al girarse hacia el ruido da la espalda.
        const d = Math.max(0.1, this.distanciaA(c));
        lanzado = motor.lanzarGadget(this, 'senuelo', c.x + (c.x - this.x) / d * 4, c.y + (c.y - this.y) / d * 4);
      }
    }
    if (lanzado) this.cooldownGadget = GADGET_COOLDOWN_S;
  }
}
