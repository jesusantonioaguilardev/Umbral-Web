// Umbral · Edge Function "invitar"
// La llama el panel de administración con la sesión del admin (verify JWT activado).
// Envía la invitación de Supabase Auth a cada correo nuevo. NO vincula: después el panel llama a la RPC
// vincular_usuario como admin, que valida condominio, rol y unidad con la lógica que ya existe en schema.sql.
//
// Request:  POST  Authorization: Bearer <jwt del admin>   body {"correos": ["a@b.com", ...]}  (máximo 300)
// Response: {"resultados": [{"correo", "estado": "invitado" | "existente" | "error", "error"?}]}
//
// Secretos (supabase secrets set): URL_BIENVENIDA. El runtime da SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_CORREOS = 300;
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Estado = "invitado" | "existente" | "error";
type Resultado = { correo: string; estado: Estado; error?: string };

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// El panel vive en otro dominio (GitHub Pages): hace falta CORS. El JWT es lo que protege la función.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Mensajes en español sin datos internos
function mensajeError(e: { status?: number; code?: string } | null): string {
  const code = e?.code ?? "";
  if (e?.status === 429 || code.includes("rate_limit")) return "Se alcanzó el límite de correos por hora. Intenta más tarde.";
  if (code === "email_address_invalid") return "Correo inválido";
  return "No se pudo enviar la invitación";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  // ---------- Quién llama: debe ser admin con condominio ----------
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json(401, { error: "Inicia sesión" });
  const { data: u, error: errU } = await supabase.auth.getUser(jwt);
  if (errU || !u?.user) return json(401, { error: "Sesión inválida" });

  const { data: perfil, error: errP } = await supabase
    .from("profiles").select("rol, condominio_id").eq("id", u.user.id).maybeSingle();
  if (errP) return json(500, { error: "No se pudo validar tu cuenta" });
  if (!perfil || perfil.rol !== "admin" || !perfil.condominio_id) return json(403, { error: "Solo administración" });

  // ---------- Body ----------
  let body: { correos?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }
  if (!Array.isArray(body.correos) || body.correos.length === 0) return json(400, { error: "Manda una lista de correos" });
  if (body.correos.length > MAX_CORREOS) return json(400, { error: `Máximo ${MAX_CORREOS} correos por invitación` });

  // Normaliza (trim + lowercase) y quita repetidos conservando el orden
  const correos = [...new Set(body.correos.map((c) => String(c ?? "").trim().toLowerCase()))];
  const resultados: Resultado[] = [];
  const validos = correos.filter((c) => {
    if (REGEX_CORREO.test(c) && c.length <= 254) return true;
    resultados.push({ correo: c, estado: "error", error: "Correo inválido" });
    return false;
  });

  // ---------- Cuáles ya tienen cuenta (RPC solo para service role) ----------
  let existentes = new Set<string>();
  if (validos.length > 0) {
    const { data, error } = await supabase.rpc("correos_registrados", { p_correos: validos });
    if (error) {
      console.error("correos_registrados", error.message);
      return json(500, { error: "No se pudieron revisar los correos" });
    }
    const lista = (data ?? []) as string[];
    existentes = new Set(lista.map((c) => String(c).toLowerCase()));
  }

  // ---------- Invitaciones (en serie, para no disparar el límite de envío) ----------
  const redirectTo = Deno.env.get("URL_BIENVENIDA") || undefined;
  for (const correo of validos) {
    if (existentes.has(correo)) {
      resultados.push({ correo, estado: "existente" });
      continue;
    }
    const { error } = await supabase.auth.admin.inviteUserByEmail(correo, { redirectTo });
    if (!error) resultados.push({ correo, estado: "invitado" });
    else if (error.code === "email_exists" || (error.status === 422 && /registered|exists/i.test(error.message))) {
      resultados.push({ correo, estado: "existente" });   // se registró entre la revisión y la invitación
    } else {
      console.error("inviteUserByEmail", error.status, error.code);
      resultados.push({ correo, estado: "error", error: mensajeError(error) });
    }
  }

  return json(200, { resultados });
});
