# CLAUDE.md · Umbral-Web

Panel web de Umbral (caseta y administración), página pública del pase y esquema de Supabase.
Repo hermano: `C:/Users/user/Desktop/Umbral-App` (app Kotlin Multiplatform). Ambos comparten **una sola** base de datos Supabase
y el esquema vive **solo aquí**. Guía para personas: [README.md](README.md). Cambios: [CHANGELOG.md](CHANGELOG.md).

## Arquitectura

- HTML, CSS y JS puro, sin build ni bundler. Librerías por CDN en `index.html` (supabase-js 2.45.4, html5-qrcode 2.3.8).
- Orden de carga (importa): `js/config.js` → `api.js` → `ui.js` → `caseta.js` → `admin.js` → `app.js`.
  Cada archivo expone un global: `window.UMBRAL_CONFIG`, `API`, `UI`, `Caseta`, `Admin`.
- `app.js` enruta por rol: `guardia` → `Caseta.mount`, `admin` → `Admin.mount`, `residente` → se le pide usar la app.
- Seguridad en la base de datos (RLS + triggers + RPC `security definer`), no en el cliente.
- Publicación: GitHub Pages sirve `main` en https://jesusantonioaguilardev.github.io/Umbral-Web/.

## Rutas clave

| Ruta | Qué es |
|---|---|
| `js/config.js` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PUNTO_ACCESO`, `MODULOS {comunidad, finanzas}`, `ZONA_HORARIA` |
| `js/api.js` | Única capa de datos: todas las consultas a tablas y `sb.rpc(...)` |
| `js/ui.js` | `esc` (escape HTML), `form`, `confirmDlg`, `toast`, `UI.zona` (fechas en la zona del condominio) |
| `js/caseta.js` | Panel del guardia: escaneo QR, visita sin pase, bitácora, paquetes, emergencia |
| `js/admin.js` | Panel admin: menú `TODAS` (filtrado por `MOD`), vistas por `id`, `REPORTES` |
| `pase.html` | Página pública: lee `?c=`, dibuja QR `UMBRAL:<código>`. No consulta la BD |
| `supabase/schema.sql` | Esquema completo e idempotente |
| `supabase/seed_pruebas.sql` | Datos de prueba, **gitignored** (tiene contraseñas). No lo agregues a git |

## Convenciones

- Todo texto de usuario en español de México. Toda interpolación en HTML pasa por `esc()` (XSS).
- Fechas: usa `UI.zona` (`hoy()`, `aUTC(dia, hora)`, `inicioDia`, `finDia`, `sumarDias`, `partes`), nunca `new Date()` con la
  zona del navegador ni `toISOString().slice(0,10)` para "hoy". `YYYY-MM-DD` = día civil en la zona del condominio.
- Vistas nuevas: entrada en `TODAS` de `admin.js` con `mod: "accesos" | "comunidad" | "finanzas"`, y su operación de datos en `api.js`.
- Cargo `pendiente` con `vence` pasado se trata como `vencido` (`vencer` en `api.js`), igual que `kpis_admin` y la app.
- `schema.sql`: cada cambio debe poder re-ejecutarse (`if not exists`, `create or replace`, `drop ... if exists` antes de crear
  triggers/políticas, `do $$ ... exception ... end $$` para enums y extensiones). Las políticas se borran y recrean todas.

## Contratos entre piezas

- **Config:** `js/config.js` y `Umbral-App/.../Config.kt` deben coincidir en `MODULOS` ↔ `MODULO_COMUNIDAD`/`MODULO_FINANZAS`
  y `ZONA_HORARIA`. La zona `America/Hermosillo` también está fija en `schema.sql` (funciones, default de `egresos.fecha`, cron).
- **QR:** formato `UMBRAL:<código>`. Caseta web y app quitan el prefijo antes de `validar_pase`.
- **Pase público:** la app arma `Config.URL_PASE_WEB + código` = `…/Umbral-Web/pase.html?c=<código>`. Si mueves o renombras
  `pase.html`, rompes los enlaces ya enviados por WhatsApp.
- **RPC usadas:** web → `validar_pase`, `en_lista_negra`, `kpis_admin`, `kpis_accesos`, `emitir_cuotas`, `vincular_usuario`,
  `desvincular_usuario`. App → `validar_pase`, `generar_codigo_personal`, `registrar_dispositivo`, `quitar_dispositivo`.
  Cambiar firma o forma del JSON exige revisar ambos repos.
- **Push:** triggers `notificar_*` insertan en `notificaciones`; un Database Webhook (fuera de `schema.sql`) llama a la Edge
  Function `supabase/functions/notificar`. `p_plataforma` ∈ `android|ios|web|desktop` (igual que `plataformaPush` de la app).
  Las claves `datos` (`tipo`, `*_id`) las lee la app; no las renombres sin cambiarla.
- **Pagos:** el residente inserta con `confirmado` forzado a `false` (trigger `proteger_pago`); el admin confirma con
  `update pagos set confirmado = true`; `on_pago` marca el cargo pagado. KPIs solo suman confirmados.
- Columnas que lee la app (`Models.kt`) no se renombran sin cambiar la app.

## Verificación

```bash
python -m http.server 8080                       # sirve el panel en http://localhost:8080
for f in js/*.js; do node --check "$f"; done   # sintaxis (node --check revisa un archivo a la vez)
git diff main..HEAD -- supabase/schema.sql      # revisa que lo nuevo sea idempotente
```

`.claude/launch.json` define la configuración `umbral-web` (mismo servidor en el puerto 8080).
No hay pruebas automáticas; prueba en el navegador con las cuentas y pases de `seed_pruebas.sql` (`PRUEBA1`–`PRUEBA3`).

## Reglas

- **Nunca ejecutes SQL contra el proyecto de Supabase de producción.** Entrega el SQL para que el usuario lo corra en el SQL Editor.
- **Sin secretos:** nada de `service_role`, contraseñas ni correos reales en código, docs o commits. En docs usa `https://xxxx.supabase.co`.
- No uses `service_role` en el cliente; toda regla de acceso va en RLS/triggers.
- `umbral_setup` y `marcar_vencidos` no se exponen a `authenticated`.
- Si un cambio requiere ejecutar `schema.sql`, dilo en el CHANGELOG: **(requiere ejecutar `supabase/schema.sql`)**.
- No cambies de rama ni hagas commit/push sin que lo pidan.

## Skills (`~/.claude/skills`)

| Skill | Cuándo |
|---|---|
| `umbral-vista-admin` | Página nueva o cambio en `admin.js`/`caseta.js` u operación en `api.js` |
| `umbral-migracion-idempotente` | Antes de tocar `schema.sql` |
| `umbral-checklist-rls` | Tablas, políticas, triggers, vistas o funciones `security definer` |
| `umbral-revision-contratos` | Después de cambios en BD, `api.js` o modelos de la app |
| `umbral-tokens-diseno` | Colores, tokens o modo oscuro en `css/styles.css` |
| `umbral-checklist-accesibilidad` | Diseñar o revisar pantallas |
| `umbral-changelog` | Registrar cambios en `CHANGELOG.md` |
