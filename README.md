# Tasktracker

A focused coordination workspace for Michaila and Brady.

## Run locally

No build step is required. Start any static file server from the project directory:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Features

- Overview of open work and current team focus
- Individual to-do list with open, completed, and assignee filters
- Project progress and recurring task sections
- Team view showing what each person is working on
- Lightweight status updates and notes for cross-office handoffs
- Task creation with an assignee, due date, project, and recurring marker
- One-click task completion and reopening
- Task deletion
- Shared Supabase persistence for newly created and updated tasks
- Responsive desktop and mobile layout

## Supabase setup

The app is configured to use Supabase for shared persistence. Before opening it:

1. Open the Supabase project SQL Editor.
2. Open `supabase-schema.sql`, copy the **entire file** into a new SQL Editor query, and
   run it before inserting any profiles. The result should list both `profiles` and
   `tasks`.
3. In **Authentication → Users**, create accounts for Michaila, Brady, and the administrator.
4. Copy each user UUID and create their profile in the SQL Editor:

```sql
insert into public.profiles (id, display_name, role) values
  ('MICHAILA_USER_UUID', 'Michaila', 'member'),
  ('BRADY_USER_UUID', 'Brady', 'member'),
  ('ADMIN_USER_UUID', 'Your name', 'admin');
```

5. Start the local server and sign in with one of the accounts.

If Supabase reports `relation "public.profiles" does not exist`, the schema migration
has not been run successfully yet. Run all of `supabase-schema.sql`, confirm its final
query lists `public.profiles`, and only then run the profile `insert` statement.

The browser uses the publishable key in `supabase.js`; no secret or service-role key is
stored in the frontend. The app refreshes shared data every five seconds so updates made
in Halifax or Charlottetown appear without a manual reload. Only authenticated users with
a matching profile can open the workspace.
