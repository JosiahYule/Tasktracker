import { taskStore } from './supabase.js';

const starterTasks = [
  { id: 1, name: 'Review bank reconciliation', assignee: 'Michaila', due: '2026-08-13', project: 'Month-end close', recurring: true, frequency: 'monthly', status: 'doing', note: 'Checking the final two reconciling items.', completed: false },
  { id: 2, name: 'Approve payroll journal', assignee: 'Michaila', due: '2026-08-13', project: 'Month-end close', recurring: false, status: 'todo', note: '', completed: false },
  { id: 3, name: 'Update monthly reporting package', assignee: 'Brady', due: '2026-08-14', project: 'Month-end close', recurring: true, frequency: 'monthly', status: 'doing', note: 'Income statement is ready; cash flow is next.', completed: false },
  { id: 4, name: 'Prepare budget assumptions', assignee: 'Michaila', due: '2026-08-18', project: 'FY26 planning', recurring: false, status: 'waiting', note: 'Waiting for Greg’s headcount figures.', completed: false },
  { id: 5, name: 'Review software access list', assignee: 'Brady', due: '2026-08-20', project: 'Systems review', recurring: false, status: 'todo', note: '', completed: false },
  { id: 6, name: 'Post recurring accruals', assignee: 'Brady', due: '2026-08-13', project: 'Month-end close', recurring: true, frequency: 'monthly', status: 'todo', note: '', completed: true }
];

const projects = [
  { name: 'Month-end close', description: 'Complete August close and reporting', due: 'Aug 19', color: 'coral' },
  { name: 'FY26 planning', description: 'Build next year’s operating plan', due: 'Sep 5', color: 'blue' },
  { name: 'Systems review', description: 'Review access and finance workflows', due: 'Sep 28', color: 'teal' }
];
let tasks = [];
let taskFilter = 'open';
const dialog = document.querySelector('#taskDialog');
const updateDialog = document.querySelector('#updateDialog');
const recurringDialog = document.querySelector('#recurringDialog');

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
async function loadTasks({ quiet = false } = {}) {
  try {
    if (!quiet) setSyncStatus('Connecting…');
    const records = await taskStore.list();
    if (!records.length) {
      tasks = await Promise.all(starterTasks.map(task => {
        const { id, ...seed } = task;
        return taskStore.create(toDatabase(seed));
      }));
    } else {
      tasks = records;
    }
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
  if (frequency === 'monthly') next.setMonth(next.getMonth() + 1);
  if (frequency === 'quarterly') next.setMonth(next.getMonth() + 3);
  if (frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
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
  document.querySelector('#overviewTasks').innerHTML = tasks.filter(task => !task.completed && task.assignee === 'Michaila').slice(0, 4).map(taskMarkup).join('');
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
  await createTask({ name: document.querySelector('#taskName').value.trim(), assignee: document.querySelector('#assignee').value, due: document.querySelector('#dueDate').value || null, project: document.querySelector('#project').value, recurring: document.querySelector('#recurring').checked, frequency: 'monthly', paused: false, recurrenceGenerated: false, status: document.querySelector('#status').value, note: '', completed: false });
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

loadTasks();
setInterval(() => {
  if (!document.querySelector('dialog[open]')) loadTasks({ quiet: true });
}, 5000);
