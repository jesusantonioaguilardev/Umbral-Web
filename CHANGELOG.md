# Changelog

Cambios importantes de este proyecto. Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Sin publicar]

### Agregado
- **Notificaciones push** para residentes: avisan cuando entra una visita, proveedor, paquetería o Airbnb de su unidad, cuando
  caseta registra un paquete para su unidad y cuando administración publica un aviso (a todo el condominio o solo a la torre
  del aviso). Ver también Umbral-App (push en Android). **(requiere ejecutar `supabase/schema.sql`)**
  - Tabla `dispositivos`: los teléfonos donde cada usuario recibe push. Cada quien solo ve y borra los suyos, y si alguien
    cambia o sale del condominio sus dispositivos se borran (trigger `limpiar_dispositivos`) para que no siga recibiendo
    avisos del anterior.
  - Tabla `notificaciones`: una fila por aviso y destinatario. Solo la llenan los triggers `notificar_acceso`,
    `notificar_paquete` y `notificar_aviso`; el destinatario solo puede marcarla como leída (trigger `proteger_notificacion`).
    Se publica en tiempo real.
  - RPC `registrar_dispositivo(p_token, p_plataforma)` y `quitar_dispositivo(p_token)`, que la app llama al iniciar y al
    cerrar sesión. Si un token ya era de otra cuenta (mismo teléfono, otra sesión), pasa a la cuenta actual.
  - Edge Function `notificar`: la llama un Database Webhook en cada `INSERT` de `notificaciones`, envía con Firebase Cloud
    Messaging y anota `enviada_at` o `error` en la fila. Se despliega y se configura a mano (secretos y webhook):
    ver [`supabase/functions/notificar/README.md`](supabase/functions/notificar/README.md).
- **Lista negra** en el menú Seguridad del panel de administración: agrega personas (y su placa, opcional) a las que no se
  debe dejar entrar, con motivo, y desactívalas o reactívalas cuando cambie la situación. **(requiere ejecutar `supabase/schema.sql`)**
- La caseta niega automáticamente los pases de una persona en la lista negra con el motivo *"Persona restringida por
  administración"*, aunque el pase se haya creado antes de la restricción. **(requiere ejecutar `supabase/schema.sql`)**
- *Visita sin pase* en caseta pide la placa del vehículo y, antes de registrar una entrada autorizada, revisa la lista negra
  por nombre y por placa. Si hay coincidencia, el guardia ve el motivo y decide; si no confirma, queda como acceso negado.
  **(requiere ejecutar `supabase/schema.sql`)**
- La placa aparece en la bitácora de caseta y de administración, se puede buscar y se incluye en el CSV. **(requiere ejecutar `supabase/schema.sql`)**
- Botón **Confirmar** en *Pagos recibidos* para los pagos que reportan los residentes, con aviso de verificar antes la referencia
  en el banco; el resumen separa lo confirmado de lo que está por confirmar y el CSV incluye la columna `confirmado`.
  **(requiere ejecutar `supabase/schema.sql`)**
- Al validar un pase recurrente, la caseta muestra sus días y horario permitidos. **(requiere ejecutar `supabase/schema.sql`)**
- Los cargos vencidos se marcan solos cada día a las 00:10 (Hermosillo) con `pg_cron`. Si la extensión no está habilitada,
  el script avisa y sigue; habilítala en *Database → Extensions* y vuelve a ejecutarlo. **(requiere ejecutar `supabase/schema.sql`)**
- `CLAUDE.md` con el contexto del repositorio para los agentes.

### Cambiado
- **Rediseño minimalista** del panel, la caseta, el inicio de sesión y `pase.html`: tipografía Inter, paleta sobria con un solo
  acento, barra lateral clara, tablas y chips de estado con texto (✓/✕), sin sombras. La caseta muestra a la vez el resultado,
  los esperados de hoy, la bitácora y los paquetes. Los ítems del menú son botones accesibles con teclado y Esc cierra los
  modales. Ver también Umbral-App.
- Los pagos que reporta el residente quedan **por confirmar** hasta que administración los revisa, y solo entonces el cargo se
  marca pagado. Así no se da por pagado un cargo solo con una clave de rastreo sin verificar. Los pagos que registra el
  administrador y los que ya existían cuentan como confirmados. Ver también Umbral-App (cargo *En revisión*).
  **(requiere ejecutar `supabase/schema.sql`)**
- Los KPIs de cobranza (*cobrado del mes* y la gráfica de ingresos) solo suman pagos confirmados. **(requiere ejecutar `supabase/schema.sql`)**
- Un cargo pendiente cuya fecha de vencimiento ya pasó se muestra y se cuenta como vencido en cobranza, estado de cuenta,
  reportes y KPIs, aunque el proceso diario aún no lo haya marcado. **(requiere ejecutar `supabase/schema.sql`)**
- "Hoy", "este mes", los rangos de reportes, la hora pico, el reloj de caseta, los visitantes esperados y los valores por defecto
  de fechas usan la zona horaria del condominio (`ZONA_HORARIA` en `js/config.js`) en lugar de la del navegador, para que todos
  vean los mismos días que el servidor. Ver también Umbral-App.
- Las funciones de KPIs, `marcar_vencidos` y la fecha por defecto de los egresos calculan el día y el mes en
  `America/Hermosillo`. **(requiere ejecutar `supabase/schema.sql`)**
- El README describe dos repositorios separados (antes hablaba de un monorepo con `mobile/` y `web/`), la publicación en
  GitHub Pages, la instalación con `pg_cron` y la referencia actualizada de funciones SQL.
- La app ahora enlaza a `pase.html` publicado en GitHub Pages desde `main`; no cambies de lugar ni de nombre `pase.html`
  (ver también Umbral-App).

### Corregido
- Una reservación ya no puede terminar antes de empezar ni traslaparse con otra de la misma área y fecha; dos reservas
  simultáneas tampoco pueden quedar encimadas. El mensaje indica el horario ocupado. **(requiere ejecutar `supabase/schema.sql`)**
- La barra superior del panel ya no se desborda en pantallas angostas.

### Seguridad
- Un residente solo puede reportar pagos de cargos de su propia unidad y una sola vez mientras el pago está en revisión.
  **(requiere ejecutar `supabase/schema.sql`)**
- Los votos de las encuestas solo son visibles dentro del condominio, ya no se puede votar en encuestas cerradas ni de otro
  condominio, y la vista `resultados_encuestas` respeta los permisos de quien consulta (`security_invoker`).
  **(requiere ejecutar `supabase/schema.sql`)**
- Borrar una reservación exige que sea del propio condominio, y no se puede reservar un área de otro condominio.
  **(requiere ejecutar `supabase/schema.sql`)**
- La lista negra solo la consultan caseta y administración, y solo administración la edita; los residentes no la ven.
  **(requiere ejecutar `supabase/schema.sql`)**
