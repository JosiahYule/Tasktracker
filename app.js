const starterTasks = [
  { id: 1, name: 'Review bank reconciliation', assignee: 'Michaila', due: '2026-08-13', recurring: true, completed: false },
  { id: 2, name: 'Approve payroll journal', assignee: 'Michaila', due: '2026-08-13', recurring: false, completed: false },
  { id: 3, name: 'Update monthly reporting package', assignee: 'Brady', due: '2026-08-14', recurring: true, completed: false }
];

let tasks = loadTasks();
let filter = 'open';

const taskList = document.querySelector('#taskList');
const dialog = document.querySelector('#taskDialog');
const form = document.querySelector('#taskForm');

function loadTasks() {
  try {
    return JSON.parse(localStorage.getItem('tasktracker-tasks')) || starterTasks;
  } catch {
    return starterTasks;
  }
}

function saveTasks() {
  localStorage.setItem('tasktracker-tasks', JSON.stringify(tasks));
}

function formatDate(date) {
  if (!date) return 'No due date';
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric'
  });
}

function render() {
  const visibleTasks = tasks.filter((task) => {
    if (filter === 'open') return !task.completed;
    if (filter === 'completed') return task.completed;
    return true;
  });

  document.querySelector('#openCount').textContent = tasks.filter((task) => !task.completed).length;

  taskList.innerHTML = visibleTasks.length
    ? visibleTasks.map((task) => `
      <article class="task ${task.completed ? 'done' : ''}" data-id="${task.id}">
        <button class="complete" aria-label="${task.completed ? 'Reopen' : 'Complete'} task">${task.completed ? '✓' : ''}</button>
        <div>
          <div class="task-name"></div>
          <div class="task-meta">${formatDate(task.due)}${task.recurring ? '<span class="recurring">↻ Recurring</span>' : ''}</div>
        </div>
        <span class="assignee">${task.assignee}</span>
        <button class="delete" aria-label="Delete task">×</button>
      </article>`).join('')
    : '<p class="empty">No tasks here.</p>';

  visibleTasks.forEach((task, index) => {
    taskList.querySelectorAll('.task-name')[index].textContent = task.name;
  });
}

taskList.addEventListener('click', (event) => {
  const row = event.target.closest('.task');
  if (!row) return;
  const task = tasks.find((item) => item.id === Number(row.dataset.id));

  if (event.target.closest('.complete')) task.completed = !task.completed;
  if (event.target.closest('.delete')) tasks = tasks.filter((item) => item !== task);

  saveTasks();
  render();
});

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelector('.filter.active').classList.remove('active');
    button.classList.add('active');
    render();
  });
});

document.querySelector('#openForm').addEventListener('click', () => dialog.showModal());
document.querySelector('#closeForm').addEventListener('click', () => dialog.close());
document.querySelector('#cancelForm').addEventListener('click', () => dialog.close());

form.addEventListener('submit', (event) => {
  event.preventDefault();
  tasks.push({
    id: Date.now(),
    name: document.querySelector('#taskName').value.trim(),
    assignee: document.querySelector('#assignee').value,
    due: document.querySelector('#dueDate').value,
    recurring: document.querySelector('#recurring').checked,
    completed: false
  });
  saveTasks();
  form.reset();
  dialog.close();
  filter = 'open';
  document.querySelector('.filter.active').classList.remove('active');
  document.querySelector('[data-filter="open"]').classList.add('active');
  render();
});

render();
