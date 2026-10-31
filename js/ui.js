/* Utilidades de interfaz compartidas */
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(Number(n || 0)).toLocaleString("es-MX", { maximumFractionDigits: 0 });

  /* Zona horaria del condominio (no la del navegador). Fechas "YYYY-MM-DD" = día civil en esa zona. */
  const zona = (function () {
    let tz = (window.UMBRAL_CONFIG || {}).ZONA_HORARIA || "America/Hermosillo";
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch (e) { console.warn("ZONA_HORARIA inválida:", tz); tz = "America/Hermosillo"; }
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short" });
    const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const pad = (n) => String(n).padStart(2, "0");
    // Partes de fecha/hora de un instante en la zona: {y, m (1-12), d, h, mi, s, dow (1=lun … 7=dom)}
    const partes = (x = new Date()) => {
      const p = {}; fmt.formatToParts(new Date(x)).forEach(({ type, value }) => (p[type] = value));
      return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, dow: WD[p.weekday] };
    };
    // Desfase de la zona respecto a UTC en minutos (Hermosillo: -420), calculado con Intl
    const desfase = (x = new Date()) => { const t = new Date(x).getTime(), p = partes(t); return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - t) / 6e4); };
    const ymd = (x = new Date()) => { const p = partes(x); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
    // Hora civil en la zona ("YYYY-MM-DD" + "HH:MM[:SS[.mmm]]") → ISO UTC
    const aUTC = (dia, hora = "00:00") => {
      const [y, m, d] = dia.split("-").map(Number), [hh, mm, ss = "0"] = hora.split(":"), [s, ms = "0"] = String(ss).split(".");
      const base = Date.UTC(y, m - 1, d, +hh, +mm, +s, +ms.padEnd(3, "0"));
      let t = base - desfase(base) * 6e4;
      t = base - desfase(t) * 6e4; // segundo paso por si cae en cambio de horario
      return new Date(t).toISOString();
    };
    const sumarDias = (dia, n) => new Date(Date.UTC(...dia.split("-").map((v, i) => +v - (i === 1 ? 1 : 0))) + n * 864e5).toISOString().slice(0, 10);
    return { tz, partes, desfase, ymd, hoy: () => ymd(), aUTC, inicioDia: (dia = ymd()) => aUTC(dia), finDia: (dia = ymd()) => aUTC(dia, "23:59:59.999"), sumarDias };
  })();

  const time = (d) => new Date(d).toLocaleTimeString("es-MX", { timeZone: zona.tz, hour: "2-digit", minute: "2-digit", hour12: false });
  // Fecha sola (YYYY-MM-DD) se muestra tal cual; un instante se convierte a la zona
  const date = (d) => String(d).length === 10
    ? new Date(d + "T12:00Z").toLocaleDateString("es-MX", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })
    : new Date(d).toLocaleDateString("es-MX", { timeZone: zona.tz, day: "numeric", month: "short", year: "numeric" });
  const dateTime = (d) => date(d) + " · " + time(d);
  const initials = (n) => String(n || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const TIPOS = { visita: "Visita", proveedor: "Proveedor", paqueteria: "Paquetería", airbnb: "Huésped", residente: "Residente" };
  const ROLES = { residente: "Residente", guardia: "Seguridad · Caseta", admin: "Administración" };

  // Marca: casa con trazo, toma el color de --on-accent
  const logo = `<div class="logo" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V9l8-6 8 6v12"/><path d="M10 21v-6h4v6"/></svg></div>`;

  // Cierra un modal con Esc
  const conEsc = (bg, close) => { const k = (e) => { if (e.key === "Escape") { document.removeEventListener("keydown", k); close(); } }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); };

  function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  function toast(msg) {
    let box = document.querySelector(".toasts");
    if (!box) { box = h(`<div class="toasts"></div>`); document.body.appendChild(box); }
    const el = h(`<div class="toast">${esc(msg)}</div>`);
    box.appendChild(el); setTimeout(() => el.remove(), 2600);
  }

  /* Modal con formulario. fields: [{name,label,type,options,value,required}] */
  function form({ title, fields, submit = "Guardar", onSubmit }) {
    return new Promise((resolve) => {
      const inputs = fields.map((f) => {
        const id = "f_" + f.name;
        let control;
        if (f.type === "select") control = `<select id="${id}" name="${f.name}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value == f.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
        else if (f.type === "textarea") control = `<textarea id="${id}" name="${f.name}" rows="4">${esc(f.value || "")}</textarea>`;
        else if (f.type === "checkbox") control = `<label class="row" style="gap:8px"><input type="checkbox" id="${id}" name="${f.name}" ${f.value ? "checked" : ""}> ${esc(f.text || "")}</label>`;
        else if (f.type === "file") control = `<input class="input" id="${id}" name="${f.name}" type="file" ${f.accept ? `accept="${esc(f.accept)}"` : ""}>${f.hint ? `<div class="small muted" style="margin-top:4px">${esc(f.hint)}</div>` : ""}`;
        else if (f.type === "days") control = `<div class="days">${DIAS.map((d, i) => `<label><input type="checkbox" name="${f.name}" value="${i + 1}" ${(f.value || []).includes(i + 1) ? "checked" : ""}> ${d}</label>`).join("")}</div>`;
        else control = `<input class="input" id="${id}" name="${f.name}" type="${f.type || "text"}" value="${esc(f.value ?? "")}" ${f.required ? "required" : ""} ${f.step ? `step="${f.step}"` : ""} placeholder="${esc(f.placeholder || "")}">`;
        return `<div class="field">${f.label ? `<label for="${id}">${esc(f.label)}</label>` : ""}${control}</div>`;
      }).join("");
      const bg = h(`<div class="modal-bg"><form class="modal" role="dialog" aria-modal="true" aria-labelledby="dlg_t"><h2 id="dlg_t">${esc(title)}</h2>${inputs}<div class="error"></div>
        <div class="actions"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary">${esc(submit)}</button></div></form></div>`);
      let quitarEsc = () => {};
      const close = (v) => { quitarEsc(); bg.remove(); resolve(v); };
      quitarEsc = conEsc(bg, () => close(null));
      bg.querySelector("[data-x]").onclick = () => close(null);
      bg.addEventListener("click", (e) => { if (e.target === bg) close(null); });
      bg.querySelector("form").onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target), data = {};
        fields.forEach((f) => {
          if (f.type === "days") data[f.name] = fd.getAll(f.name).map(Number);
          else if (f.type === "checkbox") data[f.name] = fd.get(f.name) === "on";
          else if (f.type === "file") { const file = fd.get(f.name); data[f.name] = file && file.size ? file : null; }
          else data[f.name] = fd.get(f.name);
        });
        const btn = bg.querySelector("button.primary"), txt = btn.textContent;
        btn.disabled = true; btn.textContent = "Guardando…";
        try { await onSubmit?.(data); close(data); }
        catch (err) { bg.querySelector(".error").textContent = err.message; btn.disabled = false; btn.textContent = txt; }
      };
      document.body.appendChild(bg);
      bg.querySelector("input,select,textarea")?.focus();
    });
  }

  function confirmDlg(title, text) {
    return new Promise((resolve) => {
      const bg = h(`<div class="modal-bg"><div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="dlg_t"><h2 id="dlg_t">${esc(title)}</h2><p class="muted">${esc(text)}</p>
        <div class="actions"><button class="btn" data-n>Cancelar</button><button class="btn danger" data-y>Confirmar</button></div></div></div>`);
      let quitarEsc = () => {};
      const fin = (v) => { quitarEsc(); bg.remove(); resolve(v); };
      quitarEsc = conEsc(bg, () => fin(false));
      bg.querySelector("[data-n]").onclick = () => fin(false);
      bg.querySelector("[data-y]").onclick = () => fin(true);
      document.body.appendChild(bg);
      bg.querySelector("[data-y]").focus();
    });
  }

  function themeToggle() {
    const b = h(`<button type="button" class="btn ghost icon" title="Cambiar tema" aria-label="Cambiar tema"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>`);
    b.onclick = () => {
      const r = document.documentElement;
      const dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      r.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("umbral_theme", r.dataset.theme); } catch (e) {}
    };
    return b;
  }
  try { const t = localStorage.getItem("umbral_theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

  window.UI = { esc, logo, money, zona, time, date, dateTime, initials, h, toast, form, confirmDlg, themeToggle, DIAS, TIPOS, ROLES };
})();
