const starterTasks = [
  { id: 1, name: 'Review bank reconciliation', assignee: 'Michaila', due: '2026-08-13', project: 'Month-end close', recurring: true, completed: false },
  { id: 2, name: 'Approve payroll journal', assignee: 'Michaila', due: '2026-08-13', project: 'Month-end close', recurring: false, completed: false },
  { id: 3, name: 'Update monthly reporting package', assignee: 'Brady', due: '2026-08-14', project: 'Month-end close', recurring: true, completed: false },
  { id: 4, name: 'Prepare budget assumptions', assignee: 'Michaila', due: '2026-08-18', project: 'FY26 planning', recurring: false, completed: false },
  { id: 5, name: 'Review software access list', assignee: 'Brady', due: '2026-08-20', project: 'Systems review', recurring: false, completed: false },
  { id: 6, name: 'Post recurring accruals', assignee: 'Brady', due: '2026-08-13', project: 'Month-end close', recurring: true, completed: true }
];

const projects = [
  { name: 'Month-end close', description: 'Complete August close and reporting', due: 'Aug 19', color: 'coral' },
  { name: 'FY26 planning', description: 'Build next year’s operating plan', due: 'Sep 5', color: 'blue' },
  { name: 'Systems review', description: 'Review access and finance workflows', due: 'Sep 28', color: 'teal' }
];

let tasks = loadTasks();
let taskFilter = 'open';
const dialog = document.querySelector('#taskDialog');

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem('tasktracker-tasks'));
    return saved ? saved.map(task => ({ project: 'General', recurring: false, ...task })) : starterTasks;
  }
  catch { return starterTasks; }
}
function saveTasks() { localStorage.setItem('tasktracker-tasks', JSON.stringify(tasks)); }
function safe(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
function dateLabel(date) { return date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : 'No due date'; }
function avatar(name) { return `<span class="avatar ${name === 'Michaila' ? 'coral' : 'teal'}">${name[0]}</span>`; }

function taskMarkup(task) {
  return `<article class="task ${task.completed ? 'done' : ''}" data-id="${task.id}">
    <button class="complete" aria-label="${task.completed ? 'Reopen' : 'Complete'} task">${task.completed ? '✓' : ''}</button>
    <div class="task-copy"><strong>${safe(task.name)}</strong><span>${safe(task.project)} · ${dateLabel(task.due)}${task.recurring ? ' · ↻ Recurring' : ''}</span></div>
    ${avatar(task.assignee)}<button class="delete" aria-label="Delete task">×</button>
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
  return `<article class="project-card"><i class="project-mark ${project.color}"></i><h3>${project.name}</h3><p>${project.description}</p><div class="project-meta"><span>${complete} of ${related.length} tasks</span><span>Due ${project.due}</span></div><div class="progress"><i style="width:${progress}%"></i></div></article>`;
}

function render() {
  document.querySelector('#openTotal').textContent = tasks.filter(task => !task.completed).length;
  document.querySelector('#weekTotal').textContent = tasks.filter(task => !task.completed && task.due <= '2026-08-20').length;
  document.querySelector('#overviewTasks').innerHTML = tasks.filter(task => !task.completed && task.assignee === 'Michaila').slice(0, 4).map(taskMarkup).join('');
  document.querySelector('#overviewProjects').innerHTML = projects.map(projectMarkup).join('');
  document.querySelector('#projectList').innerHTML = projects.map(projectMarkup).join('');

  const recurring = tasks.filter(task => task.recurring);
  const recurringMarkup = recurring.map(task => `<article class="simple-item"><div><strong>${safe(task.name)}</strong><span>${safe(task.assignee)} · Next: ${dateLabel(task.due)}</span></div><span>↻</span></article>`).join('');
  document.querySelector('#overviewRecurring').innerHTML = recurringMarkup;
  document.querySelector('#recurringList').innerHTML = recurringMarkup;

  document.querySelector('#focusList').innerHTML = ['Michaila', 'Brady'].map(name => {
    const current = tasks.find(task => !task.completed && task.assignee === name);
    return `<article class="focus">${avatar(name)}<div><strong>${name}</strong><span>${current ? safe(current.name) : 'No open tasks'}</span></div><i>${tasks.filter(task => !task.completed && task.assignee === name).length} open</i></article>`;
  }).join('');

  document.querySelector('#teamList').innerHTML = ['Michaila', 'Brady'].map(name => `<section class="card team-card"><div class="team-heading">${avatar(name)}<div><h2>${name}</h2><p>${name === 'Michaila' ? 'Controller' : 'Assistant Controller'}</p></div></div>${tasks.filter(task => !task.completed && task.assignee === name).map(taskMarkup).join('') || '<p class="empty">No open tasks.</p>'}</section>`).join('');
  renderTasks();
}

function showView(view) {
  const titles = { overview: ['Overview', 'A clear view of the team’s work.'], tasks: ['To-do list', 'All individual tasks in one place.'], projects: ['Projects', 'Track shared work and progress.'], recurring: ['Recurring tasks', 'Tasks that happen on a regular schedule.'], team: ['Team activity', 'See what Michaila and Brady are working on.'] };
  document.querySelectorAll('.view').forEach(section => section.classList.remove('active'));
  document.querySelector(`#${view}View`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  document.querySelector('#pageTitle').textContent = titles[view][0];
  document.querySelector('#pageSubtitle').textContent = titles[view][1];
}

document.addEventListener('click', event => {
  const nav = event.target.closest('[data-view], [data-go]');
  if (nav) showView(nav.dataset.view || nav.dataset.go);
  const row = event.target.closest('.task');
  if (!row) return;
  const task = tasks.find(item => item.id === Number(row.dataset.id));
  if (event.target.closest('.complete')) task.completed = !task.completed;
  if (event.target.closest('.delete')) tasks = tasks.filter(item => item !== task);
  saveTasks(); render();
});

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { taskFilter = button.dataset.filter; document.querySelector('.filter.active').classList.remove('active'); button.classList.add('active'); renderTasks(); }));
document.querySelector('#personFilter').addEventListener('change', renderTasks);
document.querySelector('#openForm').addEventListener('click', () => dialog.showModal());
document.querySelector('#closeForm').addEventListener('click', () => dialog.close());
document.querySelector('#cancelForm').addEventListener('click', () => dialog.close());
document.querySelector('#taskForm').addEventListener('submit', event => {
  event.preventDefault();
  tasks.push({ id: Date.now(), name: document.querySelector('#taskName').value.trim(), assignee: document.querySelector('#assignee').value, due: document.querySelector('#dueDate').value, project: document.querySelector('#project').value, recurring: document.querySelector('#recurring').checked, completed: false });
  saveTasks(); event.target.reset(); dialog.close(); render();
});

render();
