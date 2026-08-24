# Review notes

What was wrong, what changed, and what is still open.

---

# Fifth pass: the visual layer

The app worked and read cleanly, but it looked like an internal tool rather than a product.
Five things were doing the damage, and none of them were the palette.

## The list did not line up

Task rows used `auto auto auto` for the due date, status, assignee and controls, so every
row put its metadata wherever the task name happened to stop. Ten rows meant ten different
right-hand edges. The list now has fixed tracks — 108px for the due date, 84px for status,
30px for the avatar, 104px for the controls — and `.task-tags` picks those tracks up with
`grid-template-columns: subgrid`, so the two chips inside it stay on the same rails as
everything else. The eye runs down four straight columns instead of chasing metadata.

Row controls became glyphs at the same time. **Notes**, **Edit** and a delete cross cost
more width in words than the metadata they sat beside, and the label was read once.

## There were no surfaces

Everything sat on flat white: sidebar, page and content were within a few percent of each
other, so nothing was in front of anything. There are three grounds now — the rail recedes,
a warm paper canvas holds the page, white panels carry the work. Warm rather than the usual
cool grey, which suits an accounting workspace and is a choice rather than a default.

This is what fixed dark mode too. The old rail was `#171a18` against a `#131614` page,
a difference you had to look for.

## The overview was one long column

Two full-width blocks stacked down a 1440px screen, with the right half of the page empty
below the fold. It splits 62/38 now: the task list is where the day is spent, the project
grid is only checked. The attention band deliberately ignores the split and spans both
columns, because the count that decides what to do first should not be stuck in one of them.

## Three pastel tiles

The overdue, due-today and due-this-week counters were three rounded pastel rectangles —
the most templated thing on the page, and the colour was decorative because all three had
it. They are one instrument now: a single panel divided by hairlines, each segment still a
live filter, only overdue carrying colour, and overdue given more width than its
neighbours because it is the only one asking for something.

## Sign in had no card

Type floating on a wash that was too faint to read as intentional. It is a card with an
edge and a shadow now, on a ground with two blooms instead of three.

## Also in this pass

- **Icons.** Five for navigation, three for row controls, drawn once into a sprite in
  `index.html` and referenced by `<use>`. One stroke weight, `currentColor`, so they take
  the state colour of whatever holds them.
- **The dark palette is one definition again.** It used to be written out twice — once for
  `[data-theme='dark']` and again inside `prefers-color-scheme` for `[data-theme='auto']`,
  fifty lines that had to stay in step by hand. Each theme now sets `color-scheme` and
  nothing else, and every token is a single `light-dark()` pair. This closes the last item
  on the "still open" list below.
- **Person colours are paired.** Each pastel now ships with the ink that stays legible on
  it (`--peach` / `--on-peach`), which replaced a set of hardcoded hex values and a blanket
  `color: var(--ink)` override that flattened every avatar in dark mode.
- **The team panels stopped leaving holes.** In a narrow column the row controls claimed a
  line of their own, so every task in a team panel had a band of empty space under it. They
  share the line with the chips now.
- **Variable Inter with optical sizing**, a weight ladder that uses 650 for panel headings,
  and tracking that tightens as size grows.
- **The schedule got the same panel as every other list.** It is the one list with no
  `.card` wrapper in the markup, so it had been sitting on bare canvas.
- Segmented Open/Completed/All rather than three underlines that never touch; a search
  glyph and a styled clear button, since the user-agent cross is blue on a warm palette;
  a chevron drawn as SVG instead of two stacked linear-gradients; one scrollbar treatment
  for the whole app; the character counter moved clear of the resize grip.

Nothing here changed behaviour. `npm test` covers the same 25 checks and passes unchanged.

**On the browser floor.** `light-dark()` and `subgrid` are the two new requirements. Both
sit inside the floor the app already had: `@starting-style` for the dialogs, container
queries for the task rows, and `color-mix()` throughout already meant Chrome 117, Safari
17.4 and Firefox 129. There is no fallback palette on purpose — writing the light values a
second time would put the stylesheet straight back into the two-copies problem this pass
just removed, on a branch that no supported browser takes.

---

# Fourth pass: editing a repeating task

A recurring task could be created and deleted but never changed. Getting the frequency
wrong, or needing to move the next due date, meant deleting the schedule entry and
retyping it.

The obvious fix was to make the recurring dialog editable, but that would have left two
dialogs editing the same row with different field sets: edit from the schedule and you
could change the frequency but not the priority, status or handoff note; edit the same
task from the to-do list — where it already appeared, with an Edit button — and you got
the opposite. So the repeat controls moved into the one dialog that edits a task, and the
create-only `#recurringDialog` was retired. The change is a net deletion.

- The schedule's rows gained the **Edit** control every other row already had.
- **This task repeats** and the frequency now live in the task dialog, shown only when
  they apply. The due date is relabelled **Next due date** and stops being optional while
  the box is ticked, because a repeating task needs a date to count forward from.
- A one-off can be put on the schedule, and a repeating task taken off it, with that
  checkbox. Turning repeats back on clears `recurrence_generated`, which the last
  completion set — otherwise the schedule would never produce another occurrence.
- **Add recurring task** on the schedule opens the same dialog with the box already
  ticked, so there is one form to learn rather than two.

Three tests cover it: editing frequency from the schedule, converting a task in both
directions, and the pre-ticked create path.

One thing found while building it: `.repeat-block select { background: … }` used the
shorthand, which wiped the `background-image` that draws a select's chevron. Caught in a
screenshot rather than in the code.

---

# Third pass: accounts and polish

## Account creation

Signing in used to require the administrator to create a Supabase user by hand, copy its
UUID out of the dashboard, and paste it into an `insert`. Two people meant two trips
through that, and it also meant somebody other than Michaila or Brady knew their password
at least once.

Now the administrator invites an address and that is the whole job:

```sql
insert into public.invitations (email, display_name, role, title, office, accent, sort_order)
values ('brady@yourcompany.ca', 'Brady', 'member', 'Senior Accountant', 'Charlottetown', 'rose', 2);
```

The person visits the app, picks **Create your account**, and chooses their own password.
A trigger on `auth.users` writes their `profiles` row from the invitation and marks it
claimed. Nobody copies a UUID and nobody else ever knows the password.

**Sign-up is gated, not open.** An address with no invitation is turned away before an
account is created — the screen asks `public.email_is_invited`, which returns a boolean
and cannot be used to read the invitation list.

**This closed a real hole.** Every policy read `to authenticated using (true)`, meaning
*any* Supabase account in the project could read every task, note and activity row
straight from the REST API. That was survivable only because accounts could not be
created without the dashboard. Opening sign-up would have made it exploitable, so
membership is now "has a profile in this workspace", via `public.is_workspace_member()`,
and every policy is written in terms of it.

Also added, because an account nobody can get back into is not much use:

- **Forgot it?** on the sign-in screen emails a reset link. The reply is the same whether
  or not the address exists, so it cannot be used to find out who has an account.
- Following that link opens straight into **Set a new password**. The token arrives in the
  URL fragment and is cleared from the address bar before anything else runs, so it is not
  left in history or pasted into a shared link.
- **Your account** in the sidebar, for changing a password while signed in.

The trigger that provisions profiles swallows its own errors on purpose. A failure there
would otherwise surface to the person signing up as `Database error saving new user`;
instead the account is created without a profile, which is a state the app already
explains, and one insert repairs it.

## Design

Restrained rather than redecorated — the white-and-pastel direction is unchanged.

- **Depth is layered.** Shadows are two-part now: one tight shadow for the edge, one wide
  and soft for the lift. A single large shadow reads as a drop shadow; two read as depth.
  On dark the shadows do almost nothing, so depth comes from a hairline ring instead.
- **One pair of easing curves** for the whole interface. The browser default starts and
  ends slow, which reads as sluggish on small movements.
- **Dialogs rise into place** rather than appearing, using `@starting-style` so a
  `display: none` element can animate in at all. The backdrop fades with them.
- **The completion tick lands** with a small overshoot instead of switching state.
- Focus on a text field draws a soft accent ring rather than a hard outline. This also
  fixed a wobble where focusing an input changed its corner radius from 8px to 6px.
- Task rows tint on hover, project cards and attention counters lift, pressed buttons
  move by half a pixel, and each view rises as it opens.
- `-webkit-font-smoothing: antialiased`, balanced heading wrapping, a styled selection
  colour, and a thin scrollbar on the notes list.

Everything above stays inside the existing `prefers-reduced-motion` rule.

---

# Second pass

Written against the version at commit `82e17bc`. Everything below this heading is
covered by `npm test`.

## Bugs fixed

| Where | Problem |
|---|---|
| `supabase.js` | **Anyone left signed in for an hour got signed out.** The workspace poll fires four requests at once. When the access token expired all four came back 401 and all four called the refresh endpoint. Supabase rotates the refresh token on every use, so the first call succeeded and the other three spent a token that had already been replaced — each failure cleared the session. Concurrent callers now share a single refresh. The test asserts 4 parallel 401s produce exactly 1 refresh. |
| `supabase.js` | A write that timed out was replayed. `POST /tasks` that reached the database but lost the response on the way back created the task twice. Only `GET` and `HEAD` are retried now; a failed write is reported instead of guessed at. |
| `supabase.js` | `refreshSession` read `session.refresh_token` with no guard, so a session cleared by a parallel request threw a `TypeError` rather than a handled error. |
| `app.js` | **An expired refresh token left the workspace on screen failing silently.** Every poll showed "Something went wrong" and the only fix was knowing to reload. A session that cannot be renewed now returns to the sign-in screen and says why. |
| `app.js` | Two people completing the same recurring task within a few seconds each scheduled a next occurrence, so the month got two. Completing now claims the recurrence in one conditional write; whoever loses the race creates nothing. |
| `app.js` | Editing a task the other office had just deleted called `updateTask(undefined, …)` and threw. It now says the task is gone. |
| `app.js` | A `PATCH` that matched no row returned `undefined` and `Object.assign(task, undefined)` silently did nothing, so a save onto a deleted task looked like it worked. |
| `app.js` | Double-clicking a row control threw `InvalidStateError`: `showModal()` on a dialog that is already open. Ticking a checkbox twice before the first write landed toggled it back. |
| `app.js` | Sign out left the previous person's filters, search term, roster and note counts in place for whoever signed in next on the same machine. |
| `app.js` | The poller kept re-arming behind the sign-in screen, firing a timer every five seconds with nothing to fetch. |
| `app.js` | Sorting by name threw on a task with a null name. |
| `index.html` | `#noteBody` stayed `required` while the History tab hid it. A `required` control inside a hidden element cannot be focused, so the browser refuses the submit and reports it only to the console. |
| `styles.css` | **The recurring row was visibly broken below 900px.** The row has six children but the narrow breakpoints declared four columns and then three, so Pause and the delete control wrapped onto their own row and stranded themselves under the date. The three controls are now grouped in one element, matching how task rows already work. |
| `supabase-schema.sql` | Renaming a project skipped any task whose `project_id` was never resolved — one written before that column existed, or one whose project was created after it. Those kept pointing at the old name. |

## Also changed

**Deadline filter versus status filter.** Clicking an attention counter and then
"Completed" could only ever produce an empty list, since a deadline filter excludes
completed work by definition. Choosing a status filter now clears the deadline one.

**Two hot paths.** `dueInfo` was recomputed from scratch roughly ten times per task per
render — every task is measured by the attention band, the nav badge, two sorts and its
own row. It is memoised per calendar day now. Note counts were a linear scan of the whole
note index per row, which is quadratic in a busy workspace; they come from a map.

**The ten-minute re-render.** A timer re-rendered the entire interface every ten minutes
so that "tomorrow" would not still say tomorrow after midnight. That threw away hover and
text selection 143 times a day to catch one real change. It now checks the date and
re-renders only when the day has actually turned.

**A note posted and another deleted inside one poll window** left the sync signature
unchanged, so the counts did not move. The signature carries the highest note id as well
as the count.

**Errors that only reached the console.** A project that failed to save for any reason
other than a duplicate name said nothing at all.

**Accessibility.** The two tablists had no `aria-controls` and their panels had no
`role="tabpanel"`, so a screen reader had no way to connect a tab to what it switches.

**Storage.** `localStorage` throws in a private window and in a browser with storage
blocked. Reading the theme, writing the theme and writing the session each did so
unguarded; any one of them would take down module evaluation and leave a blank page.

## Database

- An index behind the query the app runs every five seconds
  (`tasks?deleted_at=is.null&order=created_at.asc`). Nothing covered it.
- The history now records priority changes and moves between projects. The move is keyed
  off `project_id` rather than the text column, so renaming a project does not log a move
  on every task inside it.
- The confirmation comment said to expect four rows and then listed five.

## Tests

`npm test` runs 14 checks in headless Chromium against a stubbed Supabase, so it needs no
project, no credentials and no network. It covers sign-in, the attention counters, the
filters, search, every sort order, task editing, notes and history, delete-and-undo, all
five views, the theme cycle, and both session-expiry paths. It fails on the code as it
stood before this pass.

Run it with:

```bash
npm install
npm test
```

---

# First pass

Written against the version at commit `7fa6c32`.

## Bugs fixed

| Where | Problem |
|---|---|
| `app.js` | `isSaving` was declared and checked by the 5 second poller but never set to `true`. A poll landing mid-save reverted the write with no warning. |
| `app.js` | `updateTask` sent the entire row on every change, so two people editing different fields of one task overwrote each other. Writes now patch only what changed. |
| `app.js` | `nextDueDate` produced `Invalid Date` for a recurring task with no due date and threw on `.toISOString()`. |
| `app.js` | Opening notes read `entity.name` without a guard, throwing if the other office deleted the item between the render and the click. |
| `supabase.js` | `signOut` only cleared `localStorage`, leaving the refresh token valid server side. It now revokes the token. |
| `styles.css` | Task rows overflowed their card in the team view because the name column had a 150px floor. |
| `supabase-schema.sql` | Deleting a task left its notes behind as orphans. |
| `supabase-schema.sql` | Renaming a project orphaned every task pointing at the old name, because `tasks.project` was loose text with no relationship to `projects`. |

## End user gaps closed

**There was no way to edit a task.** A wrong due date or assignee meant deleting the
task and retyping it. One dialog now handles both creating and editing.

**Deadlines were invisible.** Tasks sorted by creation date and nothing marked a task
overdue. The list now groups under due-date headings, every row carries a colour-coded
rail and a plain-language chip, and the overview leads with live counts for overdue,
due today, and due this week. Those counts are buttons that filter the list.

**Deletes were instant and permanent.** They now confirm first, delete softly, and offer
Undo.

**There was no search** and no sorting control. Both added, along with a priority field.

**Two people were hardcoded** in `index.html`, four places in `app.js`, and a
`check (assignee in ('Michaila', 'Brady'))` constraint in SQL. Adding a third person
meant editing four files and running a migration. The roster now comes from
`public.profiles`.

**Nothing recorded who changed what.** `public.task_activity` now logs creation,
completion, reassignment, due-date changes, status changes, and renames, surfaced under
a History tab.

## Accessibility

The root font size was 14px with a lot of 9px and 10px text, and several greys failed
contrast badly (`#a0a4a1` on white is about 2.3:1 against a 4.5:1 minimum). The palette
was rebuilt so every text colour passes, the base is 16px, and nothing is below 12px.
Also added: a skip link, `aria-current` on navigation, checkbox semantics on the
complete control, `aria-labelledby` on every dialog, focus moved into dialogs on open
and restored on close, visible focus rings, and a `prefers-reduced-motion` rule.

## Performance

The old build polled three endpoints every 5 seconds forever, including in background
tabs, and rebuilt the entire interface each time, discarding hover and focus state
twelve times a minute. Now:

- Polling backs off to 20 seconds when the tab is behind another window and stops when
  it is hidden, resuming immediately on focus.
- A cheap signature comparison skips the re-render when nothing actually changed.
- The note poll fetches two columns for counts instead of every note body in the
  workspace. Full note bodies load when a dialog opens.
- Requests have a 12 second timeout and retry twice with backoff, so office wifi blips
  no longer surface as errors.

## Database

Beyond the fixes above: indexes on the columns the app actually filters by, `priority`,
`completed_at`, `deleted_at`, `created_by` and `updated_by` on tasks, `updated_at` on
projects with a trigger to maintain it, and a policy letting signed-in users read the
roster. The handoff note cap went from 180 to 400 characters, which was truncating
mid-sentence.

`supabase-schema.sql` is idempotent, so it doubles as the migration. Run the whole file.

## Still open

- **No way to invite someone from inside the app.** The administrator still writes one
  `insert` in the SQL editor. An admin-only invitations screen is the obvious next step,
  and the RLS policies for it are already in place.
- **Nobody can be removed from the app either.** Set `profiles.active = false` in SQL to
  take someone off the roster.
- **Projects cannot be edited or deleted.** They can only be created. The database is
  ready for both — there is a rename-cascade trigger and a `projectStore.remove` nobody
  calls — but no interface reaches them. This is the largest remaining gap and the
  obvious next piece of work.
- **`projects.archived` is dead.** The column exists, nothing reads or writes it.
- **Realtime instead of polling.** Supabase Realtime over a websocket would remove the
  poll entirely. Left alone because it is a larger change than the rest of this work.
- **Bulk actions.** Marking five reconciliations complete still takes five clicks.
- **Attachments.** There is nowhere to put the bank statement PDF a task refers to.
- **Email or push reminders** for overdue work. Nothing currently reaches anyone who is
  not looking at the tab.
- **The `tasks.project` text column is still the value the app writes.** `project_id` is
  maintained alongside it by a trigger for integrity. Moving the app to write
  `project_id` directly would be cleaner and is a contained follow-up.
- **The test suite is a smoke suite.** It drives the interface against a stub. It does
  not exercise row level security, the triggers, or the SQL itself, which would need a
  seeded Supabase branch.
