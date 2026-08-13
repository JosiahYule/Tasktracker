import { auth, noteStore, projectStore, taskStore } from './supabase.js';

let projects = [];
let notes = [];
let tasks = [];
let taskFilter = 'open';
let currentProfile = null;
let isSaving = false;
const dialog = document.querySelector('#taskDialog');
const updateDialog = document.querySelector('#updateDialog');
const recurringDialog = document.querySelector('#recurringDialog');
const projectDialog = document.querySelector('#projectDialog');
const notesDialog = document.querySelector('#notesDialog');
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
    await loadWorkspace();
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
async function loadWorkspace({ quiet = false } = {}) {
  try {
    if (!quiet) setSyncStatus('Connecting…');
    const [taskRecords, projectRecords, noteRecords] = await Promise.all([taskStore.list(), projectStore.list(), noteStore.list()]);
    tasks = taskRecords.map(fromDatabase);
    projects = projectRecords;
    notes = noteRecords;
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
function noteTotal(type, id) { return notes.filter(note => note.entity_type === type && note.entity_id === Number(id)).length; }
function notesButton(type, id) {
  const total = noteTotal(type, id);
  return `<button class="notes-button" data-notes-type="${type}" data-notes-id="${id}">Notes${total ? ` <span>${total}</span>` : ''}</button>`;
}
function noteDate(value) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay ? `Today at ${date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}` : date.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function renderNotes(type, id) {
  const related = notes.filter(note => note.entity_type === type && note.entity_id === Number(id));
  document.querySelector('#notesList').innerHTML = related.length ? related.map(note => `<article class="note"><div><strong>${safe(note.author_name)}</strong><time>${noteDate(note.created_at)}</time></div><p>${safe(note.body)}</p>${note.author_id === currentProfile.id || currentProfile.role === 'admin' ? `<button type="button" class="delete-note" data-note-id="${note.id}" aria-label="Delete note">Delete</button>` : ''}</article>`).join('') : '<p class="empty">No notes yet. Add the first one below.</p>';
}
function openNotes(type, id, name) {
  document.querySelector('#noteEntityType').value = type;
  document.querySelector('#noteEntityId').value = id;
  document.querySelector('#notesEntityName').textContent = name;
  document.querySelector('#noteBody').value = '';
  document.querySelector('#noteCount').textContent = '0';
  renderNotes(type, id);
  notesDialog.showModal();
}

function taskMarkup(task) {
  return `<article class="task ${task.completed ? 'done' : ''}" data-id="${task.id}">
    <button class="complete" aria-label="${task.completed ? 'Reopen' : 'Complete'} task">${task.completed ? '✓' : ''}</button>
    <div class="task-copy"><strong>${safe(task.name)}</strong><span>${safe(task.project)} · ${dateLabel(task.due)}${task.recurring ? ' · Recurring' : ''}</span></div>
    <span class="status ${task.status}">${statusLabel(task.status)}</span>${avatar(task.assignee)}
    ${notesButton('task', task.id)}<button class="update" aria-label="Share an update">Update</button><button class="delete" aria-label="Delete task">×</button>
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
    <div class="project-copy"><h3>${safe(project.name)}</h3><p>${safe(project.description)}</p><div class="project-meta"><span>${complete} of ${related.length} tasks</span><span>Due ${dateLabel(project.due)}</span></div>${notesButton('project', project.id)}</div>
    <div class="progress-ring" style="--progress:${progress}" role="img" aria-label="${progress}% complete"><span>${progress}%</span></div>
  </article>`;
}

function render() {
  const personalTasks = tasks.filter(task => !task.completed && (currentProfile?.role === 'admin' || task.assignee === currentProfile?.display_name));
  document.querySelector('#overviewTasks').innerHTML = personalTasks.length ? personalTasks.slice(0, 4).map(taskMarkup).join('') : '<p class="empty">No open tasks.</p>';
  document.querySelector('#overviewProjects').innerHTML = projects.length ? projects.slice(0, 3).map(projectMarkup).join('') : '<p class="empty">No projects yet.</p>';
  document.querySelector('#projectList').innerHTML = projects.length ? projects.map(projectMarkup).join('') : '<p class="empty">No projects yet. Create one to organize related tasks.</p>';
  const projectOptions = `${projects.map(project => `<option>${safe(project.name)}</option>`).join('')}<option>General</option>`;
  document.querySelector('#project').innerHTML = projectOptions;
  document.querySelector('#recurringProject').innerHTML = projectOptions;

  const recurring = tasks.filter(task => task.recurring && !task.completed);
  const recurringMarkup = recurring.filter(task => !task.paused).map(task => `<article class="simple-item"><div><strong>${safe(task.name)}</strong><span>${safe(task.assignee)} · ${frequencyLabel(task.frequency)} · Due ${dateLabel(task.due)}</span></div></article>`).join('');
  document.querySelector('#overviewRecurring').innerHTML = recurringMarkup || '<p class="empty">Nothing scheduled.</p>';
  document.querySelector('#recurringList').innerHTML = recurring.length ? recurring.map(task => `<article class="recurring-item ${task.paused ? 'paused' : ''}" data-id="${task.id}"><div class="recurring-date"><strong>${dateLabel(task.due)}</strong><span>${task.paused ? 'Paused' : 'Next due'}</span></div><div class="recurring-copy"><strong>${safe(task.name)}</strong><span>${safe(task.project)} · ${frequencyLabel(task.frequency)}</span></div>${avatar(task.assignee)}${notesButton('task', task.id)}<button class="link recurring-toggle">${task.paused ? 'Resume' : 'Pause'}</button><button class="delete" aria-label="Delete recurring task">×</button></article>`).join('') : '<p class="empty">Nothing scheduled.</p>';

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
  const notesTrigger = event.target.closest('[data-notes-type]');
  if (notesTrigger) {
    const type = notesTrigger.dataset.notesType;
    const id = Number(notesTrigger.dataset.notesId);
    const entity = type === 'project' ? projects.find(item => item.id === id) : tasks.find(item => item.id === id);
    openNotes(type, id, entity.name);
    return;
  }
  const deleteNote = event.target.closest('.delete-note');
  if (deleteNote) {
    try {
      await noteStore.remove(Number(deleteNote.dataset.noteId));
      notes = notes.filter(note => note.id !== Number(deleteNote.dataset.noteId));
      const type = document.querySelector('#noteEntityType').value;
      const id = Number(document.querySelector('#noteEntityId').value);
      renderNotes(type, id); render(); showToast('Note deleted.');
    } catch (error) { showToast('The note was not deleted.', 'error'); }
    return;
  }
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
document.querySelector('#openProjectForm').addEventListener('click', () => projectDialog.showModal());
document.querySelectorAll('[data-close-project]').forEach(button => button.addEventListener('click', () => projectDialog.close()));
document.querySelectorAll('[data-close-notes]').forEach(button => button.addEventListener('click', () => notesDialog.close()));
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
document.querySelector('#projectForm').addEventListener('submit', async event => {
  event.preventDefault();
  setSyncStatus('Saving…');
  try {
    const project = await projectStore.create({ name: document.querySelector('#projectName').value.trim(), description: document.querySelector('#projectDescription').value.trim(), due: document.querySelector('#projectDueDate').value, color: document.querySelector('#projectColor').value });
    projects.push(project);
    event.target.reset(); projectDialog.close(); render();
    setSyncStatus('Up to date', 'online'); showToast('Project created.');
  } catch (error) {
    console.error(error); setSyncStatus('Unable to save', 'error');
    showToast(error.message.includes('duplicate') ? 'A project with that name already exists.' : 'The project was not created. Please try again.', 'error');
  }
});
document.querySelector('#noteBody').addEventListener('input', event => { document.querySelector('#noteCount').textContent = event.target.value.length; });
document.querySelector('#noteForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const note = await noteStore.create({ entity_type: document.querySelector('#noteEntityType').value, entity_id: Number(document.querySelector('#noteEntityId').value), body: document.querySelector('#noteBody').value.trim(), author_id: currentProfile.id, author_name: currentProfile.display_name });
    notes.push(note);
    document.querySelector('#noteBody').value = '';
    document.querySelector('#noteCount').textContent = '0';
    renderNotes(note.entity_type, note.entity_id); render(); showToast('Note posted.');
  } catch (error) { console.error(error); showToast('The note was not posted.', 'error'); }
  finally { button.disabled = false; }
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
  projects = [];
  notes = [];
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
  if (auth.getSession() && !isSaving && !document.querySelector('dialog[open]')) loadWorkspace({ quiet: true });
}, 5000);
