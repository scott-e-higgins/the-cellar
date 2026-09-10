-- Focused correction of an existing gift. Inventory identity and quantities
-- remain immutable; only a gift's own movement date can be corrected.
grant update (gifted_to, gifted_on, occasion_note) on cellar.gifts_given to authenticated;
grant update (occurred_at) on cellar.inventory_movements to authenticated;
create policy gifts_correct_editor on cellar.gifts_given for update to authenticated
 using ((select cellar_private.can_edit_household(household_id)))
 with check ((select cellar_private.can_edit_household(household_id)));
create policy gift_movement_date_correct_editor on cellar.inventory_movements for update to authenticated
 using ((select cellar_private.can_edit_household(household_id)) and exists (
  select 1 from cellar.gifts_given g where g.inventory_movement_id=inventory_movements.id and g.household_id=inventory_movements.household_id
 ))
 with check ((select cellar_private.can_edit_household(household_id)) and exists (
  select 1 from cellar.gifts_given g where g.inventory_movement_id=inventory_movements.id and g.household_id=inventory_movements.household_id
 ));
