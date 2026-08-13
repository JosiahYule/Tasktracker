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
2. Run `supabase-schema.sql` once to create the table, validation, and row-level security policies.
3. Start the local server and open the app as described above.

The browser uses the publishable key in `supabase.js`; no secret or service-role key is
stored in the frontend. The app refreshes shared data every five seconds so updates made
in Halifax or Charlottetown appear without a manual reload.
