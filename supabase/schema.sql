-- =====================================================================
-- Umbral · Plataforma de administración de condominios
-- Esquema para Supabase (Postgres). Ejecutar en SQL Editor.
-- Roles: residente · guardia · admin
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tipos ----------
do $$ begin
  create type rol_usuario   as enum ('residente','guardia','admin');
  create type tipo_acceso   as enum ('visita','proveedor','paqueteria','airbnb','residente');
  create type modalidad_pase as enum ('una_vez','recurrente');
  create type estado_cargo  as enum ('pendiente','pagado','vencido');
  create type estado_ticket as enum ('abierto','en_proceso','cerrado');
exception when duplicate_object then null; end $$;

-- ---------- Estructura ----------
create table if not exists condominios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  ciudad text,
  created_at timestamptz default now()
);

create table if not exists unidades (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  nombre text not null,              -- "Casa 14", "Torre B · 302"
  torre text,
  clabe text,                        -- CLABE de referencia para SPEI
  propietario text,
  created_at timestamptz default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default '',
  rol rol_usuario not null default 'residente',
  condominio_id uuid references condominios(id),
  unidad_id uuid references unidades(id),
  telefono text,
  created_at timestamptz default now()
);
alter table profiles add column if not exists email text;

-- Perfil automático al registrarse
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, nombre, email)
    values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email,'@',1)), new.email);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Usuarios creados antes de este esquema: completa su perfil
insert into profiles (id, nombre, email)
  select u.id, coalesce(u.raw_user_meta_data->>'nombre', split_part(u.email,'@',1)), u.email
  from auth.users u where not exists (select 1 from profiles p where p.id = u.id);
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- ---------- Helpers de seguridad ----------
create or replace function my_rol() returns rol_usuario
language sql stable security definer set search_path = public as
$$ select rol from profiles where id = auth.uid() $$;

create or replace function my_condo() returns uuid
language sql stable security definer set search_path = public as
$$ select condominio_id from profiles where id = auth.uid() $$;

create or replace function my_unidad() returns uuid
language sql stable security definer set search_path = public as
$$ select unidad_id from profiles where id = auth.uid() $$;

create or replace function es_staff() returns boolean
language sql stable as $$ select coalesce(my_rol() in ('guardia','admin'), false) $$;

-- Nadie puede subirse de rol ni cambiarse de condominio/unidad: solo un admin, y dentro de su condominio.
-- auth.uid() nulo = SQL Editor / service role (configuración inicial).
create or replace function proteger_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_setting('umbral.interno', true) = '1' then return new; end if;
  new.email := old.email;
  if (new.rol, new.condominio_id, new.unidad_id) is distinct from (old.rol, old.condominio_id, old.unidad_id) then
    if my_rol() is distinct from 'admin' then raise exception 'Solo administración puede cambiar rol o unidad'; end if;
    if new.condominio_id is distinct from my_condo() then raise exception 'Usuario de otro condominio'; end if;
    if new.id = auth.uid() and new.rol <> 'admin' then raise exception 'No puedes quitarte el rol de administrador'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_perfil on profiles;
create trigger trg_proteger_perfil before update on profiles
  for each row execute function proteger_perfil();

-- ---------- Control de accesos ----------
create table if not exists pases (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default upper(encode(gen_random_bytes(6),'hex')),
  condominio_id uuid not null references condominios(id),
  unidad_id uuid not null references unidades(id),
  creado_por uuid references profiles(id),
  visitante text not null,
  tipo tipo_acceso not null default 'visita',
  modalidad modalidad_pase not null default 'una_vez',
  dias smallint[] default null,      -- 1=Lun … 7=Dom (recurrentes)
  hora_inicio time,
  hora_fin time,
  valido_desde timestamptz not null default now(),
  valido_hasta timestamptz not null default now() + interval '1 day',
  usos_max int default 1,            -- null = ilimitado
  usos int not null default 0,
  activo boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists accesos (            -- bitácora
  id bigserial primary key,
  condominio_id uuid not null references condominios(id),
  pase_id uuid references pases(id),
  unidad_id uuid references unidades(id),
  nombre text not null,
  tipo tipo_acceso not null,
  permitido boolean not null,
  motivo text,
  autorizo text,
  guardia_id uuid references profiles(id),
  punto text default 'Acceso principal',
  created_at timestamptz default now()
);

create table if not exists alertas (
  id bigserial primary key,
  condominio_id uuid not null references condominios(id),
  mensaje text not null,
  creado_por uuid references profiles(id),
  atendida boolean default false,
  created_at timestamptz default now()
);

create index if not exists accesos_condo_fecha on accesos(condominio_id, created_at desc);
create index if not exists pases_unidad on pases(unidad_id, created_at desc);

-- El residente solo puede cancelar sus pases; usos y vigencia los controla caseta/administración
create or replace function proteger_pase() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or es_staff() or current_setting('umbral.interno', true) = '1' then return new; end if;
  if tg_op = 'INSERT' then
    new.usos := 0; new.activo := true; new.creado_por := auth.uid();
    if new.tipo = 'residente' then raise exception 'Tipo de pase no permitido'; end if;
    if new.valido_hasta <= new.valido_desde then raise exception 'La vigencia termina antes de empezar'; end if;
  elsif row(new.*) is distinct from row(old.*) then
    if new.activo or (new.codigo, new.unidad_id, new.visitante, new.tipo, new.modalidad, new.dias, new.hora_inicio,
        new.hora_fin, new.valido_desde, new.valido_hasta, new.usos_max, new.usos)
       is distinct from (old.codigo, old.unidad_id, old.visitante, old.tipo, old.modalidad, old.dias, old.hora_inicio,
        old.hora_fin, old.valido_desde, old.valido_hasta, old.usos_max, old.usos) then
      raise exception 'Solo puedes cancelar el pase';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_pase on pases;
create trigger trg_proteger_pase before insert or update on pases
  for each row execute function proteger_pase();

-- Valida un QR en caseta, registra en bitácora y devuelve el resultado
create or replace function validar_pase(p_codigo text, p_punto text default 'Acceso principal')
returns json language plpgsql security definer set search_path = public as $$
declare
  p pases; u unidades; autor text;
  ahora timestamptz := now();
  dia int := extract(isodow from (ahora at time zone 'America/Hermosillo'));
  hora time := (ahora at time zone 'America/Hermosillo')::time;
  ok boolean := true; motivo text := null;
begin
  if not es_staff() then raise exception 'Solo caseta o administración'; end if;
  select * into p from pases where codigo = upper(trim(p_codigo)) and condominio_id = my_condo() for update;
  if not found then
    insert into accesos(condominio_id,nombre,tipo,permitido,motivo,guardia_id,punto)
      values (my_condo(),'Código '||p_codigo,'visita',false,'Código no encontrado',auth.uid(),p_punto);
    return json_build_object('permitido',false,'motivo','Código no encontrado');
  end if;

  select * into u from unidades where id = p.unidad_id;
  select nombre into autor from profiles where id = p.creado_por;

  if not p.activo then ok := false; motivo := 'Pase cancelado';
  elsif ahora < p.valido_desde then ok := false; motivo := 'Aún no es válido';
  elsif ahora > p.valido_hasta then ok := false; motivo := 'Pase vencido';
  elsif p.usos_max is not null and p.usos >= p.usos_max then ok := false; motivo := 'Pase ya utilizado';
  elsif p.modalidad = 'recurrente' and p.dias is not null and not (dia = any(p.dias)) then ok := false; motivo := 'Día no permitido';
  elsif p.hora_inicio is not null and p.hora_fin is not null and (
      (p.hora_inicio <= p.hora_fin and (hora < p.hora_inicio or hora > p.hora_fin)) or      -- 08:00–14:00
      (p.hora_inicio >  p.hora_fin and hora < p.hora_inicio and hora > p.hora_fin))         -- 22:00–06:00
    then ok := false; motivo := 'Fuera de horario';
  end if;

  if ok then update pases set usos = usos + 1 where id = p.id; end if;

  insert into accesos(condominio_id,pase_id,unidad_id,nombre,tipo,permitido,motivo,autorizo,guardia_id,punto)
    values (p.condominio_id,p.id,p.unidad_id,p.visitante,p.tipo,ok,motivo,autor,auth.uid(),p_punto);

  return json_build_object('permitido',ok,'motivo',motivo,'visitante',p.visitante,'tipo',p.tipo,
    'unidad',u.nombre,'autorizo',autor,'modalidad',p.modalidad);
end $$;

-- Código personal dinámico del residente (válido 30 segundos)
create or replace function generar_codigo_personal() returns json
language plpgsql security definer set search_path = public as $$
declare pr profiles; nuevo pases;
begin
  select * into pr from profiles where id = auth.uid();
  if pr.unidad_id is null then raise exception 'Usuario sin unidad'; end if;
  perform set_config('umbral.interno', '1', true);
  insert into pases(condominio_id,unidad_id,creado_por,visitante,tipo,valido_hasta,usos_max)
    values (pr.condominio_id,pr.unidad_id,pr.id,pr.nombre,'residente',now()+interval '30 seconds',1)
    returning * into nuevo;
  perform set_config('umbral.interno', '', true);
  return json_build_object('codigo',nuevo.codigo,'expira',nuevo.valido_hasta);
end $$;

-- ---------- Cuotas y cobranza ----------
create table if not exists cargos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  unidad_id uuid not null references unidades(id) on delete cascade,
  concepto text not null,
  extraordinaria boolean default false,
  monto numeric(12,2) not null,
  vence date not null,
  estado estado_cargo not null default 'pendiente',
  created_at timestamptz default now()
);

create table if not exists pagos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  cargo_id uuid references cargos(id),
  unidad_id uuid not null references unidades(id),
  monto numeric(12,2) not null,
  metodo text not null default 'spei',   -- spei | tarjeta | efectivo
  referencia text,                        -- clave de rastreo / CEP
  created_at timestamptz default now()
);

-- Al registrar un pago, marca el cargo como pagado
create or replace function on_pago() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cargo_id is not null then update cargos set estado = 'pagado' where id = new.cargo_id; end if;
  return new;
end $$;
drop trigger if exists trg_pago on pagos;
create trigger trg_pago after insert on pagos for each row execute function on_pago();

create table if not exists egresos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  concepto text not null,
  categoria text,
  monto numeric(12,2) not null,
  fecha date not null default current_date,
  created_at timestamptz default now()
);

-- Emite la cuota ordinaria a todas las unidades
create or replace function emitir_cuotas(p_concepto text, p_monto numeric, p_vence date)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if my_rol() is distinct from 'admin' then raise exception 'Solo administración'; end if;
  insert into cargos(condominio_id,unidad_id,concepto,monto,vence)
    select condominio_id,id,p_concepto,p_monto,p_vence from unidades where condominio_id = my_condo();
  get diagnostics n = row_count;
  return n;
end $$;

-- Marca vencidos (programar con pg_cron diario si se desea)
create or replace function marcar_vencidos() returns void language sql as
$$ update cargos set estado='vencido' where estado='pendiente' and vence < current_date $$;

-- KPIs del mes para el comité
create or replace function kpis_admin() returns json
language plpgsql security definer set search_path = public as $$
declare c uuid := my_condo(); r json;
begin
  if my_rol() is distinct from 'admin' then raise exception 'Solo administración'; end if;
  select json_build_object(
    'cobrado_mes', coalesce((select sum(monto) from pagos where condominio_id=c and date_trunc('month',created_at)=date_trunc('month',now())),0),
    'cartera_vencida', coalesce((select sum(monto) from cargos where condominio_id=c and estado='vencido'),0),
    'unidades', (select count(*) from unidades where condominio_id=c),
    'unidades_al_corriente', (select count(*) from unidades un where condominio_id=c and not exists
        (select 1 from cargos cg where cg.unidad_id=un.id and cg.estado='vencido')),
    'accesos_hoy', (select count(*) from accesos where condominio_id=c and created_at::date=current_date),
    'tickets_abiertos', (select count(*) from tickets where condominio_id=c and estado<>'cerrado'),
    'paquetes_pendientes', (select count(*) from paquetes where condominio_id=c and entregado_at is null),
    'meses', (select json_agg(m order by m.mes) from (
        select to_char(g,'YYYY-MM') mes,
          coalesce((select sum(monto) from pagos where condominio_id=c and date_trunc('month',created_at)=g),0) ingresos,
          coalesce((select sum(monto) from egresos where condominio_id=c and date_trunc('month',fecha)=g),0) egresos
        from generate_series(date_trunc('month',now())-interval '5 months', date_trunc('month',now()), interval '1 month') g) m)
  ) into r;
  return r;
end $$;

-- ---------- Administración de accesos ----------
-- KPIs de seguridad (panel de administración en modo "solo accesos")
create or replace function kpis_accesos() returns json
language plpgsql security definer set search_path = public as $$
declare c uuid := my_condo(); hoy timestamptz := date_trunc('day', now() at time zone 'America/Hermosillo') at time zone 'America/Hermosillo';
begin
  if my_rol() is distinct from 'admin' then raise exception 'Solo administración'; end if;
  return json_build_object(
    'accesos_hoy',    (select count(*) from accesos where condominio_id=c and created_at >= hoy),
    'denegados_hoy',  (select count(*) from accesos where condominio_id=c and created_at >= hoy and not permitido),
    'pases_vigentes', (select count(*) from pases where condominio_id=c and activo and tipo<>'residente' and valido_hasta > now()
                         and (usos_max is null or usos < usos_max)),
    'unidades',       (select count(*) from unidades where condominio_id=c),
    'usuarios',       (select count(*) from profiles where condominio_id=c),
    'alertas_abiertas',(select count(*) from alertas where condominio_id=c and not atendida),
    'tickets_abiertos',(select count(*) from tickets where condominio_id=c and estado<>'cerrado'),
    'paquetes_pendientes',(select count(*) from paquetes where condominio_id=c and entregado_at is null),
    'avisos_mes',     (select count(*) from avisos where condominio_id=c and created_at >= date_trunc('month', now())),
    'dias', (select json_agg(d order by d.dia) from (
        select to_char(g,'YYYY-MM-DD') dia,
          (select count(*) from accesos a where a.condominio_id=c and a.permitido
             and (a.created_at at time zone 'America/Hermosillo')::date = g::date) permitidos,
          (select count(*) from accesos a where a.condominio_id=c and not a.permitido
             and (a.created_at at time zone 'America/Hermosillo')::date = g::date) denegados
        from generate_series((now() at time zone 'America/Hermosillo')::date - 6, (now() at time zone 'America/Hermosillo')::date, interval '1 day') g) d)
  );
end $$;

-- El admin incorpora a su condominio a una persona que ya tiene cuenta (creada en Authentication o registrada)
create or replace function vincular_usuario(p_email text, p_rol rol_usuario default 'residente', p_unidad uuid default null, p_nombre text default null)
returns json language plpgsql security definer set search_path = public as $$
declare pr profiles;
begin
  if my_rol() is distinct from 'admin' then raise exception 'Solo administración'; end if;
  perform set_config('umbral.interno', '1', true);   -- deja actualizar el email (proteger_perfil lo bloquea)
  insert into profiles (id, nombre, email)
    select u.id, split_part(u.email,'@',1), u.email from auth.users u where lower(u.email) = lower(trim(p_email))
    on conflict (id) do update set email = excluded.email;
  perform set_config('umbral.interno', '', true);
  select * into pr from profiles where lower(email) = lower(trim(p_email));
  if not found then raise exception 'No existe una cuenta con el correo %. Créala primero en Supabase → Authentication → Add user.', p_email; end if;
  if pr.condominio_id is not null and pr.condominio_id <> my_condo() then raise exception 'Ese usuario pertenece a otro condominio'; end if;
  if p_unidad is not null and not exists (select 1 from unidades where id = p_unidad and condominio_id = my_condo()) then
    raise exception 'Unidad inválida'; end if;
  if p_rol = 'residente' and p_unidad is null then raise exception 'Un residente necesita unidad'; end if;
  update profiles set condominio_id = my_condo(), rol = p_rol, unidad_id = p_unidad,
         nombre = coalesce(nullif(trim(p_nombre),''), nombre)
   where id = pr.id returning * into pr;
  return row_to_json(pr);
end $$;

-- El admin saca a alguien del condominio (no borra la cuenta)
create or replace function desvincular_usuario(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_rol() is distinct from 'admin' then raise exception 'Solo administración'; end if;
  if p_id = auth.uid() then raise exception 'No puedes desvincularte a ti mismo'; end if;
  perform set_config('umbral.interno', '1', true);
  update profiles set condominio_id = null, unidad_id = null, rol = 'residente' where id = p_id and condominio_id = my_condo();
  perform set_config('umbral.interno', '', true);
end $$;

-- Configuración inicial: crea el condominio y nombra administrador a una cuenta existente.
-- Solo se ejecuta desde el SQL Editor (no está expuesta a la app):
--   select umbral_setup('Residencial Las Palmas', 'Hermosillo', 'admin@correo.com');
create or replace function umbral_setup(p_condominio text, p_ciudad text, p_email_admin text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(p_email_admin));
  if uid is null then raise exception 'Primero crea la cuenta % en Authentication → Users → Add user', p_email_admin; end if;
  insert into profiles (id, nombre, email) values (uid, split_part(trim(p_email_admin),'@',1), lower(trim(p_email_admin)))
    on conflict (id) do update set email = excluded.email;
  select id into cid from condominios where nombre = p_condominio limit 1;
  if cid is null then insert into condominios(nombre, ciudad) values (p_condominio, p_ciudad) returning id into cid; end if;
  update profiles set rol = 'admin', condominio_id = cid where id = uid;
  return cid;
end $$;
revoke execute on function umbral_setup(text,text,text) from public, anon, authenticated;

-- ---------- Comunidad ----------
create table if not exists avisos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  titulo text not null,
  cuerpo text,
  torre text,                      -- null = todos
  adjunto_url text,
  created_at timestamptz default now()
);
alter table avisos add column if not exists adjunto_nombre text;
alter table avisos add column if not exists importante boolean not null default false;
alter table avisos add column if not exists creado_por uuid references profiles(id);

create table if not exists paquetes (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  unidad_id uuid not null references unidades(id),
  descripcion text,
  paqueteria text,
  foto_url text,
  recibido_por uuid references profiles(id),
  entregado_at timestamptz,
  entregado_a text,
  created_at timestamptz default now()
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  unidad_id uuid references unidades(id),
  creado_por uuid references profiles(id),
  titulo text not null,
  descripcion text,
  foto_url text,
  estado estado_ticket not null default 'abierto',
  responsable text,
  created_at timestamptz default now()
);
alter table tickets add column if not exists categoria text not null default 'Mantenimiento';
alter table tickets add column if not exists respuesta text;          -- comentario de administración visible al residente
alter table tickets add column if not exists updated_at timestamptz default now();

-- El residente solo crea tickets de su propia unidad, siempre "abierto"; estado, responsable y respuesta los maneja administración
create or replace function proteger_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is null or my_rol() = 'admin' then return new; end if;
  if tg_op = 'INSERT' then
    new.creado_por := auth.uid();
    new.unidad_id := my_unidad();
    new.estado := 'abierto'; new.responsable := null; new.respuesta := null;
    if coalesce(trim(new.titulo), '') = '' then raise exception 'Describe el problema'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_ticket on tickets;
create trigger trg_proteger_ticket before insert or update on tickets
  for each row execute function proteger_ticket();

create table if not exists areas (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  nombre text not null,
  reglas text,
  abre time default '08:00',
  cierra time default '22:00'
);

create table if not exists reservaciones (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  area_id uuid not null references areas(id) on delete cascade,
  unidad_id uuid not null references unidades(id),
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  created_at timestamptz default now(),
  exclude_check boolean generated always as (hora_fin > hora_inicio) stored
);
create unique index if not exists reservas_unicas on reservaciones(area_id, fecha, hora_inicio);

create table if not exists encuestas (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  pregunta text not null,
  opciones text[] not null,
  cierra date,
  created_at timestamptz default now()
);

create table if not exists votos (
  encuesta_id uuid references encuestas(id) on delete cascade,
  unidad_id uuid references unidades(id),
  opcion int not null,
  primary key (encuesta_id, unidad_id)
);

create or replace view resultados_encuestas as
  select e.id encuesta_id, v.opcion, count(*) votos
  from encuestas e join votos v on v.encuesta_id = e.id group by 1,2;

-- ---------- Permisos de funciones ----------
-- Nadie sin sesión puede llamar funciones; las de configuración solo desde el SQL Editor.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function umbral_setup(text,text,text) from authenticated;
revoke execute on function marcar_vencidos() from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------- Row Level Security ----------
alter table condominios   enable row level security;
alter table unidades      enable row level security;
alter table profiles      enable row level security;
alter table pases         enable row level security;
alter table accesos       enable row level security;
alter table alertas       enable row level security;
alter table cargos        enable row level security;
alter table pagos         enable row level security;
alter table egresos       enable row level security;
alter table avisos        enable row level security;
alter table paquetes      enable row level security;
alter table tickets       enable row level security;
alter table areas         enable row level security;
alter table reservaciones enable row level security;
alter table encuestas     enable row level security;
alter table votos         enable row level security;

-- Re-ejecutable: borra las políticas previas antes de crearlas
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- Lectura general dentro del condominio
create policy condo_read  on condominios for select using (id = my_condo());
create policy unid_read   on unidades    for select using (condominio_id = my_condo());
create policy unid_admin  on unidades    for all    using (condominio_id = my_condo() and my_rol()='admin');
create policy prof_self   on profiles    for select using (id = auth.uid() or (condominio_id = my_condo() and es_staff()));
create policy prof_upd    on profiles    for update using (id = auth.uid() or (condominio_id = my_condo() and my_rol()='admin'));

-- Pases: el residente ve/crea los de su unidad; caseta y admin ven todos
create policy pases_read on pases for select using (condominio_id = my_condo() and (es_staff() or unidad_id = my_unidad()));
create policy pases_ins  on pases for insert with check (condominio_id = my_condo() and (es_staff() or unidad_id = my_unidad()));
create policy pases_upd  on pases for update using (condominio_id = my_condo() and (es_staff() or unidad_id = my_unidad()));

-- Bitácora: staff completo; residente solo su unidad
create policy acc_read on accesos for select using (condominio_id = my_condo() and (es_staff() or unidad_id = my_unidad()));
create policy acc_ins  on accesos for insert with check (condominio_id = my_condo() and es_staff());

create policy al_read on alertas for select using (condominio_id = my_condo());
create policy al_ins  on alertas for insert with check (condominio_id = my_condo());
create policy al_upd  on alertas for update using (condominio_id = my_condo() and es_staff());

-- Finanzas
create policy cargos_read on cargos for select using (condominio_id = my_condo() and (my_rol()='admin' or unidad_id = my_unidad()));
create policy cargos_adm  on cargos for all    using (condominio_id = my_condo() and my_rol()='admin');
create policy pagos_read  on pagos  for select using (condominio_id = my_condo() and (my_rol()='admin' or unidad_id = my_unidad()));
create policy pagos_ins   on pagos  for insert with check (condominio_id = my_condo() and (my_rol()='admin' or unidad_id = my_unidad()));
create policy egr_adm     on egresos for all   using (condominio_id = my_condo() and my_rol()='admin');

-- Comunidad
create policy av_read on avisos for select using (condominio_id = my_condo());
create policy av_adm  on avisos for all    using (condominio_id = my_condo() and my_rol()='admin');

create policy paq_read on paquetes for select using (condominio_id = my_condo() and (es_staff() or unidad_id = my_unidad()));
create policy paq_staff on paquetes for all   using (condominio_id = my_condo() and es_staff());

create policy tk_read on tickets for select using (condominio_id = my_condo() and (my_rol()='admin' or unidad_id = my_unidad() or creado_por = auth.uid()));
create policy tk_ins  on tickets for insert with check (condominio_id = my_condo());
create policy tk_adm  on tickets for update using (condominio_id = my_condo() and my_rol()='admin');

create policy ar_read on areas for select using (condominio_id = my_condo());
create policy ar_adm  on areas for all    using (condominio_id = my_condo() and my_rol()='admin');

create policy rs_read on reservaciones for select using (condominio_id = my_condo());
create policy rs_ins  on reservaciones for insert with check (condominio_id = my_condo() and (my_rol()='admin' or unidad_id = my_unidad()));
create policy rs_del  on reservaciones for delete using (my_rol()='admin' or unidad_id = my_unidad());

create policy en_read on encuestas for select using (condominio_id = my_condo());
create policy en_adm  on encuestas for all    using (condominio_id = my_condo() and my_rol()='admin');
create policy vt_read on votos for select using (true);
create policy vt_ins  on votos for insert with check (unidad_id = my_unidad());

-- ---------- Archivos adjuntos de avisos (Supabase Storage) ----------
-- Bucket público: el enlace lleva un identificador aleatorio; se guarda en carpetas por condominio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avisos', 'avisos', true, 10485760, array['image/png','image/jpeg','image/webp','image/gif','application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avisos_files_read on storage.objects;
drop policy if exists avisos_files_ins  on storage.objects;
drop policy if exists avisos_files_del  on storage.objects;
create policy avisos_files_read on storage.objects for select to authenticated
  using (bucket_id = 'avisos' and (storage.foldername(name))[1] = public.my_condo()::text);
create policy avisos_files_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'avisos' and (storage.foldername(name))[1] = public.my_condo()::text and public.my_rol() = 'admin');
create policy avisos_files_del on storage.objects for delete to authenticated
  using (bucket_id = 'avisos' and (storage.foldername(name))[1] = public.my_condo()::text and public.my_rol() = 'admin');

-- ---------- Tiempo real (dashboard caseta / admin) ----------
do $$ declare t text; begin
  foreach t in array array['accesos','alertas','paquetes','tickets','avisos'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- ---------- Arranque (sin datos de ejemplo) ----------
-- La base queda vacía. Para empezar:
-- 1) Crea la cuenta del administrador en Authentication → Users → Add user (marca "Auto Confirm User").
-- 2) Aquí en el SQL Editor:
--      select umbral_setup('<Nombre del condominio>', '<Ciudad>', '<correo del admin>');
-- Lo demás (unidades, guardias y residentes) se da de alta desde el panel web.
