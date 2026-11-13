// Motor de simulación: tiempo fijo con acumulador, modo headless, percepción, combate, acciones, economía y victoria.
// Requiere config.js, genes.js, raycast.js, astar.js, pizarra.js, agente.js, guardian.js, infiltrador.js, gadgets.js
// y fitness.js. No toca el DOM salvo iniciar() en modo visual (render.js va aparte y solo lee el estado).

// PRNG con semilla entera (mulberry32): misma semilla -> misma secuencia en [0, 1). Lo usan la ronda y genetico.js.
function mulberry32(semilla) {
  return () => {
    semilla = (semilla + 0x6D2B79F5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class GameEngine {
  // diseno: objeto MAPA_DISENO. porEquipo: agentes por equipo (repartidos por las casillas G y S).
  // ia = false: los agentes no deciden, no hay gadgets ni preparación (para pruebas que mueven a mano).
  // preparacion: s previos al reloj en los que solo actúan los Guardianes (colocar gadgets y posicionarse).
  constructor({
    diseno = MAPA_DISENO, headless = HEADLESS, porEquipo = AGENTES_POR_EQUIPO, semilla = SEMILLA_FIJA, ia = true,
    genesInfiltrador = GENES_INFILTRADOR_POR_DEFECTO, genesGuardian = GENES_GUARDIAN_POR_DEFECTO,
    preparacion = ia ? PREPARACION_S : 0,
  } = {}) {
    this.diseno = diseno;
    this.preparacion = preparacion;
    this.mapa = mapaAlturas(diseno);
    this.headless = headless;
    this.ia = ia;
    this.semilla = semilla;
    this.rnd = mulberry32(semilla);
    this.genesInfiltrador = limitarGenes(genesInfiltrador, RANGOS_INFILTRADOR);
    this.genesGuardian = limitarGenes(genesGuardian, RANGOS_GUARDIAN);
    const mapa = this.mapa, n = mapa.ancho * mapa.alto, celda = ([cx, cy]) => cx + cy * mapa.ancho;
    this.pizarras = { guardianes: new TeamBlackboard('guardianes', n), infiltradores: new TeamBlackboard('infiltradores', n) };
    this.agentes = [];
    this.equipos = { guardianes: [], infiltradores: [] };
    this.ticks = 0;
    this.t = 0;
    this.acumulador = 0;
    this.tiempoRestante = TIEMPO_RONDA_S;
    this.terminada = false;
    this.ganador = null;
    this.fitness = null;

    const { G = [], S = [], B = [], E = [] } = mapa.marcadores;
    if (!G.length || !S.length) throw new Error('El mapa necesita al menos una casilla G y una S');
    for (const [cx, cy] of [...G, ...S, ...B, ...E]) {
      if (!transitable(mapa, cx, cy)) throw new Error(`La casilla (${cx},${cy}) del escenario no es transitable`);
    }
    this.botines = new Map(B.map(p => [celda(p), VALOR_BOTIN])); // casilla B -> botín que le queda
    this.puntosB = [...this.botines.keys()];
    this.extraccion = (E.length ? E : S).map(celda);
    this.patrulla = [G[0], ...B].map(celda);
    this.suelo = [];        // montones de botín: { x, y, valor }
    this.ondas = [];        // ruidos emitidos { x, y, radio, t, equipo }; solo en modo visual (render.js los dibuja y purga)
    this.gadgets = [];
    this.inventario = { guardianes: GADGETS_POR_EQUIPO, infiltradores: GADGETS_POR_EQUIPO };
    this.extraido = 0;      // botín del equipo infiltrador ya sacado por la extracción
    this.bonoUsado = false;
    this.stats = {
      infiltradores: { extraido: 0, recogido: 0, derribos: 0, reanimaciones: 0, caidas: 0, gadgets: 0 },
      guardianes: { derribos: 0, reanimaciones: 0, confiscado: 0, devuelto: 0, segundosHierba: 0, revelaciones: 0, caidas: 0, gadgets: 0 },
    };
    this.costeGuardianes = new Float32Array(n);
    for (let c = 0; c < n; c++) this.costeGuardianes[c] = mapa.hierba[c] && HIERBA_PROHIBIDA_GUARDIAN ? COSTE_HIERBA_GUARDIAN : 0;
    this.cacheLuz = { tick: -1, luz: null };
    this.cacheCoste = { tick: -1, coste: new Float32Array(n) };

    // La semilla varía la partida: casillas de salida barajadas y puesto de patrulla inicial rotado.
    const barajar = lista => {
      const l = lista.slice();
      for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
      return l;
    };
    const salidasG = barajar(G), salidasS = barajar(S), puesto0 = Math.floor(this.rnd() * this.patrulla.length);
    for (let i = 0; i < porEquipo; i++) {
      const [gx, gy] = salidasG[i % G.length], [sx, sy] = salidasS[i % S.length];
      this.agregar(new Guardian(this.agentes.length, gx + 0.5, gy + 0.5, this.anguloAlCentro(gx, gy), this.pizarras.guardianes,
        this.genesGuardian, (puesto0 + i) % this.patrulla.length, this.rnd() * 2 * Math.PI));
      this.agregar(new Infiltrador(this.agentes.length, sx + 0.5, sy + 0.5, this.anguloAlCentro(sx, sy), this.pizarras.infiltradores, this.genesInfiltrador));
    }
    if (ia) planificarGadgetsGuardianes(this, this.genesGuardian);
  }

  get enPreparacion() {
    return this.preparacion > 0 && this.t <= this.preparacion + 1e-9;
  }

  anguloAlCentro(cx, cy) {
    return Math.atan2(this.mapa.alto / 2 - cy - 0.5, this.mapa.ancho / 2 - cx - 0.5);
  }

  agregar(a) {
    this.agentes.push(a);
    this.equipos[a.equipo].push(a);
  }

  // Un paso lógico de DT: gadgets -> decisiones -> movimiento y ruido -> percepción y combate -> acciones ->
  // hierba -> giro -> pizarras -> extracción -> reloj y victoria.
  paso() {
    if (this.terminada) return;
    this.ticks++;
    this.t = this.ticks * DT; // en ticks enteros para no acumular error de coma flotante
    if (this.enPreparacion) return this.pasoPreparacion();
    for (const g of this.equipos.guardianes) g.pendientes.length = 0; // lo que no se colocó a tiempo se pierde
    actualizarGadgets(this);
    // Las herramientas de los Infiltradores se recargan: +1 cada RECARGA_GADGET_S mientras tengan menos de las iniciales.
    if (this.inventario.infiltradores < GADGETS_POR_EQUIPO) {
      this.recargaGadget = (this.recargaGadget || 0) + DT;
      if (this.recargaGadget >= RECARGA_GADGET_S - 1e-9) { this.inventario.infiltradores++; this.recargaGadget = 0; }
    } else this.recargaGadget = 0;
    if (this.ia) for (const a of this.agentes) a.decidir(this);
    for (const a of this.agentes) this.mover(a, DT);
    this.separar();
    this.percibir(DT);
    this.interactuar(DT);
    this.reglaHierba(DT);
    for (const a of this.agentes) a.actualizarGiro(DT);
    for (const p of Object.values(this.pizarras)) p.limpiar(this.t);
    this.extraer();

    this.tiempoRestante -= DT;
    let ganador = null;
    if (this.extraido >= BOTIN_PARA_GANAR) ganador = 'infiltradores';
    else if (this.tiempoRestante <= 1e-9 || (GANA_CON_TODOS_CAIDOS
      ? !this.equipos.infiltradores.some(a => a.activo)
      : this.equipos.infiltradores.every(a => a.estado === 'eliminado'))) ganador = 'guardianes';
    if (ganador) {
      this.terminada = true;
      this.ganador = ganador;
      this.fitness = evaluarFitness(this);
    }
  }

  // Preparación: solo los Guardianes deciden, se mueven y giran (sin enemigos en juego, sin reloj).
  pasoPreparacion() {
    for (const g of this.equipos.guardianes) {
      g.decidir(this);
      this.mover(g, DT);
    }
    this.reglaHierba(DT);
    for (const a of this.agentes) a.actualizarGiro(DT);
  }

  // Colisión por ejes contra celdas de altura >= CAJA (cajas y muros bloquean el paso; el humo no).
  mover(a, dt) {
    if (!a.activo || !a.moviendose) return;
    const largo = Math.hypot(a.dirX, a.dirY), v = a.velocidad * dt / largo;
    const nx = a.x + a.dirX * v;
    if (this.libre(nx, a.y)) a.x = nx;
    const ny = a.y + a.dirY * v;
    if (this.libre(a.x, ny)) a.y = ny;
    a.tiempoRuido -= dt;
    if (a.tiempoRuido <= 0) {
      a.tiempoRuido = RUIDO_INTERVALO_S;
      this.emitirRuido(a, MODOS[a.modo].ruido);
    }
  }

  // Colisión entre agentes activos: dos cuerpos no se solapan (se empujan a medias, sin meterse en muros ni cajas).
  separar() {
    const activos = this.agentes.filter(a => a.activo), min = 2 * RADIO_AGENTE;
    for (let i = 0; i < activos.length; i++) {
      for (let k = i + 1; k < activos.length; k++) {
        const a = activos[i], b = activos[k];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-6) { dx = Math.cos(a.id + b.id); dy = Math.sin(a.id + b.id); d = 1; } // encima exacto: dirección fija
        const empuje = (min - d) / 2, ux = dx / d * empuje, uy = dy / d * empuje;
        if (this.libre(a.x - ux, a.y - uy)) { a.x -= ux; a.y -= uy; }
        if (this.libre(b.x + ux, b.y + uy)) { b.x += ux; b.y += uy; }
      }
    }
  }

  libre(x, y) {
    const r = RADIO_AGENTE;
    for (const [px, py] of [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]]) {
      if (alturaEn(this.mapa, Math.floor(px), Math.floor(py)) >= ALTURA.CAJA) return false;
    }
    return true;
  }

  // origen: { x, y, equipo } (agente o señuelo). Lo oye cualquier enemigo activo dentro del radio y lo radia a su equipo.
  // shortcut: el sonido no lo tapan las paredes; si hace falta, atenuarlo con lineaDeVista(RAYO_BAJO).
  emitirRuido(origen, radio) {
    if (this.enPreparacion) return; // los Infiltradores aún no están en juego
    if (!this.headless) this.ondas.push({ x: origen.x, y: origen.y, radio, t: this.t, equipo: origen.equipo }); // solo para dibujar
    const enemigos = this.equipos[origen.equipo === 'guardianes' ? 'infiltradores' : 'guardianes'];
    const oyente = enemigos.find(e => e.activo && Math.hypot(e.x - origen.x, e.y - origen.y) <= radio);
    if (oyente) oyente.pizarra.publicarRuido(origen.x, origen.y, radio, this.t);
  }

  // Visión de doble capa entre enemigos, publicación en la pizarra y barras de exposición.
  percibir(dt) {
    const activos = this.agentes.filter(a => a.activo);
    // Sensores: escondidos; un Infiltrador solo los descubre a <= SENSOR.vistaInfiltrador con línea de vista a ras de suelo.
    const pi = this.pizarras.infiltradores;
    for (const s of this.gadgets) {
      if (s.tipo !== 'sensor' || pi.sensoresVistos.has(s)) continue;
      if (this.equipos.infiltradores.some(i => i.activo && Math.hypot(i.x - s.x, i.y - s.y) <= SENSOR.vistaInfiltrador &&
        lineaDeVista(this.mapa, i.x, i.y, s.x, s.y, RAYO_BAJO, false))) pi.sensoresVistos.add(s);
    }
    // Cámaras saboteadas: el equipo guardián solo lo sabe cuando un Guardián activo ve la cámara.
    const pg = this.pizarras.guardianes;
    for (const c of this.gadgets) {
      if (c.tipo !== 'camara' || !c.saboteada || pg.camarasCaidas.has(c)) continue;
      const punto = { x: c.x, y: c.y, altura: ALTURA.DE_PIE };
      if (this.equipos.guardianes.some(g => g.activo && intensidadVision(this.mapa, g, punto) > 0)) pg.camarasCaidas.add(c);
    }
    for (const a of activos) { a.enemigoVisto = null; a.canalizando = false; }
    const vistos = new Set(), aturdidos = new Set(), neutralizados = new Set();

    for (const obs of activos) {
      let cercano = Infinity;
      for (const obj of activos) {
        if (obj.equipo === obs.equipo || intensidadVision(this.mapa, obs, obj) === 0) continue;
        const d = Math.hypot(obj.x - obs.x, obj.y - obs.y);
        obs.pizarra.publicarContacto(obj.id, obj.x, obj.y, this.t, obs.esGuardian ? -1 : celdaEn(this.mapa, obj.x, obj.y));
        if (d < cercano) { cercano = d; obs.ver(obj); }
        if (obs.esGuardian) {
          vistos.add(obj);
          if (d <= ATURDIDOR.rango) { obs.canalizando = true; aturdidos.add(obj); }
        }
      }
    }

    // Neutralización: Infiltrador a <= rango, en el semiplano trasero del Guardián y sin que ningún Guardián lo vea.
    for (const g of activos) {
      if (!g.esGuardian) continue;
      for (const i of activos) {
        if (i.esGuardian || vistos.has(i) || Math.hypot(i.x - g.x, i.y - g.y) > NEUTRALIZACION.rango) continue;
        if (Math.abs(difAngulo(Math.atan2(i.y - g.y, i.x - g.x), g.angulo)) > Math.PI / 2) neutralizados.add(g);
      }
    }

    for (const a of activos) {
      if (a.barra.actualizar((a.esGuardian ? neutralizados : aturdidos).has(a), dt)) {
        this.derribarAgente(a, a.esGuardian ? 'infiltradores' : 'guardianes');
      }
    }
  }

  // porEquipo: equipo que se apunta el derribo (null si cae solo, por la hierba).
  // Infiltrador: suelta BOLSA_SUELTA de la bolsa al suelo y retiene el resto. Guardián: suelta todo lo confiscado.
  derribarAgente(a, porEquipo) {
    if (a.bolsa > 0) {
      const suelta = a.esGuardian ? a.bolsa : a.bolsa * BOLSA_SUELTA;
      this.suelo.push({ x: a.x, y: a.y, valor: suelta });
      a.bolsa -= suelta;
    }
    a.derribar();
    a.pizarra.publicarCaido(a, this.t);
    this.stats[a.equipo].caidas++;
    if (porEquipo) this.stats[porEquipo].derribos++;
  }

  iniciarAccion(a, tipo, objetivo) {
    const duracion = {
      reanimar: REANIMAR_S, confiscar: CONFISCAR_S, saquear: SAQUEO_S, devolver: DEVOLVER_S,
      sabotear: SABOTAJE_S, reactivar: REACTIVAR_S,
      recoger: a.esGuardian ? CONFISCAR_S : RECOGER_SUELO_S,
    }[tipo];
    if (duracion === undefined) throw new Error('Acción desconocida: ' + tipo);
    a.accion = { tipo, objetivo, duracion, progreso: 0 };
    a.parar();
  }

  // ¿Sigue siendo posible la acción? Si no, se cancela (cancelable al alejarse, al caer o si otro se adelanta).
  accionValida(a, { tipo, objetivo: o }) {
    const cerca = p => Math.hypot(p.x - a.x, p.y - a.y) <= RANGO_INTERACCION;
    const aqui = celdaEn(this.mapa, a.x, a.y);
    const puedeCoger = a.esGuardian || (a.cooldownBotin <= 0 && a.bolsa < BOLSA_CAPACIDAD);
    // En un mismo sitio o se reanima o se coge botín: la acción del compañero que ya va avanzando gana.
    const companeros = (tipos, p) => this.equipos[a.equipo].some(b => b !== a && b.accion && b.accion.progreso > 0 &&
      tipos.includes(b.accion.tipo) && Math.hypot(b.x - p.x, b.y - p.y) <= RANGO_INTERACCION);
    const reanimandoAqui = () => this.equipos[a.equipo].some(b => b !== a && b.accion && b.accion.progreso > 0 &&
      b.accion.tipo === 'reanimar' && Math.hypot(b.accion.objetivo.x - a.x, b.accion.objetivo.y - a.y) <= RANGO_INTERACCION);
    switch (tipo) {
      case 'reanimar': return o.estado === 'inconsciente' && cerca(o) && !companeros(['saquear', 'recoger'], o);
      case 'confiscar': return a.esGuardian && !o.activo && o.bolsa > 0 && cerca(o);
      case 'recoger': return this.suelo.includes(o) && cerca(o) && puedeCoger && !reanimandoAqui();
      case 'saquear': return !a.esGuardian && aqui === o && this.botines.get(o) > 0 && puedeCoger && !reanimandoAqui();
      case 'devolver': return a.esGuardian && aqui === o && a.bolsa > 0;
      case 'sabotear': return !a.esGuardian && this.gadgets.includes(o) && !o.saboteada && cerca(o);
      case 'reactivar': return a.esGuardian && this.gadgets.includes(o) && o.saboteada && cerca(o);
    }
    return false;
  }

  interactuar(dt) {
    for (const a of this.agentes) {
      if (a.activo) a.cooldownBotin = Math.max(0, a.cooldownBotin - dt);
      // El aturdimiento se pasa: sin que nadie lo reanime, se levanta a los DESPERTAR_S (0 = nunca).
      if (a.estado === 'inconsciente' && DESPERTAR_S > 0 && (a.tiempoCaido += dt) >= DESPERTAR_S) a.reanimar();
      const ac = a.accion;
      if (!ac || !a.activo) continue;
      if (!this.accionValida(a, ac)) { a.accion = null; continue; }
      if (ac.tipo === 'reanimar') {
        a.tiempoRuido -= dt;
        if (a.tiempoRuido <= 0) { a.tiempoRuido = RUIDO_INTERVALO_S; this.emitirRuido(a, RUIDO_REANIMAR); }
      }
      ac.progreso += dt;
      if (ac.progreso < ac.duracion - 1e-9) continue;
      a.accion = null;
      this.completarAccion(a, ac.tipo, ac.objetivo);
    }
  }

  completarAccion(a, tipo, o) {
    const s = this.stats[a.equipo];
    if (tipo === 'reanimar') {
      o.reanimar();
      s.reanimaciones++;
    } else if (tipo === 'confiscar') {
      a.bolsa += o.bolsa;
      s.confiscado += o.bolsa;
      o.bolsa = 0;
    } else if (tipo === 'recoger') {
      const toma = a.esGuardian ? o.valor : Math.min(BOLSA_CAPACIDAD - a.bolsa, o.valor);
      a.bolsa += toma;
      o.valor -= toma;
      if (a.esGuardian) s.confiscado += toma; else s.recogido += toma;
      if (o.valor <= 1e-9) this.suelo.splice(this.suelo.indexOf(o), 1);
    } else if (tipo === 'saquear') {
      const toma = Math.min(BOLSA_CAPACIDAD - a.bolsa, this.botines.get(o));
      a.bolsa += toma;
      this.botines.set(o, this.botines.get(o) - toma);
      s.recogido += toma;
    } else if (tipo === 'devolver') {
      this.botines.set(o, this.botines.get(o) + a.bolsa);
      s.devuelto += a.bolsa;
      a.bolsa = 0;
    } else if (tipo === 'sabotear') {
      o.saboteada = true;
      o.desactivadoHasta = Infinity;
      s.sabotajes = (s.sabotajes || 0) + 1;
    } else if (tipo === 'reactivar') {
      this.pizarras.guardianes.camarasCaidas.delete(o);
      o.saboteada = false;
      o.desactivadoHasta = -Infinity;
      s.reactivaciones = (s.reactivaciones || 0) + 1;
    }
  }

  // Guardián en la hierba: > HIERBA_REVELA_S seguidos queda revelado el resto de la ronda (y pierde fitness por
  // segundo); > HIERBA_DERRIBA_S seguidos cae inconsciente. Los revelados activos se publican a los Infiltradores.
  reglaHierba(dt) {
    if (!HIERBA_PROHIBIDA_GUARDIAN) return;
    const s = this.stats.guardianes;
    for (const g of this.equipos.guardianes) {
      if (!g.activo) continue;
      if (!this.mapa.hierba[celdaEn(this.mapa, g.x, g.y)]) { g.tiempoHierba = 0; continue; }
      g.tiempoHierba += dt;
      if (g.tiempoHierba > HIERBA_REVELA_S) {
        s.segundosHierba += dt;
        if (!g.revelado) { g.revelado = true; s.revelaciones++; }
      }
      if (g.tiempoHierba > HIERBA_DERRIBA_S) this.derribarAgente(g, null);
    }
    for (const g of this.equipos.guardianes) {
      if (g.revelado && g.activo) this.pizarras.infiltradores.publicarContacto(g.id, g.x, g.y, this.t);
    }
  }

  // Infiltrador con botín pisando una casilla de extracción: lo deposita entero. La primera vez, +30 s de reloj.
  extraer() {
    for (const a of this.equipos.infiltradores) {
      if (!a.activo || a.bolsa <= 0 || !this.extraccion.includes(celdaEn(this.mapa, a.x, a.y))) continue;
      this.extraido += a.bolsa;
      this.stats.infiltradores.extraido += a.bolsa;
      a.bolsa = 0;
      if (!this.bonoUsado) { this.bonoUsado = true; this.tiempoRestante += BONO_PRIMERA_EXTRACCION_S; }
    }
  }

  lanzarGadget(agente, tipo, x, y) {
    return lanzarGadget(this, agente, tipo, x, y);
  }

  // Luz de linterna que el equipo infiltrador ve AHORA: casillas iluminadas por un Guardián activo con línea de vista
  // desde algún Infiltrador activo a <= su alcance, en cualquier dirección (una linterna se ve con la visión
  // periférica; el cono de 40° solo pillaba ~3 % de la luz). Las paredes la tapan; de pie ve el suelo por encima de
  // las cajas. Se recalcula cada LUZ_REFRESCO_TICKS (más rápido que el retardo de reacción). Lo visto se apunta en
  // luzVista (la huella).
  luzInfiltradores() {
    const turno = Math.floor(this.ticks / LUZ_REFRESCO_TICKS);
    if (this.cacheLuz.tick === turno) return this.cacheLuz.luz;
    const n = this.mapa.ancho * this.mapa.alto, iluminada = new Uint8Array(n), luz = new Uint8Array(n), lista = [];
    const vista = this.pizarras.infiltradores.luzVista, ojos = this.equipos.infiltradores.filter(i => i.activo);
    for (const g of this.equipos.guardianes) if (g.activo) marcarIluminadas(this.mapa, g, iluminada, lista);
    // Las cámaras encendidas cuentan como luz si algún Infiltrador ve la cámara (su cono se deduce al verla).
    for (const g of this.gadgets) {
      if (!CAMARAS_COMO_LUZ || g.tipo !== 'camara' || this.t < g.desactivadoHasta) continue;
      if (ojos.some(i => Math.hypot(g.x - i.x, g.y - i.y) <= i.vision.alcance && lineaDeVista(this.mapa, i.x, i.y, g.x, g.y, RAYO_BAJO, false))) {
        marcarIluminadas(this.mapa, g, iluminada, lista);
      }
    }
    for (const c of lista) {
      const [x, y] = centroCelda(this.mapa, c);
      if (ojos.some(i => Math.hypot(x - i.x, y - i.y) <= i.vision.alcance &&
        lineaDeVista(this.mapa, i.x, i.y, x, y, i.altura === ALTURA.DE_PIE ? RAYO_ALTO : RAYO_BAJO, false))) { luz[c] = 1; vista[c] = this.t; }
    }
    this.cacheLuz = { tick: turno, luz };
    return luz;
  }

  // ¿Ve el equipo infiltrador luz en esa casilla ahora mismo? (para la espera en la sombra)
  celdaIluminada(c) {
    return this.luzInfiltradores()[c] === 1;
  }

  // Coste extra A* de los Infiltradores (una vez por tick como mucho): luz, huella reciente y peligro de su pizarra.
  costeInfiltradores() {
    const cache = this.cacheCoste;
    if (cache.tick === this.ticks) return cache.coste;
    const g = this.genesInfiltrador, coste = cache.coste, luz = this.luzInfiltradores(), pizarra = this.pizarras.infiltradores;
    for (let c = 0; c < coste.length; c++) {
      coste[c] = luz[c] ? g.w_light : this.t - pizarra.luzVista[c] <= MEMORIA_LUZ_S ? g.w_huella : 0;
    }
    if (g.w_peligro > 0) {
      for (const p of pizarra.puntosPeligro(this.t)) for (const c of celdasEnRadio(this.mapa, p.x, p.y, RADIO_PELIGRO)) coste[c] += g.w_peligro;
    }
    // Memoria de patrullas: por donde se ha visto pasar Guardianes (se olvida en MEMORIA_PATRULLA_S, poco a poco).
    if (g.w_memoria > 0) {
      for (const [m, tm] of pizarra.marcas) {
        const [x, y] = centroCelda(this.mapa, m), peso = g.w_memoria * (1 - (this.t - tm) / MEMORIA_PATRULLA_S);
        if (peso > 0) for (const c of celdasEnRadio(this.mapa, x, y, 2)) coste[c] += peso;
      }
    }
    cache.tick = this.ticks;
    return coste;
  }

  // Entrenamiento: bucle while puro, sin render, a la velocidad de la CPU.
  ejecutarHeadless(maxTicks = Infinity) {
    let n = 0;
    while (!this.terminada && n++ < maxTicks) this.paso();
    return this;
  }

  // Convierte ms reales en ticks fijos. Lo que sobra (< TICK_MS) se queda para el siguiente fotograma.
  avanzar(ms) {
    this.acumulador = Math.min(this.acumulador + ms, MAX_ACUMULADO_MS);
    while (this.acumulador >= TICK_MS) {
      this.paso();
      this.acumulador -= TICK_MS;
    }
  }

  // render: objeto con dibujar(motor) (ver render.js). En headless se ignora y corre ejecutarHeadless.
  iniciar(render) {
    if (this.headless) return this.ejecutarHeadless();
    let anterior = null;
    const fotograma = t => {
      if (anterior !== null) this.avanzar(t - anterior);
      anterior = t;
      render.dibujar(this);
      requestAnimationFrame(fotograma);
    };
    requestAnimationFrame(fotograma);
    return this;
  }
}

// Interfaz del genético y de las pruebas (la misma que antes de la v2).
function crearSimulacion(genesInfiltrador, genesGuardian, opciones = {}) {
  return new GameEngine({ headless: true, ...opciones, genesInfiltrador, genesGuardian });
}

function simular(sim, ticks) {
  return sim.ejecutarHeadless(ticks);
}

function avanzar(sim, ms) {
  sim.avanzar(ms);
}
