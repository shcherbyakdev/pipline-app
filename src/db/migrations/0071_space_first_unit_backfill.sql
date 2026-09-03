-- Every space is its own bookable unit until it is split (#109), and the
-- public page lists a space only through an active unit. Two kinds of rows
-- have none: spaces from before 0047 (space-first-unit, PR #70), and spaces
-- whose first unit the plan gate refused — createOffering used to save the
-- space anyway and point the owner at "add a unit", which the same gate
-- refused. Those spaces sat on /rentals as "not bookable" with no way out.
--
-- createOffering now refuses the space when it would refuse the unit, and
-- deleteUnit keeps a space's last unit; this repairs what was left behind.
-- The unit is exactly what createOffering would have made: the space's
-- name, no description, the space's own active flag. Plan limits shape the
-- public offering, never the data (limitPublicResources), so an org over
-- its cap simply keeps the first N bookable, as it does today.

insert into public.rental_units (org_id, offering_id, name, description, active)
select o.org_id, o.id, o.name, null, o.active
from public.rental_offerings o
where not exists (select 1 from public.rental_units u where u.offering_id = o.id);
