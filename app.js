import { activityStore, auth, noteStore, profileStore, projectStore, taskStore, AuthError, OfflineError, SchemaError } from './supabase.js';

/* --------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */

let tasks = [];
let projects = [];
/** Everyone with a profile, including admins. */
let people = [];
/**
 * The people work is actually assigned to. Admins run the workspace and see
 * everything, but they are not part of the team roster, so they stay out of
 * assignee menus, the sidebar, the team view, and the focus list.
 */
let members = [];
/** entity key -> number of notes. Rebuilt whenever the note index changes. */
let noteCounts = new Map();
let currentProfile = null;
let dataSignature = '';
let hasLoadedOnce = false;

let taskFilter = 'open';
let dueFilter = 'all';
let searchTerm = '';
let sortBy = 'due';

/** Guards the poller so an in-flight save is never overwritten by stale data. */
let pendingSaves = 0;
let pollTimer = null;

const $ = selector => document.querySelector(selector);

// The recurring schedule used to carry its own create-only form. A repeating
// task is still a task, so it is created and edited in the same dialog as any
// other one, with the repeat controls shown when they apply.
const dialogs = {
  task: $('#taskDialog'),
  project: $('#projectDialog'),
  notes: $('#notesDialog'),
  account: $('#accountDialog'),
  confirm: $('#confirmDialog')
};
const authScreen = $('#authScreen');
const appShell = $('#appShell');

const DEFAULT_PEOPLE = [
  { id: null, display_name: 'Michaila', role: 'member', title: 'Controller', office: 'Halifax', accent: 'coral', active: true },
  { id: null, display_name: 'Brady', role: 'member', title: 'Senior Accountant', office: 'Charlottetown', accent: 'teal', active: true }
];

/* --------------------------------------------------------------------------
   Small helpers
   -------------------------------------------------------------------------- */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escapes for both text and attribute positions. */
function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ESCAPES[char]);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * A render asks for the same handful of dates over and over: every task is
 * measured by the attention band, the nav badge, two sorts and its own row.
 * The answer only changes when the calendar day does, so cache it and drop the
 * cache at midnight.
 */
const dueCache = new Map();
let dueCacheDay = 0;

/**
 * Turns a due date into the state the whole interface keys off: the chip, the
 * grouping, and the counts in the attention band.
 */
function dueInfo(value) {
  const today = startOfToday().getTime();
  if (today !== dueCacheDay) {
    dueCache.clear();
    dueCacheDay = today;
  }
  const cached = dueCache.get(value ?? '');
  if (cached) return cached;
  const info = computeDueInfo(value);
  dueCache.set(value ?? '', info);
  return info;
}

function computeDueInfo(value) {
  const date = parseDate(value);
  if (!date) return { state: 'none', bucket: 'none', label: 'No due date', days: null };

  const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - startOfToday()) / 86400000);

  if (days < 0) {
    const late = Math.abs(days);
    return { state: 'overdue', bucket: 'overdue', days, label: late === 1 ? '1 day late' : `${late} days late` };
  }
  if (days === 0) return { state: 'today', bucket: 'today', days, label: 'Today' };
  if (days === 1) return { state: 'soon', bucket: 'tomorrow', days, label: 'Tomorrow' };
  if (days <= 6) return { state: 'soon', bucket: 'week', days, label: date.toLocaleDateString('en-CA', { weekday: 'long' }) };

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return {
    state: 'later',
    bucket: 'later',
    days,
    label: date.toLocaleDateString('en-CA', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
  };
}

function dateLabel(value) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : 'No due date';
}

function statusLabel(status) {
  return { todo: 'To do', doing: 'In progress', waiting: 'Waiting' }[status] || 'To do';
}

function frequencyLabel(frequency) {
  return { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every quarter', yearly: 'Every year' }[frequency] || 'Every month';
}

function personFor(name) {
  return people.find(person => person.display_name === name);
}

const PERSON_ACCENTS = new Set(['coral', 'teal', 'blue', 'lavender', 'amber', 'rose']);
const PERSON_NAME_ACCENTS = new Map([
  ['michaila', 'coral'],
  ['brady', 'teal']
]);

function personAccent(name) {
  const assignedAccent = PERSON_NAME_ACCENTS.get(String(name || '').trim().toLowerCase());
  if (assignedAccent) return assignedAccent;
  const accent = personFor(name)?.accent;
  return PERSON_ACCENTS.has(accent) ? accent : 'lavender';
}

function avatar(name) {
  const initials = String(name || '?').trim().slice(0, 1).toUpperCase();
  return `<span class="avatar ${personAccent(name)}" title="${safe(name)}">${safe(initials)}</span>`;
}

function relativeTime(value) {
  const date = new Date(value);
  const seconds = Math.round((Date.now() - date) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  const sameDay = date.toDateString() === new Date().toDateString();
  if (sameDay) return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Only speaks up when something is wrong. A permanent "Up to date" label is
 * noise; the absence of a warning is the same information.
 */
function setSyncStatus(message, state = '') {
  const indicator = $('#syncStatus');
  const quiet = state === 'online';
  indicator.textContent = quiet ? '' : message;
  indicator.className = `sync-status ${state}`;
  indicator.hidden = quiet;
}

let toastTimer = null;
function showToast(message, { type = '', actionLabel = '', onAction = null, duration = 5000 } = {}) {
  const toast = $('#toast');
  const action = $('#toastAction');
  $('#toastMessage').textContent = message;

  action.hidden = !onAction;
  if (onAction) {
    action.textContent = actionLabel || 'Undo';
    action.onclick = () => {
      toast.className = 'toast';
      onAction();
    };
  }

  toast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, duration);
}

/* --------------------------------------------------------------------------
   Dialogs
   -------------------------------------------------------------------------- */

let lastFocused = null;

function openDialog(dialog) {
  // showModal() throws InvalidStateError on an already-open dialog, which a
  // double click on Edit or a stray keyboard shortcut can produce.
  if (dialog.open) return;
  lastFocused = document.activeElement;
  dialog.showModal();
  // Land on the first real field rather than the close button.
  const target = dialog.querySelector('input:not([type=hidden]), textarea, select');
  if (target) target.focus();
}

function closeDialog(dialog) {
  dialog.close();
  if (lastFocused?.isConnected) lastFocused.focus();
}

/** Promise-based replacement for deleting things with no warning at all. */
function confirmAction({ title, message, accept = 'Delete' }) {
  if (dialogs.confirm.open) return Promise.resolve(false);
  return new Promise(resolve => {
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    $('#confirmAccept').textContent = accept;

    const finish = result => {
      $('#confirmAccept').onclick = null;
      $('#confirmCancel').onclick = null;
      dialogs.confirm.removeEventListener('close', onClose);
      closeDialog(dialogs.confirm);
      resolve(result);
    };
    const onClose = () => finish(false);

    $('#confirmAccept').onclick = () => finish(true);
    $('#confirmCancel').onclick = () => finish(false);
    dialogs.confirm.addEventListener('close', onClose);

    lastFocused = document.activeElement;
    dialogs.confirm.showModal();
    $('#confirmCancel').focus();
  });
}

/* --------------------------------------------------------------------------
   Data access
   -------------------------------------------------------------------------- */

function handleError(error, fallbackMessage) {
  console.error(error);
  // A refresh token that has finally expired used to leave the workspace on
  // screen failing every poll with "something went wrong", with no hint that
  // the fix was to sign in again.
  if (error instanceof AuthError) {
    returnToSignIn(error.message);
    return;
  }
  if (error instanceof SchemaError) {
    $('#schemaBanner').hidden = false;
    setSyncStatus('Database out of date', 'error');
    return;
  }
  if (error instanceof OfflineError) {
    setSyncStatus('Offline — retrying', 'error');
    return;
  }
  setSyncStatus('Unable to save', 'error');
  if (fallbackMessage) showToast(fallbackMessage, { type: 'error' });
}

/** Wraps a write so the poller cannot land on top of it. */
async function save(operation, { failure } = {}) {
  pendingSaves += 1;
  setSyncStatus('Saving…', 'saving');
  try {
    const result = await operation();
    setSyncStatus('Up to date', 'online');
    return result;
  } catch (error) {
    handleError(error, failure);
    throw error;
  } finally {
    pendingSaves -= 1;
  }
}

function signatureOf(taskRows, projectRows, noteRows) {
  // Notes are never edited, so a count plus the highest id is enough to catch
  // a post, a delete, or one of each landing in the same poll window.
  const highestNote = noteRows.reduce((highest, note) => Math.max(highest, note.id || 0), 0);
  return [
    taskRows.map(task => `${task.id}:${task.updated_at}`).join(','),
    projectRows.map(project => `${project.id}:${project.updated_at || project.created_at}`).join(','),
    `${noteRows.length}:${highestNote}`
  ].join('|');
}

/** Ids arrive as numbers from JSON and as strings from data attributes. */
const noteKey = (type, id) => `${type}:${Number(id)}`;

function countNotes(noteRows) {
  const counts = new Map();
  for (const note of noteRows) {
    const key = noteKey(note.entity_type, note.entity_id);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function adjustNoteCount(type, id, delta) {
  const key = noteKey(type, id);
  noteCounts.set(key, Math.max(0, (noteCounts.get(key) || 0) + delta));
}

async function loadWorkspace({ quiet = false } = {}) {
  if (pendingSaves > 0) return;
  try {
    if (!quiet) setSyncStatus('Connecting…');
    const [taskRows, projectRows, noteRows, profileRows] = await Promise.all([
      taskStore.list(),
      projectStore.list(),
      noteStore.index(),
      profileStore.list()
    ]);

    const signature = signatureOf(taskRows, projectRows, noteRows);
    tasks = taskRows;
    projects = projectRows;
    noteCounts = countNotes(noteRows);
    people = resolvePeople(profileRows, taskRows);
    members = people.filter(person => person.role !== 'admin');
    hasLoadedOnce = true;

    // Skipping the re-render when nothing changed keeps hover, text selection
    // and focus alive between the twelve polls a minute.
    if (signature !== dataSignature) {
      dataSignature = signature;
      render();
    }
    setSyncStatus('Up to date', 'online');
  } catch (error) {
    handleError(error);
  }
}

/**
 * The roster comes from public.profiles. If the database still has the old
 * policy that exposes only your own row, fall back to the names already on
 * tasks so the app stays usable until the migration is run.
 */
function resolvePeople(profileRows, taskRows) {
  const active = (profileRows || []).filter(profile => profile.active !== false);
  if (active.length > 1) return active;

  const names = [...new Set([
    ...DEFAULT_PEOPLE.map(person => person.display_name),
    ...taskRows.map(task => task.assignee),
    // An admin is not on the roster, so their own name is not a fallback source.
    currentProfile?.role === 'admin' ? null : currentProfile?.display_name
  ].filter(Boolean))];

  return names.map(name => {
    const known = active.find(profile => profile.display_name === name) || DEFAULT_PEOPLE.find(person => person.display_name === name);
    return known || { id: null, display_name: name, role: 'member', title: '', office: '', accent: 'lavender', active: true };
  });
}

/* --------------------------------------------------------------------------
   Task operations
   -------------------------------------------------------------------------- */

const WRITABLE_FIELDS = ['name', 'assignee', 'due', 'project', 'recurring', 'frequency', 'paused', 'recurrence_generated', 'status', 'note', 'completed', 'priority'];

function diffOf(task, changes) {
  const patch = {};
  for (const [key, value] of Object.entries(changes)) {
    if (WRITABLE_FIELDS.includes(key) && task[key] !== value) patch[key] = value;
  }
  return patch;
}

/** Sends only what changed, so two people editing one task stop clobbering. */
async function updateTask(task, changes) {
  const patch = diffOf(task, changes);
  if (!Object.keys(patch).length) return task;
  const updated = await taskStore.update(task.id, patch);
  // No row came back: the other office deleted the task between this render
  // and this write. Saying nothing would leave the edit looking successful.
  if (!updated) throw new Error('That task is no longer in the workspace.');
  Object.assign(task, updated);
  return task;
}

async function createTask(fields) {
  const created = await taskStore.create(fields);
  tasks.push(created);
  return created;
}

function nextDueDate(date, frequency) {
  const start = parseDate(date) || startOfToday();
  const next = new Date(start);

  if (frequency === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else {
    const months = { monthly: 1, quarterly: 3, yearly: 12 }[frequency] || 1;
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + months);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
  }

  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

/** Ticking the same checkbox twice before the first write lands toggled it back. */
const togglesInFlight = new Set();

async function toggleComplete(task) {
  if (togglesInFlight.has(task.id)) return;

  const completed = !task.completed;
  const wantsNext = completed && task.recurring && !task.recurrence_generated;

  // Optimistic: the checkbox responds immediately and rolls back if the write
  // fails, instead of waiting on a round trip.
  const previous = { completed: task.completed, recurrence_generated: task.recurrence_generated };
  togglesInFlight.add(task.id);
  task.completed = completed;
  if (wantsNext) task.recurrence_generated = true;
  render();

  let scheduled = null;
  try {
    await save(async () => {
      if (!wantsNext) {
        await taskStore.update(task.id, { completed });
        return;
      }

      // Complete and claim the next occurrence in one conditional write. If
      // the other office ticked the same reconciliation first, nothing comes
      // back and we skip the insert rather than schedule it twice.
      const claimed = await taskStore.completeAndClaimRecurrence(task.id);
      if (!claimed) {
        await taskStore.update(task.id, { completed });
        return;
      }

      const due = nextDueDate(task.due, task.frequency);
      const { id, created_at, updated_at, completed_at, ...rest } = task;
      await createTask({
        ...rest,
        due,
        paused: false,
        recurrence_generated: false,
        status: 'todo',
        note: '',
        completed: false
      });
      scheduled = due;
    });
    if (scheduled) showToast(`Next occurrence scheduled for ${dateLabel(scheduled)}.`);
    render();
  } catch {
    Object.assign(task, previous);
    render();
  } finally {
    togglesInFlight.delete(task.id);
  }
}

async function removeTask(task, { label = 'Task' } = {}) {
  const confirmed = await confirmAction({
    title: `Delete this ${label.toLowerCase()}?`,
    message: `“${task.name}” will be removed from the workspace. You can undo this straight away.`
  });
  if (!confirmed) return;

  const index = tasks.indexOf(task);
  tasks = tasks.filter(item => item !== task);
  render();

  // A poll can replace the whole array between the delete and the Undo click,
  // so put the row back only if it is not already there.
  const restoreLocally = () => {
    if (!tasks.some(item => item.id === task.id)) tasks.splice(Math.min(index, tasks.length), 0, task);
    dataSignature = '';
    render();
  };

  try {
    await save(() => taskStore.softDelete(task.id), { failure: 'The task was not deleted.' });
    showToast(`${label} deleted.`, {
      actionLabel: 'Undo',
      onAction: async () => {
        try {
          await save(() => taskStore.restore(task.id), { failure: 'The task was not restored.' });
          restoreLocally();
          showToast(`${label} restored.`);
        } catch { /* handled by save() */ }
      }
    });
  } catch {
    restoreLocally();
  }
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

function noteTotal(type, id) {
  return noteCounts.get(noteKey(type, id)) || 0;
}

function notesButton(type, id) {
  const total = noteTotal(type, id);
  // A note count is information and stays visible; an empty Notes button is
  // just a control, so it waits for hover along with Edit and Delete.
  return `<button class="notes-button${total ? ' has-notes' : ''}" data-notes-type="${type}" data-notes-id="${id}">Notes${total ? ` <b>${total}</b>` : ''}</button>`;
}

/**
 * `compact` drops the row controls for glance views like the overview card,
 * which keeps long task names on one line instead of truncating them to make
 * room for buttons the reader is not going to press there.
 */
function taskMarkup(task, { compact = false } = {}) {
  const due = dueInfo(task.due);
  const meta = [safe(task.project), task.recurring ? frequencyLabel(task.frequency) : ''].filter(Boolean).join(' · ');
  const state = task.completed ? 'none' : due.state;

  // Only say the status when it is worth saying. Nearly every task is "To do",
  // so printing it on every row was a column of noise.
  const status = task.status === 'todo' || task.completed
    ? ''
    : `<span class="status ${safe(task.status)}">${statusLabel(task.status)}</span>`;

  return `<article class="task assignee-${personAccent(task.assignee)} ${task.completed ? 'done' : ''} ${compact ? 'compact' : ''}" data-id="${task.id}" data-due="${state}" data-priority="${safe(task.priority || 'normal')}">
    <button class="complete" role="checkbox" aria-checked="${task.completed}" aria-label="${task.completed ? 'Reopen' : 'Complete'} ${safe(task.name)}">✓</button>
    <div class="task-copy"><strong>${safe(task.name)}</strong><span class="task-meta">${meta}</span></div>
    <div class="task-tags"><span class="due-chip" data-state="${state}">${safe(due.label)}</span>${status}</div>
    ${avatar(task.assignee)}
    ${compact ? '' : `<div class="task-tools">${notesButton('task', task.id)}<button class="edit">Edit</button><button class="delete" aria-label="Delete ${safe(task.name)}">×</button></div>`}
    ${!compact && task.note ? `<p class="task-note">${safe(task.note)}</p>` : ''}
  </article>`;
}

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
const GROUP_TITLES = {
  overdue: 'Overdue',
  today: 'Due today',
  tomorrow: 'Tomorrow',
  week: 'This week',
  later: 'Later',
  none: 'No due date'
};

function sortTasks(list) {
  const copy = [...list];
  if (sortBy === 'name') return copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (sortBy === 'created') return copy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (sortBy === 'priority') {
    return copy.sort((a, b) =>
      (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
      (dueInfo(a.due).days ?? 99999) - (dueInfo(b.due).days ?? 99999));
  }
  // Due date: soonest first, undated last.
  return copy.sort((a, b) => (dueInfo(a.due).days ?? 99999) - (dueInfo(b.due).days ?? 99999));
}

/** Which due buckets each attention counter is asking for. */
const DUE_FILTER_BUCKETS = {
  overdue: ['overdue'],
  today: ['today'],
  week: ['overdue', 'today', 'tomorrow', 'week']
};

function visibleTasks() {
  const person = $('#personFilter').value;
  const term = searchTerm.trim().toLowerCase();
  const buckets = DUE_FILTER_BUCKETS[dueFilter];

  return tasks.filter(task => {
    if (taskFilter === 'open' && task.completed) return false;
    if (taskFilter === 'completed' && !task.completed) return false;
    if (person !== 'all' && task.assignee !== person) return false;

    // A deadline filter is about work still to do, so completed rows drop out
    // whatever the status filter says.
    if (buckets && (task.completed || !buckets.includes(dueInfo(task.due).bucket))) return false;

    if (term) {
      const haystack = `${task.name} ${task.project} ${task.assignee} ${task.note || ''}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}

function emptyState(title, hint) {
  return `<p class="empty"><b>${safe(title)}</b>${safe(hint)}</p>`;
}

function skeleton(rows = 3) {
  return `<div class="skeleton">${'<div class="skeleton-row"></div>'.repeat(rows)}</div>`;
}

function renderTasks() {
  const list = sortTasks(visibleTasks());
  const container = $('#taskList');

  $('#taskResultCount').textContent = `${list.length} ${list.length === 1 ? 'task' : 'tasks'}`;

  if (!list.length) {
    container.innerHTML = searchTerm || dueFilter !== 'all' || $('#personFilter').value !== 'all'
      ? emptyState('Nothing matches', 'Try clearing the search or the filter above.')
      : emptyState('Nothing here yet', 'Add a task to get started.');
    renderActiveFilters();
    return;
  }

  if (sortBy !== 'due') {
    container.innerHTML = list.map(task => taskMarkup(task)).join('');
    renderActiveFilters();
    return;
  }

  // Grouping under due-date headings makes the list read like a calendar.
  const groups = new Map();
  for (const task of list) {
    const bucket = task.completed ? 'none' : dueInfo(task.due).bucket;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(task);
  }

  const order = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'];
  container.innerHTML = order
    .filter(bucket => groups.has(bucket))
    .map(bucket => {
      const tone = bucket === 'overdue' ? 'overdue' : bucket === 'today' ? 'today' : '';
      const rows = groups.get(bucket);
      return `<h3 class="group-label" data-tone="${tone}">${GROUP_TITLES[bucket]} <span>${rows.length}</span></h3>${rows.map(task => taskMarkup(task)).join('')}`;
    })
    .join('');

  renderActiveFilters();
}

function renderActiveFilters() {
  const container = $('#activeFilters');
  const chips = [];
  if (dueFilter !== 'all') {
    const labels = { overdue: 'Overdue', today: 'Due today', week: 'Due this week' };
    chips.push(`<button class="chip" data-clear="due">${labels[dueFilter]}<span aria-hidden="true">×</span></button>`);
  }
  if (searchTerm.trim()) {
    chips.push(`<button class="chip" data-clear="search">“${safe(searchTerm.trim())}”<span aria-hidden="true">×</span></button>`);
  }
  const person = $('#personFilter').value;
  if (person !== 'all') {
    chips.push(`<button class="chip" data-clear="person">Assigned to ${safe(person)}<span aria-hidden="true">×</span></button>`);
  }
  if (chips.length > 1) chips.push('<button class="clear-filters" data-clear="all">Clear all</button>');
  container.innerHTML = chips.join('');
  container.hidden = !chips.length;
}

/**
 * `compact` is the overview preview: no Notes control, since the overview is
 * for glancing and the Projects tab is for working.
 */
function projectMarkup(project, { compact = false } = {}) {
  const related = tasks.filter(task => task.project === project.name);
  const complete = related.filter(task => task.completed).length;
  const overdue = related.filter(task => !task.completed && dueInfo(task.due).state === 'overdue').length;

  // One line instead of three, and no progress ring for a project with nothing
  // in it yet: a 0% dial is a graphic that says nothing.
  const summary = [
    related.length ? `${complete} of ${related.length} done` : 'No tasks yet',
    project.due ? `Due ${dueInfo(project.due).label}` : ''
  ].filter(Boolean).join(' · ');

  const progress = related.length ? Math.round(complete / related.length * 100) : null;
  const ring = progress === null
    ? ''
    : `<div class="progress-ring" style="--progress:${progress}" role="img" aria-label="${progress}% complete"><span>${progress}%</span></div>`;

  return `<article class="project-card ${safe(project.color)}">
    <div class="project-copy">
      <h3>${safe(project.name)}</h3>
      <p>${safe(project.description)}</p>
      <div class="project-meta">
        <span>${safe(summary)}</span>
        ${overdue ? `<span class="overdue">${overdue} overdue</span>` : ''}
      </div>
      ${compact ? '' : notesButton('project', project.id)}
    </div>
    ${ring}
  </article>`;
}

function renderAttentionBand() {
  const mine = tasks.filter(task => !task.completed && (currentProfile?.role === 'admin' || task.assignee === currentProfile?.display_name));
  const counts = { overdue: 0, today: 0, week: 0 };

  for (const task of mine) {
    const bucket = dueInfo(task.due).bucket;
    if (bucket === 'overdue') counts.overdue += 1;
    if (bucket === 'today') counts.today += 1;
    if (['overdue', 'today', 'tomorrow', 'week'].includes(bucket)) counts.week += 1;
  }

  const items = [];
  if (counts.overdue) items.push({ tone: 'overdue', value: counts.overdue, label: counts.overdue === 1 ? 'task overdue' : 'tasks overdue', filter: 'overdue' });
  if (counts.today) items.push({ tone: 'today', value: counts.today, label: 'due today', filter: 'today' });
  if (counts.week) items.push({ tone: 'soon', value: counts.week, label: 'due this week', filter: 'week' });

  if (!items.length) {
    items.push({ tone: 'clear', value: mine.length, label: mine.length === 1 ? 'open task, none due soon' : 'open tasks, none due soon', filter: 'all' });
  }

  $('#attentionBand').innerHTML = items
    .map(item => `<button class="attn" data-tone="${item.tone}" data-due-filter="${item.filter}"><strong>${item.value}</strong><span>${item.label}</span></button>`)
    .join('');
}

function renderNavCounts() {
  const mine = tasks.filter(task => !task.completed && (currentProfile?.role === 'admin' || task.assignee === currentProfile?.display_name));
  const overdue = mine.filter(task => dueInfo(task.due).state === 'overdue').length;

  const badge = $('#navCountOverview');
  badge.hidden = !overdue;
  badge.textContent = overdue;
  badge.dataset.tone = 'overdue';
}

function renderPeopleControls() {
  const options = members.map(person => `<option value="${safe(person.display_name)}">${safe(person.display_name)}</option>`).join('');

  const assignee = $('#assignee');
  const previousAssignee = assignee.value;
  assignee.innerHTML = options;
  // Keep whoever was selected, otherwise default to the person signing in.
  assignee.value = previousAssignee && members.some(person => person.display_name === previousAssignee)
    ? previousAssignee
    : (members.some(person => person.display_name === currentProfile?.display_name) ? currentProfile.display_name : assignee.options[0]?.value);

  const personFilter = $('#personFilter');
  const previousPerson = personFilter.value;
  personFilter.innerHTML = `<option value="all">Everyone</option>${options}`;
  personFilter.value = previousPerson && [...personFilter.options].some(option => option.value === previousPerson) ? previousPerson : 'all';

  $('#sidebarTeam').innerHTML = members
    .map(person => `<div class="person">${avatar(person.display_name)}<span>${safe(person.display_name)}</span>${person.title ? `<i>${safe(person.title)}</i>` : ''}</div>`)
    .join('');
}

function render() {
  renderPeopleControls();
  renderNavCounts();
  renderAttentionBand();

  const mine = sortTasks(tasks.filter(task => !task.completed && (currentProfile?.role === 'admin' || task.assignee === currentProfile?.display_name)));
  $('#overviewTasks').innerHTML = mine.length
    ? mine.slice(0, 5).map(task => taskMarkup(task, { compact: true })).join('')
    : emptyState('You are all caught up', 'Nothing open is assigned to you.');

  $('#overviewProjects').innerHTML = projects.length
    ? projects.slice(0, 3).map(project => projectMarkup(project, { compact: true })).join('')
    : emptyState('No projects yet', 'Create one to group related tasks.');
  $('#projectList').innerHTML = projects.length
    ? projects.map(projectMarkup).join('')
    : emptyState('No projects yet', 'Create a project, then assign tasks to it.');

  const projectSelect = $('#project');
  const previousProject = projectSelect.value;
  projectSelect.innerHTML = `${projects.map(project => `<option value="${safe(project.name)}">${safe(project.name)}</option>`).join('')}<option value="General">General</option>`;
  if (previousProject) projectSelect.value = previousProject;

  const recurring = sortTasks(tasks.filter(task => task.recurring && !task.completed));
  $('#recurringList').innerHTML = recurring.length
    ? recurring.map(task => {
        const due = dueInfo(task.due);
        // For anything more than a week out the relative label is just the date
        // again, so say what the date means instead of repeating it.
        const near = ['overdue', 'today', 'tomorrow', 'week'].includes(due.bucket);
        const caption = task.paused ? 'Paused' : near ? due.label : 'Next due';
        return `<article class="recurring-item ${task.paused ? 'paused' : ''}" data-id="${task.id}" data-due="${task.paused ? 'none' : due.state}">
          <div class="recurring-date"><strong>${dateLabel(task.due)}</strong><span>${caption}</span></div>
          <div class="recurring-copy"><strong>${safe(task.name)}</strong><span>${safe(task.project)} · ${frequencyLabel(task.frequency)}</span></div>
          ${avatar(task.assignee)}
          <div class="recurring-tools">
            ${notesButton('task', task.id)}
            <button class="edit">Edit</button>
            <button class="link recurring-toggle">${task.paused ? 'Resume' : 'Pause'}</button>
            <button class="delete" aria-label="Delete recurring task ${safe(task.name)}">×</button>
          </div>
        </article>`;
      }).join('')
    : emptyState('Nothing scheduled', 'Add the reconciliations and filings that repeat.');

  $('#teamList').innerHTML = members.map(person => {
    const name = person.display_name;
    const open = sortTasks(tasks.filter(task => !task.completed && task.assignee === name));
    return `<section class="card team-card person-${personAccent(name)}">
      <div class="team-heading">${avatar(name)}<div><h2>${safe(name)}</h2><p>${safe([person.title, person.office].filter(Boolean).join(' · '))}</p></div></div>
      ${open.map(task => taskMarkup(task)).join('') || emptyState('No open tasks', 'Nothing is assigned right now.')}
    </section>`;
  }).join('');

  renderTasks();
}

/* --------------------------------------------------------------------------
   Notes and history
   -------------------------------------------------------------------------- */

let openNotesContext = null;

async function renderNotesList() {
  const { type, id } = openNotesContext;
  const list = $('#notesList');
  list.innerHTML = skeleton(2);

  try {
    const rows = await noteStore.forEntity(type, id);
    list.innerHTML = rows.length
      ? rows.map(note => `<article class="note">
          <div><strong>${safe(note.author_name)}</strong><time>${relativeTime(note.created_at)}</time></div>
          <p>${safe(note.body)}</p>
          ${note.author_id === currentProfile.id || currentProfile.role === 'admin' ? `<button type="button" class="delete-note" data-note-id="${note.id}">Delete</button>` : ''}
        </article>`).join('')
      : emptyState('No notes yet', 'Add the first one below.');
  } catch (error) {
    handleError(error);
    list.innerHTML = emptyState('Could not load notes', 'Check your connection and try again.');
  }
}

async function renderHistoryList() {
  const { type, id } = openNotesContext;
  const list = $('#historyList');

  if (type !== 'task') {
    list.innerHTML = emptyState('No history', 'History is recorded for tasks only.');
    return;
  }

  list.innerHTML = skeleton(3);
  try {
    const rows = await activityStore.forTask(id);
    list.innerHTML = rows.length
      ? rows.map(entry => `<article class="history-item">
          <span class="history-dot" aria-hidden="true"></span>
          <span><b>${safe(entry.actor_name || 'Someone')}</b> ${safe(entry.action)}${entry.detail ? ` · ${safe(entry.detail)}` : ''}</span>
          <time>${relativeTime(entry.created_at)}</time>
        </article>`).join('')
      : emptyState('No history yet', 'Changes to this task will be listed here.');
  } catch (error) {
    // A database that has not run the migration has no task_activity table.
    if (error instanceof SchemaError) {
      list.innerHTML = emptyState('History is not set up', 'Run supabase-schema.sql to start recording changes.');
      return;
    }
    handleError(error);
    list.innerHTML = emptyState('Could not load history', 'Check your connection and try again.');
  }
}

function switchNotesTab(tab) {
  document.querySelectorAll('.notes-tab').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const onNotes = tab === 'notes';
  $('#notesList').hidden = !onNotes;
  $('#historyList').hidden = onNotes;
  $('#noteEntry').hidden = !onNotes;
  $('#noteActions').querySelector('.primary').hidden = !onNotes;
  // A `required` field the History tab has hidden cannot be focused, so the
  // browser refuses the submit with an error only the console sees.
  $('#noteBody').required = onNotes;
  if (tab === 'history') renderHistoryList();
}

function openNotes(type, id, name) {
  openNotesContext = { type, id };
  $('#noteEntityType').value = type;
  $('#noteEntityId').value = id;
  $('#notesEntityName').textContent = name;
  $('#noteBody').value = '';
  $('#noteCount').textContent = '0';
  switchNotesTab('notes');
  renderNotesList();
  openDialog(dialogs.notes);
}

/* --------------------------------------------------------------------------
   Task dialog (create and edit)
   -------------------------------------------------------------------------- */

/**
 * Keeps the repeat controls and the due date in step with the checkbox. A
 * repeating task needs a date to count forward from, so the date stops being
 * optional the moment the box is ticked.
 */
function syncRepeatFields() {
  const repeating = $('#taskRecurring').checked;
  $('#repeatFields').hidden = !repeating;
  $('#dueDate').required = repeating;
  $('#dueDateLabel').textContent = repeating ? 'Next due date' : 'Due date';
}

$('#taskRecurring').addEventListener('change', syncRepeatFields);

function openTaskDialog(task = null, { repeating = false } = {}) {
  $('#taskId').value = task?.id || '';
  const repeats = task ? Boolean(task.recurring) : repeating;
  $('#taskDialogTitle').textContent = task
    ? (repeats ? 'Edit recurring task' : 'Edit task')
    : (repeats ? 'Add a recurring task' : 'Add a task');
  $('#taskSubmit').textContent = task ? 'Save changes' : 'Add task';
  $('#taskName').value = task?.name || '';
  $('#dueDate').value = task?.due || '';
  $('#priority').value = task?.priority || 'normal';
  $('#status').value = task?.status || 'todo';
  $('#taskNote').value = task?.note || '';
  $('#taskNoteCount').textContent = String((task?.note || '').length);
  $('#taskRecurring').checked = repeats;
  $('#taskFrequency').value = task?.frequency || 'monthly';
  syncRepeatFields();

  renderPeopleControls();
  if (task) {
    $('#assignee').value = task.assignee;
    if (![...$('#project').options].some(option => option.value === task.project)) {
      $('#project').insertAdjacentHTML('afterbegin', `<option value="${safe(task.project)}">${safe(task.project)}</option>`);
    }
    $('#project').value = task.project;
  } else if (members.some(person => person.display_name === currentProfile?.display_name)) {
    $('#assignee').value = currentProfile.display_name;
  }

  openDialog(dialogs.task);
}

/* --------------------------------------------------------------------------
   Views
   -------------------------------------------------------------------------- */

const VIEW_TITLES = {
  overview: 'Overview',
  tasks: 'To-do list',
  projects: 'Projects',
  recurring: 'Recurring tasks',
  team: 'Team'
};

/**
 * One button, top right, that does whatever the current view is for. The
 * recurring view used to carry its own "Add recurring task" button alongside a
 * global "Add task", which left two competing ways to add work to one page.
 */
const VIEW_ACTIONS = {
  overview: ['Add task', () => openTaskDialog()],
  tasks: ['Add task', () => openTaskDialog()],
  projects: ['New project', () => openDialog(dialogs.project)],
  recurring: ['Add recurring task', () => openTaskDialog(null, { repeating: true })],
  team: ['Add task', () => openTaskDialog()]
};

let currentView = 'overview';

function runViewAction() {
  VIEW_ACTIONS[currentView][1]();
}

function showView(view) {
  if (!VIEW_TITLES[view]) return;
  currentView = view;

  document.querySelectorAll('.view').forEach(section => section.classList.remove('active'));
  $(`#${view}View`).classList.add('active');

  document.querySelectorAll('.nav-item').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  $('#pageTitle').textContent = VIEW_TITLES[view];

  const [label] = VIEW_ACTIONS[view];
  $('#primaryAction').textContent = label;
  $('#fabAdd').setAttribute('aria-label', label);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* --------------------------------------------------------------------------
   Events
   -------------------------------------------------------------------------- */

document.addEventListener('click', async event => {
  const attention = event.target.closest('[data-due-filter]');
  if (attention) {
    dueFilter = attention.dataset.dueFilter;
    taskFilter = 'open';
    document.querySelectorAll('.filter').forEach(button => {
      const active = button.dataset.filter === 'open';
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $('#taskList').setAttribute('aria-labelledby', 'filterOpen');
    showView('tasks');
    renderTasks();
    return;
  }

  const clearChip = event.target.closest('[data-clear]');
  if (clearChip) {
    if (clearChip.dataset.clear === 'due') dueFilter = 'all';
    if (clearChip.dataset.clear === 'search') { searchTerm = ''; $('#taskSearch').value = ''; }
    if (clearChip.dataset.clear === 'person') $('#personFilter').value = 'all';
    if (clearChip.dataset.clear === 'all') {
      dueFilter = 'all';
      searchTerm = '';
      $('#taskSearch').value = '';
      $('#personFilter').value = 'all';
    }
    renderTasks();
    return;
  }

  const nav = event.target.closest('[data-view], [data-go]');
  if (nav) { showView(nav.dataset.view || nav.dataset.go); return; }

  const closer = event.target.closest('[data-close]');
  if (closer) { closeDialog($(`#${closer.dataset.close}`)); return; }

  const notesTrigger = event.target.closest('[data-notes-type]');
  if (notesTrigger) {
    const type = notesTrigger.dataset.notesType;
    const id = Number(notesTrigger.dataset.notesId);
    const entity = type === 'project' ? projects.find(item => item.id === id) : tasks.find(item => item.id === id);
    // The other office may have deleted it between the render and this click.
    if (!entity) { showToast('That item is no longer in the workspace.', { type: 'error' }); return; }
    openNotes(type, id, entity.name);
    return;
  }

  const notesTab = event.target.closest('.notes-tab');
  if (notesTab) { switchNotesTab(notesTab.dataset.tab); return; }

  const deleteNote = event.target.closest('.delete-note');
  if (deleteNote) {
    const id = Number(deleteNote.dataset.noteId);
    try {
      await save(() => noteStore.remove(id), { failure: 'The note was not deleted.' });
      adjustNoteCount(openNotesContext.type, openNotesContext.id, -1);
      await renderNotesList();
      render();
      showToast('Note deleted.');
    } catch { /* handled by save() */ }
    return;
  }

  const recurringRow = event.target.closest('.recurring-item');
  if (recurringRow) {
    const task = tasks.find(item => item.id === Number(recurringRow.dataset.id));
    if (!task) return;
    if (event.target.closest('.edit')) { openTaskDialog(task); return; }
    if (event.target.closest('.recurring-toggle')) {
      try {
        await save(() => updateTask(task, { paused: !task.paused }), { failure: 'That change was not saved.' });
        render();
      } catch { /* handled by save() */ }
    }
    if (event.target.closest('.delete')) await removeTask(task, { label: 'Recurring task' });
    return;
  }

  const row = event.target.closest('.task');
  if (!row) return;
  const task = tasks.find(item => item.id === Number(row.dataset.id));
  if (!task) return;

  if (event.target.closest('.complete')) { await toggleComplete(task); return; }
  if (event.target.closest('.edit')) { openTaskDialog(task); return; }
  if (event.target.closest('.delete')) { await removeTask(task); return; }
});

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  taskFilter = button.dataset.filter;
  // "Completed" plus a deadline filter can only ever be empty, which read as a
  // broken list rather than a contradiction.
  if (taskFilter !== 'open') dueFilter = 'all';
  document.querySelectorAll('.filter').forEach(other => {
    const active = other === button;
    other.classList.toggle('active', active);
    other.setAttribute('aria-selected', String(active));
  });
  $('#taskList').setAttribute('aria-labelledby', button.id);
  renderTasks();
}));

$('#personFilter').addEventListener('change', renderTasks);
$('#sortBy').addEventListener('change', event => { sortBy = event.target.value; renderTasks(); });

let searchDebounce = null;
$('#taskSearch').addEventListener('input', event => {
  searchTerm = event.target.value;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderTasks, 140);
});

$('#primaryAction').addEventListener('click', runViewAction);
$('#fabAdd').addEventListener('click', runViewAction);
$('#dismissBanner').addEventListener('click', () => { $('#schemaBanner').hidden = true; });

$('#taskNote').addEventListener('input', event => { $('#taskNoteCount').textContent = event.target.value.length; });
$('#noteBody').addEventListener('input', event => { $('#noteCount').textContent = event.target.value.length; });

$('#taskForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;

  const recurring = $('#taskRecurring').checked;
  const fields = {
    name: $('#taskName').value.trim(),
    assignee: $('#assignee').value,
    due: $('#dueDate').value || null,
    project: $('#project').value,
    priority: $('#priority').value,
    status: $('#status').value,
    note: $('#taskNote').value.trim(),
    recurring,
    frequency: $('#taskFrequency').value
  };
  const id = Number($('#taskId').value);

  try {
    if (id) {
      const task = tasks.find(item => item.id === id);
      if (!task) {
        closeDialog(dialogs.task);
        showToast('That task is no longer in the workspace.', { type: 'error' });
        return;
      }
      // Turning repeating back on has to clear the flag the last completion
      // set, or the schedule would never produce another occurrence.
      if (recurring && !task.recurring) fields.recurrence_generated = false;
      await save(() => updateTask(task, fields), { failure: 'The task was not saved.' });
      showToast(recurring ? 'Recurring task updated.' : 'Task updated.');
    } else {
      await save(() => createTask({ ...fields, paused: false, recurrence_generated: false, completed: false }), { failure: 'The task was not created.' });
      showToast(recurring ? 'Added to the schedule.' : 'Task added.');
    }
    event.target.reset();
    closeDialog(dialogs.task);
    render();
  } catch { /* handled by save() */ }
  finally { submit.disabled = false; }
});

$('#projectForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  try {
    const project = await save(() => projectStore.create({
      name: $('#projectName').value.trim(),
      description: $('#projectDescription').value.trim(),
      due: $('#projectDueDate').value,
      color: $('#projectColor').value
    }));
    projects.push(project);
    event.target.reset();
    closeDialog(dialogs.project);
    render();
    showToast('Project created.');
  } catch (error) {
    if (/duplicate|unique/i.test(error.message || '')) {
      showToast('A project with that name already exists.', { type: 'error' });
    } else if (!(error instanceof AuthError)) {
      showToast('The project was not created.', { type: 'error' });
    }
  } finally { submit.disabled = false; }
});

$('#noteForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  const body = $('#noteBody').value.trim();
  if (!body) return;
  submit.disabled = true;

  try {
    const note = await save(() => noteStore.create({
      entity_type: $('#noteEntityType').value,
      entity_id: Number($('#noteEntityId').value),
      body,
      author_id: currentProfile.id,
      author_name: currentProfile.display_name
    }), { failure: 'The note was not posted.' });

    adjustNoteCount(note.entity_type, note.entity_id, 1);
    $('#noteBody').value = '';
    $('#noteCount').textContent = '0';
    await renderNotesList();
    render();
    showToast('Note posted.');
  } catch { /* handled by save() */ }
  finally { submit.disabled = false; }
});

/* --------------------------------------------------------------------------
   Keyboard shortcuts
   -------------------------------------------------------------------------- */

document.addEventListener('keydown', event => {
  if (appShell.hidden) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
  if (typing || document.querySelector('dialog[open]')) return;

  if (!event.key) return;

  if (event.key === '/') {
    event.preventDefault();
    showView('tasks');
    $('#taskSearch').focus();
  }
  // Matches whatever the top-right button currently says.
  if (event.key.toLowerCase() === 'n') {
    event.preventDefault();
    runViewAction();
  }
});

/* --------------------------------------------------------------------------
   Theme
   -------------------------------------------------------------------------- */

// Light is the default rather than auto, so the workspace stays white unless
// somebody deliberately asks for dark.
const THEME_ORDER = ['light', 'dark', 'auto'];
const THEME_LABELS = { light: 'Light theme', dark: 'Dark theme', auto: 'Match system' };
const THEME_KEY = 'tasktracker-theme';

let currentTheme = 'light';

function applyTheme(theme) {
  currentTheme = THEME_ORDER.includes(theme) ? theme : 'light';
  // Always stamped, including 'auto', so the stylesheet can scope the
  // prefers-color-scheme block to the auto case only.
  document.documentElement.dataset.theme = currentTheme;
  $('#themeToggleLabel').textContent = THEME_LABELS[currentTheme];
  // Private windows and locked-down browsers throw on write; the theme still
  // applies for this session, it just is not remembered.
  try { localStorage.setItem(THEME_KEY, currentTheme); } catch { /* not persisted */ }
}

let storedTheme = null;
try { storedTheme = localStorage.getItem(THEME_KEY); } catch { /* storage unavailable */ }
applyTheme(storedTheme || 'light');

$('#themeToggle').addEventListener('click', () => {
  applyTheme(THEME_ORDER[(THEME_ORDER.indexOf(currentTheme) + 1) % THEME_ORDER.length]);
});

/* --------------------------------------------------------------------------
   Auth
   -------------------------------------------------------------------------- */

/**
 * Everything the workspace holds about the signed-in user, so signing out or
 * being signed out never leaves one person's filters, roster or note counts in
 * front of the next person to use the machine.
 */
function resetWorkspaceState() {
  clearTimeout(pollTimer);
  pollTimer = null;
  tasks = [];
  projects = [];
  people = [];
  members = [];
  noteCounts = new Map();
  currentProfile = null;
  openNotesContext = null;
  dataSignature = '';
  hasLoadedOnce = false;
  taskFilter = 'open';
  dueFilter = 'all';
  searchTerm = '';
  $('#taskSearch').value = '';
  $('#signedInName').textContent = '';
  $('#signedInRole').textContent = '';
  $('#schemaBanner').hidden = true;
  setSyncStatus('', 'online');
}

/** Used both by the Sign out button and by a session that could not be renewed. */
function returnToSignIn(message = '') {
  resetWorkspaceState();
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  appShell.hidden = true;
  authScreen.hidden = false;
  setAuthMode('signin');
  $('#authError').textContent = message;
}

async function startApp() {
  if (!auth.getSession()) return;

  $('#overviewTasks').innerHTML = skeleton(4);
  $('#taskList').innerHTML = skeleton(5);

  try {
    currentProfile = await auth.profile();
    $('#signedInName').textContent = currentProfile.display_name;
    $('#signedInRole').textContent = currentProfile.role;
    $('#signedInAvatar').textContent = String(currentProfile.display_name || '?').trim().slice(0, 1).toUpperCase();
    $('#signedInAvatar').className = `avatar ${currentProfile.accent || 'lavender'}`;
    $('#openAccount').setAttribute('aria-label', `Account settings for ${currentProfile.display_name}`);
    authScreen.hidden = true;
    appShell.hidden = false;
    await loadWorkspace();
    schedulePoll();
  } catch (error) {
    await auth.signOut();
    returnToSignIn(error.message);
  }
}

/* --------------------------------------------------------------------------
   Sign in, create account, reset password

   One card, four modes. Accounts are gated on an invitation, so the sign-up
   step asks the database whether the address is expected before it creates
   anything: an uninvited address gets a plain answer rather than an account
   that can see nothing.
   -------------------------------------------------------------------------- */

const MIN_PASSWORD = 8;

const AUTH_MODES = {
  signin: {
    title: 'Sign in',
    subtitle: 'Enter your work email to continue.',
    submit: 'Sign in',
    busy: 'Signing in…',
    switchText: 'First time here?',
    switchAction: 'Create your account',
    next: 'signup'
  },
  signup: {
    title: 'Create your account',
    subtitle: 'Choose a password for the email you were invited with.',
    submit: 'Create account',
    busy: 'Creating your account…',
    switchText: 'Already have an account?',
    switchAction: 'Sign in',
    next: 'signin'
  },
  reset: {
    title: 'Reset your password',
    subtitle: 'We will email you a link to set a new one.',
    submit: 'Send reset link',
    busy: 'Sending…',
    switchText: 'Remembered it?',
    switchAction: 'Back to sign in',
    next: 'signin'
  },
  recover: {
    title: 'Set a new password',
    subtitle: 'Choose the password you will use from now on.',
    submit: 'Save password',
    busy: 'Saving…',
    switchText: '',
    switchAction: 'Cancel',
    next: 'signin'
  }
};

let authMode = 'signin';

function setAuthMode(mode, { keepNote = false } = {}) {
  authMode = mode;
  const config = AUTH_MODES[mode];
  const wantsConfirm = mode === 'signup' || mode === 'recover';
  const wantsPassword = mode !== 'reset';

  $('#authTitle').textContent = config.title;
  $('#authSubtitle').textContent = config.subtitle;
  $('#authSubmit').textContent = config.submit;
  $('#authSwitchText').textContent = config.switchText;
  $('#authSwitchButton').textContent = config.switchAction;
  $('#authSwitchText').hidden = !config.switchText;

  $('#emailField').hidden = mode === 'recover';
  $('#passwordField').hidden = !wantsPassword;
  $('#confirmField').hidden = !wantsConfirm;
  $('#passwordHint').hidden = !wantsConfirm;
  $('#forgotPassword').hidden = mode !== 'signin';

  // A hidden required control cannot be focused, so the browser would refuse
  // the submit and explain it only to the console.
  $('#loginEmail').required = mode !== 'recover';
  $('#loginPassword').required = wantsPassword;
  $('#loginConfirm').required = wantsConfirm;
  $('#loginPassword').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
  $('#loginPassword').minLength = wantsConfirm ? MIN_PASSWORD : 0;

  $('#authError').textContent = '';
  if (!keepNote) {
    $('#authNote').textContent = '';
    $('#authNote').hidden = true;
  }
  $('#loginPassword').value = '';
  $('#loginConfirm').value = '';
}

function showAuthNote(message) {
  $('#authError').textContent = '';
  $('#authNote').textContent = message;
  $('#authNote').hidden = false;
}

$('#authSwitchButton').addEventListener('click', () => setAuthMode(AUTH_MODES[authMode].next));
$('#forgotPassword').addEventListener('click', () => setAuthMode('reset'));

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  const config = AUTH_MODES[authMode];
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;
  const confirmation = $('#loginConfirm').value;

  $('#authError').textContent = '';
  $('#authNote').hidden = true;

  if ((authMode === 'signup' || authMode === 'recover')) {
    if (password.length < MIN_PASSWORD) {
      $('#authError').textContent = `Use at least ${MIN_PASSWORD} characters.`;
      return;
    }
    if (password !== confirmation) {
      $('#authError').textContent = 'Those two passwords do not match.';
      return;
    }
  }

  button.disabled = true;
  button.textContent = config.busy;

  try {
    if (authMode === 'signin') {
      await auth.signIn(email, password);
      await startApp();
      event.target.reset();
    } else if (authMode === 'signup') {
      if (!await auth.isInvited(email)) {
        throw new Error('That email has not been invited, or its account already exists. Ask the workspace administrator, or sign in instead.');
      }
      const outcome = await auth.signUp(email, password);
      if (outcome === 'signed-in') {
        await startApp();
        event.target.reset();
      } else {
        setAuthMode('signin');
        showAuthNote('Account created. Check your email for a confirmation link, then sign in.');
      }
    } else if (authMode === 'reset') {
      await auth.sendPasswordReset(email);
      setAuthMode('signin', { keepNote: true });
      showAuthNote('If that address has an account, a reset link is on its way.');
    } else {
      await auth.updatePassword(password);
      setAuthMode('signin');
      showAuthNote('Password saved. Sign in with it.');
    }
  } catch (authFailure) {
    $('#authError').textContent = authFailure.message;
  } finally {
    button.disabled = false;
    button.textContent = config.submit;
  }
});

$('#openAccount').addEventListener('click', () => {
  const initial = String(currentProfile?.display_name || '?').trim().slice(0, 1).toUpperCase();
  $('#accountAvatar').textContent = initial;
  $('#accountAvatar').className = `avatar ${currentProfile?.accent || 'lavender'}`;
  $('#accountName').textContent = currentProfile?.display_name || '';
  $('#accountEmail').textContent = auth.getSession()?.user?.email || '';
  $('#accountPassword').value = '';
  $('#accountConfirm').value = '';
  $('#accountError').textContent = '';
  openDialog(dialogs.account);
});

$('#accountForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  const password = $('#accountPassword').value;
  const error = $('#accountError');
  error.textContent = '';

  if (password.length < MIN_PASSWORD) {
    error.textContent = `Use at least ${MIN_PASSWORD} characters.`;
    return;
  }
  if (password !== $('#accountConfirm').value) {
    error.textContent = 'Those two passwords do not match.';
    return;
  }

  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    await auth.updatePassword(password);
    closeDialog(dialogs.account);
    showToast('Password changed.');
  } catch (failure) {
    error.textContent = failure.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Change password';
  }
});

$('#signOut').addEventListener('click', async () => {
  returnToSignIn();
  await auth.signOut();
});

$('#togglePassword').addEventListener('click', event => {
  const password = $('#loginPassword');
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  event.currentTarget.textContent = show ? 'Hide' : 'Show';
  event.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

/* --------------------------------------------------------------------------
   Sync loop

   The old version polled every five seconds forever, including in background
   tabs, and re-rendered the whole interface each time. This backs off when the
   tab is not in front and stops entirely when it is hidden.
   -------------------------------------------------------------------------- */

function pollDelay() {
  if (document.hidden) return null;
  return document.hasFocus() ? 5000 : 20000;
}

function schedulePoll() {
  clearTimeout(pollTimer);
  // Nothing to poll for while signed out, and re-arming there left a timer
  // firing every five seconds behind the sign-in screen. Signing in re-arms.
  if (!auth.getSession()) return;

  const delay = pollDelay();
  if (delay === null) return;

  pollTimer = setTimeout(async () => {
    if (!auth.getSession()) return;
    if (!pendingSaves && !document.querySelector('dialog[open]')) {
      await loadWorkspace({ quiet: true });
    }
    schedulePoll();
  }, delay);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(pollTimer); return; }
  if (auth.getSession()) { loadWorkspace({ quiet: true }); schedulePoll(); }
});
window.addEventListener('focus', schedulePoll);

window.addEventListener('unhandledrejection', event => {
  console.error(event.reason);
  if (auth.getSession() && !(event.reason instanceof OfflineError)) {
    setSyncStatus('Something went wrong', 'error');
  }
});

// Dates roll over at midnight; refresh the relative labels so an open tab does
// not keep calling today's work "tomorrow". Only when the day has actually
// changed: a blind re-render every ten minutes threw away hover and text
// selection a hundred and forty times a day for nothing.
let renderedDay = startOfToday().getTime();
setInterval(() => {
  const today = startOfToday().getTime();
  if (today === renderedDay || !hasLoadedOnce) return;
  if (document.querySelector('dialog[open]')) return;
  renderedDay = today;
  render();
}, 600000);

/**
 * A password-reset link comes back with a session in the URL fragment and no
 * user id, which every other path would read as a broken session. Take that
 * case first and go straight to "set a new password".
 */
if (auth.adoptSessionFromUrl() === 'recovery') {
  setAuthMode('recover');
  authScreen.hidden = false;
} else {
  setAuthMode('signin');
  startApp();
}
