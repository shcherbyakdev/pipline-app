# Parallel-run checklist — moving a studio onto Booklo

Two weeks of both tools side by side, then one cut-over morning. Tick every box; the order matters because the import refuses rows the setup does not yet allow.

Studio: ______________________  Handle: ______________  Cut-over date: __________  Booklo contact: __________

## Week 0 — set up (with the studio, 60–90 min)

- [ ] Pricing worksheet (`pricing-worksheet.md`) filled in and every old rule mapped or dropped.
- [ ] Org created, channel = **Spaces**, timezone and currency correct (Settings).
- [ ] Every room, whole-studio and equipment space created with the worksheet's name, kind, units/items and price.
- [ ] Opening hours set for every room and whole-studio space (Availability). *Import rows outside these hours are refused.*
- [ ] Pricing rules, deposit, cancellation tiers, terms and approval set per space; hold window set (Settings → Payments).
- [ ] Payments: Stripe Connect onboarding finished, P24/BLIK live; one 1 zł test booking paid and refunded.
- [ ] Notifications: every member on the team page, email + push chosen; the 08:00 daily digest on for at least the owner.
- [ ] One test booking made from the public page end to end (hold → payment → confirmation mail → manage link → cancel → refund).
- [ ] **Google Calendar NOT connected yet** (Integrations). A connected calendar mirrors every new booking, and with *Invite guests* on it emails a Google invitation to each client — an import of 100 rows would invite 100 clients weeks before cut-over. Connect it after the import, or connect it with *Invite guests* off until the cut-over morning.

## Week 0 — import future bookings

- [ ] Export every future booking from the old tool (Bookero: calendar export; Calendesk: bookings CSV; email/Instagram: type them into the sheet).
- [ ] Map columns onto `bookings-template.csv`: `space,date,start,end,client_name,client_email,note,paid`. Space = the Booklo space name; times are the studio's local time; `paid` = yes when the studio already collected the money (default), no when a balance is still owed; put the old booking id in `note`.
- [ ] Open `/utils/import`, pick the org, upload the file, read the preview: **N ready, M invalid** with row numbers. Fix invalid rows in the sheet (unknown space, duration off the grid, bad time) and re-upload until only rows you accept remain.
- [ ] Confirm. Read the result table: *created* / *skipped* (already imported, or a genuine clash with a booking the studio took directly) / *failed* (outside opening hours, inactive space). Fix and re-run; re-running never duplicates.
- [ ] Spot-check five imported bookings on the timeline and in the detail dialog: right room, right hour, `paid` rows show no balance, `paid=no` rows show the balance due.
- [ ] Every client with an email now exists under Clients. Booklo itself sends no mail for imported rows (no confirmation, no manage link); the only outbound path is a connected Google Calendar with *Invite guests* on — see Week 0.
- [ ] Re-run the file straight away if the run stopped early or the result table is missing rows: re-running skips what is already on the calendar. Do it *before* the studio starts moving imported bookings and without editing client names between runs — the skip key is space + start + client name, and a rescheduled or renamed booking is no longer matched.

## Weeks 1–2 — both tools live

- [ ] New bookings are taken **only** in Booklo (embed the widget or share `/<handle>`), the old tool set to read-only or its booking page hidden.
- [ ] Each morning: compare the Booklo timeline with the old calendar for the day; any booking that exists only in the old tool is entered in Booklo the same day.
- [ ] The 08:00 daily list is read: requests waiting, holds expiring, balances due. Anything the studio did outside Booklo (cash at the door, verbal cancellation) is recorded via Mark paid / Cancel the same day.
- [ ] Incident log kept: what fell through, what the studio did in the old tool or on Instagram instead, what they asked for. This log is the Phase 2 evidence.
- [ ] After-session charges tried at least once (overtime or cleaning) and collected by link or cash.

## Cut-over morning

- [ ] No future booking exists only in the old tool (last diff of the two calendars).
- [ ] Old tool's public booking page redirected to `/<handle>` or switched off; Instagram/website links updated.
- [ ] Old tool downgraded/cancelled *after* the last imported booking's date has passed, or kept read-only for the history the studio still needs.
- [ ] Final export of the old tool saved to the studio (CSV) — Booklo does not import history.

## First month after

- [ ] Weekly 20-minute check-in; incident log reviewed; any "later" item that blocks the studio promoted into a slice.
- [ ] Balances due at 30 days reviewed together (Overview list); write-offs done consciously.
- [ ] Pricing worksheet revisited once with real bookings behind it.

## Known limits to say up front

- Import is hours-mode bookings only; no people count, extras or equipment on imported rows — add those by hand where they matter.
- The import runs from Booklo's internal back office; the studio does not see or run it.
- Imported bookings carry no manage link for the client (no mail is sent); a client who needs to move or cancel does it through the studio.
- One client holding two units of the same space at the same hour imports as one row; the second is reported "already imported" — enter it by hand.
- A 500-row file is up to 1500 sequential calls (one to two minutes); if the page times out, the bookings written so far are real — re-run for the rest.
