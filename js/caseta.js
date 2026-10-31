/* Panel de Seguridad · Caseta / pluma
   Escaneo de QR, validación, bitácora en tiempo real, esperados del día,
   paquetería y alerta de emergencia. Pensado para tableta o PC en caseta. */
window.Caseta = (function () {
  const { esc, h, time, toast, form, TIPOS, initials, DIAS } = UI;
  const PUNTO = (window.UMBRAL_CONFIG || {}).PUNTO_ACCESO || "Acceso principal";
  const COMUNIDAD = !!((window.UMBRAL_CONFIG || {}).MODULOS || {}).comunidad;

  function mount({ me, root, logout }) {
    let scanner = null, lastCode = "", lastAt = 0, tab = "bitacora", unidades = [];
    const timers = [];

    const el = h(`
      <div>
        <div id="alertas"></div>
        <div class="topbar">
          <div class="brand"><div class="logo">U</div><span>Caseta · ${esc(PUNTO)}</span></div>
          <span class="chip accent" id="modo">En línea</span>
          <div class="spacer"></div>
          <strong id="reloj" style="font-variant-numeric:tabular-nums;font-size:18px"></strong>
          <button class="sos" id="sos">⚠ Emergencia</button>
          <div class="user-pill"><span class="avatar">${initials(me.nombre)}</span><span class="small">${esc(me.nombre)}<br><span class="muted">Guardia</span></span></div>
          <span id="theme"></span>
          <button class="btn" id="salir">Salir</button>
        </div>
        <div class="caseta">
          <section class="grid" style="align-content:start">
            <div class="card">
              <header><h2>Validar acceso</h2><div class="spacer"></div><button class="btn" id="cam">📷 Activar cámara</button></header>
              <div class="scanner"><div id="reader"></div><div class="placeholder" id="ph">Escanea el QR del visitante<br><span class="small">o escribe el código abajo</span></div></div>
              <form class="code-entry" id="cf">
                <input class="input" id="code" placeholder="CÓDIGO" autocomplete="off" maxlength="40">
                <button class="btn primary lg">Validar</button>
              </form>
            </div>
            <div class="result" id="result"><div class="muted">Esperando lectura…</div></div>
            <div class="grid ${COMUNIDAD ? "g2" : ""}">
              <button class="btn lg" id="manual">+ Visita sin pase</button>
              ${!COMUNIDAD ? "" : `<button class="btn lg" id="paq">📦 Recibir paquete</button>`}
            </div>
          </section>
          <section class="card" style="align-self:start">
            <header>
              <div class="row wrap" id="tabs">
                <button class="btn" data-tab="bitacora">Bitácora de hoy</button>
                <button class="btn" data-tab="esperados">Esperados hoy</button>
                ${!COMUNIDAD ? "" : `<button class="btn" data-tab="paquetes">Paquetes</button>`}
              </div>
            </header>
            <div class="row small muted" id="stats" style="margin-bottom:8px"></div>
            <div id="panel" class="log-list"></div>
          </section>
        </div>
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
      r.className = "result"; r.innerHTML = `<div class="muted">Validando ${esc(cod)}…</div>`;
      try {
        const res = await API.validarPase(cod, PUNTO);
        r.className = "result " + (res.permitido ? "ok" : "bad");
        const horario = res.modalidad === "recurrente" && (res.dias || res.hora_inicio)
          ? `<div class="meta small">Horario: ${res.dias ? res.dias.map((d) => DIAS[d - 1]).join(", ") : "Todos los días"}${res.hora_inicio ? " · " + res.hora_inicio + " a " + res.hora_fin : ""}</div>` : "";
        r.innerHTML = `
          <span class="chip ${res.permitido ? "ok" : "bad"}" style="font-size:14px">${res.permitido ? "✓ Acceso válido · Levantar pluma" : "✕ Acceso denegado"}</span>
          <div class="big">${esc(res.visitante || "Código " + cod)}</div>
          <div class="meta">${res.tipo ? esc(TIPOS[res.tipo]) + " · " : ""}${res.unidad ? esc(res.unidad) : ""}${res.autorizo ? " · Autorizó: " + esc(res.autorizo) : ""}</div>
          ${res.motivo ? `<div style="margin-top:8px;font-weight:700;color:var(--bad)">${esc(res.motivo)}</div>` : ""}${horario}`;
        beep(res.permitido);
      } catch (e) {
        r.className = "result bad"; r.innerHTML = `<b>Error:</b> ${esc(e.message)}`;
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

    // ---------- Paneles ----------
    el.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));

    async function render() {
      el.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("primary", b.dataset.tab === tab));
      const p = $("#panel");
      if (tab === "bitacora") {
        const rows = await API.accesos({ soloHoy: true });
        const den = rows.filter((r) => !r.permitido).length;
        $("#stats").innerHTML = `<span class="chip">${rows.length} registros</span><span class="chip ok">${rows.length - den} permitidos</span><span class="chip bad">${den} denegados</span>`;
        p.innerHTML = rows.length ? rows.map(logItem).join("") : `<div class="empty">Sin registros hoy</div>`;
      } else if (tab === "esperados") {
        const rows = await API.esperadosHoy();
        $("#stats").innerHTML = `<span class="chip">${rows.length} con pase vigente hoy</span>`;
        p.innerHTML = rows.length ? rows.map((r) => `
          <div class="log-item"><span class="chip">${esc(TIPOS[r.tipo])}</span>
            <div><b>${esc(r.visitante)}</b><div class="small muted">${esc(r.unidad)}${r.hora_inicio ? " · " + r.hora_inicio + "–" + r.hora_fin : ""}</div></div>
            <button class="btn" data-cod="${esc(r.codigo)}">Validar</button></div>`).join("") : `<div class="empty">Nadie programado</div>`;
        p.querySelectorAll("[data-cod]").forEach((b) => (b.onclick = () => validar(b.dataset.cod)));
      } else {
        const rows = await API.paquetes({ pendientes: true });
        $("#stats").innerHTML = `<span class="chip warn">${rows.length} por entregar</span>`;
        p.innerHTML = rows.length ? rows.map((r) => `
          <div class="log-item"><time>${time(r.created_at)}</time>
            <div><b>${esc(r.unidad)}</b><div class="small muted">${esc(r.paqueteria || "")} · ${esc(r.descripcion || "")}</div></div>
            <button class="btn" data-ent="${esc(r.id)}">Entregar</button></div>`).join("") : `<div class="empty">Sin paquetes pendientes</div>`;
        p.querySelectorAll("[data-ent]").forEach((b) => (b.onclick = async () => {
          const d = await form({ title: "Entregar paquete", fields: [{ name: "a", label: "Recibe (nombre)", required: true }], submit: "Entregar",
            onSubmit: (v) => API.entregarPaquete(b.dataset.ent, v.a) });
          if (d) { toast("Paquete entregado"); render(); }
        }));
      }
    }
    const logItem = (r) => `
      <div class="log-item"><time>${time(r.created_at)}</time>
        <div><b>${esc(r.nombre)}</b><div class="small muted">${esc(r.unidad || "—")}${r.autorizo ? " · " + esc(r.autorizo) : ""}${r.motivo ? " · " + esc(r.motivo) : ""}</div></div>
        <span class="chip ${r.permitido ? "" : "bad"}">${r.permitido ? esc(TIPOS[r.tipo] || r.tipo) : "Denegado"}</span></div>`;

    // ---------- Acciones ----------
    const unidadOpts = () => unidades.map((u) => ({ value: u.id, label: u.nombre + (u.propietario ? " · " + u.propietario : "") }));
    $("#manual").onclick = async () => {
      const d = await form({
        title: "Visita sin pase", submit: "Registrar",
        fields: [
          { name: "nombre", label: "Nombre del visitante", required: true },
          { name: "unidad_id", label: "Unidad que visita", type: "select", options: unidadOpts() },
          { name: "tipo", label: "Tipo", type: "select", options: Object.entries(TIPOS).filter(([k]) => k !== "residente").map(([value, label]) => ({ value, label })) },
          { name: "permitido", label: "¿El residente autorizó por llamada?", type: "select", options: [{ value: "1", label: "Sí, autorizado" }, { value: "0", label: "No, se negó el acceso" }] }
        ],
        onSubmit: (v) => API.registrarManual({ nombre: v.nombre, unidad_id: v.unidad_id, tipo: v.tipo, permitido: v.permitido === "1", motivo: v.permitido === "1" ? null : "No autorizado por residente", punto: PUNTO })
      });
      if (d) { toast("Registrado en bitácora"); tab = "bitacora"; render(); }
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
      if (d) { toast("Paquete registrado · residente notificado"); tab = "paquetes"; render(); }
    };
    $("#sos").onclick = async () => {
      const d = await form({ title: "Alerta de emergencia", submit: "Enviar alerta", fields: [{ name: "m", label: "Mensaje para residentes y administración", type: "textarea", value: "Emergencia en caseta. Favor de mantenerse en sus domicilios." }],
        onSubmit: (v) => API.crearAlerta(v.m) });
      if (d) toast("Alerta enviada");
    };
    $("#salir").onclick = async () => { await stopCam(); logout(); };

    async function renderAlertas() {
      const al = await API.alertas();
      $("#alertas").innerHTML = al.map((a) => `<div class="alert-banner">⚠ ${esc(a.mensaje)} <span class="small" style="opacity:.8">${time(a.created_at)}</span><div class="spacer"></div><button class="btn" data-at="${a.id}">Atendida</button></div>`).join("");
      $("#alertas").querySelectorAll("[data-at]").forEach((b) => (b.onclick = async () => { await API.atenderAlerta(+b.dataset.at || b.dataset.at); renderAlertas(); }));
    }

    // Tiempo real
    const unsub = API.subscribe((tabla) => {
      if (tabla === "alertas") renderAlertas();
      if ((tabla === "accesos" && tab === "bitacora") || (tabla === "paquetes" && tab === "paquetes")) render();
    });
    timers.push(setInterval(render, 60000));

    API.unidades().then((u) => (unidades = u));
    render(); renderAlertas();
    $("#code").focus();

    return () => { unsub(); timers.forEach(clearInterval); stopCam(); };
  }
  return { mount };
})();
