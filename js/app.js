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
      <div class="login-wrap"><div class="login card">
        <div class="brand" style="margin-bottom:18px"><div class="logo">U</div>Umbral</div>
        <h1 style="margin-bottom:4px">Panel del condominio</h1>
        <p class="muted" style="margin:0 0 18px">Caseta y administración en un solo lugar. Lo que ves depende de tu rol.</p>
        <form id="lf">
          <div class="field"><label for="em">Correo</label><input class="input" id="em" type="email" required autocomplete="username"></div>
          <div class="field"><label for="pw">Contraseña</label><input class="input" id="pw" type="password" required autocomplete="current-password"></div>
          <div class="error">${esc(error)}</div>
          <button class="btn primary lg" style="width:100%">Entrar</button>
        </form>
      </div></div>`);
    root.appendChild(el);
    const go = async (email, pw) => {
      el.querySelector(".error").textContent = "";
      try { route(await API.login(email, pw)); } catch (e) { el.querySelector(".error").textContent = e.message; }
    };
    el.querySelector("#lf").onsubmit = (e) => { e.preventDefault(); go(el.querySelector("#em").value, el.querySelector("#pw").value); };
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
      <div class="login-wrap"><div class="login card">
        <div class="brand" style="margin-bottom:18px"><div class="logo">U</div>Umbral</div>
        <h1 style="margin-bottom:8px">Falta configurar Supabase</h1>
        <p class="muted" style="margin:0">Escribe <b>SUPABASE_URL</b> y <b>SUPABASE_ANON_KEY</b> en <b>js/config.js</b> y recarga la página.
        Si ya lo hiciste, revisa que la librería de Supabase pueda cargarse (conexión a internet).</p>
      </div></div>`));
  }

  if (!window.API) renderSinConfig();
  else API.restore().then(route).catch(() => renderLogin());
})();
