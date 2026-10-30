-- Permisos de las tablas del SAT-IoT.
-- El dashboard (clave pública) solo puede leer. Solo escribe sat_servidor.py,
-- con la clave secreta, que no está sujeta a estas políticas.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de poner la clave secreta en config.json.

begin;

alter table public.lecturas enable row level security;
alter table public.notificaciones enable row level security;

-- Elimina las políticas anteriores, sean cuales sean sus nombres
do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('lecturas', 'notificaciones')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- Realtime también necesita esta política para entregar los cambios al dashboard
create policy "lectura publica" on public.lecturas
  for select to anon, authenticated using (true);

create policy "lectura publica" on public.notificaciones
  for select to anon, authenticated using (true);

commit;
