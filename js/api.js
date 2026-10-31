/* Capa de datos: Supabase. Sin configuración, window.API = null y el panel pide configurarla. */
(function () {
  const cfg = window.UMBRAL_CONFIG || {};
  const hasSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);


  function saldoUnidad(u, cargos) {
    const mis = cargos.filter((c) => c.unidad_id === u.id);
    const pendiente = mis.filter((c) => c.estado === "pendiente").reduce((s, c) => s + +c.monto, 0);
    const vencido = mis.filter((c) => c.estado === "vencido").reduce((s, c) => s + +c.monto, 0);
    return { ...u, pendiente, vencido, estado: vencido > 0 ? "vencido" : pendiente > 0 ? "pendiente" : "al_corriente" };
  }

  // =====================================================================
  //  SUPABASE
  // =====================================================================
  function createSupabase() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    let me = null;
    const q = async (p) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };
    const flat = (r) => ({ ...r, unidad: r.unidades?.nombre || "—" });
    const Z = () => window.UI.zona; // zona horaria del condominio (ui.js carga después; se usa en tiempo de llamada)
    const hoy0 = () => Z().inicioDia();

    async function loadProfile(user) {
      const p = await q(sb.from("profiles").select("*, condominios(*)").eq("id", user.id).single());
      me = { ...p, email: user.email, condominio: p.condominios };
      return me;
    }

    return {
      mode: "supabase",
      async login(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos" : error.message);
        return loadProfile(data.user);
      },
      async restore() { const { data } = await sb.auth.getSession(); return data.session ? loadProfile(data.session.user) : null; },
      async logout() { await sb.auth.signOut(); me = null; },
      subscribe(cb) {
        const ch = sb.channel("umbral-" + Math.random())
          .on("postgres_changes", { event: "*", schema: "public", table: "accesos" }, async (p) => {
            const r = p.new; if (r?.unidad_id) { const u = await q(sb.from("unidades").select("nombre").eq("id", r.unidad_id).single()); r.unidad = u.nombre; } else if (r) r.unidad = "—";
            cb("accesos", r);
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "alertas" }, (p) => cb("alertas", p.new))
          .on("postgres_changes", { event: "*", schema: "public", table: "paquetes" }, (p) => cb("paquetes", p.new))
          .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, (p) => cb("tickets", p.new))
          .subscribe();
        return () => sb.removeChannel(ch);
      },

      // ---- Caseta ----
      async validarPase(codigo, punto) { return q(sb.rpc("validar_pase", { p_codigo: codigo, p_punto: punto })); },
      async registrarManual(a) {
        return q(sb.from("accesos").insert({ ...a, condominio_id: me.condominio_id, guardia_id: me.id, autorizo: "Llamada a residente" }).select().single());
      },
      async accesos({ soloHoy = false, limit = 200 } = {}) {
        let s = sb.from("accesos").select("*, unidades(nombre)").order("created_at", { ascending: false }).limit(limit);
        if (soloHoy) s = s.gte("created_at", hoy0());
        return (await q(s)).map(flat);
      },
      async esperadosHoy() {
        const d = new Date(), dow = Z().partes(d).dow;
        const rows = await q(sb.from("pases").select("*, unidades(nombre)").eq("activo", true).neq("tipo", "residente").gt("valido_hasta", d.toISOString()).lte("valido_desde", new Date(d.getTime() + 864e5).toISOString()));
        return rows.filter((p) => p.modalidad === "una_vez" ? (p.usos_max == null || p.usos < p.usos_max) : (!p.dias || p.dias.includes(dow))).map(flat);
      },
      async paquetes({ pendientes = false } = {}) {
        let s = sb.from("paquetes").select("*, unidades(nombre)").order("created_at", { ascending: false }).limit(200);
        if (pendientes) s = s.is("entregado_at", null);
        return (await q(s)).map(flat);
      },
      async registrarPaquete(p) { return q(sb.from("paquetes").insert({ ...p, condominio_id: me.condominio_id, recibido_por: me.id }).select().single()); },
      async entregarPaquete(id, entregado_a) { return q(sb.from("paquetes").update({ entregado_at: new Date().toISOString(), entregado_a }).eq("id", id)); },
      async crearAlerta(mensaje) { return q(sb.from("alertas").insert({ mensaje, condominio_id: me.condominio_id, creado_por: me.id }).select().single()); },
      async alertas() { return q(sb.from("alertas").select("*").eq("atendida", false).order("created_at", { ascending: false })); },
      async atenderAlerta(id) { return q(sb.from("alertas").update({ atendida: true }).eq("id", id)); },
      async unidades() { return q(sb.from("unidades").select("*").order("nombre")); },
      async crearUnidad(u) { return q(sb.from("unidades").insert({ ...u, condominio_id: me.condominio_id }).select().single()); },

      // ---- Administración ----
      async kpis() { return q(sb.rpc("kpis_admin")); },
      async kpisAccesos() { return q(sb.rpc("kpis_accesos")); },
      async unidadesConSaldo() {
        const [us, cs] = await Promise.all([this.unidades(), q(sb.from("cargos").select("unidad_id,monto,estado").neq("estado", "pagado"))]);
        return us.map((u) => saldoUnidad(u, cs));
      },
      async cargos({ unidad_id } = {}) {
        let s = sb.from("cargos").select("*, unidades(nombre)").order("vence", { ascending: false }).limit(500);
        if (unidad_id) s = s.eq("unidad_id", unidad_id);
        return (await q(s)).map(flat);
      },
      async pagos() { return (await q(sb.from("pagos").select("*, unidades(nombre)").order("created_at", { ascending: false }).limit(300))).map(flat); },
      async emitirCuotas(concepto, monto, vence) { return q(sb.rpc("emitir_cuotas", { p_concepto: concepto, p_monto: monto, p_vence: vence })); },
      async crearCargo(c) { return q(sb.from("cargos").insert({ ...c, condominio_id: me.condominio_id }).select().single()); },
      async registrarPago(p) { return q(sb.from("pagos").insert({ ...p, condominio_id: me.condominio_id }).select().single()); },
      async confirmarPago(id) { return q(sb.from("pagos").update({ confirmado: true }).eq("id", id)); },
      async egresos() { return q(sb.from("egresos").select("*").order("fecha", { ascending: false }).limit(300)); },
      async crearEgreso(e) { return q(sb.from("egresos").insert({ ...e, condominio_id: me.condominio_id }).select().single()); },
      async avisos() { return q(sb.from("avisos").select("*").order("created_at", { ascending: false })); },
      async crearAviso(a, archivo) {
        let adjunto = {};
        if (archivo) {
          if (archivo.size > 10 * 1024 * 1024) throw new Error("El archivo pesa más de 10 MB");
          const limpio = archivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-60);
          const ruta = `${me.condominio_id}/${crypto.randomUUID()}-${limpio}`;
          const { error } = await sb.storage.from("avisos").upload(ruta, archivo, { contentType: archivo.type });
          if (error) throw new Error("No se pudo subir el archivo: " + error.message);
          adjunto = { adjunto_url: sb.storage.from("avisos").getPublicUrl(ruta).data.publicUrl, adjunto_nombre: archivo.name };
        }
        return q(sb.from("avisos").insert({ ...a, ...adjunto, condominio_id: me.condominio_id, creado_por: me.id }).select().single());
      },
      async eliminarAviso(a) {
        const ruta = a.adjunto_url?.split("/object/public/avisos/")[1];
        if (ruta) await sb.storage.from("avisos").remove([decodeURIComponent(ruta)]);
        return q(sb.from("avisos").delete().eq("id", a.id));
      },

      // ---- Reportes: filas crudas por rango de fechas ([desde, hasta] en YYYY-MM-DD) ----
      async reporte(tipo, { desde, hasta, unidad_id } = {}) {
        const ini = desde ? Z().inicioDia(desde) : null;
        const fin = hasta ? Z().finDia(hasta) : null;
        const rango = (s, col = "created_at", fecha = false) => {
          if (desde) s = s.gte(col, fecha ? desde : ini);
          if (hasta) s = s.lte(col, fecha ? hasta : fin);
          return s;
        };
        const porUnidad = (s) => (unidad_id ? s.eq("unidad_id", unidad_id) : s);
        const T = {
          accesos: () => rango(sb.from("accesos").select("*, unidades(nombre), profiles:guardia_id(nombre)")).order("created_at", { ascending: false }),
          pases: () => rango(sb.from("pases").select("*, unidades(nombre), profiles:creado_por(nombre)").neq("tipo", "residente")).order("created_at", { ascending: false }),
          avisos: () => rango(sb.from("avisos").select("*")).order("created_at", { ascending: false }),
          paquetes: () => rango(sb.from("paquetes").select("*, unidades(nombre)")).order("created_at", { ascending: false }),
          tickets: () => rango(sb.from("tickets").select("*, unidades(nombre)")).order("created_at", { ascending: false }),
          reservaciones: () => rango(sb.from("reservaciones").select("*, unidades(nombre), areas(nombre)"), "fecha", true).order("fecha", { ascending: false }),
          alertas: () => rango(sb.from("alertas").select("*, profiles:creado_por(nombre)")).order("created_at", { ascending: false }),
          usuarios: () => sb.from("profiles").select("*, unidades(nombre)").order("nombre"),
          unidades: () => sb.from("unidades").select("*").order("nombre"),
          pagos: () => rango(sb.from("pagos").select("*, unidades(nombre)")).order("created_at", { ascending: false }),
          cargos: () => rango(sb.from("cargos").select("*, unidades(nombre)"), "vence", true).order("vence", { ascending: false }),
          egresos: () => rango(sb.from("egresos").select("*"), "fecha", true).order("fecha", { ascending: false })
        };
        let s = T[tipo]();
        if (unidad_id && !["avisos", "alertas", "usuarios", "unidades", "egresos"].includes(tipo)) s = porUnidad(s);
        if (unidad_id && tipo === "usuarios") s = s.eq("unidad_id", unidad_id);
        return (await q(s.limit(5000))).map((r) => ({ ...r, unidad: r.unidades?.nombre || "—", area: r.areas?.nombre, persona: r.profiles?.nombre }));
      },
      async tickets() { return (await q(sb.from("tickets").select("*, unidades(nombre)").order("created_at", { ascending: false }))).map(flat); },
      async actualizarTicket(id, patch) { return q(sb.from("tickets").update(patch).eq("id", id)); },
      async areas() { return q(sb.from("areas").select("*").order("nombre")); },
      async crearArea(a) { return q(sb.from("areas").insert({ ...a, condominio_id: me.condominio_id }).select().single()); },
      async reservaciones() {
        return (await q(sb.from("reservaciones").select("*, unidades(nombre), areas(nombre)").gte("fecha", Z().hoy()).order("fecha")))
          .map((r) => ({ ...flat(r), area: r.areas?.nombre }));
      },
      async cancelarReservacion(id) { return q(sb.from("reservaciones").delete().eq("id", id)); },
      async encuestas() {
        const [es, rs] = await Promise.all([q(sb.from("encuestas").select("*").order("created_at", { ascending: false })), q(sb.from("resultados_encuestas").select("*"))]);
        return es.map((e) => {
          const resultados = e.opciones.map((_, i) => +(rs.find((r) => r.encuesta_id === e.id && r.opcion === i)?.votos || 0));
          return { ...e, resultados, total: resultados.reduce((a, b) => a + b, 0) };
        });
      },
      async crearEncuesta(e) { return q(sb.from("encuestas").insert({ ...e, condominio_id: me.condominio_id }).select().single()); },
      async pases() { return (await q(sb.from("pases").select("*, unidades(nombre)").neq("tipo", "residente").order("created_at", { ascending: false }).limit(300))).map(flat); },
      async crearPase(p) { return flat(await q(sb.from("pases").insert({ ...p, condominio_id: me.condominio_id, creado_por: me.id }).select("*, unidades(nombre)").single())); },
      async cancelarPase(id) { return q(sb.from("pases").update({ activo: false }).eq("id", id)); },
      async usuarios() { return (await q(sb.from("profiles").select("*, unidades(nombre)").order("nombre"))).map((u) => ({ ...u, unidad: u.unidades?.nombre || null })); },
      async actualizarUsuario(id, patch) { return q(sb.from("profiles").update(patch).eq("id", id)); },
      async vincularUsuario(email, rol, unidad_id, nombre) {
        return q(sb.rpc("vincular_usuario", { p_email: email, p_rol: rol, p_unidad: unidad_id || null, p_nombre: nombre || null }));
      },
      async desvincularUsuario(id) { return q(sb.rpc("desvincular_usuario", { p_id: id })); },
      async actualizarUnidad(id, patch) { return q(sb.from("unidades").update(patch).eq("id", id)); }
    };
  }

  window.API = hasSupabase ? createSupabase() : null;
})();
