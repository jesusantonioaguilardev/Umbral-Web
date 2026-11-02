# Changelog

Cambios importantes de este proyecto. Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Sin publicar]

### Agregado
- **Recuperar contraseña:** el login del panel tiene **¿Olvidaste tu contraseña?**, que manda un correo con un enlace a
  `bienvenida.html` para elegir una nueva. Siempre responde lo mismo (*"Si el correo está registrado, te enviamos un
  enlace…"*) para no revelar qué correos tienen cuenta. En *Usuarios y roles*, cada persona con correo tiene **Enviar enlace
  de contraseña**, para que administración ayude a quien la olvidó sin cambiarla a mano en Supabase. Si se piden demasiados
  enlaces seguidos, avisa *"Espera unos minutos antes de pedir otro enlace"*. No requiere SQL, pero sí traducir la plantilla
  *Reset password* y tener `bienvenida.html` en *Redirect URLs* (ver README → Invitaciones por correo, paso 7).
- **Invitar usuarios por correo:** en *Usuarios y roles*, **+ Invitar usuario** pide correo, nombre, rol y unidad, manda la
  invitación de Supabase y deja a la persona vinculada al condominio, sin tener que crear la cuenta a mano en Authentication.
  Si el correo ya tenía cuenta, solo se vincula. **(requiere ejecutar `supabase/schema.sql`)**
  - Edge Function `invitar`: solo la puede usar un admin con condominio; normaliza los correos, revisa cuáles ya existen y
    manda las invitaciones (máximo 300 por llamada). **No vincula**: el panel llama después a `vincular_usuario`, que sigue
    siendo la única que decide si alguien puede entrar al condominio. Se despliega y se configura a mano (secreto
    `URL_BIENVENIDA`, Redirect URL, plantilla del correo y SMTP propio): ver
    [`supabase/functions/invitar/README.md`](supabase/functions/invitar/README.md).
  - RPC `correos_registrados(p_correos)`: de una lista de correos, cuáles ya tienen cuenta. Solo la puede llamar la
    `service_role` (la función `invitar`), para que nadie pueda averiguar desde el panel o la app qué correos están registrados.
  - Página `bienvenida.html`: el enlace del correo abre esta página para que la persona escriba su nombre (si falta) y defina
    su contraseña (mínimo 8 caracteres). Avisa si el enlace venció o ya se usó, y quita los tokens de la barra de direcciones.
  - **Vincular cuenta existente** queda como opción aparte para cuentas creadas a mano en Supabase (no manda correo).
- **Importar unidades y usuarios desde CSV** en *Usuarios y roles* y en *Unidades* (y desde *Primeros pasos* del resumen):
  plantilla descargable con las columnas `unidad, torre, propietario, clabe, correo, nombre, rol`, vista previa con los errores
  por fila (correo inválido o repetido, rol desconocido, CLABE que no tiene 18 dígitos, falta la unidad) y, al terminar, un
  resumen de unidades creadas, invitaciones enviadas, cuentas que ya existían y vinculados, con los errores descargables en CSV.
  Acepta coma, punto y coma o tabulador, y archivos de Excel en UTF-8 o Windows-1252; máximo 2,000 filas y 2 MB. Las unidades
  que ya existen no se modifican. Usa la Edge Function `invitar`, así que necesita lo mismo que *Invitar usuario*.
- **Alerta de emergencia por push a todo el condominio:** cada alerta nueva (del botón de caseta, de administración o del botón
  de emergencia de la app) genera una notificación para todas las personas del condominio con la app y sesión abierta
  (residentes, caseta y administración), menos para quien la envió. Si la manda un residente, el mensaje empieza con su unidad
  (*"Casa 14: …"*). Trigger `notificar_alerta`, `datos.tipo = "alerta"`. Ver también Umbral-App.
  **(requiere ejecutar `supabase/schema.sql`)**
- La Edge Function `notificar` manda las alertas con `channel_id: "emergencias"` en Android, para que lleguen por el canal
  *Emergencias* de la app aunque esté en segundo plano. **(requiere redesplegar `notificar`:
  `supabase functions deploy notificar --no-verify-jwt`)**
- Botón **⚠ Emergencia** en el resumen de administración; pide una segunda confirmación antes de enviar, porque la notificación
  llega a todo el condominio y no se puede deshacer.
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
- El alta de guardias y residentes ya no pide crear la cuenta en *Authentication → Add user*: se hace con **+ Invitar usuario**
  o **Importar CSV**. El error de `vincular_usuario` cuando no existe la cuenta ahora dice *"Invítala primero desde Usuarios →
  Invitar"*. **(requiere ejecutar `supabase/schema.sql`)**
- Las alertas abiertas se muestran arriba en caseta y en administración con el mensaje, la hora (o la fecha si no es de hoy) y
  quién la envió; **Marcar atendida** pide confirmación porque la alerta deja de verse en los dos paneles. El KPI del resumen
  resalta las alertas sin atender, y el resumen se actualiza en tiempo real cuando llega una.
- El botón de emergencia de caseta dice *"avisar a todos"* y explica antes de enviar que la notificación llega a todo el
  condominio; si falla, sugiere llamar a los servicios de emergencia.
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
- Una alerta solo se puede crear a nombre propio: la política `al_ins` exige `creado_por = auth.uid()` (y la columna toma ese
  valor por defecto), para que nadie mande una alerta haciéndose pasar por otra persona o unidad. **(requiere ejecutar `supabase/schema.sql`)**
- Límite anti-spam: un residente puede crear como máximo **2 alertas cada 10 minutos** (trigger `limitar_alertas`; caseta y
  administración sin límite). Como cada alerta llega por push a todo el condominio, así un error o un abuso no satura a nadie.
  **(requiere ejecutar `supabase/schema.sql`)**
- Un residente solo puede reportar pagos de cargos de su propia unidad y una sola vez mientras el pago está en revisión.
  **(requiere ejecutar `supabase/schema.sql`)**
- Los votos de las encuestas solo son visibles dentro del condominio, ya no se puede votar en encuestas cerradas ni de otro
  condominio, y la vista `resultados_encuestas` respeta los permisos de quien consulta (`security_invoker`).
  **(requiere ejecutar `supabase/schema.sql`)**
- Borrar una reservación exige que sea del propio condominio, y no se puede reservar un área de otro condominio.
  **(requiere ejecutar `supabase/schema.sql`)**
- La lista negra solo la consultan caseta y administración, y solo administración la edita; los residentes no la ven.
  **(requiere ejecutar `supabase/schema.sql`)**
