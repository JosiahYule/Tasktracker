const defaultTasks = [
  { id: 1, name: 'Review August cash flow forecast', project: 'FY26 planning', due: 'Due today', assignee: 'Michaila', recurring: false, completed: false, tab: 'today' },
  { id: 2, name: 'Approve payroll journal entries', project: 'Month-end close', due: 'Due today', assignee: 'Michaila', recurring: false, completed: false, tab: 'today' },
  { id: 3, name: 'Review bank reconciliation', project: 'Month-end close', due: 'Due today', assignee: 'Brady', recurring: true, completed: false, tab: 'today' },
  { id: 4, name: 'Update monthly reporting package', project: 'Month-end close', due: 'Due today', assignee: 'Michaila', recurring: true, completed: true, tab: 'today' },
  { id: 5, name: 'Send expense variance notes to Greg', project: 'FY26 planning', due: 'Overdue', assignee: 'Brady', recurring: false, completed: false, tab: 'today' },
  { id: 6, name: 'Post recurring accruals', project: 'Month-end close', due: 'Due today', assignee: 'Brady', recurring: true, completed: true, tab: 'today' },
  { id: 7, name: 'Prepare quarterly board schedules', project: 'FY26 planning', due: 'Aug 17', assignee: 'Michaila', recurring: false, completed: false, tab: 'upcoming' },
  { id: 8, name: 'Audit software access permissions', project: 'Systems review', due: 'Aug 19', assignee: 'Brady', recurring: true, completed: false, tab: 'upcoming' }
];

let tasks;
try { tasks = JSON.parse(localStorage.getItem('northstar-tasks')) || defaultTasks; } catch { tasks = defaultTasks; }
let currentTab = 'today';
const list = document.querySelector('#taskList');
const modal = document.querySelector('#taskModal');
const form = document.querySelector('#taskForm');

function save() { localStorage.setItem('northstar-tasks', JSON.stringify(tasks)); }
function renderTasks() {
  const visible = currentTab === 'completed' ? tasks.filter(t => t.completed) : tasks.filter(t => t.tab === currentTab && !t.completed);
  list.innerHTML = visible.length ? visible.map(task => `
    <div class="task-row ${task.completed ? 'completed' : ''}" data-id="${task.id}">
      <button class="check" aria-label="${task.completed ? 'Reopen' : 'Complete'} ${task.name}">${task.completed ? '✓' : ''}</button>
      <div class="task-main"><div class="task-name">${escapeHtml(task.name)}</div><div class="task-details"><span class="project-tag">${escapeHtml(task.project)}</span>${task.recurring ? '<span class="recurring" title="Recurring task">↻</span>' : ''}</div></div>
      <span class="due ${task.due === 'Overdue' ? 'overdue' : ''}">${escapeHtml(task.due)}</span><div class="avatar ${task.assignee === 'Brady' ? 'brady' : 'michaila'}">${task.assignee[0]}</div>
    </div>`).join('') : '<div style="padding:42px;text-align:center;color:#999">Nothing here — you’re all caught up.</div>';
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function openModal() { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); setTimeout(() => document.querySelector('#taskName').focus(), 150); }
function closeModal() { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); form.reset(); }
function showToast(title = 'Task completed', subtitle = 'Nice work — keep it going.') { const toast = document.querySelector('#toast'); toast.querySelector('strong').textContent = title; toast.querySelector('small').textContent = subtitle; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); }

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => { document.querySelector('.tab.active').classList.remove('active'); tab.classList.add('active'); currentTab = tab.dataset.tab; renderTasks(); }));
list.addEventListener('click', event => { const button = event.target.closest('.check'); if (!button) return; const id = Number(button.closest('.task-row').dataset.id); const task = tasks.find(item => item.id === id); task.completed = !task.completed; save(); renderTasks(); showToast(task.completed ? 'Task completed' : 'Task reopened', task.completed ? 'Nice work — keep it going.' : 'It’s back on your list.'); });
document.querySelector('#newTaskButton').addEventListener('click', openModal);
document.querySelector('#inlineAdd').addEventListener('click', openModal);
document.querySelector('#closeModal').addEventListener('click', closeModal);
document.querySelector('#cancelModal').addEventListener('click', closeModal);
modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
form.addEventListener('submit', event => { event.preventDefault(); const date = document.querySelector('#dueDate').value; tasks.unshift({ id: Date.now(), name: document.querySelector('#taskName').value.trim(), project: document.querySelector('#projectSelect').value, assignee: document.querySelector('#assignee').value, recurring: document.querySelector('#recurring').checked, completed: false, tab: date && date !== new Date().toISOString().slice(0, 10) ? 'upcoming' : 'today', due: date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : 'Due today' }); save(); currentTab = 'today'; document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'today')); renderTasks(); closeModal(); showToast('Task created', 'Your team can see it now.'); });
document.querySelector('#openSidebar').addEventListener('click', () => document.querySelector('#sidebar').classList.add('open'));
document.querySelector('#closeSidebar').addEventListener('click', () => document.querySelector('#sidebar').classList.remove('open'));
renderTasks();
