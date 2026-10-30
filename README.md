# Umbral · Plataforma para condominios

Control de accesos con QR, cuotas y cobranza, comunidad y reportes financieros.
Tres piezas sobre una sola base de datos (Supabase):

| Pieza | Para quién | Tecnología |
|---|---|---|
| `mobile/` App móvil | Residentes (y guardias, en modo caseta) | Kotlin Multiplatform + Compose Multiplatform (Android, iOS y escritorio) |
| `web/` Panel web | **Seguridad en la pluma** y **Administración**: cambia según quién inicia sesión | HTML, CSS y JS puro |
| `supabase/schema.sql` | Base de datos, roles, seguridad (RLS) y funciones | Postgres |

No incluye datos de ejemplo: todo arranca vacío y se llena con la operación real. Sin las claves de Supabase, la app y el panel muestran un aviso para configurarlas.

---

## 1. Base de datos (Supabase)

1. Crea un proyecto en supabase.com.
2. Abre **SQL Editor**, pega `supabase/schema.sql` y ejecútalo (se puede volver a ejecutar sin romper nada).
3. En **Authentication → Users → Add user** crea la cuenta del administrador (marca *Auto Confirm User*).
4. De vuelta en el SQL Editor:
   ```sql
   select umbral_setup('Residencial Las Palmas', 'Hermosillo', 'admin@tucorreo.com');
   ```
5. Entra al panel web como admin y da de alta lo demás:
   - **Unidades → + Unidad**
   - Guardias y residentes: crea su cuenta en *Authentication → Add user* y luego en **Usuarios y roles → + Agregar usuario**
     escribe ese correo, el rol y (para residentes) su unidad. Ya no hace falta SQL.

Funciones incluidas:

- `validar_pase(codigo)`: la caseta valida un QR (vigencia, días, horario —incluye turnos nocturnos como 22:00–06:00—, usos) y lo guarda en la bitácora.
- `generar_codigo_personal()`: código del residente que dura 30 segundos.
- `vincular_usuario(email, rol, unidad)` / `desvincular_usuario(id)`: el admin agrega o quita personas de su condominio.
- `kpis_accesos()`: accesos y denegados de hoy, pases vigentes y actividad de 7 días.
- `umbral_setup(condominio, ciudad, email)`: configuración inicial, solo desde el SQL Editor.
- Cobranza (si `SOLO_ACCESOS = false`): `emitir_cuotas`, `kpis_admin`, `marcar_vencidos`.

Seguridad: RLS por condominio y rol, y triggers que impiden que un residente se cambie de rol/unidad o altere usos y vigencia de sus pases (solo puede cancelarlos).

### Módulos

En `web/js/config.js` (`MODULOS`) y en `Config.kt` (`MODULO_COMUNIDAD`, `MODULO_FINANZAS`); mantenlos iguales.
Control de accesos siempre está activo: Resumen, Unidades, **Reportes**, Bitácora, Pases y Usuarios.

- `comunidad: true` → Avisos (con imagen o PDF adjunto, por torre, importantes), Paquetería, Tickets, Reservaciones y Encuestas.
  En la app aparece la pestaña Comunidad y en caseta la recepción de paquetes. Los adjuntos van al bucket `avisos` de Supabase Storage (lo crea `schema.sql`).
- `finanzas: true` → Cobranza, Pagos y Egresos; en la app, la pestaña Pagos.

### Reportes

Panel admin → **Reportes**: elige el tipo (bitácora de accesos, pases, alertas, usuarios, unidades, avisos, paquetería, tickets,
reservaciones y, con finanzas, pagos/cargos/egresos), el periodo y la unidad. Muestra un resumen (totales, hora pico, motivo de rechazo
más común…) y la tabla, y se exporta a **CSV** (Excel) o **PDF** (Imprimir → Guardar como PDF).

### Datos de prueba

`supabase/seed_pruebas.sql` deja al admin listo y crea Casa 1/Casa 2, un guardia, dos residentes y los pases PRUEBA1/PRUEBA2.
No lo publiques: contiene la contraseña de las cuentas de prueba.

## 2. Panel web (`web/`)

1. Edita `web/js/config.js` con `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
2. Súbelo a cualquier hosting estático (Netlify, Vercel, Firebase Hosting, un servidor propio) o pruébalo local:
   `cd web && python3 -m http.server 8080` → http://localhost:8080
3. Al iniciar sesión:
   - **guardia** → *Panel de caseta*: escaneo de QR con la cámara (o código a mano), resultado grande en verde o rojo,
     bitácora del día en tiempo real, visitantes esperados hoy, visita sin pase, recepción y entrega de paquetes, botón de emergencia.
   - **admin** → *Panel administrativo*: resumen con KPIs y gráfica, cobranza por unidad, estado de cuenta, registro de pagos,
     egresos, bitácora con filtros y exportación CSV, proveedores recurrentes, avisos, paquetería, tickets, reservaciones,
     encuestas y usuarios/roles.
   - **residente** → se le indica que use la app móvil.

`web/pase.html?c=CODIGO` es la página que recibe la visita por WhatsApp para mostrar su QR sin instalar nada.

> La cámara del navegador requiere **HTTPS** (o `localhost`).

## 3. App móvil (`mobile/`)

Requisitos: Android Studio (Ladybug o más reciente) con el plugin *Kotlin Multiplatform*, JDK 17; Xcode 15+ para iOS.

1. Edita `composeApp/src/commonMain/kotlin/mx/umbral/app/Config.kt` (URL, anon key y la URL de `pase.html`).
2. **Android:** abre `mobile/` en Android Studio y ejecuta la configuración `composeApp`.
3. **Escritorio (prueba rápida):** `./gradlew :composeApp:run`
4. **iOS:** crea un proyecto de Xcode en `mobile/iosApp` (o usa el asistente de kmp.jetbrains.com y copia `iosApp/iosApp/*.swift`),
   agrega una *Run Script Phase* con
   `cd "$SRCROOT/.." && ./gradlew :composeApp:embedAndSignAppleFrameworkForXcode`
   y en *Framework Search Paths* `$(SRCROOT)/../composeApp/build/xcode-frameworks/$(CONFIGURATION)/$(SDK_NAME)`.

Pantallas del residente: **Inicio** (saldo, paquetes, avisos, últimos accesos) · **Accesos** (crear pase de una vez o recurrente,
QR, compartir por WhatsApp, cancelar) · **Pagos** (estado de cuenta, CLABE SPEI, reportar pago) · **Comunidad** (avisos, paquetes,
tickets, reservaciones, encuestas) · **Perfil** (código personal dinámico de 30 s).
Si entra un **guardia**, la app cambia a *modo caseta* (validar código y bitácora del día).

Estructura:

```
composeApp/src/commonMain/kotlin/mx/umbral/app/
  App.kt                 ← elige pantalla según el rol
  Config.kt
  data/                  ← modelos, Repository, SupabaseRepository
  ui/login, ui/residente, ui/caseta, ui/Theme.kt, ui/Components.kt
  util/Fechas.kt
androidMain / iosMain / desktopMain ← punto de entrada y "compartir" nativo
```

## Pendientes para producción

- **Conciliación SPEI automática:** hoy el residente reporta su pago con la clave de rastreo y el cargo se marca pagado.
  Para conciliar solo, conecta un proveedor con CLABEs por unidad (STP, Openpay, etc.) y registra el pago desde su webhook
  (una Edge Function de Supabase) validando el CEP de Banxico. Restringe entonces el insert de `pagos` a ese servicio.
- **Pago con tarjeta:** el botón llama a `reportarPago("tarjeta")`; integra Stripe, Conekta u Openpay antes de esa llamada.
- **Notificaciones push** (paquete recibido, alerta de emergencia): Firebase Cloud Messaging + trigger en `paquetes`/`alertas`.
- **Fotos** en paquetes y tickets: Supabase Storage (las columnas `foto_url` ya existen).
- **Escaneo con cámara en la app:** hoy el escaneo con cámara vive en el panel web de caseta; en la app el guardia teclea el código.
- `marcar_vencidos()` conviene programarla diario con `pg_cron`.
