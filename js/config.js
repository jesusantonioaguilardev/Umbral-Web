// Configura aquí tu proyecto de Supabase (Project Settings → API).
// Obligatorio: sin estos datos el panel no puede iniciar.
window.UMBRAL_CONFIG = {
  SUPABASE_URL: "https://shqlonhfxvlayhmshnzo.supabase.co",       // ej. "https://xxxx.supabase.co"
  SUPABASE_ANON_KEY: "sb_publishable_3Fpxg6yeBYXI_ZnW8F3Kmw_ygyavdDZ",  // clave pública "anon"
  PUNTO_ACCESO: "Acceso principal",
  // Control de accesos (unidades, usuarios, pases, caseta, bitácora y reportes) siempre está activo.
  // Mantén estos valores iguales a los de Config.kt en la app.
  MODULOS: {
    comunidad: true,   // avisos, paquetería, tickets, reservaciones y encuestas
    finanzas: false    // cobranza, pagos y egresos
  },
  ZONA_HORARIA: "America/Hermosillo"
};
