# Review notes

What was wrong, what changed, and what is still open.

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
- **The dark palette is written out twice**, once for `[data-theme='dark']` and again
  inside the `prefers-color-scheme` block for `[data-theme='auto']`. Roughly fifty lines
  that have to stay in step by hand. CSS `light-dark()` would collapse them into one
  definition per token; it is a wide diff for no behaviour change, so it was left alone.
- **The test suite is a smoke suite.** It drives the interface against a stub. It does
  not exercise row level security, the triggers, or the SQL itself, which would need a
  seeded Supabase branch.
