-- Fix wine edits failing inside the shared drinking-guidance trigger.
--
-- PL/pgSQL validates record-field references before choosing a CASE branch,
-- so referencing NEW.wine_id is invalid when this trigger runs for
-- cellar.wines. Branch first, then access the table-specific record field.
create or replace function cellar_private.refresh_wine_guidance_trigger()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_schema = 'cellar' and tg_table_name = 'wines' then
    perform cellar_private.refresh_wine_guidance(new.id);
  elsif tg_table_schema = 'cellar' and tg_table_name = 'wine_online_info' then
    perform cellar_private.refresh_wine_guidance(new.wine_id);
  else
    raise exception 'Unsupported trigger source %.%', tg_table_schema, tg_table_name;
  end if;

  return new;
end;
$$;
