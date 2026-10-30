-- Retira la lógica de alertas que corría dentro de Supabase, para que
-- sat_servidor.py sea la única fuente de notificaciones.
-- Reversible: la función registrar_notificacion_automatica y la Edge Function
-- enviar-alerta-telegram no se eliminan, y el webhook se puede volver a crear.

begin;

drop trigger if exists "trigger-alerta-rio" on public.lecturas;
drop trigger if exists trg_registrar_notificacion on public.lecturas;

commit;
