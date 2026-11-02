# Umbral · Panel web y base de datos

Umbral es una plataforma para condominios: control de accesos con QR, cuotas y cobranza, comunidad y reportes.
Este repositorio contiene el **panel web** (caseta y administración), la **página pública del pase** y el
**esquema de la base de datos** de Supabase que comparte con la app móvil.

| Repositorio | Contenido | Para quién |
|---|---|---|
| [Umbral-Web](https://github.com/jesusantonioaguilardev/Umbral-Web) (este) | Panel web en HTML, CSS y JS puro, `pase.html` y `supabase/` | Guardia en caseta, administración y la visita que recibe el pase |
| [Umbral-App](https://github.com/jesusantonioaguilardev/Umbral-App) | App Kotlin Multiplatform + Compose (Android, iOS y escritorio) | Residentes (y guardias en *modo caseta*) |

Los dos usan **la misma base de datos Supabase**. El esquema vive solo aquí, en `supabase/schema.sql`.

- Panel publicado (GitHub Pages, rama `main`): https://jesusantonioaguilardev.github.io/Umbral-Web/
- Pase de una visita: `https://jesusantonioaguilardev.github.io/Umbral-Web/pase.html?c=<código>`

Contenido: [Estructura](#estructura) · [1. Base de datos](#1-instalar-la-base-de-datos) · [2. Configurar el panel](#2-configurar-el-panel) ·
[Invitaciones](#invitaciones-por-correo-edge-function-invitar) · [3. Servir en local](#3-servir-el-panel-en-local) · [4. Publicar](#4-publicar-en-github-pages) · [Qué ve cada rol](#qué-ve-cada-rol) ·
[Referencia SQL](#referencia-de-la-base-de-datos) · [Pendientes](#pendientes-para-producción)

---

## Estructura

```
index.html                ← panel (login y enrutamiento por rol)
pase.html                 ← página pública que muestra el QR a la visita
bienvenida.html           ← página del enlace de invitación: la persona define su nombre y contraseña
css/styles.css            ← estilos y tokens (claro/oscuro)
js/config.js              ← configuración: Supabase, módulos, zona horaria
js/api.js                 ← todas las llamadas a Supabase (tablas y RPC)
js/ui.js                  ← utilidades de interfaz y zona horaria (UI.zona)
js/caseta.js              ← panel de caseta (guardia)
js/admin.js               ← panel administrativo
js/app.js                 ← arranque, login y ruteo por rol
supabase/schema.sql       ← esquema completo, idempotente
supabase/seed_pruebas.sql ← datos de prueba (solo local, NO versionado)
supabase/functions/notificar/ ← Edge Function que envía el push (FCM) y su README de despliegue
supabase/functions/invitar/   ← Edge Function que manda las invitaciones por correo y su README de despliegue
```

## 1. Instalar la base de datos

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. (Recomendado) Habilita **pg_cron** en *Database → Extensions*. El esquema la usa para marcar a diario los cargos vencidos
   (ver [Cargos vencidos y pg_cron](#cargos-vencidos-y-pg_cron)).
3. Abre **SQL Editor**, pega el contenido de `supabase/schema.sql` y ejecútalo.
   El archivo es **idempotente**: puedes volver a ejecutarlo completo cada vez que cambie, sin perder datos
   (usa `create table if not exists`, `add column if not exists`, `create or replace function` y recrea las políticas).
4. En **Authentication → Users → Add user** crea la cuenta del administrador y marca *Auto Confirm User*.
5. De vuelta en el SQL Editor, crea el condominio y nombra administrador a esa cuenta:
   ```sql
   select umbral_setup('Residencial Las Palmas', 'Hermosillo', 'admin@ejemplo.com');
   ```
6. Configura las invitaciones por correo (una sola vez): sigue [Invitaciones por correo](#invitaciones-por-correo-edge-function-invitar).
7. Entra al panel como administrador y da de alta lo demás. Hay dos caminos y ninguno necesita SQL:
   - **Uno por uno:** **Unidades → + Unidad**; luego **Usuarios y roles → + Invitar usuario** con el correo, el nombre, el rol y
     (para residentes) la unidad. La persona recibe un correo, define su contraseña en `bienvenida.html` y queda vinculada.
   - **Todo de golpe:** **Importar CSV** (en *Usuarios y roles* o en *Unidades*). Descarga la plantilla, llénala y súbela; ver
     [Importar desde CSV](#importar-unidades-y-usuarios-desde-csv).
   - Si alguien ya tiene cuenta en *Authentication* (creada a mano), usa **Vincular cuenta existente**: no manda correo.

El esquema **no trae datos de ejemplo**: todo arranca vacío.

### Cargos vencidos y pg_cron

`schema.sql` intenta crear la extensión `pg_cron` y programar el trabajo `umbral-vencidos`, que ejecuta
`marcar_vencidos()` todos los días a las **07:10 UTC (00:10 en Hermosillo)**.
Si `pg_cron` no está disponible, el script **no falla**: muestra el aviso
*"No se programó marcar_vencidos…"* y sigue. En ese caso habilítala en *Database → Extensions* y vuelve a ejecutar `schema.sql`.

Para comprobar que quedó programado:

```sql
select jobname, schedule, command from cron.job where jobname = 'umbral-vencidos';
```

Aunque el cron no haya corrido, `kpis_admin`, el panel y la app ya tratan como **vencido** cualquier cargo `pendiente`
cuya fecha de vencimiento pasó. Así los números son correctos desde el primer día y el cron solo deja el estado guardado al día.

### Notificaciones push

`schema.sql` crea las tablas `dispositivos` y `notificaciones` y los triggers que llenan la bandeja, pero **el envío no queda
activo solo con el SQL**: falta desplegar la Edge Function `notificar`, guardar sus secretos (cuenta de servicio de Firebase y
`NOTIFICAR_SECRETO`) y crear el Database Webhook. Cada vez que cambie `supabase/functions/notificar/index.ts` vuelve a
desplegarla con `supabase functions deploy notificar --no-verify-jwt` (por ejemplo, el canal `emergencias` de las alertas
depende de la versión actual). Sigue [`supabase/functions/notificar/README.md`](supabase/functions/notificar/README.md).
Sin eso, las filas se acumulan en `notificaciones` sin `enviada_at` y nadie recibe push. La app también necesita su
`google-services.json` (ver el README de Umbral-App, sección *Notificaciones push (Android)*).

### Invitaciones por correo (Edge Function `invitar`)

El panel da de alta personas con la Edge Function `invitar`, que manda la invitación de Supabase Auth. Como `schema.sql` no
puede desplegar funciones ni cambiar la configuración de Authentication, estos pasos se hacen a mano. El detalle (contrato,
respuestas y pruebas) está en [`supabase/functions/invitar/README.md`](supabase/functions/invitar/README.md).

1. Ejecuta `supabase/schema.sql` actualizado: crea la RPC `correos_registrados`, que solo puede usar la función.
2. Configura un **SMTP propio** en *Project Settings → Authentication → SMTP Settings* y después sube el límite en
   *Authentication → Rate Limits*. El correo integrado de Supabase solo manda unos pocos correos por hora: con él, una
   importación de CSV falla con *"Se alcanzó el límite de correos por hora"*.
3. Guarda el secreto con la página a la que lleva el correo:
   ```bash
   supabase secrets set URL_BIENVENIDA=https://jesusantonioaguilardev.github.io/Umbral-Web/bienvenida.html
   ```
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los pone el runtime; no los guardes tú ni los copies al repositorio.
4. En *Authentication → URL Configuration → Redirect URLs* agrega la misma URL
   (`https://jesusantonioaguilardev.github.io/Umbral-Web/bienvenida.html`). Si no está en la lista, Supabase ignora el
   `redirectTo` y manda al invitado al *Site URL*.
5. Despliega la función **con la verificación de JWT activa** (sin `--no-verify-jwt`):
   ```bash
   supabase functions deploy invitar
   ```
   A diferencia de `notificar` (que la llama un webhook), a `invitar` la llama una persona con sesión, así que el gateway debe
   rechazar a quien no la tenga. Revisa en *Edge Functions → invitar → Details* que *Enforce JWT Verification* esté encendido.
6. Traduce la plantilla en *Authentication → Emails → Templates → Invite user*: asunto `Te invitaron a Umbral` y un cuerpo en
   español que conserve `{{ .ConfirmationURL }}` (es el enlace que abre `bienvenida.html` con la sesión del invitado). Hay un
   ejemplo listo en el README de la función.
7. Traduce también *Authentication → Emails → Templates → Reset password*, que usan **¿Olvidaste tu contraseña?** del login
   y **Enviar enlace de contraseña** de *Usuarios y roles*: asunto `Cambia tu contraseña de Umbral` y un cuerpo en español
   que conserve `{{ .ConfirmationURL }}`, por ejemplo:
   ```html
   <h2>Cambia tu contraseña de Umbral</h2>
   <p>Recibimos una solicitud para cambiar la contraseña de tu cuenta. Toca el botón para elegir una nueva:</p>
   <p><a href="{{ .ConfirmationURL }}">Elegir nueva contraseña</a></p>
   <p>El enlace sirve una sola vez y vence pronto. Si no lo pediste, ignora este correo: tu contraseña no cambia.</p>
   ```
   El enlace lleva a `bienvenida.html` junto al panel (la misma página de `URL_BIENVENIDA`), así que esa URL debe estar en
   *Redirect URLs* (paso 4); si no, Supabase manda a la persona al *Site URL* y no puede cambiar su contraseña. Este correo
   cuenta para el mismo límite de envío por hora que las invitaciones.

**Por qué la función no vincula:** `invitar` corre con la `service_role` y solo manda correos. El rol, la unidad y el
condominio los asigna después el panel con `vincular_usuario`, con la sesión del admin. Así la regla de quién puede entrar a
qué condominio (por ejemplo, rechazar a alguien que ya es de otro) vive en un solo lugar, el SQL, y la función no puede saltársela.
Por lo mismo, para un correo que ya tenía cuenta responde `existente` sin decir de qué condominio es.

### Importar unidades y usuarios desde CSV

**Importar CSV** acepta un archivo cuya primera fila son los encabezados. Solo `unidad` es obligatoria como columna:

| Columna | Qué es |
|---|---|
| `unidad` | Nombre de la unidad (`Casa 1`). Si no existe, se crea; si ya existe, no se modifica. Puede ir vacía solo en filas de guardia o admin |
| `torre`, `propietario`, `clabe` | Datos de la unidad nueva (se toman de la primera fila de esa unidad). La CLABE debe tener 18 dígitos |
| `correo` | Persona a invitar. Vacío = solo se crea la unidad |
| `nombre` | Cómo aparece en caseta y en la app |
| `rol` | `residente` (si va vacío), `guardia` o `admin`. También acepta `seguridad`, `caseta`, `vigilante`, `administrador`… |

El panel muestra una vista previa con los errores por fila antes de importar; las filas con error no se importan. Después crea
las unidades que falten, manda las invitaciones en lotes de 50 y vincula a cada persona con `vincular_usuario`. Al final muestra
un resumen y deja descargar los errores en CSV. Acepta coma, punto y coma (Excel en español) o tabulador, y archivos en UTF-8 o
Windows-1252; máximo 2,000 filas y 2 MB. No cierres la ventana mientras corre.

### Datos de prueba (`seed_pruebas.sql`)

`supabase/seed_pruebas.sql` es solo para desarrollo y **no está en el repositorio** (está en `.gitignore` porque contiene la
contraseña de las cuentas de prueba). Si lo tienes en local:

1. Ejecuta antes `schema.sql`.
2. Edita la variable `admin_email` al inicio del script con el correo de tu administrador.
3. Ejecútalo en el SQL Editor. Se puede repetir sin duplicar nada y no requiere `umbral_setup`.

Crea Casa 1 y Casa 2, un guardia, dos residentes, los pases `PRUEBA1` (visita de hoy), `PRUEBA2` (proveedor recurrente) y
una persona en lista negra con su pase `PRUEBA3`, que la caseta debe negar con *"Persona restringida por administración"*.
Al final trae una sección **LIMPIEZA** comentada para borrar lo de prueba. Nunca lo ejecutes en producción.

## 2. Configurar el panel

Edita `js/config.js` con los datos de *Project Settings → API* de Supabase:

```js
window.UMBRAL_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "<clave pública anon>",
  PUNTO_ACCESO: "Acceso principal",          // nombre del punto que se guarda en la bitácora
  MODULOS: { comunidad: true, finanzas: false },
  ZONA_HORARIA: "America/Hermosillo"
};
```

- Usa solo la clave **anon** (pública). Nunca pongas la clave `service_role` en el panel ni en la app: la seguridad depende de RLS.
- Sin `SUPABASE_URL` y `SUPABASE_ANON_KEY` el panel muestra *"Falta configurar Supabase"*.

### Debe coincidir con la app

`js/config.js` y `composeApp/src/commonMain/kotlin/mx/umbral/app/Config.kt` (en
[Umbral-App](https://github.com/jesusantonioaguilardev/Umbral-App)) deben tener los mismos valores:

| Panel (`js/config.js`) | App (`Config.kt`) | Qué controla |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | El mismo proyecto de Supabase |
| `MODULOS.comunidad` | `MODULO_COMUNIDAD` | Avisos, paquetería, tickets, reservaciones y encuestas |
| `MODULOS.finanzas` | `MODULO_FINANZAS` | Cobranza, pagos y egresos (en la app, la pestaña Pagos) |
| `ZONA_HORARIA` | `ZONA_HORARIA` | Qué es "hoy", horarios de pases, rangos de reportes |

**Por qué la zona horaria es explícita:** "hoy", "este mes" y el horario de un pase se calculan en la zona del condominio,
no en la del navegador o el teléfono. Así un guardia o un administrador con el equipo en otra zona ven los mismos días que el servidor.
Las funciones SQL usan `America/Hermosillo` fija; si cambias `ZONA_HORARIA`, también hay que cambiarla en `schema.sql`
(incluida la hora del cron).

Control de accesos (resumen, unidades, reportes, bitácora, pases, lista negra y usuarios) siempre está activo.
Los adjuntos de los avisos se guardan en el bucket `avisos` de Supabase Storage, que crea `schema.sql`.

## 3. Servir el panel en local

El panel es estático: no tiene paso de compilación. Sírvelo desde la raíz del repositorio:

```bash
python -m http.server 8080
```

Abre http://localhost:8080 (y el pase en http://localhost:8080/pase.html?c=PRUEBA1).
En Windows también funciona `py -m http.server 8080`; en macOS/Linux, `python3 -m http.server 8080`.

> La cámara del navegador (escaneo de QR en caseta) solo funciona con **HTTPS** o en `localhost`.

## 4. Publicar en GitHub Pages

GitHub Pages publica la rama **`main`** de este repositorio en https://jesusantonioaguilardev.github.io/Umbral-Web/.
Un cambio queda en línea cuando se fusiona a `main`; las ramas de trabajo no se publican.

- `js/config.js` se publica tal cual: solo debe llevar la URL y la clave **anon**.
- La app arma el enlace del pase con `Config.URL_PASE_WEB` (`…/Umbral-Web/pase.html?c=`). Si cambias de dominio o de hosting,
  actualiza esa constante en Umbral-App.
- `pase.html` no consulta la base de datos: solo dibuja el QR (`UMBRAL:<código>`) a partir del parámetro `c`.
  La validación real ocurre en caseta con `validar_pase`.

## Qué ve cada rol

- **guardia** → *Panel de caseta*: escaneo de QR con la cámara (o código a mano), resultado en verde o rojo con días y horario
  del pase, bitácora del día en tiempo real, visitantes esperados hoy, **visita sin pase** (con placa y revisión de la lista negra),
  paquetería y botón de **emergencia** (push a todo el condominio). Las alertas abiertas se ven arriba hasta marcarlas atendidas.
- **admin** → *Panel administrativo*: resumen con KPIs y botón de **emergencia** (con doble confirmación), unidades, usuarios y
  roles (**invitar**, **importar CSV** o vincular una cuenta existente), bitácora con filtros y CSV, pases y proveedores,
  **lista negra**, reportes (CSV o PDF) y, según los módulos, comunicados, paquetería, tickets, reservaciones, encuestas,
  cobranza, pagos (con **Confirmar**) y egresos.
- **residente** → se le indica que use la app móvil.

### Por qué un pago queda "por confirmar"

Cuando el residente reporta una transferencia desde la app, solo escribe la clave de rastreo: Umbral todavía no concilia SPEI
automáticamente. Para no marcar un cargo como pagado sin verificar, el trigger `proteger_pago` guarda ese pago con
`confirmado = false` y el cargo sigue pendiente (en la app aparece **En revisión**). Cuando administración revisa la referencia
en su banco y pulsa **Confirmar**, el trigger `on_pago` marca el cargo como pagado. Los pagos que registra el administrador
quedan confirmados de inmediato, y `kpis_admin` solo suma pagos confirmados.

### Por qué una alerta llega a todo el condominio y tiene límite

Una emergencia (incendio, intrusión, alguien herido) le importa a todo el condominio, no solo a caseta, así que el trigger
`notificar_alerta` avisa a todas las personas con la app y sesión abierta, menos a quien la envió. Como eso multiplica el
efecto de un toque accidental o de un abuso, hay tres frenos: en la app hay que mantener el botón 2 segundos, en el panel de
administración se confirma dos veces y `limitar_alertas` deja a cada residente crear como máximo 2 alertas cada 10 minutos.
La política `al_ins` exige que `creado_por` sea quien inserta, para que el mensaje siempre muestre la unidad real de quien la envió.

### Por qué la caseta revisa la lista negra en dos lugares

`validar_pase` niega cualquier pase cuyo visitante esté en la lista negra, aunque el residente lo haya creado antes de la
restricción. Las visitas **sin pase** no pasan por `validar_pase`, así que el panel llama a `en_lista_negra` (nombre y placa)
antes de registrar una entrada autorizada; si hay coincidencia, el guardia decide y, si no confirma, queda como acceso negado.

---

## Referencia de la base de datos

### Funciones RPC

Todas son `security definer` salvo `marcar_vencidos`. Ninguna se puede llamar sin sesión (`anon`).
"Staff" = rol `guardia` o `admin`. Todas operan sobre el condominio de quien llama (`my_condo()`).

| Función | Parámetros | Devuelve | Quién la llama |
|---|---|---|---|
| `validar_pase` | `p_codigo text`, `p_punto text default 'Acceso principal'` | `json` | Staff (caseta) |
| `generar_codigo_personal` | — | `json` | Usuario con unidad (residente) |
| `en_lista_negra` | `p_nombre text`, `p_placa text default null` | `json` | Staff |
| `vincular_usuario` | `p_email text`, `p_rol rol_usuario default 'residente'`, `p_unidad uuid default null`, `p_nombre text default null` | `json` (fila de `profiles`) | Admin |
| `desvincular_usuario` | `p_id uuid` | `void` | Admin |
| `kpis_accesos` | — | `json` | Admin |
| `kpis_admin` | — | `json` | Admin |
| `emitir_cuotas` | `p_concepto text`, `p_monto numeric`, `p_vence date` | `int` (cargos creados) | Admin |
| `registrar_dispositivo` | `p_token text`, `p_plataforma text` | `void` | Cualquier usuario con sesión y condominio (la app al iniciar sesión) |
| `quitar_dispositivo` | `p_token text` | `void` | Cualquier usuario con sesión (la app al cerrar sesión) |
| `correos_registrados` | `p_correos text[]` | `setof text` (correos en minúsculas) | Solo `service_role` (Edge Function `invitar`) |
| `marcar_vencidos` | — | `void` | Solo SQL Editor y `pg_cron` |
| `umbral_setup` | `p_condominio text`, `p_ciudad text`, `p_email_admin text` | `uuid` (id del condominio) | Solo SQL Editor |

**`validar_pase(p_codigo, p_punto)`** — La caseta valida un código (el panel y la app quitan el prefijo `UMBRAL:` del QR antes de llamarla).
Revisa en este orden: que exista, que esté activo, que la visita no esté en la lista negra (por nombre normalizado; no aplica al
código personal del residente), vigencia (`valido_desde`/`valido_hasta`), usos, día de la semana y horario, incluidos turnos que
cruzan la medianoche como 22:00–06:00 (zona `America/Hermosillo`). Si es válido suma un uso. **Siempre** escribe en la bitácora
`accesos`, también los rechazos. Devuelve `{permitido, motivo, visitante, tipo, unidad, autorizo, modalidad, dias, hora_inicio, hora_fin}`;
si el código no existe, solo `{permitido: false, motivo: "Código no encontrado"}`.

**`generar_codigo_personal()`** — Crea un pase tipo `residente` de un uso que vence en **30 segundos** y devuelve `{codigo, expira}`.
Falla con *"Usuario sin unidad"* si quien llama no tiene unidad. Dura poco para que una captura de pantalla no sirva como llave permanente.

**`en_lista_negra(p_nombre, p_placa)`** — Busca la primera coincidencia activa del condominio por nombre (minúsculas, sin acentos,
espacios colapsados) o por placa (solo letras y números, en mayúsculas). Devuelve `{restringido: false}` o
`{restringido: true, nombre, motivo}`.

**`vincular_usuario(p_email, p_rol, p_unidad, p_nombre)`** — Incorpora al condominio del admin una cuenta que ya existe en
Authentication (invitada con `invitar` o creada a mano). Falla si no existe la cuenta (*"…Invítala primero desde Usuarios →
Invitar"*), si pertenece a otro condominio, si la unidad no es del condominio o si es residente sin unidad. El panel la llama
después de cada invitación, también al importar un CSV.

**`correos_registrados(p_correos)`** — De una lista de correos (revisa hasta 300, sin distinguir mayúsculas ni espacios),
devuelve los que ya tienen cuenta en `auth.users`. Es `security definer` y no tiene permiso para `authenticated`: solo la
`service_role` la puede llamar, desde la Edge Function `invitar`. Así nadie con sesión puede averiguar qué correos están
registrados, incluidos los de otros condominios.

**`desvincular_usuario(p_id)`** — Saca a una persona del condominio (quita condominio y unidad, y la deja como `residente`).
No borra la cuenta. Un admin no puede desvincularse a sí mismo.

**`kpis_accesos()`** — `{accesos_hoy, denegados_hoy, pases_vigentes, unidades, usuarios, alertas_abiertas, tickets_abiertos,
paquetes_pendientes, avisos_mes, dias: [{dia, permitidos, denegados}]}` con los últimos 7 días.

**`kpis_admin()`** — `{cobrado_mes, cartera_vencida, unidades, unidades_al_corriente, accesos_hoy, tickets_abiertos,
paquetes_pendientes, meses: [{mes, ingresos, egresos}]}` con los últimos 6 meses. Solo suma pagos **confirmados** y cuenta como
vencido un cargo `vencido` o `pendiente` con fecha pasada.

**`emitir_cuotas(p_concepto, p_monto, p_vence)`** — Crea un cargo igual para cada unidad del condominio y devuelve cuántos creó.

**`registrar_dispositivo(p_token, p_plataforma)`** — Guarda el token de push (FCM) del teléfono para quien llama.
`p_plataforma` debe ser `android`, `ios`, `web` o `desktop`. Falla sin sesión, si la cuenta no tiene condominio o si el token
viene vacío. Si el token ya existía con otra cuenta (mismo teléfono, otra sesión), pasa a la cuenta actual: un token pertenece
a un solo perfil a la vez, para que nadie reciba los avisos de quien usó el teléfono antes.

**`quitar_dispositivo(p_token)`** — Borra ese token solo si es de quien llama. La app la llama **antes** de cerrar sesión,
porque sin sesión no sabría de quién es el token.

**`marcar_vencidos()`** — Pasa a `vencido` los cargos `pendiente` con `vence` anterior a hoy (Hermosillo). La programa `pg_cron`;
no está expuesta a la app ni al panel.

**`umbral_setup(p_condominio, p_ciudad, p_email_admin)`** — Configuración inicial: crea el condominio (o reutiliza uno con ese nombre)
y nombra administrador a la cuenta indicada, que debe existir en Authentication. No tiene permiso para `authenticated`,
para que nadie se autonombre administrador desde la app.

### Triggers de protección

| Trigger | Tabla | Qué hace |
|---|---|---|
| `trg_proteger_perfil` | `profiles` | Impide cambiar rol, condominio, unidad o correo; solo un admin, dentro de su condominio, y sin quitarse a sí mismo el rol |
| `trg_proteger_pase` | `pases` | Impide al residente crear pases tipo `residente` o con vigencia invertida, y modificar un pase; solo puede cancelarlo |
| `trg_proteger_pago` | `pagos` | Rechaza pagos de un cargo de otra unidad; los del residente quedan sin confirmar y solo uno pendiente por cargo |
| `trg_pago` | `pagos` | Marca el cargo como pagado solo cuando el pago está confirmado |
| `trg_proteger_ticket` | `tickets` | Impide al residente asignar estado, responsable o respuesta, o abrir tickets de otra unidad |
| `trg_validar_reservacion` | `reservaciones` | Rechaza reservaciones traslapadas en la misma área y fecha, o de un área de otro condominio |
| `trg_proteger_notificacion` (`proteger_notificacion`) | `notificaciones` | El destinatario solo puede cambiar `leida`; lo demás lo escribe la Edge Function `notificar` con la service role (sin `auth.uid()`) |
| `trg_limpiar_dispositivos` (`limpiar_dispositivos`) | `profiles` | Si alguien cambia o sale de condominio, borra sus dispositivos del condominio anterior para que deje de recibir sus avisos |
| `trg_limitar_alertas` (`limitar_alertas`) | `alertas`, antes de `INSERT` | Un residente puede crear como máximo 2 alertas cada 10 minutos (*"Ya enviaste una alerta hace poco; tu alerta ya llegó a caseta y al condominio"*); caseta y admin sin límite. Toma un candado por usuario para que dos envíos simultáneos no se salten el conteo |

Además, `reservaciones` tiene la restricción `reservas_horas_validas` (`hora_fin > hora_inicio`) y `dispositivos` la
restricción `dispositivos_plataforma_valida` (`android`, `ios`, `web` o `desktop`).

### Triggers de notificación (push)

Cada uno inserta una fila en `notificaciones` por destinatario; un **Database Webhook** en `INSERT` de esa tabla llama a la
Edge Function `notificar`, que la envía por Firebase Cloud Messaging y anota `enviada_at` o `error`. Los de acceso, paquete y
aviso solo notifican a perfiles con rol `residente`; el de alerta, a todo el condominio. El webhook no está en `schema.sql`: se crea a mano (ver
[`supabase/functions/notificar/README.md`](supabase/functions/notificar/README.md)).

| Trigger | Tabla y evento | Cuándo | A quién | Título | `datos.tipo` |
|---|---|---|---|---|---|
| `trg_notificar_acceso` (`notificar_acceso`) | `accesos`, después de `INSERT` | Acceso permitido, con unidad y tipo distinto de `residente` (visita, proveedor, paquetería, Airbnb) | Residentes de la unidad | *Tu visita llegó* (cuerpo: nombre y punto de acceso) | `acceso` + `acceso_id` |
| `trg_notificar_paquete` (`notificar_paquete`) | `paquetes`, después de `INSERT` | Paquete sin entregar | Residentes de la unidad | *Llegó un paquete* (cuerpo: paquetería y descripción) | `paquete` + `paquete_id` |
| `trg_notificar_aviso` (`notificar_aviso`) | `avisos`, después de `INSERT` | Siempre | Residentes con unidad del condominio, o solo los de la torre del aviso si tiene `torre` | Título del aviso (con *Importante:* si lo es); cuerpo recortado a 240 caracteres | `aviso` + `aviso_id` |
| `trg_notificar_alerta` (`notificar_alerta`) | `alertas`, después de `INSERT` | Siempre | Todos los perfiles del condominio (cualquier rol) con al menos un dispositivo registrado, menos quien la creó | *Alerta de emergencia* (cuerpo: el mensaje, o *Emergencia* si va vacío; si la creó un residente, antecedido por su unidad, `Casa 14: …`; máximo 240 caracteres) | `alerta` + `alerta_id` |

El acceso del propio residente (código personal) no notifica, para no avisarle de su propia entrada.
Con `datos.tipo = "alerta"`, `notificar` manda en Android `channel_id: "emergencias"` (el canal *Emergencias* de la app); las
demás llegan por el canal por defecto `umbral`.

### Tablas y acceso por rol (RLS)

Todas las tablas tienen RLS y se filtran por el condominio de quien consulta.

| Tabla | Residente | Guardia | Admin |
|---|---|---|---|
| `condominios`, `unidades` | Lee | Lee | Lee; edita unidades |
| `profiles` | Su perfil | Lee los del condominio; edita el suyo | Lee y edita los del condominio |
| `pases` | Los de su unidad (crea y cancela) | Todos | Todos |
| `accesos` (bitácora) | Los de su unidad | Lee y registra | Lee y registra |
| `lista_negra` | No la ve | Lee | Lee y edita |
| `alertas` | Lee; crea solo a su nombre (máx. 2 cada 10 min) | Lee, crea a su nombre y atiende | Lee, crea a su nombre y atiende |
| `cargos`, `pagos` | Los de su unidad; reporta pagos | Sin acceso | Todo; confirma pagos |
| `egresos` | Sin acceso | Sin acceso | Todo |
| `avisos` | Lee | Lee | Todo |
| `paquetes` | Los de su unidad | Todo | Todo |
| `tickets` | Los suyos y los de su unidad; crea | Crea y ve los suyos | Todo |
| `areas` | Lee | Lee | Todo |
| `reservaciones` | Lee; crea y borra las de su unidad | Lee | Lee, crea y borra |
| `encuestas` | Lee | Lee | Todo |
| `votos` | Lee los del condominio; vota por su unidad si la encuesta no ha cerrado | Lee | Lee |
| `dispositivos` (tokens de push) | Solo los suyos: lee, crea, edita y borra | Igual | Igual |
| `notificaciones` | Solo las suyas: lee y marca leída. No crea ni borra | Igual | Igual |

La vista `resultados_encuestas` usa `security_invoker`, así respeta el RLS de quien consulta.
El registro normal de `dispositivos` va por `registrar_dispositivo`. En `notificaciones` solo escriben los triggers
`notificar_*` y la Edge Function `notificar`; caseta y administración solo reciben filas de alertas.
En `alertas`, la política `al_ins` exige `condominio_id = my_condo()` y `creado_por = auth.uid()` (la columna toma `auth.uid()`
por defecto); `al_read` deja leer las del condominio y solo staff (`al_upd`) las marca atendidas.
Tiempo real (`supabase_realtime`): `accesos`, `alertas`, `paquetes`, `tickets`, `avisos`, `lista_negra` y `notificaciones`.

---

## Pendientes para producción

- **Conciliación SPEI automática:** hoy administración confirma a mano cada pago reportado. Para conciliar solo, conecta un
  proveedor con CLABEs por unidad (STP, Openpay, etc.) y registra el pago desde su webhook (una Edge Function de Supabase)
  validando el CEP de Banxico.
- **Pago con tarjeta:** la app llama a `reportarPago` con método `tarjeta`; falta integrar un procesador antes de esa llamada.
- **Push en iOS:** la base de datos y la Edge Function ya lo soportan; falta la parte nativa de la app en Xcode
  (ver `iosApp/PUSH_IOS.md` en Umbral-App).
- **Recuperar contraseña en la app:** el panel ya manda enlaces de recuperación (login y *Usuarios y roles*); la app móvil
  todavía no tiene su botón *¿Olvidaste tu contraseña?* (mientras, el residente puede pedirlo a administración).
- **Push a caseta y administración desde el navegador:** el panel web no registra dispositivos; las alertas solo les llegan por
  push si usan la app con sesión abierta (y en Android 13+ con el permiso de notificaciones concedido).
- **Fotos** en paquetes y tickets: las columnas `foto_url` ya existen.
- **Zona horaria configurable en SQL:** hoy `America/Hermosillo` está fija en `schema.sql`.

Historial de cambios: [CHANGELOG.md](CHANGELOG.md). Contexto para agentes: [CLAUDE.md](CLAUDE.md).
