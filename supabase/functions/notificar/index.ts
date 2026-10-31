// Umbral · Edge Function "notificar"
// La dispara un Database Webhook en INSERT de public.notificaciones. Envía el push con FCM HTTP v1
// a cada dispositivo del destinatario y marca enviada_at o error en la fila.
//
// Secretos (supabase secrets set): FIREBASE_SERVICE_ACCOUNT (JSON completo), NOTIFICAR_SECRETO.
// El runtime da SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";

const HEADER_SECRETO = "x-notificar-secreto";

type Notificacion = {
  id: number;
  condominio_id: string;
  profile_id: string;
  titulo: string;
  cuerpo: string | null;
  datos: Record<string, unknown> | null;
  enviada_at: string | null;
};

type CuentaServicio = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// ---------- Utilidades ----------
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Comparación en tiempo constante para el secreto compartido
function igualSeguro(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function base64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemADer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// ---------- OAuth2 de Google (JWT RS256 firmado con la cuenta de servicio) ----------
let cuenta: CuentaServicio | null = null;
let accessToken: { valor: string; expira: number } | null = null;

function leerCuenta(): CuentaServicio {
  if (cuenta) return cuenta;
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) throw new Error("Falta el secreto FIREBASE_SERVICE_ACCOUNT");
  const c = JSON.parse(raw) as CuentaServicio;
  if (!c.project_id || !c.client_email || !c.private_key) throw new Error("FIREBASE_SERVICE_ACCOUNT incompleto");
  // Si el JSON se pegó con "\n" literales en la llave, los convierte en saltos reales
  c.private_key = c.private_key.replace(/\\n/g, "\n");
  cuenta = c;
  return c;
}

async function obtenerAccessToken(): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000);
  if (accessToken && accessToken.expira - 60 > ahora) return accessToken.valor;

  const c = leerCuenta();
  const tokenUri = c.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: c.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenUri,
    iat: ahora,
    exp: ahora + 3600,
  }));
  const llave = await crypto.subtle.importKey(
    "pkcs8",
    pemADer(c.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", llave, new TextEncoder().encode(`${header}.${claims}`)),
  );
  const jwt = `${header}.${claims}.${base64url(firma)}`;

  const r = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!r.ok) throw new Error(`OAuth de Google respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const t = await r.json() as { access_token: string; expires_in: number };
  accessToken = { valor: t.access_token, expira: ahora + (t.expires_in ?? 3600) };
  return t.access_token;
}

// ---------- Envío FCM HTTP v1 ----------
type Resultado = { ok: true } | { ok: false; tokenInvalido: boolean; detalle: string };

async function enviarFcm(token: string, n: Notificacion): Promise<Resultado> {
  const c = leerCuenta();
  // FCM exige que data sea un mapa de strings
  const data: Record<string, string> = { notificacion_id: String(n.id) };
  for (const [k, v] of Object.entries(n.datos ?? {})) {
    if (v !== null && v !== undefined) data[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  const mensaje = {
    message: {
      token,
      notification: { title: n.titulo, body: n.cuerpo ?? "" },
      data,
      android: { priority: "HIGH" },
      apns: { payload: { aps: { sound: "default" } } },
    },
  };

  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await obtenerAccessToken()}` },
    body: JSON.stringify(mensaje),
  });
  if (r.ok) return { ok: true };

  const texto = await r.text();
  let status = "";
  let codigos: string[] = [];
  let mensajeError = texto;
  try {
    const e = JSON.parse(texto).error ?? {};
    status = e.status ?? "";
    mensajeError = e.message ?? texto;
    codigos = (e.details ?? []).map((d: { errorCode?: string }) => d.errorCode).filter(Boolean);
  } catch { /* respuesta no JSON */ }

  // UNREGISTERED: la app se desinstaló o el token caducó.
  // INVALID_ARGUMENT: solo cuenta como token inválido si FCM se refiere al token; si es el mensaje, no borramos nada.
  const unregistered = codigos.includes("UNREGISTERED") || status === "UNREGISTERED";
  const argumentoInvalido = (codigos.includes("INVALID_ARGUMENT") || status === "INVALID_ARGUMENT") &&
    /registration token|message\.token/i.test(mensajeError);
  return {
    ok: false,
    tokenInvalido: unregistered || argumentoInvalido,
    detalle: `${r.status} ${codigos[0] ?? status}: ${mensajeError}`.slice(0, 300),
  };
}

// ---------- Handler del webhook ----------
Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  const secreto = Deno.env.get("NOTIFICAR_SECRETO");
  if (!secreto) return json(500, { error: "Falta el secreto NOTIFICAR_SECRETO" });
  if (!igualSeguro(req.headers.get(HEADER_SECRETO) ?? "", secreto)) return json(401, { error: "No autorizado" });

  let body: { type?: string; table?: string; schema?: string; record?: Notificacion };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }
  if (body.type !== "INSERT" || body.table !== "notificaciones" || !body.record?.id) {
    return json(200, { ignorado: true });
  }

  // Relee la fila desde la BD: no confiamos en el contenido del payload más allá del id
  const { data: n, error: errN } = await supabase
    .from("notificaciones")
    .select("id, condominio_id, profile_id, titulo, cuerpo, datos, enviada_at")
    .eq("id", body.record.id)
    .maybeSingle();
  if (errN) return json(500, { error: errN.message });
  if (!n) return json(200, { ignorado: true, motivo: "No existe" });
  if (n.enviada_at) return json(200, { ignorado: true, motivo: "Ya enviada" });

  const marcar = async (cambios: { enviada_at?: string; error?: string | null }) => {
    const { error } = await supabase.from("notificaciones").update(cambios).eq("id", n.id);
    if (error) console.error("No se pudo marcar la notificación", n.id, error.message);
  };

  const { data: dispositivos, error: errD } = await supabase
    .from("dispositivos")
    .select("id, token")
    .eq("profile_id", n.profile_id)
    .eq("condominio_id", n.condominio_id);
  if (errD) {
    await marcar({ error: `Dispositivos: ${errD.message}` });
    return json(500, { error: errD.message });
  }
  if (!dispositivos || dispositivos.length === 0) {
    await marcar({ error: "Sin dispositivos registrados" });
    return json(200, { enviados: 0, motivo: "Sin dispositivos" });
  }

  let enviados = 0;
  const errores: string[] = [];
  const invalidos: string[] = [];
  try {
    for (const d of dispositivos) {
      const r = await enviarFcm(d.token, n as Notificacion);
      if (r.ok) enviados++;
      else {
        errores.push(r.detalle);
        if (r.tokenInvalido) invalidos.push(d.id);
      }
    }
  } catch (e) {
    // Falla de configuración (cuenta de servicio, OAuth): se guarda en la fila
    const msg = e instanceof Error ? e.message : String(e);
    await marcar({ error: msg.slice(0, 500) });
    return json(500, { error: msg });
  }

  if (invalidos.length > 0) {
    const { error } = await supabase.from("dispositivos").delete().in("id", invalidos);
    if (error) console.error("No se pudieron borrar dispositivos inválidos", error.message);
  }

  if (enviados > 0) {
    await marcar({ enviada_at: new Date().toISOString(), error: errores.length ? errores.join(" | ").slice(0, 500) : null });
  } else {
    await marcar({ error: errores.join(" | ").slice(0, 500) || "No se pudo enviar" });
  }
  return json(200, { enviados, fallidos: errores.length, tokens_borrados: invalidos.length });
});
