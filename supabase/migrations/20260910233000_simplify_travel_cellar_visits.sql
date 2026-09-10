-- Present Cellar winery visits as Travel Journal activities.
-- Explicit trip links win; otherwise an unlinked visit is inferred only when
-- its date falls inside exactly one visible trip in the same household.
create or replace function public.get_trip_cellar_activity(p_trip_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with target_trip as (
    select t.id, t.household_id, t.start_date, t.end_date
    from public.trips t
    where t.id = p_trip_id
  ),
  explicit_visits as (
    select distinct
      v.id,
      v.household_id,
      v.winery_id,
      v.visit_date,
      v.notes,
      'explicit'::text as link_source
    from target_trip t
    join cellar.travel_references r
      on r.external_system = 'travel-journal'
     and r.external_entity_type = 'trip'
     and r.external_id = t.id::text
     and r.winery_visit_id is not null
    join cellar.winery_visits v
      on v.id = r.winery_visit_id
     and v.household_id = r.household_id
     and v.household_id = t.household_id
  ),
  unlinked_visits as (
    select
      v.id,
      v.household_id,
      v.winery_id,
      v.visit_date,
      v.notes
    from cellar.winery_visits v
    where not exists (
      select 1
      from cellar.travel_references r
      where r.winery_visit_id = v.id
        and r.household_id = v.household_id
        and r.external_system = 'travel-journal'
        and r.external_entity_type = 'trip'
    )
  ),
  date_match_counts as (
    select v.id as visit_id, count(t.id) as trip_count
    from unlinked_visits v
    join public.trips t
      on t.household_id = v.household_id
     and v.visit_date between t.start_date and t.end_date
    group by v.id
  ),
  inferred_visits as (
    select
      v.id,
      v.household_id,
      v.winery_id,
      v.visit_date,
      v.notes,
      'date'::text as link_source
    from target_trip t
    join unlinked_visits v
      on v.household_id = t.household_id
     and v.visit_date between t.start_date and t.end_date
    join date_match_counts matches
      on matches.visit_id = v.id
     and matches.trip_count = 1
  ),
  resolved_visits as (
    select * from explicit_visits
    union all
    select * from inferred_visits
  ),
  visit_cards as (
    select
      v.id as visit_id,
      v.winery_id,
      w.name as winery_name,
      v.visit_date,
      v.notes,
      v.link_source,
      coalesce(
        (
          select ph.storage_path
          from cellar.photos ph
          where ph.household_id = v.household_id
            and ph.winery_visit_id = v.id
          order by ph.is_hero desc, ph.sort_order, ph.created_at
          limit 1
        ),
        (
          select ph.storage_path
          from cellar.photos ph
          where ph.household_id = v.household_id
            and ph.winery_id = v.winery_id
          order by ph.is_hero desc, ph.sort_order, ph.created_at
          limit 1
        )
      ) as photo_path
    from resolved_visits v
    join cellar.wineries w
      on w.id = v.winery_id
     and w.household_id = v.household_id
    where not exists (
      select 1
      from public.trip_plans p
      where p.trip_id = p_trip_id
        and p.plan_date = v.visit_date
        and (
          position('visit=' || v.id::text in lower(coalesce(p.website_url, ''))) > 0
          or lower(trim(p.title)) = lower(trim(w.name))
          or lower(trim(coalesce(p.location_name, ''))) = lower(trim(w.name))
        )
    )
  )
  select jsonb_build_object(
    'visits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'visit_id', vc.visit_id,
          'winery_id', vc.winery_id,
          'winery_name', vc.winery_name,
          'visit_date', vc.visit_date,
          'notes', vc.notes,
          'link_source', vc.link_source,
          'photo_path', vc.photo_path
        ) order by vc.visit_date desc, vc.winery_name
      )
      from visit_cards vc
    ), '[]'::jsonb),
    'wines', '[]'::jsonb
  );
$$;

revoke all on function public.get_trip_cellar_activity(uuid) from public;
revoke all on function public.get_trip_cellar_activity(uuid) from anon;
grant execute on function public.get_trip_cellar_activity(uuid) to authenticated;

comment on function public.get_trip_cellar_activity(uuid) is
  'Returns minimal Cellar winery-visit activity for an authorized Travel Journal trip; explicit links win and unique date matches may be inferred.';
