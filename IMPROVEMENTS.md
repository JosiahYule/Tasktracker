# Review notes

What was wrong, what changed, and what is still open. Written against the version at
commit `7fa6c32`.

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

- **Realtime instead of polling.** Supabase Realtime over a websocket would remove the
  poll entirely. Left alone because it is a larger change than the rest of this work.
- **Bulk actions.** Marking five reconciliations complete still takes five clicks.
- **Attachments.** There is nowhere to put the bank statement PDF a task refers to.
- **Email or push reminders** for overdue work. Nothing currently reaches anyone who is
  not looking at the tab.
- **The `tasks.project` text column is still the value the app writes.** `project_id` is
  maintained alongside it by a trigger for integrity. Moving the app to write
  `project_id` directly would be cleaner and is a contained follow-up.
- **No automated tests.** There is no build step, so a small Playwright smoke suite
  against a seeded Supabase branch would be the lightest useful option.
