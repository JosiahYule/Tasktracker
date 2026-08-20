# Tasktracker

A shared task workspace for the accounting team in Halifax and Charlottetown.

## Run locally

The app itself has no build step. Start any static file server from the project
directory:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Tests

```bash
npm install
npm test
```

`npm test` drives the interface in headless Chromium against a stubbed Supabase, so it
needs no project, no credentials and no network. It covers sign-in, the attention
counters, the filters, search, every sort order, task editing, notes and history,
delete-and-undo, all five views, the theme cycle, and both ways a session can end.
Playwright is the only dependency, and it is a dev dependency — nothing is bundled into
the app.

## Features

- Overview with live counts for overdue work, work due today, and work due this week
- To-do list grouped by due date, with search, assignee filter, and sorting
- Full task editing: name, assignee, due date, project, priority, status, and handoff note
- Deletion with a confirmation step and an Undo that restores the task
- Projects with progress rings and an overdue count
- Recurring schedule that creates the next occurrence when one is completed
- Team view showing each person's open work
- Threaded notes on tasks and projects, plus a per-task history of who changed what
- Light, dark, and automatic colour themes
- Keyboard shortcuts: `N` for the current page's action, `/` to search
- Shared Supabase persistence with background sync

## Supabase setup

1. Open the Supabase project SQL Editor.
2. Copy the **entire** contents of `supabase-schema.sql` into a new query and run it.
   The final statement should list `notes`, `profiles`, `projects`, `task_activity`,
   and `tasks`.
3. In **Authentication → Users**, create an account for each team member.
4. Copy each user UUID and create their profile:

```sql
insert into public.profiles (id, display_name, role, title, office, accent, sort_order) values
  ('MICHAILA_USER_UUID', 'Michaila', 'member', 'Controller',        'Halifax',        'coral',    1),
  ('BRADY_USER_UUID',    'Brady',    'member', 'Senior Accountant', 'Charlottetown',  'teal',     2),
  ('ADMIN_USER_UUID',    'Your name','admin',  'Administrator',     'Halifax',        'lavender', 3);
```

5. Start the local server and sign in.

`supabase-schema.sql` is safe to re-run. It creates anything missing and upgrades an
existing database in place without touching your data, so run the whole file again
after pulling changes.

### Adding someone to the team

Create their Supabase user, insert one row into `public.profiles`, and they appear in
the assignee menus, the sidebar, the team view, and the person filter. No code change
is needed. `accent` accepts `coral`, `teal`, `blue`, `lavender`, `amber`, or `rose`.

Profiles with `role = 'admin'` are deliberately left off that roster. An admin sees
every task in the workspace and can delete permanently, but work is not assigned to
them and they do not appear in the team list.

### If the app shows "The database is behind this version of the app"

The frontend asked for a column or table the database does not have yet. Run all of
`supabase-schema.sql` in the SQL Editor and reload.

## How data is handled

- Deleting a task sets `deleted_at` rather than removing the row, which is what makes
  Undo work. Permanent deletion is restricted to profiles with the `admin` role.
- Every task change is written to `public.task_activity`, visible under the History tab
  of any task's Notes dialog.
- Renaming a project updates the tasks assigned to it instead of orphaning them.
- Edits patch only the fields that changed, so two people working on the same task at
  once do not overwrite each other.

The browser uses the publishable key in `supabase.js`. No secret or service-role key is
stored in the frontend. Shared data refreshes every 5 seconds while the tab is in front,
every 20 seconds when it is behind another window, and pauses when the tab is hidden.
Only authenticated users with a matching profile can open the workspace.

Access tokens are renewed in the background, so a tab left open all day keeps working.
When a session can no longer be renewed the app returns to the sign-in screen and says
so, rather than staying on screen and failing quietly.
