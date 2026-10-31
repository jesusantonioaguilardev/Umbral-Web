# Edge Function `invitar` (invitar residentes y personal por correo)

Permite que el admin dé de alta personas desde el panel sin crear cuentas a mano en Authentication. El flujo es:

1. El panel llama a `invitar` con la sesión del admin y una lista de correos (máximo 300).
2. La función valida que quien llama sea **admin** de un condominio, normaliza los correos (trim y minúsculas) y revisa cuáles ya tienen cuenta (RPC `correos_registrados`, que solo puede usar el service role).
3. A cada correo nuevo le envía la invitación de Supabase Auth (`inviteUserByEmail`). El trigger `handle_new_user` le crea su perfil al instante.
4. **La función no vincula.** Después, el panel llama a `vincular_usuario(p_email, p_rol, p_unidad, p_nombre)` como admin para cada correo con estado `invitado` o `existente`. Esa RPC decide si se puede (por ejemplo, rechaza a alguien de otro condominio).

No guardes secretos reales en este repositorio. Todo va en `supabase secrets`.

## Contrato

```http
POST https://<project-ref>.supabase.co/functions/v1/invitar
Authorization: Bearer <jwt del admin>
Content-Type: application/json

{"correos": ["ana@example.com", "luis@example.com"]}
```

Respuesta `200`:

```json
{"resultados": [
  {"correo": "ana@example.com",  "estado": "invitado"},
  {"correo": "luis@example.com", "estado": "existente"},
  {"correo": "x@",               "estado": "error", "error": "Correo inválido"}
]}
```

- `invitado`: se envió el correo de invitación.
- `existente`: ya tenía cuenta. No se dice de qué condominio es: `vincular_usuario` lo decide.
- `error`: correo inválido, límite de envío alcanzado u otra falla (mensaje en español, sin datos internos).

Errores generales: `401` sin sesión o sesión inválida, `403` si no es admin con condominio, `400` si el body no trae `correos` o trae más de 300.

Desde el panel (supabase-js) basta con `sb.functions.invoke("invitar", { body: { correos } })`: manda el JWT de la sesión.

## 0. Requisitos

- Haber ejecutado `supabase/schema.sql` completo (crea la RPC `correos_registrados`).
- Supabase CLI con sesión y el proyecto vinculado (ver el paso 0 de `functions/notificar/README.md`).
- **SMTP propio** (Project Settings → Authentication → SMTP Settings). El correo integrado de Supabase solo manda unos pocos correos por hora; con eso una invitación masiva falla con "Se alcanzó el límite de correos por hora". Después ajusta el límite en Authentication → Rate Limits.

## 1. Secreto

```bash
supabase secrets set URL_BIENVENIDA=https://jesusantonioaguilardev.github.io/Umbral-Web/bienvenida.html
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los da el runtime.

## 2. Redirect URL

Dashboard → **Authentication → URL Configuration → Redirect URLs** → **Add URL**:

```
https://jesusantonioaguilardev.github.io/Umbral-Web/bienvenida.html
```

Si no está en la lista, Supabase ignora `redirectTo` y manda al invitado al Site URL.

## 3. Deploy

```bash
supabase functions deploy invitar
```

Sin `--no-verify-jwt`: la verificación de JWT queda **activa** (la llama un usuario con sesión). Compruébalo en Dashboard → Edge Functions → `invitar` → Details: "Enforce JWT Verification" encendido.

## 4. Plantilla de correo en español

Dashboard → **Authentication → Emails → Templates → Invite user**:

- Subject: `Te invitaron a Umbral`
- Body (HTML):

  ```html
  <h2>Bienvenido a Umbral</h2>
  <p>La administración de tu condominio te invitó a Umbral, la app para pases de visita, pagos y avisos.</p>
  <p><a href="{{ .ConfirmationURL }}">Aceptar invitación y crear mi contraseña</a></p>
  <p>Si no esperabas este correo, ignóralo.</p>
  ```

Conserva `{{ .ConfirmationURL }}`: es el enlace que abre `bienvenida.html` con la sesión del invitado para que defina su contraseña.

## 5. Probar

1. Inicia sesión en el panel como admin de prueba (`seed_pruebas.sql`) e invita un correo tuyo de prueba y uno ya existente (`residente1@example.com`).
2. Espera `invitado` y `existente`. En el SQL Editor: `select id, email, rol, condominio_id from profiles where email = '<correo invitado>';` (el perfil existe, sin condominio).
3. Vincúlalo desde el panel (o `vincular_usuario`) y vuelve a consultar: ya tiene condominio, rol y unidad.
4. Con un residente o guardia, la función responde `403`. Sin sesión, el gateway responde `401`.
5. Logs: Dashboard → Edge Functions → `invitar` → Logs, o `supabase functions logs invitar`.
