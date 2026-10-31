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
[3. Servir en local](#3-servir-el-panel-en-local) · [4. Publicar](#4-publicar-en-github-pages) · [Qué ve cada rol](#qué-ve-cada-rol) ·
[Referencia SQL](#referencia-de-la-base-de-datos) · [Pendientes](#pendientes-para-producción)

---

## Estructura

```
index.html                ← panel (login y enrutamiento por rol)
pase.html                 ← página pública que muestra el QR a la visita
css/styles.css            ← estilos y tokens (claro/oscuro)
js/config.js              ← configuración: Supabase, módulos, zona horaria
js/api.js                 ← todas las llamadas a Supabase (tablas y RPC)
js/ui.js                  ← utilidades de interfaz y zona horaria (UI.zona)
js/caseta.js              ← panel de caseta (guardia)
js/admin.js               ← panel administrativo
js/app.js                 ← arranque, login y ruteo por rol
supabase/schema.sql       ← esquema completo, idempotente
supabase/seed_pruebas.sql ← datos de prueba (solo local, NO versionado)
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
6. Entra al panel como administrador y da de alta lo demás:
   - **Unidades → + Unidad**.
   - Guardias y residentes: crea su cuenta en *Authentication → Add user* y luego, en **Usuarios y roles → + Agregar usuario**,
     escribe su correo, el rol y (para residentes) la unidad. El panel llama a `vincular_usuario`; no hace falta SQL.

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
  paquetería y botón de emergencia.
- **admin** → *Panel administrativo*: resumen con KPIs, unidades, usuarios y roles, bitácora con filtros y CSV, pases y proveedores,
  **lista negra**, reportes (CSV o PDF) y, según los módulos, comunicados, paquetería, tickets, reservaciones, encuestas,
  cobranza, pagos (con **Confirmar**) y egresos.
- **residente** → se le indica que use la app móvil.

### Por qué un pago queda "por confirmar"

Cuando el residente reporta una transferencia desde la app, solo escribe la clave de rastreo: Umbral todavía no concilia SPEI
automáticamente. Para no marcar un cargo como pagado sin verificar, el trigger `proteger_pago` guarda ese pago con
`confirmado = false` y el cargo sigue pendiente (en la app aparece **En revisión**). Cuando administración revisa la referencia
en su banco y pulsa **Confirmar**, el trigger `on_pago` marca el cargo como pagado. Los pagos que registra el administrador
quedan confirmados de inmediato, y `kpis_admin` solo suma pagos confirmados.

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
Authentication. Falla si no existe la cuenta, si pertenece a otro condominio, si la unidad no es del condominio o si es residente sin unidad.

**`desvincular_usuario(p_id)`** — Saca a una persona del condominio (quita condominio y unidad, y la deja como `residente`).
No borra la cuenta. Un admin no puede desvincularse a sí mismo.

**`kpis_accesos()`** — `{accesos_hoy, denegados_hoy, pases_vigentes, unidades, usuarios, alertas_abiertas, tickets_abiertos,
paquetes_pendientes, avisos_mes, dias: [{dia, permitidos, denegados}]}` con los últimos 7 días.

**`kpis_admin()`** — `{cobrado_mes, cartera_vencida, unidades, unidades_al_corriente, accesos_hoy, tickets_abiertos,
paquetes_pendientes, meses: [{mes, ingresos, egresos}]}` con los últimos 6 meses. Solo suma pagos **confirmados** y cuenta como
vencido un cargo `vencido` o `pendiente` con fecha pasada.

**`emitir_cuotas(p_concepto, p_monto, p_vence)`** — Crea un cargo igual para cada unidad del condominio y devuelve cuántos creó.

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

Además, `reservaciones` tiene la restricción `reservas_horas_validas` (`hora_fin > hora_inicio`).

### Tablas y acceso por rol (RLS)

Todas las tablas tienen RLS y se filtran por el condominio de quien consulta.

| Tabla | Residente | Guardia | Admin |
|---|---|---|---|
| `condominios`, `unidades` | Lee | Lee | Lee; edita unidades |
| `profiles` | Su perfil | Lee los del condominio; edita el suyo | Lee y edita los del condominio |
| `pases` | Los de su unidad (crea y cancela) | Todos | Todos |
| `accesos` (bitácora) | Los de su unidad | Lee y registra | Lee y registra |
| `lista_negra` | No la ve | Lee | Lee y edita |
| `alertas` | Lee y crea | Lee, crea y atiende | Lee, crea y atiende |
| `cargos`, `pagos` | Los de su unidad; reporta pagos | Sin acceso | Todo; confirma pagos |
| `egresos` | Sin acceso | Sin acceso | Todo |
| `avisos` | Lee | Lee | Todo |
| `paquetes` | Los de su unidad | Todo | Todo |
| `tickets` | Los suyos y los de su unidad; crea | Crea y ve los suyos | Todo |
| `areas` | Lee | Lee | Todo |
| `reservaciones` | Lee; crea y borra las de su unidad | Lee | Lee, crea y borra |
| `encuestas` | Lee | Lee | Todo |
| `votos` | Lee los del condominio; vota por su unidad si la encuesta no ha cerrado | Lee | Lee |

La vista `resultados_encuestas` usa `security_invoker`, así respeta el RLS de quien consulta.
Tiempo real (`supabase_realtime`): `accesos`, `alertas`, `paquetes`, `tickets`, `avisos` y `lista_negra`.

---

## Pendientes para producción

- **Conciliación SPEI automática:** hoy administración confirma a mano cada pago reportado. Para conciliar solo, conecta un
  proveedor con CLABEs por unidad (STP, Openpay, etc.) y registra el pago desde su webhook (una Edge Function de Supabase)
  validando el CEP de Banxico.
- **Pago con tarjeta:** la app llama a `reportarPago` con método `tarjeta`; falta integrar un procesador antes de esa llamada.
- **Notificaciones push** (paquete recibido, alerta de emergencia).
- **Fotos** en paquetes y tickets: las columnas `foto_url` ya existen.
- **Zona horaria configurable en SQL:** hoy `America/Hermosillo` está fija en `schema.sql`.

Historial de cambios: [CHANGELOG.md](CHANGELOG.md). Contexto para agentes: [CLAUDE.md](CLAUDE.md).
