-- Limit corrections to descriptive/date columns. No permission to change
-- gift identity, quantity, purchase item, movement type or household is added.
grant update (gifted_to,gifted_on,occasion_note) on cellar.gifts_given to authenticated;
grant update (occurred_at) on cellar.inventory_movements to authenticated;
create policy gifts_correct_editor on cellar.gifts_given for update to authenticated
 using ((select cellar_private.can_edit_household(household_id)))
 with check ((select cellar_private.can_edit_household(household_id)));
create policy movement_date_correct_editor on cellar.inventory_movements for update to authenticated
 using ((select cellar_private.can_edit_household(household_id)))
 with check ((select cellar_private.can_edit_household(household_id)));
