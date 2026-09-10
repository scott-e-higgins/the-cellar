-- Read-only projection used by the Travel Journal trip detail.
-- Security remains the intersection of Travel trip RLS and Cellar household RLS.
create or replace function public.get_trip_cellar_activity(p_trip_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with target_trip as (
    select t.id
    from public.trips t
    where t.id = p_trip_id
  ),
  linked_visits as (
    select distinct
      v.id,
      v.household_id,
      v.winery_id,
      v.visit_date,
      v.notes
    from target_trip t
    join cellar.travel_references r
      on r.external_system = 'travel-journal'
     and r.external_entity_type = 'trip'
     and r.external_id = t.id::text
     and r.winery_visit_id is not null
    join cellar.winery_visits v
      on v.id = r.winery_visit_id
     and v.household_id = r.household_id
  ),
  visit_cards as (
    select
      v.id as visit_id,
      v.winery_id,
      w.name as winery_name,
      v.visit_date,
      v.notes,
      coalesce((
        select sum(pi.quantity)
        from cellar.purchases p
        join cellar.purchase_items pi
          on pi.purchase_id = p.id
         and pi.household_id = p.household_id
        where p.winery_visit_id = v.id
          and p.household_id = v.household_id
      ), 0) as bottle_count,
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
    from linked_visits v
    join cellar.wineries w
      on w.id = v.winery_id
     and w.household_id = v.household_id
  ),
  linked_purchase_ids as (
    select distinct p.id, p.household_id
    from target_trip t
    join cellar.travel_references r
      on r.external_system = 'travel-journal'
     and r.external_entity_type = 'trip'
     and r.external_id = t.id::text
     and r.purchase_id is not null
    join cellar.purchases p
      on p.id = r.purchase_id
     and p.household_id = r.household_id
    union
    select distinct p.id, p.household_id
    from linked_visits v
    join cellar.purchases p
      on p.winery_visit_id = v.id
     and p.household_id = v.household_id
  ),
  wine_cards as (
    select
      wi.id as wine_id,
      wi.name as wine_name,
      wi.vintage,
      wi.non_vintage,
      coalesce(w.name, 'Unknown winery') as winery_name,
      sum(pi.quantity) as quantity,
      (
        select ph.storage_path
        from cellar.photos ph
        where ph.household_id = wi.household_id
          and ph.wine_id = wi.id
        order by ph.is_hero desc, ph.sort_order, ph.created_at
        limit 1
      ) as photo_path
    from linked_purchase_ids lp
    join cellar.purchase_items pi
      on pi.purchase_id = lp.id
     and pi.household_id = lp.household_id
    join cellar.wines wi
      on wi.id = pi.wine_id
     and wi.household_id = pi.household_id
    left join cellar.wineries w
      on w.id = wi.winery_id
     and w.household_id = wi.household_id
    group by wi.id, wi.name, wi.vintage, wi.non_vintage, wi.household_id, w.name
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
          'bottle_count', vc.bottle_count,
          'photo_path', vc.photo_path
        ) order by vc.visit_date desc, vc.winery_name
      )
      from visit_cards vc
    ), '[]'::jsonb),
    'wines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'wine_id', wc.wine_id,
          'wine_name', wc.wine_name,
          'vintage', wc.vintage,
          'non_vintage', wc.non_vintage,
          'winery_name', wc.winery_name,
          'quantity', wc.quantity,
          'photo_path', wc.photo_path
        ) order by wc.winery_name, wc.wine_name, wc.vintage desc nulls last
      )
      from wine_cards wc
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_trip_cellar_activity(uuid) from public;
revoke all on function public.get_trip_cellar_activity(uuid) from anon;
grant execute on function public.get_trip_cellar_activity(uuid) to authenticated;

comment on function public.get_trip_cellar_activity(uuid) is
  'Returns the minimal Cellar visit and wine card data for an authorized Travel Journal trip.';
