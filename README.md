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
- Full task editing: name, assignee, due date, project, priority, status, handoff note,
  and whether the task repeats
- Deletion with a confirmation step and an Undo that restores the task
- Projects with progress rings and an overdue count
- Recurring schedule that creates the next occurrence when one is completed. Repeating
  tasks are edited in the same dialog as any other, so the frequency, the next due date
  and everything else can be changed after the fact — and a one-off can be put on the
  schedule, or taken off it, with one checkbox
- Team view showing each person's open work
- Threaded notes on tasks and projects, plus a per-task history of who changed what
- Self-serve accounts: the administrator invites an email, that person sets their own
  password, resets it themselves, and can change it later
- Light, dark, and automatic colour themes
- Keyboard shortcuts: `N` for the current page's action, `/` to search
- Shared Supabase persistence with background sync

## Supabase setup

1. Open the Supabase project SQL Editor.
2. Copy the **entire** contents of `supabase-schema.sql` into a new query and run it.
   The final statement should list `invitations`, `notes`, `profiles`, `projects`,
   `task_activity`, and `tasks`.
3. Invite the team. One row each — no user UUIDs to copy, because the account does not
   exist yet:

```sql
insert into public.invitations (email, display_name, role, title, office, accent, sort_order) values
  ('michaila@yourcompany.ca', 'Michaila',  'member', 'Controller',        'Halifax',       'coral',    1),
  ('brady@yourcompany.ca',    'Brady',     'member', 'Senior Accountant', 'Charlottetown', 'rose',     2),
  ('you@yourcompany.ca',      'Your name', 'admin',  'Administrator',     'Halifax',       'lavender', 3)
on conflict (email) do nothing;
```

4. In **Authentication → URL Configuration**, set the **Site URL** to wherever the app is
   served from, and add the same address under **Redirect URLs**. Password reset links
   come back to it.
5. Send each person the address. They choose **Create your account**, enter the email
   they were invited with, and pick their own password.

### How accounts work

Nobody creates passwords for anybody else. The administrator says who is allowed in, and
each person sets their own password the first time they visit.

- An address with no invitation is turned away before an account is created. The app asks
  the database through `public.email_is_invited`, which answers with a boolean and cannot
  be used to read the invitation list.
- When an invited address signs up, a trigger on `auth.users` writes their `profiles` row
  from the invitation and marks it claimed, so a second person cannot reuse it.
- **Row level security requires a profile, not just a token.** An account that somehow
  reaches the API without an invitation reads nothing at all.
- If your project has **Confirm email** switched on (the Supabase default), sign-up says
  to check the inbox. Switch it off under **Authentication → Providers → Email** if you
  would rather people go straight in.

Forgetting a password no longer needs an administrator: **Forgot it?** on the sign-in
screen emails a link back to the app, which opens straight into "set a new password".
Anyone signed in can change theirs from **their name in the sidebar → Your account**.

`supabase-schema.sql` is safe to re-run. It creates anything missing and upgrades an
existing database in place without touching your data, so run the whole file again
after pulling changes.

### Adding someone to the team

Insert one row into `public.invitations` and send them the address. Once they create
their account they appear in the assignee menus, the sidebar, the team view, and the
person filter. No code change is needed. `accent` accepts `coral`, `teal`, `blue`,
`lavender`, `amber`, or `rose`.

To see who has joined:

```sql
select email, display_name, claimed_at from public.invitations order by sort_order;
```

A `claimed_at` of `null` means that person has not set a password yet.

Profiles with `role = 'admin'` are deliberately left off that roster. An admin sees
every task in the workspace and can delete permanently, but work is not assigned to
them and they do not appear in the team list.

### If the app shows "The database is behind this version of the app"

The frontend asked for a column or table the database does not have yet. Run all of
`supabase-schema.sql` in the SQL Editor and reload.

## How data is handled

- Every table is readable only by an account that has a profile in this workspace.
  Holding a valid Supabase token is not enough.
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
