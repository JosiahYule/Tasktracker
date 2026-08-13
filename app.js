import { auth, taskStore } from './supabase.js';

const projects = [
  { name: 'Month-end close', description: 'Complete August close and reporting', due: 'Aug 19', color: 'coral' },
  { name: 'FY26 planning', description: 'Build next year’s operating plan', due: 'Sep 5', color: 'blue' },
  { name: 'Systems review', description: 'Review access and finance workflows', due: 'Sep 28', color: 'teal' }
];
let tasks = [];
let taskFilter = 'open';
let currentProfile = null;
let isSaving = false;
const dialog = document.querySelector('#taskDialog');
const updateDialog = document.querySelector('#updateDialog');
const recurringDialog = document.querySelector('#recurringDialog');
const authScreen = document.querySelector('#authScreen');
const appShell = document.querySelector('#appShell');

async function startApp() {
  if (!auth.getSession()) return;
  try {
    const profile = await auth.profile();
    currentProfile = profile;
    document.querySelector('#signedInName').textContent = profile.display_name;
    document.querySelector('#signedInRole').textContent = profile.role;
    authScreen.hidden = true;
    appShell.hidden = false;
    document.querySelector('#myTasksSubtitle').textContent = profile.role === 'admin' ? 'Open tasks across the team' : `${profile.display_name}’s next tasks`;
    await loadTasks();
  } catch (error) {
    auth.signOut();
    authScreen.hidden = false;
    appShell.hidden = true;
    document.querySelector('#authError').textContent = error.message;
  }
}

function fromDatabase(task) {
  return { ...task, recurrenceGenerated: task.recurrence_generated };
}
function toDatabase(task) {
  const { recurrenceGenerated, created_at, updated_at, ...record } = task;
  return { ...record, recurrence_generated: recurrenceGenerated || false };
}
function setSyncStatus(message, state = '') {
  const indicator = document.querySelector('#syncStatus');
  indicator.textContent = message;
  indicator.className = `sync-status ${state}`;
}
function showToast(message, type = '') {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toast.className = 'toast'; }, 3000);
}
async function loadTasks({ quiet = false } = {}) {
  try {
    if (!quiet) setSyncStatus('Connecting…');
    const records = await taskStore.list();
    tasks = records;
    tasks = tasks.map(fromDatabase);
    render();
    setSyncStatus('Up to date', 'online');
  } catch (error) {
    console.error(error);
    setSyncStatus('Unable to sync', 'error');
  }
}
async function createTask(task) {
  const { id, ...newTask } = task;
  const created = fromDatabase(await taskStore.create(toDatabase(newTask)));
  tasks.push(created);
}
async function updateTask(task, changes) {
  const updated = fromDatabase(await taskStore.update(task.id, toDatabase({ ...task, ...changes })));
  Object.assign(task, updated);
}
async function deleteTask(task) {
  await taskStore.remove(task.id);
  tasks = tasks.filter(item => item !== task);
}
function safe(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
function dateLabel(date) { return date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : 'No due date'; }
function avatar(name) { return `<span class="avatar ${name === 'Michaila' ? 'coral' : 'teal'}">${name[0]}</span>`; }
function statusLabel(status) { return { todo: 'To do', doing: 'In progress', waiting: 'Waiting' }[status] || 'To do'; }
function frequencyLabel(frequency) { return { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every quarter', yearly: 'Every year' }[frequency] || 'Every month'; }
function nextDueDate(date, frequency) {
  const next = new Date(`${date}T12:00:00`);
  if (frequency === 'weekly') next.setDate(next.getDate() + 7);
  if (frequency !== 'weekly') {
    const months = { monthly: 1, quarterly: 3, yearly: 12 }[frequency] || 1;
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + months);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
  }
  return next.toISOString().slice(0, 10);
}

function taskMarkup(task) {
  return `<article class="task ${task.completed ? 'done' : ''}" data-id="${task.id}">
    <button class="complete" aria-label="${task.completed ? 'Reopen' : 'Complete'} task">${task.completed ? '✓' : ''}</button>
    <div class="task-copy"><strong>${safe(task.name)}</strong><span>${safe(task.project)} · ${dateLabel(task.due)}${task.recurring ? ' · Recurring' : ''}</span></div>
    <span class="status ${task.status}">${statusLabel(task.status)}</span>${avatar(task.assignee)}
    <button class="update" aria-label="Share an update">Update</button><button class="delete" aria-label="Delete task">×</button>
  </article>`;
}

function renderTasks() {
  const person = document.querySelector('#personFilter').value;
  const visible = tasks.filter(task => (taskFilter === 'all' || (taskFilter === 'open' ? !task.completed : task.completed)) && (person === 'all' || task.assignee === person));
  document.querySelector('#taskList').innerHTML = visible.length ? visible.map(taskMarkup).join('') : '<p class="empty">No tasks here.</p>';
}

function projectMarkup(project) {
  const related = tasks.filter(task => task.project === project.name);
  const complete = related.filter(task => task.completed).length;
  const progress = related.length ? Math.round(complete / related.length * 100) : 0;
  return `<article class="project-card ${project.color}">
    <div class="project-copy"><h3>${project.name}</h3><p>${project.description}</p><div class="project-meta"><span>${complete} of ${related.length} tasks</span><span>Due ${project.due}</span></div></div>
    <div class="progress-ring" style="--progress:${progress}" role="img" aria-label="${progress}% complete"><span>${progress}%</span></div>
  </article>`;
}

function render() {
  const personalTasks = tasks.filter(task => !task.completed && (currentProfile?.role === 'admin' || task.assignee === currentProfile?.display_name));
  document.querySelector('#overviewTasks').innerHTML = personalTasks.length ? personalTasks.slice(0, 4).map(taskMarkup).join('') : '<p class="empty">No open tasks.</p>';
  document.querySelector('#overviewProjects').innerHTML = projects.map(projectMarkup).join('');
  document.querySelector('#projectList').innerHTML = projects.map(projectMarkup).join('');

  const recurring = tasks.filter(task => task.recurring && !task.completed);
  const recurringMarkup = recurring.filter(task => !task.paused).map(task => `<article class="simple-item"><div><strong>${safe(task.name)}</strong><span>${safe(task.assignee)} · ${frequencyLabel(task.frequency)} · Due ${dateLabel(task.due)}</span></div></article>`).join('');
  document.querySelector('#overviewRecurring').innerHTML = recurringMarkup || '<p class="empty">Nothing scheduled.</p>';
  document.querySelector('#recurringList').innerHTML = recurring.length ? recurring.map(task => `<article class="recurring-item ${task.paused ? 'paused' : ''}" data-id="${task.id}"><div class="recurring-date"><strong>${dateLabel(task.due)}</strong><span>${task.paused ? 'Paused' : 'Next due'}</span></div><div class="recurring-copy"><strong>${safe(task.name)}</strong><span>${safe(task.project)} · ${frequencyLabel(task.frequency)}</span></div>${avatar(task.assignee)}<button class="link recurring-toggle">${task.paused ? 'Resume' : 'Pause'}</button><button class="delete" aria-label="Delete recurring task">×</button></article>`).join('') : '<p class="empty">Nothing scheduled.</p>';

  document.querySelector('#focusList').innerHTML = ['Michaila', 'Brady'].map(name => {
    const current = tasks.find(task => !task.completed && task.assignee === name && task.status === 'doing') || tasks.find(task => !task.completed && task.assignee === name);
    return `<article class="focus">${avatar(name)}<div><strong>${name}<small>${name === 'Michaila' ? 'Halifax' : 'Charlottetown'}</small></strong><span>${current ? safe(current.name) : 'Nothing assigned'}</span>${current?.note ? `<p>${safe(current.note)}</p>` : ''}</div><i>${current ? statusLabel(current.status) : 'Clear'}</i></article>`;
  }).join('');

  document.querySelector('#teamList').innerHTML = ['Michaila', 'Brady'].map(name => `<section class="card team-card"><div class="team-heading">${avatar(name)}<div><h2>${name}</h2><p>${name === 'Michaila' ? 'Controller' : 'Senior Accountant'}</p></div></div>${tasks.filter(task => !task.completed && task.assignee === name).map(taskMarkup).join('') || '<p class="empty">No open tasks.</p>'}</section>`).join('');
  renderTasks();
}

function showView(view) {
  const titles = { overview: ['Overview', 'Today’s work, in one place.'], tasks: ['To-do list', 'Assign, update, and complete tasks.'], projects: ['Projects', 'Shared work and progress.'], recurring: ['Recurring tasks', 'Routine work and its next due date.'], team: ['Team', 'What Michaila and Brady are working on.'] };
  document.querySelectorAll('.view').forEach(section => section.classList.remove('active'));
  document.querySelector(`#${view}View`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  document.querySelector('#pageTitle').textContent = titles[view][0];
  document.querySelector('#pageSubtitle').textContent = titles[view][1];
}

document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view], [data-go]');
  if (nav) showView(nav.dataset.view || nav.dataset.go);
  const row = event.target.closest('.task');
  const recurringRow = event.target.closest('.recurring-item');
  if (recurringRow) {
    const recurringTask = tasks.find(item => item.id === Number(recurringRow.dataset.id));
    setSyncStatus('Saving…');
    if (event.target.closest('.recurring-toggle')) await updateTask(recurringTask, { paused: !recurringTask.paused });
    if (event.target.closest('.delete')) await deleteTask(recurringTask);
    render(); setSyncStatus('Up to date', 'online'); return;
  }
  if (!row) return;
  const task = tasks.find(item => item.id === Number(row.dataset.id));
  if (event.target.closest('.complete')) {
    setSyncStatus('Saving…');
    const completed = !task.completed;
    const shouldGenerate = completed && task.recurring && !task.recurrenceGenerated;
    await updateTask(task, { completed, recurrenceGenerated: shouldGenerate ? true : task.recurrenceGenerated });
    if (shouldGenerate) {
      const { id, ...nextTask } = task;
      await createTask({ ...nextTask, due: nextDueDate(task.due, task.frequency), paused: false, recurrenceGenerated: false, status: 'todo', note: '', completed: false });
    }
  }
  if (event.target.closest('.delete')) await deleteTask(task);
  if (event.target.closest('.update')) {
    document.querySelector('#updateTaskId').value = task.id;
    document.querySelector('#updateTaskName').textContent = task.name;
    document.querySelector('#updateStatus').value = task.status;
    document.querySelector('#updateNote').value = task.note;
    updateDialog.showModal();
    return;
  }
  render(); setSyncStatus('Up to date', 'online');
});

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { taskFilter = button.dataset.filter; document.querySelector('.filter.active').classList.remove('active'); button.classList.add('active'); renderTasks(); }));
document.querySelector('#personFilter').addEventListener('change', renderTasks);
document.querySelector('#openForm').addEventListener('click', () => dialog.showModal());
document.querySelector('#closeForm').addEventListener('click', () => dialog.close());
document.querySelector('#cancelForm').addEventListener('click', () => dialog.close());
document.querySelector('#openRecurringForm').addEventListener('click', () => recurringDialog.showModal());
document.querySelectorAll('[data-close-recurring]').forEach(button => button.addEventListener('click', () => recurringDialog.close()));
document.querySelectorAll('[data-close-update]').forEach(button => button.addEventListener('click', () => updateDialog.close()));
document.querySelector('#taskForm').addEventListener('submit', async event => {
  event.preventDefault();
  setSyncStatus('Saving…');
  await createTask({ name: document.querySelector('#taskName').value.trim(), assignee: document.querySelector('#assignee').value, due: document.querySelector('#dueDate').value || null, project: document.querySelector('#project').value, recurring: false, frequency: 'monthly', paused: false, recurrenceGenerated: false, status: document.querySelector('#status').value, note: '', completed: false });
  event.target.reset(); dialog.close(); render(); setSyncStatus('Up to date', 'online');
});
document.querySelector('#recurringForm').addEventListener('submit', async event => {
  event.preventDefault();
  setSyncStatus('Saving…');
  await createTask({ name: document.querySelector('#recurringName').value.trim(), assignee: document.querySelector('#recurringAssignee').value, due: document.querySelector('#recurringDueDate').value, project: document.querySelector('#recurringProject').value, recurring: true, frequency: document.querySelector('#frequency').value, paused: false, recurrenceGenerated: false, status: 'todo', note: '', completed: false });
  event.target.reset(); recurringDialog.close(); render(); setSyncStatus('Up to date', 'online');
});
document.querySelector('#updateForm').addEventListener('submit', async event => {
  event.preventDefault();
  const task = tasks.find(item => item.id === Number(document.querySelector('#updateTaskId').value));
  setSyncStatus('Saving…');
  await updateTask(task, { status: document.querySelector('#updateStatus').value, note: document.querySelector('#updateNote').value.trim() });
  updateDialog.close(); render(); setSyncStatus('Up to date', 'online');
});

document.querySelector('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const error = document.querySelector('#authError');
  const button = event.submitter;
  error.textContent = '';
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    await auth.signIn(document.querySelector('#loginEmail').value.trim(), document.querySelector('#loginPassword').value);
    await startApp();
    event.target.reset();
  } catch (loginError) {
    error.textContent = loginError.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});
document.querySelector('#signOut').addEventListener('click', () => {
  auth.signOut();
  tasks = [];
  currentProfile = null;
  appShell.hidden = true;
  authScreen.hidden = false;
});
document.querySelector('#togglePassword').addEventListener('click', event => {
  const password = document.querySelector('#loginPassword');
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  event.currentTarget.textContent = show ? 'Hide' : 'Show';
  event.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});
window.addEventListener('unhandledrejection', event => {
  console.error(event.reason);
  if (auth.getSession()) {
    setSyncStatus('Unable to save', 'error');
    showToast('Something went wrong. Please try again.', 'error');
  }
});

startApp();
setInterval(() => {
  if (auth.getSession() && !isSaving && !document.querySelector('dialog[open]')) loadTasks({ quiet: true });
}, 5000);
