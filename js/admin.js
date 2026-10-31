/* Panel Administrativo
   Resumen financiero, cobranza por unidad, pagos, egresos, accesos y
   proveedores, avisos, paquetería, tickets, reservaciones, encuestas y usuarios. */
window.Admin = (function () {
  const { esc, h, money, zona, time, date, dateTime, toast, form, confirmDlg, TIPOS, ROLES, DIAS, initials } = UI;
  const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  // Módulos activos (config.js). Control de accesos siempre está activo.
  const MOD = { accesos: true, ...((window.UMBRAL_CONFIG || {}).MODULOS || {}) };
  const TODAS = [
    { group: "General" },
    { id: "resumen", label: "Resumen", icon: "◧", mod: "accesos" },
    { id: "unidades", label: "Unidades", icon: "⌂", mod: "accesos" },
    { id: "reportes", label: "Reportes", icon: "▤", mod: "accesos" },
    { group: "Finanzas" },
    { id: "cobranza", label: "Cobranza", icon: "$", mod: "finanzas" },
    { id: "pagos", label: "Pagos recibidos", icon: "⇣", mod: "finanzas" },
    { id: "egresos", label: "Egresos", icon: "⇡", mod: "finanzas" },
    { group: "Seguridad" },
    { id: "accesos", label: "Bitácora de accesos", icon: "⛨", mod: "accesos" },
    { id: "pases", label: "Pases y proveedores", icon: "▣", mod: "accesos" },
    { id: "listaNegra", label: "Lista negra", icon: "⊘", mod: "accesos" },
    { group: "Comunidad" },
    { id: "avisos", label: "Comunicados", icon: "✉", mod: "comunidad" },
    { id: "paquetes", label: "Paquetería", icon: "▢", mod: "comunidad" },
    { id: "tickets", label: "Tickets", icon: "✎", mod: "comunidad" },
    { id: "reservas", label: "Reservaciones", icon: "◷", mod: "comunidad" },
    { id: "encuestas", label: "Encuestas", icon: "☑", mod: "comunidad" },
    { group: "Configuración" },
    { id: "usuarios", label: "Usuarios y roles", icon: "☺", mod: "accesos" }
  ];
  const PAGES = TODAS
    .filter((p) => p.group || MOD[p.mod])
    .filter((p, i, arr) => !p.group || (arr[i + 1] && !arr[i + 1].group));

  // ---- Definición de reportes: columnas [título, valor] y resumen [[etiqueta, valor, color?]] ----
  const cuenta = (rows, f) => rows.filter(f).length;
  const top = (rows, key, n = 1) => {
    const m = {}; rows.forEach((r) => { const k = key(r); if (k) m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
  };
  const horaPico = (rows) => { const t = top(rows, (r) => zona.partes(r.created_at).h + ":00"); return t[0] ? `${t[0][0]} (${t[0][1]})` : "—"; };
  const suma = (rows) => rows.reduce((s, r) => s + +r.monto, 0);
  const sn = (b) => (b ? "Sí" : "No");
  const REPORTES = {
    accesos: { mod: "accesos", archivo: "accesos", titulo: "Bitácora de accesos", desc: "Cada lectura en caseta: quién entró, a qué unidad, quién autorizó y si se permitió.",
      cols: [["Fecha y hora", (r) => dateTime(r.created_at)], ["Nombre", (r) => r.nombre], ["Unidad", (r) => r.unidad], ["Tipo", (r) => TIPOS[r.tipo] || r.tipo],
        ["Resultado", (r) => (r.permitido ? "Permitido" : "Denegado")], ["Motivo", (r) => r.motivo || ""], ["Autorizó", (r) => r.autorizo || ""], ["Guardia", (r) => r.persona || ""], ["Punto", (r) => r.punto || ""]],
      resumen: (d) => [["Total de lecturas", d.length], ["Permitidos", cuenta(d, (r) => r.permitido), "ok"], ["Denegados", cuenta(d, (r) => !r.permitido), "bad"], ["Hora pico", horaPico(d)],
        ...top(d.filter((r) => r.unidad !== "—"), (r) => r.unidad, 1).map(([u, n]) => ["Unidad con más visitas", `${u} (${n})`]),
        ...top(d.filter((r) => !r.permitido), (r) => r.motivo, 1).map(([m, n]) => ["Motivo de rechazo más común", `${m} (${n})`])] },
    pases: { mod: "accesos", archivo: "pases", titulo: "Pases emitidos", desc: "Pases de visita y credenciales de proveedores creados en el periodo.",
      cols: [["Creado", (r) => dateTime(r.created_at)], ["Visitante", (r) => r.visitante], ["Tipo", (r) => TIPOS[r.tipo] || r.tipo], ["Unidad", (r) => r.unidad],
        ["Modalidad", (r) => (r.modalidad === "recurrente" ? "Recurrente" + (r.dias ? " · " + r.dias.map((x) => DIAS[x - 1]).join(", ") : "") : "Una vez")],
        ["Vigente hasta", (r) => dateTime(r.valido_hasta)], ["Usos", (r) => `${r.usos}${r.usos_max ? " / " + r.usos_max : ""}`], ["Estado", (r) => (!r.activo ? "Cancelado" : new Date(r.valido_hasta) < new Date() ? "Vencido" : "Vigente")],
        ["Creó", (r) => r.persona || ""], ["Código", (r) => r.codigo]],
      resumen: (d) => [["Pases emitidos", d.length], ["Usados al menos una vez", cuenta(d, (r) => r.usos > 0), "ok"], ["Nunca usados", cuenta(d, (r) => r.usos === 0)],
        ["Cancelados", cuenta(d, (r) => !r.activo), "bad"], ["Proveedores recurrentes", cuenta(d, (r) => r.modalidad === "recurrente")]] },
    alertas: { mod: "accesos", archivo: "alertas", titulo: "Alertas de emergencia", desc: "Alertas enviadas desde caseta y si ya fueron atendidas.",
      cols: [["Fecha y hora", (r) => dateTime(r.created_at)], ["Mensaje", (r) => r.mensaje], ["Envió", (r) => r.persona || ""], ["Atendida", (r) => sn(r.atendida)]],
      resumen: (d) => [["Alertas", d.length], ["Atendidas", cuenta(d, (r) => r.atendida), "ok"], ["Pendientes", cuenta(d, (r) => !r.atendida), "bad"]] },
    usuarios: { mod: "accesos", archivo: "usuarios", titulo: "Directorio de usuarios", sinFechas: true, desc: "Personas con acceso al condominio, su rol y unidad.",
      cols: [["Nombre", (r) => r.nombre], ["Correo", (r) => r.email || ""], ["Rol", (r) => ROLES[r.rol] || r.rol], ["Unidad", (r) => r.unidad], ["Teléfono", (r) => r.telefono || ""], ["Alta", (r) => date(r.created_at)]],
      resumen: (d) => [["Usuarios", d.length], ["Residentes", cuenta(d, (r) => r.rol === "residente")], ["Guardias", cuenta(d, (r) => r.rol === "guardia")], ["Administradores", cuenta(d, (r) => r.rol === "admin")]] },
    unidades: { mod: "accesos", archivo: "unidades", titulo: "Padrón de unidades", sinFechas: true, desc: "Unidades registradas con su torre y propietario.",
      cols: [["Unidad", (r) => r.nombre], ["Torre / sección", (r) => r.torre || ""], ["Propietario", (r) => r.propietario || ""], ["CLABE", (r) => r.clabe || ""], ["Alta", (r) => date(r.created_at)]],
      resumen: (d) => [["Unidades", d.length], ["Torres / secciones", new Set(d.map((r) => r.torre).filter(Boolean)).size], ["Sin propietario registrado", cuenta(d, (r) => !r.propietario)]] },
    avisos: { mod: "comunidad", archivo: "comunicados", titulo: "Comunicados publicados", desc: "Comunicados enviados a los residentes.",
      cols: [["Fecha", (r) => dateTime(r.created_at)], ["Título", (r) => r.titulo], ["Dirigido a", (r) => (r.torre ? "Torre " + r.torre : "Todos")], ["Importante", (r) => sn(r.importante)],
        ["Mensaje", (r) => r.cuerpo || ""], ["Adjunto", (r) => r.adjunto_nombre || ""]],
      resumen: (d) => [["Avisos", d.length], ["Importantes", cuenta(d, (r) => r.importante), "bad"], ["Con adjunto", cuenta(d, (r) => r.adjunto_url)], ["Para todo el condominio", cuenta(d, (r) => !r.torre)]] },
    paquetes: { mod: "comunidad", archivo: "paquetes", titulo: "Paquetería", desc: "Paquetes recibidos en caseta y su entrega.",
      cols: [["Recibido", (r) => dateTime(r.created_at)], ["Unidad", (r) => r.unidad], ["Paquetería", (r) => r.paqueteria || ""], ["Descripción", (r) => r.descripcion || ""],
        ["Entregado", (r) => (r.entregado_at ? dateTime(r.entregado_at) : "Pendiente")], ["Recibió", (r) => r.entregado_a || ""]],
      resumen: (d) => [["Paquetes recibidos", d.length], ["Entregados", cuenta(d, (r) => r.entregado_at), "ok"], ["En caseta", cuenta(d, (r) => !r.entregado_at), "warn"],
        ...top(d, (r) => r.paqueteria, 1).map(([p, n]) => ["Paquetería más frecuente", `${p} (${n})`])] },
    tickets: { mod: "comunidad", archivo: "tickets", titulo: "Tickets de mantenimiento", desc: "Reportes de residentes, su estado y responsable.",
      cols: [["Creado", (r) => dateTime(r.created_at)], ["Título", (r) => r.titulo], ["Categoría", (r) => r.categoria || ""], ["Unidad", (r) => r.unidad], ["Estado", (r) => ({ abierto: "Abierto", en_proceso: "En proceso", cerrado: "Cerrado" }[r.estado])],
        ["Responsable", (r) => r.responsable || ""], ["Descripción", (r) => r.descripcion || ""], ["Respuesta", (r) => r.respuesta || ""]],
      resumen: (d) => [["Tickets", d.length], ["Abiertos", cuenta(d, (r) => r.estado === "abierto"), "bad"], ["En proceso", cuenta(d, (r) => r.estado === "en_proceso"), "warn"], ["Cerrados", cuenta(d, (r) => r.estado === "cerrado"), "ok"],
        ...top(d, (r) => r.categoria, 1).map(([k, n]) => ["Categoría más reportada", `${k} (${n})`])] },
    reservaciones: { mod: "comunidad", archivo: "reservaciones", titulo: "Reservaciones de áreas comunes", desc: "Uso de áreas comunes por fecha de la reservación.",
      cols: [["Fecha", (r) => date(r.fecha)], ["Horario", (r) => `${String(r.hora_inicio).slice(0, 5)}–${String(r.hora_fin).slice(0, 5)}`], ["Área", (r) => r.area || ""], ["Unidad", (r) => r.unidad]],
      resumen: (d) => [["Reservaciones", d.length], ...top(d, (r) => r.area, 1).map(([a, n]) => ["Área más usada", `${a} (${n})`]), ...top(d, (r) => r.unidad, 1).map(([u, n]) => ["Unidad que más reservó", `${u} (${n})`])] },
    pagos: { mod: "finanzas", archivo: "pagos", titulo: "Pagos recibidos", desc: "Pagos registrados en el periodo.",
      cols: [["Fecha", (r) => dateTime(r.created_at)], ["Unidad", (r) => r.unidad], ["Método", (r) => r.metodo.toUpperCase()], ["Referencia", (r) => r.referencia || ""], ["Monto", (r) => money(r.monto)]],
      resumen: (d) => [["Pagos", d.length], ["Total cobrado", money(suma(d)), "ok"], ...top(d, (r) => r.metodo.toUpperCase(), 1).map(([m, n]) => ["Método más usado", `${m} (${n})`])] },
    cargos: { mod: "finanzas", archivo: "cargos", titulo: "Cargos y cartera", desc: "Cuotas y cargos por fecha de vencimiento.",
      cols: [["Vence", (r) => date(r.vence)], ["Unidad", (r) => r.unidad], ["Concepto", (r) => r.concepto], ["Monto", (r) => money(r.monto)], ["Estado", (r) => ({ pendiente: "Pendiente", pagado: "Pagado", vencido: "Vencido" }[r.estado])]],
      resumen: (d) => [["Cargos", d.length], ["Pagado", money(suma(d.filter((r) => r.estado === "pagado"))), "ok"], ["Pendiente", money(suma(d.filter((r) => r.estado === "pendiente"))), "warn"], ["Vencido", money(suma(d.filter((r) => r.estado === "vencido"))), "bad"]] },
    egresos: { mod: "finanzas", archivo: "egresos", titulo: "Egresos", desc: "Gastos del condominio por fecha.",
      cols: [["Fecha", (r) => date(r.fecha)], ["Concepto", (r) => r.concepto], ["Categoría", (r) => r.categoria || ""], ["Monto", (r) => money(r.monto)]],
      resumen: (d) => [["Egresos", d.length], ["Total", money(suma(d)), "bad"], ...top(d, (r) => r.categoria, 1).map(([k, n]) => ["Categoría principal", `${k} (${n})`])] }
  };

  function mount({ me, root, logout }) {
    let page = "resumen";
    try { page = sessionStorage.getItem("umbral_admin_page") || page; } catch (e) {}

    const el = h(`
      <div class="admin">
        <aside class="sidebar" id="sb">
          <div class="sb-head">
            <div class="brand">${UI.logo}<span>Umbral<span class="sub">${esc(me.condominio?.nombre || "Administración")}</span></span></div>
            <button type="button" class="btn ghost icon menu-btn" id="menu" aria-label="Abrir menú" aria-expanded="false" aria-controls="sbBody">☰</button>
          </div>
          <div class="sb-body" id="sbBody">
            <nav class="nav" id="nav" aria-label="Menú"></nav>
            <div class="sb-foot">
              <div class="user-pill"><span class="avatar" aria-hidden="true">${esc(initials(me.nombre))}</span><span class="small">${esc(me.nombre)}<br><span class="muted">Administración</span></span></div>
              <div class="row"><span id="theme"></span><button type="button" class="btn" id="salir">Salir</button></div>
            </div>
          </div>
        </aside>
        <div class="main">
          <div id="alertas" role="alert"></div>
          <main class="content" id="content"></main>
        </div>
      </div>`);
    root.appendChild(el);
    el.querySelector("#theme").appendChild(UI.themeToggle());
    const $ = (s) => el.querySelector(s);
    $("#salir").onclick = logout;
    $("#menu").onclick = () => $("#menu").setAttribute("aria-expanded", $("#sb").classList.toggle("open"));

    $("#nav").innerHTML = PAGES.map((p) => p.group ? `<div class="group">${esc(p.group)}</div>` : `<button type="button" class="nav-item" data-p="${esc(p.id)}">${esc(p.label)}<span class="badge hidden" data-b="${esc(p.id)}"></span></button>`).join("");
    $("#nav").querySelectorAll("[data-p]").forEach((a) => (a.onclick = () => go(a.dataset.p)));

    function go(p) {
      page = p; try { sessionStorage.setItem("umbral_admin_page", p); } catch (e) {}
      $("#sb").classList.remove("open"); $("#menu").setAttribute("aria-expanded", "false");
      $("#nav").querySelectorAll("[data-p]").forEach((a) => { a.classList.toggle("active", a.dataset.p === p); a.toggleAttribute("aria-current", a.dataset.p === p); });
      document.title = (PAGES.find((x) => x.id === p)?.label || "Panel") + " · Umbral";
      const c = $("#content"); c.innerHTML = `<div class="empty">Cargando…</div>`;
      (VIEWS[p] || VIEWS.resumen)(c).catch((e) => (c.innerHTML = `<div class="card error"><b>No se pudo cargar esta sección.</b> ${esc(e.message)} <button type="button" class="btn sm" id="retry" style="margin-left:8px">Reintentar</button></div>`, c.querySelector("#retry").onclick = refresh));
    }
    const refresh = () => go(page);
    const head = (title, sub, actions = "") => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="spacer"></div>${actions ? `<div class="acts">${actions}</div>` : ""}</div>`;
    // Fecha larga de hoy en la zona del condominio: "Viernes 31 de octubre"
    const hoyLargo = () => { const t = new Date().toLocaleDateString("es-MX", { timeZone: zona.tz, weekday: "long", day: "numeric", month: "long" }).replace(",", ""); return t.charAt(0).toUpperCase() + t.slice(1); };
    const resultado = (a) => (a.permitido ? `<span class="chip ok">✓ Permitido</span>` : `<span class="chip bad">✕ ${esc(a.motivo || "Denegado")}</span>`);
    const tablaAccesos = (accesos) => `<div class="table-wrap"><table class="table"><thead><tr><th>Hora</th><th>Persona</th><th>Unidad</th><th>Tipo</th><th>Resultado</th></tr></thead><tbody>${accesos.map((a) => `<tr><td class="muted num" style="text-align:left">${time(a.created_at)}</td><td><b>${esc(a.nombre)}</b></td><td>${esc(a.unidad)}</td><td class="muted">${esc(TIPOS[a.tipo] || a.tipo)}</td><td>${resultado(a)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Sin accesos hoy. Las lecturas de caseta aparecerán aquí.</td></tr>`}</tbody></table></div>`;
    const opts = (arr, l, v = "id") => arr.map((x) => ({ value: x[v], label: typeof l === "function" ? l(x) : x[l] }));

    async function badges() {
      if (!MOD.comunidad) return;
      const k = await API.kpisAccesos();
      const set = (id, n) => { const b = el.querySelector(`[data-b="${id}"]`); if (!b) return; b.textContent = n; b.classList.toggle("hidden", !n); };
      set("tickets", k.tickets_abiertos); set("paquetes", k.paquetes_pendientes);
    }

    // =================================================================
    const VIEWS = {
      async resumen(c) {
        if (!MOD.finanzas) return resumenAccesos(c);
        const [k, accesos] = await Promise.all([API.kpis(), API.accesos({ soloHoy: true, limit: 8 })]);
        const pct = k.unidades ? Math.round((k.unidades_al_corriente / k.unidades) * 100) : 0;
        const meses = k.meses || [];
        const max = Math.max(1, ...meses.flatMap((m) => [+m.ingresos, +m.egresos]));
        const bal = meses.length ? +meses[meses.length - 1].ingresos - +meses[meses.length - 1].egresos : 0;
        c.innerHTML = head("Resumen", esc(hoyLargo())) + `
          <div class="grid g4" style="margin-bottom:16px">
            <div class="card kpi"><div class="label">Cobrado en el mes</div><div class="value">${money(k.cobrado_mes)}</div><div class="sub">Pagos SPEI, tarjeta y efectivo</div></div>
            <div class="card kpi"><div class="label">Unidades al corriente</div><div class="value">${pct}%</div><div class="progress" style="margin-top:8px"><div style="width:${pct}%"></div></div><div class="sub">${k.unidades_al_corriente} de ${k.unidades}</div></div>
            <div class="card kpi"><div class="label">Cartera vencida</div><div class="value" style="color:${k.cartera_vencida > 0 ? "var(--bad)" : "inherit"}">${money(k.cartera_vencida)}</div><div class="sub">Cargos con fecha vencida</div></div>
            <div class="card kpi"><div class="label">Balance del mes</div><div class="value" style="color:${bal > 0 ? "var(--ok)" : bal < 0 ? "var(--bad)" : "inherit"}">${money(bal)}</div><div class="sub">Ingresos − egresos</div></div>
          </div>
          <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
            <div class="card">
              <header><h2>Ingresos vs egresos</h2><div class="spacer"></div><span class="chip">Últimos 6 meses</span></header>
              ${max <= 1 ? `<div class="empty" style="height:220px;display:grid;place-items:center">Sin movimientos todavía. Los ingresos y egresos aparecerán aquí.</div>` : ""}
              <div class="bars ${max <= 1 ? "hidden" : ""}">${meses.map((m) => { const [, mm] = m.mes.split("-");
                return `<div class="m"><div class="pair"><div class="bar in" style="height:${(m.ingresos / max) * 100}%" title="Ingresos ${money(m.ingresos)}"></div><div class="bar out" style="height:${(m.egresos / max) * 100}%" title="Egresos ${money(m.egresos)}"></div></div></div>`; }).join("")}</div>
              <div class="row" style="gap:18px;padding:0 4px">${meses.map((m) => `<div class="small muted" style="flex:1;text-align:center">${MESES[+m.mes.split("-")[1] - 1]}</div>`).join("")}</div>
              <div class="legend"><span><i style="background:var(--accent)"></i>Ingresos</span><span><i style="background:var(--border-strong)"></i>Egresos</span></div>
            </div>
            <div class="grid" style="align-content:start">
              <div class="card kpi"><div class="label">Accesos hoy</div><div class="value">${k.accesos_hoy}</div></div>
              <div class="card kpi"><div class="label">Tickets abiertos</div><div class="value">${k.tickets_abiertos}</div></div>
              <div class="card kpi"><div class="label">Paquetes por entregar</div><div class="value">${k.paquetes_pendientes}</div></div>
            </div>
          </div>
          <div class="card" style="margin-top:16px"><header><h2>Accesos recientes</h2><div class="spacer"></div><button type="button" class="btn link" id="vb">Ver bitácora</button></header>
            ${tablaAccesos(accesos)}</div>`;
        c.querySelector("#vb").onclick = () => go("accesos");
      },

      async cobranza(c) {
        const us = await API.unidadesConSaldo();
        let filtro = "todas";
        c.innerHTML = head("Cobranza por unidad", "Estado de cuenta y cartera de cada unidad",
          `<button class="btn" id="nu">+ Unidad</button><button class="btn" id="cx">+ Cargo extraordinario</button><button class="btn primary" id="em">Emitir cuota del mes</button>`) + `
          <div class="row wrap" style="margin-bottom:12px" id="flt">
            ${[["todas", "Todas"], ["al_corriente", "Al corriente"], ["pendiente", "Pendientes"], ["vencido", "Vencidas"]].map(([v, l]) => `<button class="btn" data-f="${v}">${l} (${v === "todas" ? us.length : us.filter((u) => u.estado === v).length})</button>`).join("")}
            <div class="spacer"></div><input class="input" id="bq" placeholder="Buscar unidad o propietario" style="max-width:260px">
          </div>
          <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Unidad</th><th>Propietario</th><th>CLABE</th><th class="num">Pendiente</th><th class="num">Vencido</th><th>Estado</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
        const draw = () => {
          const qv = c.querySelector("#bq").value.toLowerCase();
          c.querySelectorAll("[data-f]").forEach((b) => b.classList.toggle("primary", b.dataset.f === filtro));
          const rows = us.filter((u) => (filtro === "todas" || u.estado === filtro) && (u.nombre + " " + (u.propietario || "")).toLowerCase().includes(qv));
          c.querySelector("#tb").innerHTML = rows.map((u) => `<tr>
            <td><b>${esc(u.nombre)}</b></td><td>${esc(u.propietario || "—")}</td><td class="small muted">${esc(u.clabe || "—")}</td>
            <td class="num">${money(u.pendiente)}</td><td class="num" style="color:${u.vencido ? "var(--bad)" : "inherit"}">${money(u.vencido)}</td>
            <td>${u.estado === "al_corriente" ? `<span class="chip ok">✓ Al corriente</span>` : u.estado === "vencido" ? `<span class="chip bad">✕ Vencida</span>` : `<span class="chip warn">Pendiente</span>`}</td>
            <td><button class="btn" data-u="${esc(u.id)}">Estado de cuenta</button></td></tr>`).join("") || `<tr><td colspan="7" class="empty">Sin resultados</td></tr>`;
          c.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => estadoCuenta(us.find((u) => u.id === b.dataset.u))));
        };
        c.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filtro = b.dataset.f; draw(); }));
        c.querySelector("#bq").oninput = draw;
        draw();
        const { y, m } = zona.partes(), sig = new Date(Date.UTC(y, m, 1, 12)); // mes siguiente en la zona
        const vence = sig.toISOString().slice(0, 8) + "10";
        c.querySelector("#em").onclick = async () => {
          if (!us.length) return toast("Primero crea las unidades");
          const mesTxt = sig.toLocaleDateString("es-MX", { timeZone: "UTC", month: "long", year: "numeric" });
          const d = await form({ title: "Emitir cuota ordinaria", submit: "Emitir a todas las unidades", fields: [
            { name: "concepto", label: "Concepto", value: "Cuota ordinaria " + mesTxt, required: true },
            { name: "monto", label: "Monto por unidad (MXN)", type: "number", value: 2000, required: true },
            { name: "vence", label: "Fecha límite", type: "date", value: vence, required: true }],
            onSubmit: (v) => API.emitirCuotas(v.concepto, +v.monto, v.vence) });
          if (d) { toast("Avisos de cobro emitidos"); refresh(); }
        };
        c.querySelector("#nu").onclick = async () => {
          const d = await form({ title: "Nueva unidad", submit: "Crear unidad", fields: [
            { name: "nombre", label: "Nombre", required: true, placeholder: "Casa 14, Torre B · 302…" },
            { name: "torre", label: "Torre / sección (opcional)" },
            { name: "propietario", label: "Propietario (opcional)" },
            { name: "clabe", label: "CLABE SPEI de la unidad (opcional)" }],
            onSubmit: (v) => API.crearUnidad({ nombre: v.nombre.trim(), torre: v.torre || null, propietario: v.propietario || null, clabe: v.clabe || null }) });
          if (d) { toast("Unidad creada"); refresh(); }
        };
        c.querySelector("#cx").onclick = async () => {
          if (!us.length) return toast("Primero crea una unidad");
          const d = await form({ title: "Cargo extraordinario", fields: [
            { name: "unidad_id", label: "Unidad", type: "select", options: opts(us, "nombre") },
            { name: "concepto", label: "Concepto", required: true, placeholder: "Multa, reparación, cuota especial…" },
            { name: "monto", label: "Monto (MXN)", type: "number", required: true },
            { name: "vence", label: "Fecha límite", type: "date", value: vence, required: true }],
            onSubmit: (v) => API.crearCargo({ ...v, monto: +v.monto, extraordinaria: true }) });
          if (d) { toast("Cargo creado"); refresh(); }
        };
      },

      async pagos(c) {
        const ps = await API.pagos();
        const total = ps.filter((p) => p.confirmado).reduce((s, p) => s + +p.monto, 0);
        const porConfirmar = ps.filter((p) => !p.confirmado).length;
        c.innerHTML = head("Pagos recibidos", `${ps.length} pagos · ${money(total)} confirmados${porConfirmar ? ` · ${porConfirmar} por confirmar` : ""}`, `<button class="btn" id="csv">Exportar CSV</button>`) + `
          <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Unidad</th><th>Método</th><th>Referencia / CEP</th><th class="num">Monto</th><th>Estado</th></tr></thead><tbody>
          ${ps.map((p) => `<tr><td>${dateTime(p.created_at)}</td><td><b>${esc(p.unidad)}</b></td><td><span class="chip">${esc(p.metodo.toUpperCase())}</span></td><td class="small muted">${esc(p.referencia || "—")}</td><td class="num">${money(p.monto)}</td>
            <td>${p.confirmado ? `<span class="chip ok">✓ Confirmado</span>` : `<button class="btn sm" data-ok="${esc(p.id)}">Confirmar</button>`}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Aún no hay pagos</td></tr>`}
          </tbody></table></div></div>`;
        c.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = async () => {
          const p = ps.find((x) => x.id === b.dataset.ok);
          if (await confirmDlg("Confirmar pago", `${money(p.monto)} de ${p.unidad}. Verifica antes la referencia en tu banco; el cargo quedará como pagado.`)) {
            await API.confirmarPago(p.id); toast("Pago confirmado"); refresh();
          }
        }));
        c.querySelector("#csv").onclick = () => downloadCsv("pagos.csv", [["fecha", "unidad", "metodo", "referencia", "monto", "confirmado"], ...ps.map((p) => [p.created_at, p.unidad, p.metodo, p.referencia || "", p.monto, p.confirmado ? "si" : "no"])]);
      },

      async egresos(c) {
        const es = await API.egresos();
        c.innerHTML = head("Egresos", `${money(es.reduce((s, e) => s + +e.monto, 0))} registrados`, `<button class="btn primary" id="ne">+ Registrar egreso</button>`) + `
          <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th class="num">Monto</th></tr></thead><tbody>
          ${es.map((e) => `<tr><td>${date(e.fecha)}</td><td><b>${esc(e.concepto)}</b></td><td><span class="chip">${esc(e.categoria || "—")}</span></td><td class="num">${money(e.monto)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">Aún no hay egresos</td></tr>`}
          </tbody></table></div></div>`;
        c.querySelector("#ne").onclick = async () => {
          const d = await form({ title: "Registrar egreso", fields: [
            { name: "concepto", label: "Concepto", required: true },
            { name: "categoria", label: "Categoría", type: "select", options: ["Servicios", "Mantenimiento", "Nómina", "Administración", "Otros"].map((x) => ({ value: x, label: x })) },
            { name: "monto", label: "Monto (MXN)", type: "number", required: true },
            { name: "fecha", label: "Fecha", type: "date", value: zona.hoy() }],
            onSubmit: (v) => API.crearEgreso({ ...v, monto: +v.monto }) });
          if (d) { toast("Egreso registrado"); refresh(); }
        };
      },

      async accesos(c) {
        const rows = await API.accesos({ limit: 500 });
        c.innerHTML = head("Bitácora de accesos", "Cada entrada con hora, unidad y quién autorizó", `<button class="btn" id="csv">Exportar CSV</button>`) + `
          <div class="row wrap" style="margin-bottom:12px"><input class="input" id="bq" placeholder="Buscar nombre, unidad o placa" style="max-width:280px">
            <select id="ft" style="max-width:180px"><option value="">Todos los tipos</option>${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
            <select id="fr" style="max-width:180px"><option value="">Todos</option><option value="1">Permitidos</option><option value="0">Denegados</option></select></div>
          <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Nombre</th><th>Unidad</th><th>Tipo</th><th>Autorizó</th><th>Punto</th><th>Resultado</th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
        const draw = () => {
          const qv = c.querySelector("#bq").value.toLowerCase(), ft = c.querySelector("#ft").value, fr = c.querySelector("#fr").value;
          const f = rows.filter((r) => (r.nombre + " " + r.unidad + " " + (r.placa || "")).toLowerCase().includes(qv) && (!ft || r.tipo === ft) && (!fr || String(+r.permitido) === fr));
          c.querySelector("#tb").innerHTML = f.map((r) => `<tr><td class="small">${dateTime(r.created_at)}</td><td><b>${esc(r.nombre)}</b>${r.placa ? `<div class="small muted">Placa ${esc(r.placa)}</div>` : ""}</td><td>${esc(r.unidad)}</td><td>${esc(TIPOS[r.tipo] || r.tipo)}</td><td class="small muted">${esc(r.autorizo || "—")}</td><td class="small muted">${esc(r.punto || "")}</td>
            <td>${r.permitido ? `<span class="chip ok">✓ Permitido</span>` : `<span class="chip bad" title="${esc(r.motivo || "")}">✕ ${esc(r.motivo || "Denegado")}</span>`}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">Sin registros</td></tr>`;
        };
        ["#bq", "#ft", "#fr"].forEach((s) => (c.querySelector(s).oninput = draw));
        draw();
        c.querySelector("#csv").onclick = () => downloadCsv("bitacora.csv", [["fecha", "nombre", "placa", "unidad", "tipo", "permitido", "motivo", "autorizo"], ...rows.map((r) => [r.created_at, r.nombre, r.placa || "", r.unidad, r.tipo, r.permitido, r.motivo || "", r.autorizo || ""])]);
      },

      async pases(c) {
        const [ps, us] = await Promise.all([API.pases(), API.unidades()]);
        const vig = (p) => p.activo && new Date(p.valido_hasta) > new Date();
        c.innerHTML = head("Pases y proveedores", "Pases de visita y proveedores recurrentes con días, horario y credencial digital", `<button class="btn" id="nv">+ Pase de visita</button><button class="btn primary" id="np">+ Proveedor recurrente</button>`) + `
          <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Persona</th><th>Tipo</th><th>Unidad</th><th>Días y horario</th><th>Vigencia</th><th>Código</th><th>Estado</th><th></th></tr></thead><tbody>
          ${ps.map((p) => `<tr><td><b>${esc(p.visitante)}</b></td><td>${esc(TIPOS[p.tipo])}</td><td>${esc(p.unidad)}</td>
            <td class="small">${p.modalidad === "recurrente" ? (p.dias ? p.dias.map((d) => DIAS[d - 1]).join(", ") : "Todos los días") + (p.hora_inicio ? ` · ${p.hora_inicio.slice(0, 5)}–${p.hora_fin.slice(0, 5)}` : "") : "Una vez"}</td>
            <td class="small muted">hasta ${date(p.valido_hasta)}</td><td><code>${esc(p.codigo)}</code></td>
            <td>${vig(p) ? `<span class="chip ok">✓ Vigente</span>` : `<span class="chip">Inactivo</span>`}</td>
            <td>${vig(p) ? `<button class="btn" data-x="${esc(p.id)}">Revocar</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">Aún no hay pases</td></tr>`}
          </tbody></table></div></div>`;
        c.querySelectorAll("[data-x]").forEach((b) => (b.onclick = async () => { if (await confirmDlg("Revocar pase", "El código dejará de funcionar en caseta.")) { await API.cancelarPase(b.dataset.x); toast("Pase revocado"); refresh(); } }));
        c.querySelector("#np").onclick = async () => {
          if (!us.length) return toast("Primero crea una unidad");
          const d = await form({ title: "Proveedor recurrente", submit: "Crear credencial", fields: [
            { name: "visitante", label: "Nombre y servicio", required: true, placeholder: "Luis Pérez · Jardinería" },
            { name: "unidad_id", label: "Unidad / área que atiende", type: "select", options: opts(us, "nombre") },
            { name: "dias", label: "Días permitidos", type: "days", value: [1, 3, 5] },
            { name: "hora_inicio", label: "Desde", type: "time", value: "08:00" },
            { name: "hora_fin", label: "Hasta", type: "time", value: "14:00" },
            { name: "valido_hasta", label: "Vigente hasta", type: "date", value: zona.sumarDias(zona.hoy(), 90) }],
            onSubmit: (v) => API.crearPase({ ...v, tipo: "proveedor", modalidad: "recurrente", usos_max: null, valido_hasta: zona.aUTC(v.valido_hasta, "23:59"), dias: v.dias.length ? v.dias : null }) });
          if (d) { toast("Credencial creada"); refresh(); }
        };
        c.querySelector("#nv").onclick = async () => {
          if (!us.length) return toast("Primero crea una unidad");
          const hoy = zona.hoy();
          let creado = null;
          const d = await form({ title: "Pase de visita (un acceso)", submit: "Crear pase", fields: [
            { name: "visitante", label: "Nombre del visitante", required: true },
            { name: "unidad_id", label: "Unidad que visita", type: "select", options: opts(us, "nombre") },
            { name: "tipo", label: "Tipo", type: "select", options: Object.entries(TIPOS).filter(([k]) => k !== "residente").map(([value, label]) => ({ value, label })) },
            { name: "fecha", label: "Fecha de la visita", type: "date", value: hoy, required: true }],
            onSubmit: async (v) => {
              creado = await API.crearPase({ visitante: v.visitante.trim(), unidad_id: v.unidad_id, tipo: v.tipo, modalidad: "una_vez", usos_max: 1,
                valido_desde: zona.aUTC(v.fecha, "00:00"), valido_hasta: zona.aUTC(v.fecha, "23:59") });
            } });
          if (d && creado) { toast("Pase creado · código " + creado.codigo); refresh(); }
        };
      },

      async listaNegra(c) {
        const xs = await API.listaNegra();
        const act = xs.filter((x) => x.activo).length;
        c.innerHTML = head("Lista negra", `${act} activas · ${xs.length - act} desactivadas`, `<button class="btn primary" id="nl">+ Agregar</button>`) + `
          ${!xs.length ? `<div class="card empty">
              <b>Aún no hay personas restringidas.</b><br>Agrega aquí a quien no debe entrar al condominio. La caseta negará sus pases y avisará al guardia si llega sin pase, por nombre o por placa.<br>
              <button class="btn primary" id="nl2" style="margin-top:10px">+ Agregar a la lista</button></div>` : `
          <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Nombre</th><th>Placa</th><th>Motivo</th><th>Agregada</th><th>Estado</th><th></th></tr></thead><tbody>
          ${xs.map((x) => `<tr><td><b>${esc(x.nombre)}</b></td><td>${x.placa ? `<code>${esc(x.placa)}</code>` : `<span class="muted">—</span>`}</td><td class="small">${esc(x.motivo || "—")}</td><td class="small muted">${date(x.created_at)}</td>
            <td>${x.activo ? `<span class="chip bad">⊘ Restringida</span>` : `<span class="chip">Desactivada</span>`}</td>
            <td><button class="btn" data-ln="${esc(x.id)}">${x.activo ? "Desactivar" : "Reactivar"}</button></td></tr>`).join("")}
          </tbody></table></div></div>`}`;
        const nuevo = async () => {
          const d = await form({ title: "Agregar a la lista negra", submit: "Agregar", fields: [
            { name: "nombre", label: "Nombre completo", required: true },
            { name: "placa", label: "Placa del vehículo (opcional)", placeholder: "ABC-123-D" },
            { name: "motivo", label: "Motivo (opcional)", type: "textarea" }],
            onSubmit: (v) => API.agregarListaNegra({ nombre: v.nombre.trim(), placa: v.placa.trim().toUpperCase() || null, motivo: v.motivo.trim() || null }) });
          if (d) { toast("Agregada a la lista negra"); refresh(); }
        };
        c.querySelector("#nl").onclick = nuevo;
        if (c.querySelector("#nl2")) c.querySelector("#nl2").onclick = nuevo;
        c.querySelectorAll("[data-ln]").forEach((b) => (b.onclick = async () => {
          const x = xs.find((y) => String(y.id) === b.dataset.ln);
          const ok = x.activo
            ? await confirmDlg("Desactivar restricción", `${x.nombre} podrá volver a entrar con pase o con autorización del residente.`)
            : await confirmDlg("Reactivar restricción", `La caseta volverá a negar el acceso a ${x.nombre}.`);
          if (!ok) return;
          try { await API.cambiarListaNegra(x.id, !x.activo); toast(x.activo ? "Restricción desactivada" : "Restricción reactivada"); refresh(); }
          catch (e) { toast("No se pudo actualizar: " + e.message); }
        }));
      },

      async avisos(c) {
        const [av, un] = await Promise.all([API.avisos(), API.unidades()]);
        const torres = [...new Set(un.map((u) => u.torre).filter(Boolean))].sort();
        let filtro = "";
        const esImagen = (u) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u || "");
        c.innerHTML = head("Comunicados", "Avisos para todo el condominio o por torre / sección. Los residentes los ven en la app.",
          `<button class="btn primary" id="na">+ Nuevo aviso</button>`) + `
          <div class="row wrap" style="margin-bottom:12px"><input class="input" id="bq" placeholder="Buscar en avisos" style="max-width:300px">
            <span class="small muted">${av.length} aviso(s) publicados</span></div>
          <div class="grid" id="lst"></div>`;
        const draw = () => {
          const rows = av.filter((a) => (a.titulo + " " + (a.cuerpo || "")).toLowerCase().includes(filtro));
          c.querySelector("#lst").innerHTML = rows.map((a) => `<div class="card" ${a.importante ? `style="border-left:4px solid var(--bad)"` : ""}>
            <header><h3>${esc(a.titulo)}</h3><div class="spacer"></div>
              ${a.importante ? `<span class="chip bad">Importante</span>` : ""}
              <span class="chip">${a.torre ? "Torre " + esc(a.torre) : "Todos"}</span>
              <span class="small muted">${dateTime(a.created_at)}</span>
              <button class="btn ghost" data-del="${esc(a.id)}" title="Eliminar aviso">Eliminar</button></header>
            <div style="white-space:pre-wrap">${esc(a.cuerpo || "")}</div>
            ${a.adjunto_url ? (esImagen(a.adjunto_url)
              ? `<a href="${esc(a.adjunto_url)}" target="_blank" rel="noopener"><img src="${esc(a.adjunto_url)}" alt="${esc(a.adjunto_nombre || "Imagen del aviso")}" style="margin-top:10px;max-width:100%;max-height:260px;border-radius:10px;border:1px solid var(--border)"></a>`
              : `<div style="margin-top:10px"><a class="btn" href="${esc(a.adjunto_url)}" target="_blank" rel="noopener">📎 ${esc(a.adjunto_nombre || "Ver adjunto")}</a></div>`) : ""}
          </div>`).join("") || `<div class="card empty">${av.length ? "Sin resultados" : "Aún no hay avisos. Publica el primero con “+ Nuevo aviso”."}</div>`;
          c.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
            const a = av.find((x) => x.id === b.dataset.del);
            if (await confirmDlg("Eliminar aviso", `“${a.titulo}” dejará de verse en la app de los residentes.`)) {
              await API.eliminarAviso(a); toast("Aviso eliminado"); refresh();
            }
          }));
        };
        c.querySelector("#bq").oninput = (e) => { filtro = e.target.value.toLowerCase(); draw(); };
        c.querySelector("#na").onclick = async () => {
          const d = await form({ title: "Nuevo aviso", submit: "Publicar", fields: [
            { name: "titulo", label: "Título", required: true, placeholder: "Corte de agua el jueves, fumigación…" },
            { name: "cuerpo", label: "Mensaje", type: "textarea" },
            { name: "torre", label: "Dirigido a", type: "select", value: "", options: [{ value: "", label: "Todo el condominio" }, ...torres.map((t) => ({ value: t, label: "Torre / sección " + t }))] },
            { name: "archivo", label: "Adjunto (opcional)", type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,application/pdf", hint: "Imagen o PDF de hasta 10 MB: circular, reglamento, foto…" },
            { name: "importante", type: "checkbox", text: "Marcar como importante" }],
            onSubmit: (v) => API.crearAviso({ titulo: v.titulo.trim(), cuerpo: v.cuerpo || null, torre: v.torre || null, importante: v.importante }, v.archivo) });
          if (d) { toast("Aviso publicado"); refresh(); }
        };
        draw();
      },

      async paquetes(c) {
        const ps = await API.paquetes();
        c.innerHTML = head("Paquetería", `${ps.filter((p) => !p.entregado_at).length} por entregar`) + `
          <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Recibido</th><th>Unidad</th><th>Paquetería</th><th>Descripción</th><th>Estado</th></tr></thead><tbody>
          ${ps.map((p) => `<tr><td class="small">${dateTime(p.created_at)}</td><td><b>${esc(p.unidad)}</b></td><td>${esc(p.paqueteria || "—")}</td><td>${esc(p.descripcion || "")}</td>
            <td>${p.entregado_at ? `<span class="chip ok">✓ Entregado a ${esc(p.entregado_a || "")}</span>` : `<span class="chip warn">En caseta</span>`}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Aún no hay paquetes</td></tr>`}
          </tbody></table></div></div>`;
      },

      async tickets(c) {
        const ts = await API.tickets();
        const col = (estado, label) => `<div><h3 style="margin-bottom:10px">${label} <span class="muted">(${ts.filter((t) => t.estado === estado).length})</span></h3><div class="grid">
          ${ts.filter((t) => t.estado === estado).map((t) => `<div class="card"><div class="row"><b>${esc(t.titulo)}</b><div class="spacer"></div><span class="chip">${esc(t.categoria || "General")}</span></div><div class="small muted" style="margin:4px 0 8px">${esc(t.unidad)} · ${date(t.created_at)}</div><div class="small" style="white-space:pre-wrap">${esc(t.descripcion || "")}</div>
            ${t.respuesta ? `<div class="small" style="margin-top:8px;padding:8px;border-radius:8px;background:var(--accent-soft)"><b>Respuesta:</b> ${esc(t.respuesta)}</div>` : ""}
            <div class="row wrap" style="margin-top:12px"><span class="chip">${esc(t.responsable || "Sin asignar")}</span><div class="spacer"></div><button class="btn" data-t="${esc(t.id)}">Gestionar</button></div></div>`).join("") || `<div class="empty small">—</div>`}</div></div>`;
        c.innerHTML = head("Tickets", "Reportes de residentes con responsable y seguimiento") + `<div class="grid g3">${col("abierto", "Abiertos")}${col("en_proceso", "En proceso")}${col("cerrado", "Cerrados")}</div>`;
        c.querySelectorAll("[data-t]").forEach((b) => (b.onclick = async () => {
          const t = ts.find((x) => x.id === b.dataset.t);
          const d = await form({ title: t.titulo, fields: [
            { name: "estado", label: "Estado", type: "select", value: t.estado, options: [{ value: "abierto", label: "Abierto" }, { value: "en_proceso", label: "En proceso" }, { value: "cerrado", label: "Cerrado" }] },
            { name: "responsable", label: "Responsable", value: t.responsable || "", placeholder: "Mantenimiento, Administración…" },
            { name: "respuesta", label: "Respuesta para el residente (la ve en la app)", type: "textarea", value: t.respuesta || "" }],
            onSubmit: (v) => API.actualizarTicket(t.id, { estado: v.estado, responsable: v.responsable || null, respuesta: v.respuesta?.trim() || null }) });
          if (d) { toast("Ticket actualizado"); refresh(); badges(); }
        }));
      },

      async reservas(c) {
        const [rs, ar] = await Promise.all([API.reservaciones(), API.areas()]);
        c.innerHTML = head("Reservaciones", "Áreas comunes con reglas y horarios", `<button class="btn primary" id="na">+ Área común</button>`) + `
          <div class="grid g3" style="margin-bottom:16px">${ar.map((a) => `<div class="card"><b>${esc(a.nombre)}</b><div class="small muted">${esc(a.reglas || "")}</div><div class="small" style="margin-top:6px">${String(a.abre).slice(0, 5)}–${String(a.cierra).slice(0, 5)}</div></div>`).join("") || `<div class="card empty">Aún no hay áreas comunes</div>`}</div>
          <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Horario</th><th>Área</th><th>Unidad</th><th></th></tr></thead><tbody>
          ${rs.map((r) => `<tr><td>${date(r.fecha)}</td><td>${String(r.hora_inicio).slice(0, 5)}–${String(r.hora_fin).slice(0, 5)}</td><td><b>${esc(r.area)}</b></td><td>${esc(r.unidad)}</td><td><button class="btn" data-x="${esc(r.id)}">Cancelar</button></td></tr>`).join("") || `<tr><td colspan="5" class="empty">Sin reservaciones próximas</td></tr>`}
          </tbody></table></div></div>`;
        c.querySelector("#na").onclick = async () => {
          const d = await form({ title: "Nueva área común", submit: "Crear", fields: [
            { name: "nombre", label: "Nombre", required: true, placeholder: "Salón de eventos, asador, alberca…" },
            { name: "reglas", label: "Reglas (opcional)" },
            { name: "abre", label: "Abre", type: "time", value: "08:00" },
            { name: "cierra", label: "Cierra", type: "time", value: "22:00" }],
            onSubmit: (v) => API.crearArea({ nombre: v.nombre.trim(), reglas: v.reglas || null, abre: v.abre, cierra: v.cierra }) });
          if (d) { toast("Área creada"); refresh(); }
        };
        c.querySelectorAll("[data-x]").forEach((b) => (b.onclick = async () => { if (await confirmDlg("Cancelar reservación", "Se notificará a la unidad.")) { await API.cancelarReservacion(b.dataset.x); refresh(); } }));
      },

      async encuestas(c) {
        const es = await API.encuestas();
        const kpi = await API.kpisAccesos();
        c.innerHTML = head("Encuestas", "Resultados en tiempo real", `<button class="btn primary" id="ne">+ Nueva encuesta</button>`) + `<div class="grid g2">
          ${es.map((e) => `<div class="card"><header><h3>${esc(e.pregunta)}</h3></header>
            ${e.opciones.map((o, i) => { const p = e.total ? Math.round((e.resultados[i] / e.total) * 100) : 0;
              return `<div style="margin-bottom:10px"><div class="row small"><span>${esc(o)}</span><div class="spacer"></div><b>${p}%</b><span class="muted">(${e.resultados[i]})</span></div><div class="progress"><div style="width:${p}%"></div></div></div>`; }).join("")}
            <div class="small muted">Participación: ${e.total} de ${kpi.unidades} unidades${e.cierra ? " · cierra " + date(e.cierra) : ""}</div></div>`).join("") || `<div class="empty">Sin encuestas</div>`}</div>`;
        c.querySelector("#ne").onclick = async () => {
          const d = await form({ title: "Nueva encuesta", submit: "Publicar", fields: [
            { name: "pregunta", label: "Pregunta", required: true },
            { name: "opciones", label: "Opciones (una por línea)", type: "textarea", value: "Sí\nNo" },
            { name: "cierra", label: "Cierra", type: "date", value: zona.sumarDias(zona.hoy(), 7) }],
            onSubmit: (v) => { const op = v.opciones.split("\n").map((s) => s.trim()).filter(Boolean); if (op.length < 2) throw new Error("Agrega al menos 2 opciones"); return API.crearEncuesta({ pregunta: v.pregunta, opciones: op, cierra: v.cierra }); } });
          if (d) { toast("Encuesta publicada"); refresh(); }
        };
      },

      async reportes(c) {
        const un = await API.unidades();
        const hoy = zona.hoy(), inicioMes = hoy.slice(0, 8) + "01"; // días civiles en la zona del condominio
        const disponibles = Object.entries(REPORTES).filter(([, r]) => MOD[r.mod]);
        let datos = null, def = null, filtros = null;

        c.innerHTML = head("Reportes", "Genera reportes por periodo, revisa el resumen y expórtalos a Excel (CSV) o PDF") + `
          <div class="card" style="margin-bottom:16px">
            <form id="rf" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));align-items:end">
              <div class="field" style="margin:0"><label for="r_tipo">Reporte</label><select id="r_tipo">${disponibles.map(([k, r]) => `<option value="${k}">${esc(r.titulo)}</option>`).join("")}</select></div>
              <div class="field" style="margin:0"><label for="r_desde">Desde</label><input class="input" type="date" id="r_desde" value="${inicioMes}"></div>
              <div class="field" style="margin:0"><label for="r_hasta">Hasta</label><input class="input" type="date" id="r_hasta" value="${hoy}"></div>
              <div class="field" style="margin:0"><label for="r_unidad">Unidad</label><select id="r_unidad"><option value="">Todas</option>${un.map((u) => `<option value="${esc(u.id)}">${esc(u.nombre)}</option>`).join("")}</select></div>
              <button class="btn primary">Generar</button>
            </form>
            <div class="row wrap small" style="margin-top:12px;gap:6px">
              <span class="muted">Periodo rápido:</span>
              ${[["hoy", "Hoy"], ["7", "Últimos 7 días"], ["mes", "Este mes"], ["mesant", "Mes anterior"], ["anio", "Este año"]].map(([v, l]) => `<button type="button" class="btn ghost" data-rng="${v}">${l}</button>`).join("")}
            </div>
            <p class="small muted" id="r_desc" style="margin:10px 0 0"></p>
          </div>
          <div id="r_out"><div class="card empty">Elige un reporte y presiona <b>Generar</b>.</div></div>`;
        const $r = (s) => c.querySelector(s);
        const desc = () => {
          const r = REPORTES[$r("#r_tipo").value];
          $r("#r_desc").textContent = r.desc + (r.sinFechas ? " · Este reporte muestra el estado actual (no usa fechas)." : "");
          $r("#r_desde").disabled = $r("#r_hasta").disabled = !!r.sinFechas;
        };
        $r("#r_tipo").onchange = desc; desc();
        c.querySelectorAll("[data-rng]").forEach((b) => (b.onclick = () => {
          const finMesAnt = zona.sumarDias(inicioMes, -1);
          const R = { hoy: [hoy, hoy], 7: [zona.sumarDias(hoy, -6), hoy], mes: [inicioMes, hoy],
            mesant: [finMesAnt.slice(0, 8) + "01", finMesAnt], anio: [hoy.slice(0, 5) + "01-01", hoy] }[b.dataset.rng];
          $r("#r_desde").value = R[0]; $r("#r_hasta").value = R[1];
          $r("#rf").requestSubmit();
        }));

        $r("#rf").onsubmit = async (e) => {
          e.preventDefault();
          def = REPORTES[$r("#r_tipo").value];
          filtros = { desde: def.sinFechas ? null : $r("#r_desde").value, hasta: def.sinFechas ? null : $r("#r_hasta").value, unidad_id: $r("#r_unidad").value || null };
          if (filtros.desde && filtros.hasta && filtros.desde > filtros.hasta) return toast("La fecha inicial es posterior a la final");
          $r("#r_out").innerHTML = `<div class="card empty">Generando reporte…</div>`;
          try { datos = await API.reporte($r("#r_tipo").value, filtros); }
          catch (err) { $r("#r_out").innerHTML = `<div class="card error">${esc(err.message)}</div>`; return; }
          pintar();
        };

        function periodoTxt() {
          const u = filtros.unidad_id ? un.find((x) => x.id === filtros.unidad_id)?.nombre : null;
          return [def.sinFechas ? "Estado actual" : `${date(filtros.desde)} – ${date(filtros.hasta)}`, u ? "Unidad: " + u : "Todas las unidades"].join(" · ");
        }
        function pintar() {
          const resumen = def.resumen(datos);
          $r("#r_out").innerHTML = `
            <div class="card" style="margin-bottom:16px"><header><h2>${esc(def.titulo)}</h2><div class="spacer"></div>
              <span class="small muted">${esc(periodoTxt())}</span>
              <button class="btn" id="r_csv" ${datos.length ? "" : "disabled"}>Exportar CSV</button>
              <button class="btn primary" id="r_pdf" ${datos.length ? "" : "disabled"}>Imprimir / PDF</button></header>
              <div class="grid g4">${resumen.map(([l, v, cls]) => `<div class="kpi"><div class="label">${esc(l)}</div><div class="value" ${cls ? `style="color:var(--${cls})"` : ""}>${esc(v)}</div></div>`).join("")}</div>
            </div>
            <div class="card"><div class="table-wrap"><table class="table"><thead><tr>${def.cols.map(([t]) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>
              ${datos.slice(0, 500).map((r) => `<tr>${def.cols.map(([, f]) => `<td>${esc(f(r))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${def.cols.length}" class="empty">Sin registros en este periodo</td></tr>`}
            </tbody></table></div>
            ${datos.length > 500 ? `<p class="small muted">Se muestran 500 de ${datos.length} filas. El CSV y el PDF incluyen todas.</p>` : ""}</div>`;
          $r("#r_csv").onclick = () => downloadCsv(`reporte-${def.archivo}-${filtros.desde || hoy}.csv`,
            [def.cols.map(([t]) => t), ...datos.map((r) => def.cols.map(([, f]) => f(r)))]);
          $r("#r_pdf").onclick = () => imprimir(resumen);
        }

        function imprimir(resumen) {
          const w = window.open("", "_blank");
          if (!w) return toast("Permite las ventanas emergentes para imprimir el reporte");
          w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(def.titulo)} · ${esc(me.condominio?.nombre || "Umbral")}</title>
            <style>
              *{box-sizing:border-box} body{font-family:Inter,system-ui,sans-serif;color:#111827;margin:28px;font-size:12px}
              h1{font-size:20px;margin:0 0 2px} .sub{color:#6b7280;margin:0 0 16px}
              .kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px} .k{border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;min-width:120px}
              .k b{display:block;font-size:16px} .k span{color:#6b7280;font-size:11px}
              table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top}
              th{background:#f3f4f6;font-size:11px;text-transform:uppercase;letter-spacing:.03em} tr{page-break-inside:avoid}
              .pie{margin-top:14px;color:#6b7280;font-size:10px} @page{margin:14mm}
            </style></head><body>
            <h1>${esc(def.titulo)}</h1>
            <p class="sub">${esc(me.condominio?.nombre || "")} · ${esc(periodoTxt())} · Generado el ${esc(dateTime(new Date()))} por ${esc(me.nombre)}</p>
            <div class="kpis">${resumen.map(([l, v]) => `<div class="k"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join("")}</div>
            <table><thead><tr>${def.cols.map(([t]) => `<th>${esc(t)}</th>`).join("")}</tr></thead>
            <tbody>${datos.map((r) => `<tr>${def.cols.map(([, f]) => `<td>${esc(f(r))}</td>`).join("")}</tr>`).join("")}</tbody></table>
            <p class="pie">${datos.length} registro(s) · Umbral</p>
            <script>window.onload = () => { window.print(); }<\/script></body></html>`);
          w.document.close();
        }
      },

      async usuarios(c) {
        const [us, un] = await Promise.all([API.usuarios(), API.unidades()]);
        const unidadOpts = [{ value: "", label: "— Sin unidad —" }, ...opts(un, "nombre")];
        const rolOpts = Object.entries(ROLES).map(([value, label]) => ({ value, label }));
        c.innerHTML = head("Usuarios y roles", "El rol define qué ve cada persona: Caseta, Administración o la app de residente",
          `<button class="btn primary" id="nv">+ Agregar usuario</button>`) + `
          <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Unidad</th><th></th></tr></thead><tbody>
          ${us.map((u) => `<tr><td><div class="row"><span class="avatar">${initials(u.nombre)}</span><b>${esc(u.nombre)}</b></div></td><td class="small muted">${esc(u.email || "—")}</td>
            <td><span class="chip ${u.rol === "admin" ? "accent" : u.rol === "guardia" ? "warn" : ""}">${esc(ROLES[u.rol])}</span></td><td>${esc(u.unidad || "—")}</td>
            <td><div class="row" style="justify-content:flex-end"><button class="btn" data-u="${esc(u.id)}">Editar</button>${u.id !== me.id ? `<button class="btn ghost" data-q="${esc(u.id)}">Quitar</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="5" class="empty">Sin usuarios</td></tr>`}
          </tbody></table></div></div>
          <p class="small muted">Para agregar a alguien: crea su cuenta en Supabase → Authentication → <b>Add user</b> (con “Auto Confirm User”)
          y luego usa <b>+ Agregar usuario</b> con ese mismo correo para asignarle rol y unidad.</p>`;
        c.querySelector("#nv").onclick = async () => {
          const d = await form({ title: "Agregar usuario al condominio", submit: "Agregar", fields: [
            { name: "email", label: "Correo de la cuenta", type: "email", required: true },
            { name: "nombre", label: "Nombre (opcional)" },
            { name: "rol", label: "Rol", type: "select", value: "residente", options: rolOpts },
            { name: "unidad_id", label: "Unidad (obligatoria para residentes)", type: "select", value: "", options: unidadOpts }],
            onSubmit: (v) => API.vincularUsuario(v.email.trim(), v.rol, v.unidad_id, v.nombre) });
          if (d) { toast("Usuario agregado"); refresh(); }
        };
        c.querySelectorAll("[data-u]").forEach((b) => (b.onclick = async () => {
          const u = us.find((x) => x.id === b.dataset.u);
          const d = await form({ title: "Editar " + u.nombre, fields: [
            { name: "nombre", label: "Nombre", value: u.nombre, required: true },
            { name: "rol", label: "Rol", type: "select", value: u.rol, options: rolOpts },
            { name: "unidad_id", label: "Unidad (solo residentes)", type: "select", value: u.unidad_id || "", options: unidadOpts }],
            onSubmit: (v) => {
              if (v.rol === "residente" && !v.unidad_id) throw new Error("Un residente necesita unidad");
              return API.actualizarUsuario(u.id, { nombre: v.nombre.trim(), rol: v.rol, unidad_id: v.unidad_id || null });
            } });
          if (d) { toast("Usuario actualizado"); refresh(); }
        }));
        c.querySelectorAll("[data-q]").forEach((b) => (b.onclick = async () => {
          const u = us.find((x) => x.id === b.dataset.q);
          if (await confirmDlg("Quitar a " + u.nombre, "Perderá acceso al condominio. Su cuenta no se borra y puedes volver a agregarla.")) {
            await API.desvincularUsuario(u.id); toast("Usuario quitado"); refresh();
          }
        }));
      },

      async unidades(c) {
        const [un, us] = await Promise.all([API.unidades(), API.usuarios()]);
        const residentes = (id) => us.filter((u) => u.unidad_id === id).map((u) => u.nombre);
        c.innerHTML = head("Unidades", `${un.length} unidades registradas`, `<button class="btn primary" id="nu">+ Unidad</button>`) + `
          <div class="row wrap" style="margin-bottom:12px"><input class="input" id="bq" placeholder="Buscar unidad, torre o propietario" style="max-width:300px"></div>
          <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Unidad</th><th>Torre / sección</th><th>Propietario</th><th>Residentes con app</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
        const draw = () => {
          const qv = c.querySelector("#bq").value.toLowerCase();
          const rows = un.filter((u) => [u.nombre, u.torre, u.propietario].join(" ").toLowerCase().includes(qv));
          c.querySelector("#tb").innerHTML = rows.map((u) => `<tr><td><b>${esc(u.nombre)}</b></td><td>${esc(u.torre || "—")}</td><td>${esc(u.propietario || "—")}</td>
            <td class="small">${esc(residentes(u.id).join(", ") || "—")}</td><td><button class="btn" data-e="${esc(u.id)}">Editar</button></td></tr>`).join("")
            || `<tr><td colspan="5" class="empty">${un.length ? "Sin resultados" : "Aún no hay unidades. Crea la primera con “+ Unidad”."}</td></tr>`;
          c.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => editar(un.find((u) => u.id === b.dataset.e))));
        };
        const campos = (u = {}) => [
          { name: "nombre", label: "Nombre", value: u.nombre, required: true, placeholder: "Casa 14, Torre B · 302…" },
          { name: "torre", label: "Torre / sección (opcional)", value: u.torre },
          { name: "propietario", label: "Propietario (opcional)", value: u.propietario }];
        const limpio = (v) => ({ nombre: v.nombre.trim(), torre: v.torre || null, propietario: v.propietario || null });
        async function editar(u) {
          const d = await form({ title: "Editar " + u.nombre, fields: campos(u), onSubmit: (v) => API.actualizarUnidad(u.id, limpio(v)) });
          if (d) { toast("Unidad actualizada"); refresh(); }
        }
        c.querySelector("#bq").oninput = draw;
        c.querySelector("#nu").onclick = async () => {
          const d = await form({ title: "Nueva unidad", submit: "Crear unidad", fields: campos(), onSubmit: (v) => API.crearUnidad(limpio(v)) });
          if (d) { toast("Unidad creada"); refresh(); }
        };
        draw();
      }
    };

    // Resumen de seguridad (modo solo accesos)
    async function resumenAccesos(c) {
      const [k, accesos] = await Promise.all([API.kpisAccesos(), API.accesos({ soloHoy: true, limit: 8 })]);
      const dias = k.dias || [];
      const max = Math.max(1, ...dias.map((d) => +d.permitidos + +d.denegados));
      const hayDatos = dias.some((d) => +d.permitidos + +d.denegados > 0);
      const DS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
      const pendientes = [
        !k.unidades && `Crea las unidades del condominio en <a href="#" data-go="unidades">Unidades</a>.`,
        k.usuarios < 2 && `Agrega guardias y residentes en <a href="#" data-go="usuarios">Usuarios y roles</a>.`
      ].filter(Boolean);
      c.innerHTML = head("Resumen", esc(hoyLargo()), `<button type="button" class="btn" id="vb2">Ver bitácora</button>${MOD.comunidad ? `<button type="button" class="btn primary" data-go="avisos">Nuevo comunicado</button>` : ""}`) + `
        ${pendientes.length ? `<div class="card" style="margin-bottom:16px"><header><h2>Primeros pasos</h2></header>${pendientes.map((p) => `<p style="margin:6px 0">• ${p}</p>`).join("")}</div>` : ""}
        <div class="grid g4" style="margin-bottom:16px">
          <div class="card kpi"><div class="label">Accesos hoy</div><div class="value">${k.accesos_hoy}</div><div class="sub">Lecturas registradas en caseta</div></div>
          <div class="card kpi"><div class="label">Denegados hoy</div><div class="value" style="color:${k.denegados_hoy ? "var(--bad)" : "inherit"}">${k.denegados_hoy}</div><div class="sub">Códigos inválidos o vencidos</div></div>
          <div class="card kpi"><div class="label">Pases vigentes</div><div class="value">${k.pases_vigentes}</div><div class="sub">Visitas y proveedores activos</div></div>
          <div class="card kpi"><div class="label">Unidades · usuarios</div><div class="value">${k.unidades} · ${k.usuarios}</div><div class="sub">${k.alertas_abiertas ? k.alertas_abiertas + " alerta(s) sin atender" : "Sin alertas abiertas"}</div></div>
        </div>
        ${MOD.comunidad ? `<div class="grid g3" style="margin-bottom:16px">
          <div class="card kpi"><div class="label">Tickets abiertos</div><div class="value">${k.tickets_abiertos}</div><div class="sub"><a href="#" data-go="tickets">Ver tickets</a></div></div>
          <div class="card kpi"><div class="label">Paquetes en caseta</div><div class="value">${k.paquetes_pendientes}</div><div class="sub"><a href="#" data-go="paquetes">Ver paquetería</a></div></div>
          <div class="card kpi"><div class="label">Avisos este mes</div><div class="value">${k.avisos_mes}</div><div class="sub"><a href="#" data-go="avisos">Publicar aviso</a></div></div>
        </div>` : ""}
        <div class="card">
          <header><h2>Accesos por día</h2><div class="spacer"></div><span class="chip">Últimos 7 días</span></header>
          ${!hayDatos ? `<div class="empty" style="height:220px;display:grid;place-items:center">Sin accesos todavía. Aquí verás la actividad de caseta.</div>` : `
          <div class="bars">${dias.map((d) => `<div class="m"><div class="pair"><div class="bar in" style="height:${(d.permitidos / max) * 100}%" title="${d.permitidos} permitidos"></div><div class="bar out" style="height:${(d.denegados / max) * 100}%;background:var(--bad)" title="${d.denegados} denegados"></div></div></div>`).join("")}</div>
          <div class="row" style="gap:18px;padding:0 4px">${dias.map((d) => `<div class="small muted" style="flex:1;text-align:center">${DS[new Date(d.dia + "T12:00").getDay()]} ${+d.dia.slice(8)}</div>`).join("")}</div>
          <div class="legend"><span><i style="background:var(--accent)"></i>Permitidos</span><span><i style="background:var(--bad)"></i>Denegados</span></div>`}
        </div>
        <div class="card" style="margin-top:16px"><header><h2>Accesos recientes</h2><div class="spacer"></div><button type="button" class="btn link" id="vb">Ver bitácora</button></header>
          ${tablaAccesos(accesos)}</div>`;
      c.querySelector("#vb").onclick = c.querySelector("#vb2").onclick = () => go("accesos");
      c.querySelectorAll("[data-go]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); go(a.dataset.go); }));
    }

    // Estado de cuenta + registrar pago manual
    async function estadoCuenta(u) {
      const cs = await API.cargos({ unidad_id: u.id });
      const bg = h(`<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-label="Estado de cuenta" style="max-width:640px">
        <div class="row"><h2 style="margin:0">${esc(u.nombre)}</h2><div class="spacer"></div><button type="button" class="btn ghost icon" data-x aria-label="Cerrar">✕</button></div>
        <p class="muted" style="margin:4px 0 14px">${esc(u.propietario || "")} · CLABE ${esc(u.clabe || "—")}</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Concepto</th><th>Vence</th><th class="num">Monto</th><th>Estado</th><th></th></tr></thead><tbody>
        ${cs.length ? "" : `<tr><td colspan="5" class="empty">Sin cargos</td></tr>`}${cs.map((x) => `<tr><td>${esc(x.concepto)}${x.extraordinaria ? ` <span class="chip">Extra</span>` : ""}</td><td class="small">${date(x.vence)}</td><td class="num">${money(x.monto)}</td>
          <td>${x.estado === "pagado" ? `<span class="chip ok">✓ Pagado</span>` : x.estado === "vencido" ? `<span class="chip bad">✕ Vencido</span>` : `<span class="chip warn">Pendiente</span>`}</td>
          <td>${x.estado !== "pagado" ? `<button class="btn" data-c="${esc(x.id)}">Registrar pago</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div></div></div>`);
      bg.querySelector("[data-x]").onclick = () => bg.remove();
      bg.addEventListener("keydown", (e) => { if (e.key === "Escape") bg.remove(); });
      bg.querySelectorAll("[data-c]").forEach((b) => (b.onclick = async () => {
        const cg = cs.find((x) => x.id === b.dataset.c);
        bg.remove();
        const d = await form({ title: "Registrar pago · " + cg.concepto, fields: [
          { name: "monto", label: "Monto", type: "number", value: cg.monto, required: true },
          { name: "metodo", label: "Método", type: "select", options: [{ value: "spei", label: "SPEI" }, { value: "tarjeta", label: "Tarjeta" }, { value: "efectivo", label: "Efectivo" }] },
          { name: "referencia", label: "Clave de rastreo / referencia" }],
          onSubmit: (v) => API.registrarPago({ cargo_id: cg.id, unidad_id: u.id, monto: +v.monto, metodo: v.metodo, referencia: v.referencia }) });
        if (d) { toast("Pago registrado"); refresh(); }
      }));
      document.body.appendChild(bg);
      bg.querySelector("[data-x]").focus();
    }

    function downloadCsv(name, rows) {
      const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = name; a.click();
    }

    async function renderAlertas() {
      const al = await API.alertas();
      $("#alertas").innerHTML = al.map((a) => `<div class="alert-banner">⚠ Alerta de caseta: ${esc(a.mensaje)} <span class="small" style="font-weight:500">${time(a.created_at)}</span><div class="spacer"></div><button type="button" class="btn sm" data-at="${esc(a.id)}">Marcar atendida</button></div>`).join("");
      $("#alertas").querySelectorAll("[data-at]").forEach((b) => (b.onclick = async () => { await API.atenderAlerta(+b.dataset.at || b.dataset.at); renderAlertas(); }));
    }

    const unsub = API.subscribe((tabla) => {
      if (tabla === "alertas") renderAlertas();
      if (tabla === "tickets" || tabla === "paquetes") badges();
      if (tabla === "accesos" && (page === "resumen" || page === "accesos")) refresh();
    });
    if (!PAGES.some((p) => p.id === page)) page = "resumen";
    go(page); badges(); renderAlertas();
    return () => unsub();
  }
  return { mount };
})();
