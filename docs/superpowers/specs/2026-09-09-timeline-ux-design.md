# Timeline v3 — the tape chart to best practice

Date: 2026-09-09. Rebuilds the admin Timeline (`/bookings?view=timeline`, PR #68 "timeline v2", drag-to-pan in the same PR) against resource-scheduler and hotel tape-chart best practice. Visual reference: a dark hotel "checkerboard" (room types as groups with a free-rooms-per-day row, rooms with status badges, guest bars with a source tag, today column, hatched blackouts, filters + search). The ask: "follow best-practice guidelines and handle all cases, so it is easy to work with; set a goal and finish when it meets all requirements."

## Goal

A front-desk board the owner can read at a glance and work from without leaving it: every space, one row per unit, one column per day; stays as bars that say who and how long; free units per day for split spaces; today obvious; conflicts impossible to miss; and the common jobs — move a stay, extend it, book an empty run of days, find a guest, jump to a date — done on the board itself with the keyboard or the pointer, on a laptop or a phone, in light and dark.

The goal is met when every item in **Definition of done** below is checked in the browser against the QA board (`scripts/seed-timeline-qa.sql`; see "QA data"). **Status 2026-09-09: all items checked** — `scripts/qa-timeline.mjs` (15 steps) and `scripts/qa-timeline-2.mjs` (7 steps) pass, `npm run verify` 1489/1489, screenshots in light and dark at four widths.

## Research (2026-09-09, 30+ pages; folded into the checklist)

Sources: Bryntum Scheduler feature docs (ViewPreset, NonWorkingTime, ColumnLines, GroupSummary/Summary, StickyEvents, EventDrag `validatorFn`, EventResize, EventDragCreate, Pan — "incompatible with drag-create", ResourceTimeRanges, EventTooltip, EventFilter/highlightEvents, a11y blog), FullCalendar resource-timeline (`stickyHeaderDates`, `nowIndicator`, `resourceGroupField`, `eventMinWidth`, render hooks, virtualization), Syncfusion (`headerRows`, `rowAutoHeight`, virtual scrolling), DHTMLX timeline (second scale, marked timespans, limits, touch, autoscroll, Gantt 9 sticky labels + red conflicts), hotel charts (rezStream "14 things", innRoad tape chart, WebRezPro, Cloudbeds new calendar + drag-and-drop troubleshooting, Mews timeline, Sirvoy, LS Central, RoomKey, MyPMS, Book&Link), NN/g (data tables: freeze headers, filters obvious; sticky headers; skeletons; empty states; mobile tables), W3C APG grid pattern, WCAG 1.4.1 / 1.4.11 / 2.3.3 / 2.4.7, Google Calendar shortcuts, Notion timelines.

The fifteen highest-impact rules, and where this slice lands them: two-tier sticky header + frozen rail (§header); today column + self-updating now line; collapsible groups with a **free-units-per-day row** (the one thing that turns a Gantt into a tape chart; only Bryntum GroupSummary and hotel-native charts have it); housekeeping badges (**deferred — no housekeeping model**); status colour with a second channel (outline style = status, ring = rule break, icon for conflicts) + legend; bar label = name (+ length), **sticky inside long bars** while scrolling; Today/arrows/date picker; click or drag empty cells to create with room + dates prefilled; drag to move/resize with a **live validator during the drag and again on drop** and a tooltip with the new dates; blackouts as **full-height hatched ranges behind bars**, inert to the mouse; quick search that scrolls to and highlights; conflicts impossible to create by drag, existing ones ringed and counted; APG grid keyboard model; virtualisation (**not needed** at ≤ 168 columns × a few dozen lanes — the buffered window is the performance strategy).

Deferred with reasons: "No room / unassigned" lane (every stay has a unit — `bookings_unit_iff_rental`; auto-assignment happens at booking time); housekeeping status; source/channel tag and filter (no source field); right-click menu and multi-select; row pinning, sortable rail (sort order lives on the space page); off-screen row indicators; real-time updates; a side panel instead of the dialog (the app's Linear dialog system is the ruling); touch long-press drag (the Move dialog is the touch path); confirmation on consequential drops (an **Undo** toast replaces it — the reschedule action already emails the client on a date change).

## Decisions

1. **Native scrolling replaces the translate machinery.** The chart is one `overflow: auto` box; the header is `sticky top`, the rail `sticky left`. Position = `scrollLeft`. Wheel/trackpad, touch, scrollbar and keyboard all pan for free (platform over JS). The three-window buffer stays: the page fetches `bufferWindow(from, days)`, the chart scrolls to the visible window in a layout effect, and a settled scroll commits `from` to the URL in a transition (`router.replace`, `scroll: false`). Beyond ±1 window a scroll shows blank until the transition lands (unchanged, accepted). Deleted: `--base`/`--pan` translates, `RAIL_PAN_STYLE`, `use-pan-chart.ts`; `pan.ts` keeps `bufferWindow`/`visibleOffset`/`panDays`.
2. **Gestures are unambiguous** (Bryntum: pan and drag-create cannot share a surface). Drag on the **date header** = pan through time (grab cursor). Drag on **empty cells** = select a run of days → New booking prefilled with start, end and unit. Drag a **bar** = move it (same lane or another unit of the same space); drag a bar's **edge** = change check-in/check-out; dragging near the chart's edge auto-scrolls. Horizontal wheel / Shift+wheel = pan; Ctrl/⌘+wheel = zoom step. The arrows, Today, zoom and a **date picker** on the window label stay in the toolbar.
3. **Rows are fixed height, the board is dense.** Lanes no longer stretch to fill the screen: 36 px lanes, single-line bars (name · length), hourly chips 22 px stacked. A **single-unit space is one row** (its header is its lane — "space = its own unit until split"). Groups **collapse** (chevron; remembered per browser). The chart fills the panel height (`flex-1 min-h-0`), no viewport arithmetic.
4. **A free-units row per split space** (nights/days): the group header's day cells show how many units are free that day (turnover and blackouts count as taken); `0` is tinted. Hourly groups show the day's booking count instead.
5. **Header density by column width:** month strip; weekday+number ≥ 44 px, number ≥ 24 px, below that only Mondays and today; weekends tinted through the body; a stronger rule at each Monday; today = brand pill on the date, a tinted column, a 2 px brand line with a marker in the header.
6. **Blackouts are full-height hatched ranges behind the bars**, inert to the pointer except their small label pill (dates, reason, link to the space page); a stay laid over one wears the conflict ring, so nothing is lost by drawing the hatch underneath.
7. **Bars say status without words:** confirmed = space-hue wash + solid left rule; request = dashed outline; hold = dotted outline + expiry in the card; in house = brand left rule + "In house" only when there is room; past = muted; ghost (placement) = dashed, lighter; conflict = red/amber ring + icon (colour never alone). Hover/focus card: name, dates, length, unit, email, note, price and paid state, status line, every conflict. Click = the booking dialog (unchanged).
8. **Move/resize/create validate live and stay honest.** While dragging, the ghost turns red when the target run collides with the lane's own stays, a turnover tail (either party's — the server refuses those too, `range.ts` marks the tail taken) or blackouts (client-side, same rules as `detectConflicts`); a red drop reverts with a toast. The drag's day delta is a difference of DATES (the column under the pointer on whatever buffer the board shows), the header pan is incremental, and the run-select anchors on dates — so a scroll commit landing mid-drag and recentring the buffer never moves the ghost. A green drop calls the existing admin reschedule action (nights/days: `rescheduleRentalBookingAdmin`; hours: `rescheduleRentalHoursAdmin`) — the server remains the authority; failure = toast + revert via refresh; success = toast with **Undo** (the reverse move through the same action). Pending requests, holds, started stays and ghosts are not draggable (the action refuses them; the bar says why in its card).
9. **Find a client** on the board: a search field above the chart filters by client name (client-side, within the fetched window); non-matches dim, matches count, Enter scrolls to the first match. The conflicts banner becomes a compact chip in the same strip (count + Show), never pushing the chart.
10. **Keyboard (APG grid + Google Calendar):** the board is one Tab stop with roving focus over cells (arrows move, Home/End = first/last visible day, PageUp/PageDown or `p`/`n` = a window back/forward, `t` = today, `/` = search, Enter/Space = new booking here); cells carry `gridcell`, rails `rowheader`, dates `columnheader`; bars and chips are buttons reachable by Tab after the grid; drag results and window changes are announced in a polite live region. Long bars keep their label in view (`position: sticky` inside the bar).
11. **Small screens:** under 640 px the rail narrows to 132 px and drops the mode chips, columns keep a 14 px minimum (the 8-week overview still fits 56 days on a laptop) and the board scrolls natively both ways; touch scrolls, tap opens; drag-to-move is pointer-only (mouse/pen), the Move dialog stays the touch path. (The default zoom is not width-dependent: the server cannot see the width, and a cookie for it is not worth the round trip.)
12. **Motion:** hover/drag transitions off under `prefers-reduced-motion`.
13. **Out of scope:** see the deferred list under Research; also printing, a per-day occupancy % footer and Timeline for people.

## Definition of done

Header & time ruler
- [x] Month strip labels pinned to the visible edge; day cells adapt by width (weekday+number / number / Mondays+today only); weekends tinted through every lane; Monday rules; today pill + column tint + brand line with header marker; header and rail sticky both ways; corner cell holds the free-units legend word.
- [x] Day header cell → link to that day's Day view (drill-in), with a tooltip.

Rows & rail
- [x] Fixed 36 px lanes; single-unit spaces are one row; split spaces: group row (name, mode chip, unit count, conflict count, collapse chevron) + one row per unit; inactive unit badge; collapse state remembered.
- [x] Free-units-per-day row on nights/days groups (0 tinted); booking-count row on hourly groups.

Bars & chips
- [x] Single-line bars: name (+ length when there is room, initials below 48 px); nights hand over mid-cell; days hold whole cells; turnover tails dashed; continuation glyphs with sr text at the window's cut.
- [x] Status styling per decision 7 (confirmed / request / hold / in house / past / ghost / conflict) with the icon for conflicts; hover card and focus card carry the full story incl. price and paid state.
- [x] Hourly chips: time + name ≥ 96 px, time ≥ 56 px, hour ≥ 28 px; 8-week zoom folds a day into a count pill that zooms in.

Navigation
- [x] Wheel/trackpad horizontal scroll and Shift+wheel pan; a settled scroll aligns to a day and updates the URL (`from=`); arrows/Today/zoom keep working; the window label opens a date picker that jumps to a date; header drag pans with a grab cursor; a pan never fires a click.
- [x] Keyboard per decision 10 (roles, roving focus, `t`, `/`, `n`/`p`, PageUp/PageDown); sticky bar labels; Ctrl/⌘+wheel zoom; edge auto-scroll while dragging a bar.

Interactions
- [x] Click empty cell → New booking (unit + date); drag across empty cells → New booking (unit + start + end); past cells disabled.
- [x] Drag bar → move (day and unit within the same space), edge drag → resize; live red/green ghost; server action on drop; toast; Undo; refusal reasons for non-movable bars; hourly chips move between days/units keeping their time.
- [x] Click bar → booking dialog (unchanged); blackouts hatched behind bars full-height, pill → space page.

Search & conflicts
- [x] Search field filters by name (dim/highlight, match count, Enter → first match); conflicts chip counts and Show scrolls/opens (or zooms in for a folded pill).

States
- [x] Empty (no spaces) state; loading: `aria-busy` + "Loading…" while a window transition is pending; failed move (or a transport error) → toast + revert; lapsed requests never drawn; a hold past its deadline is drawn until the drain flips it (S2 ruling: it still blocks its slot) with "Reserved until …" in its card.

Accessibility
- [x] Roving-tabindex grid, labelled cells, buttons for bars/chips with full aria-labels, live region for drag/window announcements, visible focus rings, contrast ≥ 4.5:1 for bar text in light and dark (measured: 12.7 dark / 18.9 light), reduced-motion respected, conflicts carry an icon not only colour. Known compromise: bars, tails and blackout pills sit in a `role="presentation"` track and so are children of the row rather than of a cell; `aria-rowcount`/`aria-colcount` count the header rows and the rowheader column.

Responsive
- [x] 1440 / 1024 / 768 / 390 px checked: rail width, min column width, native two-axis scroll, no document overflow (`scripts/qa-timeline-2.mjs`).

Quality gates
- [x] `npm run verify` green (unit tests for: free-units-per-day, header density, drag target maths, collision check, hourly chip density); `messages/*.json` complete in en/pl/uk; final code review clean (see PR); QA screenshots in light and dark on the QA board.

## QA data

Local demo org (`demo-studio`, Europe/Warsaw), `scripts/seed-timeline-qa.sql` (idempotent, tag `TLQA`): nightly "Apartment" ×3 units (turnover 1; past, in-house with note, back-to-back with a turnover clash, long pending request crossing the window edge, hold with expiry, blackout "Painting" over the request), daily "Camera kit" ×2 (single-day and multi-day, unit B blacked out for repair), the studio's hourly rooms as they are. The S6QA leftovers were retired (inactive) so the board is readable. Browser QA: `scripts/qa-timeline.mjs` and `scripts/qa-timeline-2.mjs` (Playwright, scripted — the MCP browser was locked by another session).

## Lessons

- **A reschedule is a new row.** Both admin reschedule actions now return `id: new_booking_id`; anything that wants to move the stay again (Undo) must use it, and an ISO instant handed back to an action must be normalised to `…Z` (`z.iso.datetime()` refuses Postgres's `+00:00`).
- **Focusing a bar from a key handler** (search → Enter) must wait for the key to finish (`setTimeout(…, 0)` + `preventDefault`), or the bar receives the keypress and opens.
- **`overflow: clip`, not `hidden`, on the bar** — a hidden overflow makes the bar its own scroll container and pins the sticky label to the bar instead of the board.
- **Sticky rails must be opaque** (`bg-muted`, not `bg-muted/40`): buffered columns scrolled under a translucent rail show through.
- **The URL is the truth whenever nothing of ours is in flight**: `if (!isPending && fromDate !== from) setFrom(fromDate)` replaces a committed/seen pair, and handles a navigation that discarded our commit (Today during a pending scroll). When only the buffer moved (our commit coming back), the layout effect SHIFTS `scrollLeft` by the buffer's delta instead of resetting to `from`, so a scroll still in progress keeps its place.
- The React Compiler is not enabled (`next.config.ts`), only its lint rules — so `TimelineLane` is `React.memo` with stable callbacks (`onCellFocus(unitId, idx)`, `onBarPress(e, press)`, `stayDrag.begin` reading its geometry through a ref).
- The React Compiler lint refuses refs written in render and setState in effects; the collapsed set is a tiny `useSyncExternalStore` store over localStorage, the pending move is derived from `isPending`, the ghost is a plain function called for the drag and again for the drop.
