/* Utilidades de interfaz compartidas */
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(Number(n || 0)).toLocaleString("es-MX", { maximumFractionDigits: 0 });
  const time = (d) => new Date(d).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
  const date = (d) => new Date(String(d).length === 10 ? d + "T12:00" : d).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  const dateTime = (d) => date(d) + " · " + time(d);
  const initials = (n) => String(n || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const TIPOS = { visita: "Visita", proveedor: "Proveedor", paqueteria: "Paquetería", airbnb: "Huésped", residente: "Residente" };
  const ROLES = { residente: "Residente", guardia: "Seguridad · Caseta", admin: "Administración" };

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
        else if (f.type === "checkbox") control = `<label class="row" style="gap:8px;font-weight:500"><input type="checkbox" id="${id}" name="${f.name}" ${f.value ? "checked" : ""}> ${esc(f.text || "")}</label>`;
        else if (f.type === "file") control = `<input class="input" id="${id}" name="${f.name}" type="file" ${f.accept ? `accept="${esc(f.accept)}"` : ""}>${f.hint ? `<div class="small muted" style="margin-top:4px">${esc(f.hint)}</div>` : ""}`;
        else if (f.type === "days") control = `<div class="days">${DIAS.map((d, i) => `<label><input type="checkbox" name="${f.name}" value="${i + 1}" ${(f.value || []).includes(i + 1) ? "checked" : ""}> ${d}</label>`).join("")}</div>`;
        else control = `<input class="input" id="${id}" name="${f.name}" type="${f.type || "text"}" value="${esc(f.value ?? "")}" ${f.required ? "required" : ""} ${f.step ? `step="${f.step}"` : ""} placeholder="${esc(f.placeholder || "")}">`;
        return `<div class="field">${f.label ? `<label for="${id}">${esc(f.label)}</label>` : ""}${control}</div>`;
      }).join("");
      const bg = h(`<div class="modal-bg"><form class="modal"><h2>${esc(title)}</h2>${inputs}<div class="error"></div>
        <div class="actions"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary">${esc(submit)}</button></div></form></div>`);
      const close = (v) => { bg.remove(); resolve(v); };
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
      const bg = h(`<div class="modal-bg"><div class="modal"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
        <div class="actions"><button class="btn" data-n>Cancelar</button><button class="btn danger" data-y>Confirmar</button></div></div></div>`);
      bg.querySelector("[data-n]").onclick = () => { bg.remove(); resolve(false); };
      bg.querySelector("[data-y]").onclick = () => { bg.remove(); resolve(true); };
      document.body.appendChild(bg);
    });
  }

  function themeToggle() {
    const b = h(`<button class="btn ghost" title="Cambiar tema" aria-label="Cambiar tema"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>`);
    b.onclick = () => {
      const r = document.documentElement;
      const dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      r.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("umbral_theme", r.dataset.theme); } catch (e) {}
    };
    return b;
  }
  try { const t = localStorage.getItem("umbral_theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

  window.UI = { esc, money, time, date, dateTime, initials, h, toast, form, confirmDlg, themeToggle, DIAS, TIPOS, ROLES };
})();
