# Edge Function `notificar` (push con Firebase Cloud Messaging)

Envía las notificaciones push de Umbral. El flujo es:

1. Un trigger de `schema.sql` inserta una fila en `public.notificaciones` (visita que entró, paquete recibido, aviso nuevo o alerta de emergencia).
2. Un **Database Webhook** de Supabase en `INSERT` de `notificaciones` llama a esta función.
3. La función lee los tokens del destinatario en `public.dispositivos`, envía con **FCM HTTP v1** y marca `enviada_at` (o `error`) en la fila.
4. Si FCM responde `UNREGISTERED` (o `INVALID_ARGUMENT` referido al token), borra ese dispositivo.

No guardes secretos reales en este repositorio. Todo va en `supabase secrets`.

## 0. Requisitos

- [Supabase CLI](https://supabase.com/docs/guides/cli) instalado y con sesión: `supabase login`.
- Haber ejecutado `supabase/schema.sql` completo en el SQL Editor (crea `dispositivos`, `notificaciones` y los triggers).
- Desde la carpeta `Umbral-Web`, vincular el proyecto (una sola vez; `<project-ref>` está en Project Settings → General):

  ```bash
  supabase link --project-ref <project-ref>
  ```

  Si el CLI pide `supabase/config.toml`, ejecuta antes `supabase init` en `Umbral-Web` (no toca `schema.sql`).

## 1. Cuenta de servicio de Firebase

1. Firebase Console → tu proyecto → Configuración del proyecto → **Cuentas de servicio** → **Generar nueva clave privada**. Se descarga un JSON.
2. Guárdalo **fuera** del repositorio (por ejemplo en `Descargas`). No lo subas a git.
3. Verifica que la API **Firebase Cloud Messaging API (V1)** esté habilitada (Configuración del proyecto → Cloud Messaging).

## 2. Secretos

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya los da el runtime; no hace falta ponerlos.

```bash
# JSON completo de la cuenta de servicio (lee el archivo descargado)
supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat /ruta/a/umbral-firebase-adminsdk.json)"

# Secreto compartido con el webhook: genera uno largo y aleatorio
supabase secrets set NOTIFICAR_SECRETO="$(openssl rand -hex 32)"

# Comprueba que existen (solo muestra el hash, no el valor)
supabase secrets list
```

En PowerShell:

```powershell
supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(Get-Content -Raw C:\ruta\a\umbral-firebase-adminsdk.json)"
$s = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) }); supabase secrets set NOTIFICAR_SECRETO=$s; $s
```

Anota el valor de `NOTIFICAR_SECRETO`: lo vas a pegar en el webhook (paso 4). Si PowerShell rompe las comillas del JSON, usa en su lugar un archivo `.env` fuera del repo con `FIREBASE_SERVICE_ACCOUNT=...` en una sola línea y `supabase secrets set --env-file C:\ruta\secretos.env`.

## 3. Deploy

```bash
supabase functions deploy notificar --no-verify-jwt
```

`--no-verify-jwt` es necesario porque el webhook no manda un JWT de usuario. La función se protege con el header `x-notificar-secreto`: sin él (o con otro valor) responde `401`.

## 4. Database Webhook

Dashboard de Supabase → **Database → Webhooks** (si no aparece, primero **Enable webhooks**) → **Create a new hook**:

| Campo | Valor |
|---|---|
| Name | `notificar_push` |
| Table | `public.notificaciones` |
| Events | solo **Insert** |
| Type of webhook | **Supabase Edge Functions** |
| Edge Function | `notificar` |
| Method | `POST` |
| Timeout | `5000` ms (o más si un usuario tiene muchos dispositivos) |
| HTTP Headers | `Content-Type: application/json` (ya viene) y **Add a new header**: `x-notificar-secreto` = el valor de `NOTIFICAR_SECRETO` |

No agregues el header `Authorization` con la service role key: no hace falta (la función se despliega con `--no-verify-jwt`).

El webhook queda como un trigger sobre `notificaciones` en la base. Volver a ejecutar `schema.sql` no lo borra (el esquema solo recrea sus propios triggers `trg_*`).

## 5. Probar

1. Inicia sesión en la app con un residente (por ejemplo `residente1@example.com` de `seed_pruebas.sql`) en un teléfono o emulador con Google Play. La app llama a `registrar_dispositivo`.
2. En el SQL Editor confirma el token: `select profile_id, plataforma, updated_at from dispositivos;`
3. Desde caseta registra un paquete para Casa 1 (o publica un aviso desde administración).
4. Revisa la fila:

   ```sql
   select id, titulo, cuerpo, enviada_at, error from notificaciones order by id desc limit 5;
   ```

   - `enviada_at` con fecha: llegó a FCM.
   - `error = 'Sin dispositivos registrados'`: el residente no tiene token (no abrió la app o cerró sesión).
   - Otro `error`: mensaje de FCM u OAuth (por ejemplo, la cuenta de servicio es de otro proyecto de Firebase).
5. Logs de la función: Dashboard → Edge Functions → `notificar` → Logs, o `supabase functions logs notificar`.

Para probar la función sin webhook (sustituye los valores; no los guardes en archivos):

```bash
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/notificar" \
  -H "Content-Type: application/json" -H "x-notificar-secreto: <NOTIFICAR_SECRETO>" \
  -d '{"type":"INSERT","table":"notificaciones","schema":"public","record":{"id":<id de una notificación>}}'
```

La función solo usa el `id` del payload y relee la fila desde la base; si ya tiene `enviada_at`, la ignora.

## Mensaje que recibe la app

```json
{
  "notification": { "title": "Llegó un paquete", "body": "Recógelo en caseta · Amazon" },
  "data": { "notificacion_id": "123", "tipo": "paquete", "paquete_id": "<uuid>" }
}
```

`data.tipo` es `acceso` (con `acceso_id`), `paquete` (con `paquete_id`), `aviso` (con `aviso_id`) o `alerta` (con `alerta_id`, alerta de emergencia para todo el condominio). Todos los valores de `data` son strings. En Android se envía con prioridad alta. Las de `tipo = "alerta"` llevan `android.notification.channel_id = "emergencias"` (canal *Emergencias* de la app, con vibración) para que se vean con ese canal aunque la app esté en segundo plano; las demás van sin `channel_id` y usan el canal por defecto que la app declara en el manifest con `com.google.firebase.messaging.default_notification_channel_id` (`umbral`). Si cambias `index.ts`, vuelve a desplegar con `supabase functions deploy notificar --no-verify-jwt`.

## Rotar secretos

- Cuenta de servicio: genera una clave nueva en Firebase, `supabase secrets set FIREBASE_SERVICE_ACCOUNT=...` y borra la clave vieja en Firebase.
- `NOTIFICAR_SECRETO`: cámbialo con `supabase secrets set` y actualiza el header del webhook en el mismo momento.
