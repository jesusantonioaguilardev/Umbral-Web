/* Panel de Seguridad · Caseta / pluma
   Escaneo de QR, validación, bitácora en tiempo real, esperados del día,
   paquetería y alerta de emergencia. Pensado para tableta o PC en caseta. */
window.Caseta = (function () {
  const { esc, h, time, toast, form, confirmDlg, TIPOS, initials, DIAS } = UI;
  const PUNTO = (window.UMBRAL_CONFIG || {}).PUNTO_ACCESO || "Acceso principal";
  const COMUNIDAD = !!((window.UMBRAL_CONFIG || {}).MODULOS || {}).comunidad;

  function mount({ me, root, logout }) {
    let scanner = null, lastCode = "", lastAt = 0, unidades = [];
    const timers = [];
    const ICO_OK = `<span class="ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>`;
    const ICO_NO = `<span class="ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg></span>`;
    const ESPERA = `<div class="espera">Esperando lectura…<div class="small" style="margin-top:4px">Escanea el QR o escribe el código del pase.</div></div>`;

    const el = h(`
      <div>
        <div id="alertas" role="alert"></div>
        <header class="topbar">
          <div class="brand">${UI.logo}<span>Caseta · ${esc(PUNTO)}</span></div>
          <span class="chip accent" id="modo">En línea</span>
          <span class="reloj" id="reloj" aria-label="Hora actual"></span>
          ${!COMUNIDAD ? "" : `<button type="button" class="btn" id="paq">Recibir paquete</button>`}
          <button type="button" class="btn primary" id="manual">Visita sin pase</button>
          <button type="button" class="sos" id="sos" title="Envía una notificación de emergencia a todo el condominio">⚠ Emergencia<span class="sos-extra"> · avisar a todos</span></button>
          <span id="theme"></span>
          <div class="user-pill" title="${esc(me.nombre)}"><span class="avatar" aria-hidden="true">${esc(initials(me.nombre))}</span><span class="small">${esc(me.nombre)}<br><span class="muted">Guardia</span></span></div>
          <button type="button" class="btn" id="salir">Salir</button>
        </header>
        <main class="caseta">
          <section aria-label="Validar acceso">
            <form class="code-entry" id="cf">
              <label for="code" class="sr-only">Código del pase</label>
              <input class="input" id="code" placeholder="Escanea o escribe el código" autocomplete="off" maxlength="40">
              <button class="btn accent xl">Validar</button>
            </form>
            <div class="result" id="result" aria-live="assertive">${ESPERA}</div>
            <div class="card">
              <header><h2>Lector QR</h2><div class="spacer"></div><button type="button" class="btn" id="cam">📷 Activar cámara</button></header>
              <div class="scanner"><div id="reader"></div><div class="placeholder" id="ph">Activa la cámara y apunta al QR del visitante</div></div>
            </div>
          </section>
          <aside aria-label="Actividad de hoy">
            <section class="card pane"><header><h2>Esperados hoy</h2><div class="spacer"></div><span class="small muted" id="s_esperados"></span></header><div class="log-list" id="p_esperados"></div></section>
            <section class="card pane"><header><h2>Bitácora</h2><div class="spacer"></div><span class="small muted" id="s_bitacora"></span></header><div class="log-list" id="p_bitacora"></div></section>
            ${!COMUNIDAD ? "" : `<section class="card pane"><header><h2>Paquetes</h2><div class="spacer"></div><span class="small muted" id="s_paquetes"></span></header><div class="log-list" id="p_paquetes"></div></section>`}
          </aside>
        </main>
      </div>`);
    root.appendChild(el);
    el.querySelector("#theme").appendChild(UI.themeToggle());
    const $ = (s) => el.querySelector(s);

    // Reloj
    const tick = () => ($("#reloj").textContent = new Date().toLocaleTimeString("es-MX", { timeZone: UI.zona.tz, hour12: false }));
    tick(); timers.push(setInterval(tick, 1000));

    // ---------- Validación ----------
    async function validar(raw) {
      const cod = String(raw).replace(/^UMBRAL:/i, "").trim().toUpperCase();
      if (!cod) return;
      const r = $("#result");
      r.className = "result"; r.innerHTML = `<div class="espera">Validando ${esc(cod)}…</div>`;
      try {
        const res = await API.validarPase(cod, PUNTO);
        r.className = "result " + (res.permitido ? "ok" : "bad");
        const horario = res.modalidad === "recurrente" && (res.dias || res.hora_inicio)
          ? `<div class="meta small">Horario: ${res.dias ? res.dias.map((d) => DIAS[d - 1]).join(", ") : "Todos los días"}${res.hora_inicio ? " · " + esc(res.hora_inicio) + " a " + esc(res.hora_fin) : ""}</div>` : "";
        const meta = [res.tipo ? esc(TIPOS[res.tipo] || res.tipo) : "", res.unidad ? esc(res.unidad) : "", res.autorizo ? "Autorizó " + esc(res.autorizo) : ""].filter(Boolean).join(" · ");
        r.innerHTML = `
          <div class="status">${res.permitido ? ICO_OK + "Acceso válido · Levantar pluma" : ICO_NO + "Acceso denegado"}</div>
          <div class="big">${esc(res.visitante || "Código " + cod)}</div>
          ${meta ? `<div class="meta">${meta}</div>` : ""}
          ${res.motivo ? `<div class="motivo">${esc(res.motivo)}</div>` : ""}${horario}`;
        beep(res.permitido);
      } catch (e) {
        r.className = "result bad"; r.innerHTML = `<div class="status">${ICO_NO}No se pudo validar</div><div class="meta">${esc(e.message)}</div><div class="meta small">Revisa la conexión e intenta de nuevo.</div>`;
      }
      $("#code").value = "";
    }
    $("#cf").onsubmit = (e) => { e.preventDefault(); validar($("#code").value); };

    function beep(ok) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.15 : 0.4));
      } catch (e) {}
    }

    // ---------- Cámara ----------
    $("#cam").onclick = async () => {
      if (scanner) { await stopCam(); return; }
      if (!window.Html5Qrcode) return toast("No se pudo cargar el lector de QR");
      try {
        scanner = new Html5Qrcode("reader");
        await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 230 }, (txt) => {
          const now = Date.now();
          if (txt === lastCode && now - lastAt < 4000) return;
          lastCode = txt; lastAt = now; validar(txt);
        });
        $("#ph").classList.add("hidden"); $("#cam").textContent = "Detener cámara";
      } catch (e) { scanner = null; toast("No se pudo abrir la cámara: " + (e.message || e)); }
    };
    async function stopCam() {
      try { await scanner?.stop(); scanner?.clear(); } catch (e) {}
      scanner = null; $("#ph").classList.remove("hidden"); $("#cam").textContent = "📷 Activar cámara";
    }

    // ---------- Paneles (columna lateral) ----------
    const PANES = {
      async bitacora() {
        const rows = await API.accesos({ soloHoy: true });
        const den = rows.filter((r) => !r.permitido).length;
        $("#s_bitacora").textContent = `${rows.length} hoy · ${den} denegados`;
        return rows.length ? rows.map(logItem).join("") : `<div class="empty">Sin registros hoy. Cada lectura aparecerá aquí.</div>`;
      },
      async esperados() {
        const rows = await API.esperadosHoy();
        $("#s_esperados").textContent = `${rows.length} con pase`;
        return rows.length ? rows.map((r) => `
          <div class="log-item"><span class="dot" aria-hidden="true"></span>
            <div><div>${esc(r.visitante)}</div><div class="small muted">${esc(TIPOS[r.tipo] || r.tipo)} · ${esc(r.unidad)}${r.hora_inicio ? " · " + esc(String(r.hora_inicio).slice(0, 5)) + "–" + esc(String(r.hora_fin).slice(0, 5)) : ""}</div></div>
            <button type="button" class="btn sm" data-cod="${esc(r.codigo)}">Validar</button></div>`).join("") : `<div class="empty">Nadie programado para hoy</div>`;
      },
      async paquetes() {
        const rows = await API.paquetes({ pendientes: true });
        $("#s_paquetes").textContent = `${rows.length} por entregar`;
        return rows.length ? rows.map((r) => `
          <div class="log-item"><time>${time(r.created_at)}</time>
            <div><div>${esc(r.unidad)}</div><div class="small muted">${esc(r.paqueteria || "")}${r.descripcion ? " · " + esc(r.descripcion) : ""}</div></div>
            <button type="button" class="btn sm" data-ent="${esc(r.id)}">Entregar</button></div>`).join("") : `<div class="empty">Sin paquetes pendientes</div>`;
      }
    };
    async function render(cual) {
      const ks = cual ? [cual] : Object.keys(PANES).filter((k) => k !== "paquetes" || COMUNIDAD);
      await Promise.all(ks.map(async (k) => {
        const p = $("#p_" + k); if (!p) return;
        try { p.innerHTML = await PANES[k](); }
        catch (e) { p.innerHTML = `<div class="empty error">No se pudo cargar: ${esc(e.message)}</div>`; }
      }));
      el.querySelectorAll("[data-cod]").forEach((b) => (b.onclick = () => validar(b.dataset.cod)));
      el.querySelectorAll("[data-ent]").forEach((b) => (b.onclick = async () => {
        const d = await form({ title: "Entregar paquete", fields: [{ name: "a", label: "Recibe (nombre)", required: true }], submit: "Entregar",
          onSubmit: (v) => API.entregarPaquete(b.dataset.ent, v.a) });
        if (d) { toast("Paquete entregado"); render("paquetes"); }
      }));
    }
    const logItem = (r) => `
      <div class="log-item"><span class="dot ${r.permitido ? "ok" : "bad"}" aria-hidden="true"></span>
        <div><div>${esc(r.nombre)}</div><div class="small muted">${r.permitido ? "✓ " + esc(TIPOS[r.tipo] || r.tipo) : `<span class="bad-txt">✕ ${esc(r.motivo || "Denegado")}</span>`} · ${esc(r.unidad || "—")}${r.placa ? " · Placa " + esc(r.placa) : ""}${r.autorizo ? " · " + esc(r.autorizo) : ""}</div></div>
        <time>${time(r.created_at)}</time></div>`;

    // ---------- Acciones ----------
    const unidadOpts = () => unidades.map((u) => ({ value: u.id, label: u.nombre + (u.propietario ? " · " + u.propietario : "") }));
    const RESTRINGIDA = "Persona restringida por administración";
    $("#manual").onclick = async () => {
      let negadoPorLista = false;
      const d = await form({
        title: "Visita sin pase", submit: "Registrar",
        fields: [
          { name: "nombre", label: "Nombre del visitante", required: true },
          { name: "placa", label: "Placa del vehículo (opcional)", placeholder: "ABC-123-D" },
          { name: "unidad_id", label: "Unidad que visita", type: "select", options: unidadOpts() },
          { name: "tipo", label: "Tipo", type: "select", options: Object.entries(TIPOS).filter(([k]) => k !== "residente").map(([value, label]) => ({ value, label })) },
          { name: "permitido", label: "¿El residente autorizó por llamada?", type: "select", options: [{ value: "1", label: "Sí, autorizado" }, { value: "0", label: "No, se negó el acceso" }] }
        ],
        onSubmit: async (v) => {
          const nombre = v.nombre.trim(), placa = (v.placa || "").trim().toUpperCase() || null;
          let permitido = v.permitido === "1", motivo = permitido ? null : "No autorizado por residente";
          negadoPorLista = false;
          if (permitido) { // antes de dejar pasar, revisa la lista negra del condominio
            let ln;
            try { ln = await API.enListaNegra(nombre, placa); }
            catch (e) { throw new Error("No se pudo revisar la lista negra: " + e.message); }
            if (ln?.restringido && !(await confirmDlg("Persona restringida", `Persona restringida: ${ln.nombre || nombre} · ${ln.motivo || "Sin motivo registrado"}. ¿Registrar de todos modos?`))) {
              permitido = false; motivo = RESTRINGIDA; negadoPorLista = true;
            }
          }
          return API.registrarManual({ nombre, placa, unidad_id: v.unidad_id, tipo: v.tipo, permitido, motivo, punto: PUNTO, ...(negadoPorLista ? { autorizo: "Guardia · lista negra" } : {}) });
        }
      });
      if (d) { toast(negadoPorLista ? "Registrado como acceso negado" : "Registrado en bitácora"); render("bitacora"); }
    };
    if ($("#paq")) $("#paq").onclick = async () => {
      const d = await form({
        title: "Recibir paquete", submit: "Registrar y avisar",
        fields: [
          { name: "unidad_id", label: "Unidad", type: "select", options: unidadOpts() },
          { name: "paqueteria", label: "Paquetería", placeholder: "DHL, Amazon, Mercado Libre…" },
          { name: "descripcion", label: "Descripción", placeholder: "Caja chica, sobre…" }
        ],
        onSubmit: (v) => API.registrarPaquete(v)
      });
      if (d) { toast("Paquete registrado · residente notificado"); render("paquetes"); }
    };
    // Emergencia: el insert en alertas manda push a todo el condominio (residentes, caseta y administración)
    $("#sos").onclick = async () => { if (await UI.emergencia({ mensaje: "Emergencia en caseta. Favor de mantenerse en sus domicilios." })) renderAlertas(); };
    $("#salir").onclick = async () => { await stopCam(); logout(); };

    const renderAlertas = () => UI.bannerAlertas($("#alertas"));

    // Tiempo real
    const unsub = API.subscribe((tabla) => {
      if (tabla === "alertas") renderAlertas();
      if (tabla === "accesos") render("bitacora");
      if (tabla === "paquetes") render("paquetes");
    });
    timers.push(setInterval(() => render(), 60000));

    API.unidades().then((u) => (unidades = u));
    render(); renderAlertas();
    $("#code").focus();

    return () => { unsub(); timers.forEach(clearInterval); stopCam(); };
  }
  return { mount };
})();
