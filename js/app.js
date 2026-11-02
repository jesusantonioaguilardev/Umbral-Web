/* Arranque: login y enrutamiento por rol.
   guardia → panel de caseta (pluma) · admin → panel administrativo */
(function () {
  const { esc, h, ROLES } = UI;
  const root = document.getElementById("app");
  let cleanup = null;

  function renderLogin(error = "") {
    cleanup?.(); cleanup = null;
    root.innerHTML = "";
    const el = h(`
      <div class="login-wrap"><main class="login card">
        <div class="brand">${UI.logo}Umbral</div>
        <h1>Bienvenido</h1>
        <p class="lead">Entra con la cuenta de caseta o administración que te dio tu condominio.</p>
        <form id="lf">
          <div class="field"><label for="em">Correo</label><input class="input lg" id="em" type="email" required autocomplete="username"></div>
          <div class="field"><label for="pw">Contraseña</label><input class="input lg" id="pw" type="password" required autocomplete="current-password"></div>
          <div class="error" role="alert">${esc(error)}</div>
          <button class="btn primary lg" style="width:100%;margin-top:8px">Entrar</button>
        </form>
        <button type="button" class="btn link olvide" id="olv">¿Olvidaste tu contraseña?</button>
        <div id="rec" role="status" aria-live="polite"></div>
        <p class="foot">¿No tienes cuenta? Pídela a la administración.<br>Umbral · Control de accesos y comunidad</p>
      </main></div>`);
    root.appendChild(el);
    const go = async (email, pw) => {
      el.querySelector(".error").textContent = "";
      try { route(await API.login(email, pw)); } catch (e) { el.querySelector(".error").textContent = e.message; }
    };
    el.querySelector("#lf").onsubmit = (e) => { e.preventDefault(); go(el.querySelector("#em").value, el.querySelector("#pw").value); };
    // Recuperar contraseña: mensaje neutral, sin revelar si el correo está registrado
    const olv = el.querySelector("#olv"), rec = el.querySelector("#rec");
    olv.onclick = async () => {
      rec.textContent = "";
      const d = await UI.form({ title: "Recuperar contraseña", submit: "Enviar enlace",
        intro: "Escribe el correo de tu cuenta. Te mandaremos un enlace para elegir una nueva contraseña.",
        fields: [{ name: "email", label: "Correo", type: "email", required: true, value: el.querySelector("#em").value.trim(), placeholder: "nombre@correo.com" }],
        onSubmit: (v) => API.recuperarContrasena(v.email) });
      if (d) rec.replaceChildren(h(`<p class="notice ok">Si el correo está registrado, te enviamos un enlace para elegir una nueva contraseña. Revisa también tu correo no deseado.</p>`));
      olv.focus();
    };
  }

  async function logout() { await API.logout(); renderLogin(); }

  function route(me) {
    cleanup?.(); cleanup = null;
    root.innerHTML = "";
    if (!me) return renderLogin();
    const ctx = { me, root, logout };
    if (me.rol === "guardia") cleanup = Caseta.mount(ctx);
    else if (me.rol === "admin") cleanup = Admin.mount(ctx);
    else API.logout().then(() => renderLogin("Tu cuenta es de residente: usa la app móvil para crear pases y pagar cuotas."));
  }

  function renderSinConfig() {
    root.innerHTML = "";
    root.appendChild(h(`
      <div class="login-wrap"><main class="login card">
        <div class="brand">${UI.logo}Umbral</div>
        <h1>Falta configurar Supabase</h1>
        <p class="lead" style="margin-bottom:0">Escribe <b>SUPABASE_URL</b> y <b>SUPABASE_ANON_KEY</b> en <b>js/config.js</b> y recarga la página.
        Si ya lo hiciste, revisa que la librería de Supabase pueda cargarse (conexión a internet).</p>
      </main></div>`));
  }

  if (!window.API) renderSinConfig();
  else API.restore().then(route).catch(() => renderLogin());
})();
