/**
 * A workspace with one of everything the interface has a branch for: an
 * overdue task, one due today, one later in the week, one with no date, a
 * recurring one, and a completed one.
 */

const now = new Date();
const iso = date => date.toISOString();

export const isoNow = iso(now);

/** Offset from today as the `yyyy-mm-dd` string the date column stores. */
export function day(offset) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const profiles = [
  { id: 'u-1', display_name: 'Michaila', role: 'member', title: 'Controller', office: 'Halifax', accent: 'coral', active: true, sort_order: 1 },
  { id: 'u-2', display_name: 'Brady', role: 'member', title: 'Senior Accountant', office: 'Charlottetown', accent: 'teal', active: true, sort_order: 2 },
  { id: 'u-3', display_name: 'Avery', role: 'admin', title: 'Administrator', office: 'Halifax', accent: 'lavender', active: true, sort_order: 3 }
];

function task(id, overrides) {
  return {
    id,
    name: `Task ${id}`,
    assignee: 'Michaila',
    due: day(0),
    project: 'General',
    recurring: false,
    frequency: 'monthly',
    paused: false,
    recurrence_generated: false,
    status: 'todo',
    note: '',
    completed: false,
    priority: 'normal',
    completed_at: null,
    created_at: isoNow,
    updated_at: isoNow,
    ...overrides
  };
}

export const tasks = [
  task(1, { name: 'Overdue reconciliation', due: day(-3), priority: 'high' }),
  task(2, { name: 'Due today filing', due: day(0) }),
  task(3, { name: 'Next week review', due: day(5), assignee: 'Brady', status: 'doing' }),
  task(4, { name: 'No date backlog', due: null }),
  task(5, { name: 'Monthly bank rec', due: day(-1), recurring: true, frequency: 'monthly' }),
  task(6, { name: 'Finished thing', completed: true, completed_at: isoNow })
];

export const projects = [
  { id: 10, name: 'Year-end', description: 'Audit prep', due: day(20), color: 'blue', created_at: isoNow, updated_at: isoNow }
];

/** Two notes on task 1, one on the project. */
export const noteIndex = [
  { id: 1, entity_type: 'task', entity_id: 1 },
  { id: 2, entity_type: 'task', entity_id: 1 },
  { id: 3, entity_type: 'project', entity_id: 10 }
];

export const noteBodies = [
  { id: 1, entity_type: 'task', entity_id: 1, body: 'Statement is in the shared drive.', author_id: 'u-1', author_name: 'Michaila', created_at: isoNow }
];

export const activity = [
  { id: 1, task_id: 1, actor_id: 'u-2', actor_name: 'Brady', action: 'reassigned', detail: 'Brady to Michaila', created_at: isoNow }
];
