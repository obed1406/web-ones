// ================= Estado Central =================
let appData = {
    projects: [],
    tasks: [],
    users: [],
    activity: [],
    settings: { theme: 'light' }
};

let currentProjectId = null;
let currentDate = new Date();

// ================= Interfaz y Notificaciones =================
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    
    if(viewId === 'kanban' && currentProjectId) renderKanban();
    if(viewId === 'dashboard') renderDashboard();
    if(viewId === 'users') renderUsers();
    if(viewId === 'calendar') renderCalendar();
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `background: ${type === 'error' ? '#e74c3c' : '#2ecc71'}; color: white; padding: 15px; margin-top: 10px; border-radius: 5px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); opacity: 0; transition: opacity 0.3s;`;
    container.appendChild(toast);
    setTimeout(() => toast.style.opacity = '1', 10);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function logActivity(action) {
    appData.activity.unshift({ action, time: new Date().toLocaleString() });
    if (appData.activity.length > 5) appData.activity.pop();
    saveData();
    if(!document.getElementById('view-dashboard').classList.contains('hidden')) renderDashboard();
}

// ================= Persistencia de Datos =================
function loadData() {
    const data = localStorage.getItem('taskFlowData');
    if (data) appData = JSON.parse(data);
    applyTheme();
    renderProjects();
    renderDashboard();
}

function saveData() { localStorage.setItem('taskFlowData', JSON.stringify(appData)); }

function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr); dl.setAttribute("download", "taskflow_backup.json");
    document.body.appendChild(dl); dl.click(); dl.remove();
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            appData = JSON.parse(e.target.result);
            saveData(); loadData(); showToast("Datos importados");
        } catch (error) { showToast("Archivo JSON inválido", "error"); }
    };
    reader.readAsText(file);
}

function clearData() {
    if (confirm("¿Borrar TODOS los datos?")) { localStorage.removeItem('taskFlowData'); location.reload(); }
}

function toggleTheme() {
    appData.settings.theme = appData.settings.theme === 'light' ? 'dark' : 'light';
    applyTheme(); saveData();
}

function applyTheme() {
    if (appData.settings.theme === 'dark') document.body.setAttribute('data-theme', 'dark');
    else document.body.removeAttribute('data-theme');
}

// ================= Dashboard =================
function renderDashboard() {
    const totalProjects = appData.projects.length;
    const pendingTasks = appData.tasks.filter(t => t.status === 'pending').length;
    const doneTasks = appData.tasks.filter(t => t.status === 'done').length;
    const totalTasks = appData.tasks.length;

    document.getElementById('dash-projects').innerText = totalProjects;
    document.getElementById('dash-pending').innerText = pendingTasks;
    document.getElementById('dash-done').innerText = doneTasks;

    const progressPercentage = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);
    document.getElementById('global-progress').value = progressPercentage;
    document.getElementById('global-progress-text').innerText = `${progressPercentage}% Completado`;

    document.getElementById('activity-log').innerHTML = appData.activity.map(act => 
        `<li style="padding: 10px 0; border-bottom: 1px solid var(--border-color);"><strong>${act.action}</strong> <br><small>${act.time}</small></li>`
    ).join('');
}

// ================= Proyectos y Usuarios =================
function saveProject() {
    const nameInput = document.getElementById('project-name');
    if (!nameInput.value.trim()) return showToast("El nombre es obligatorio", "error");

    const newProject = { id: Date.now().toString(), name: nameInput.value, createdAt: new Date().toISOString() };
    appData.projects.push(newProject);
    logActivity(`Proyecto creado: ${newProject.name}`);
    saveData(); nameInput.value = ''; closeModal('modal-project'); renderProjects(); renderDashboard(); showToast("Proyecto creado");
}

function renderProjects() {
    const container = document.getElementById('project-list');
    container.innerHTML = '';
    appData.projects.forEach(proj => {
        const card = document.createElement('div'); card.className = 'card';
        card.innerHTML = `<h3>${proj.name}</h3>`;
        card.onclick = () => openProject(proj.id, proj.name);
        container.appendChild(card);
    });
}

function openProject(id, name) {
    currentProjectId = id;
    document.getElementById('kanban-title').innerText = `Proyecto: ${name}`;
    showView('kanban');
}

function createUser() {
    const nameInput = document.getElementById('new-user-name');
    const name = nameInput.value.trim();
    if (!name) return showToast("El nombre es obligatorio", "error");
    appData.users.push({ id: 'user_' + Date.now(), name });
    logActivity(`Usuario creado: ${name}`);
    nameInput.value = ''; renderUsers(); saveData(); showToast("Usuario añadido");
}

function renderUsers() {
    const list = document.getElementById('users-list');
    list.innerHTML = appData.users.map(u => `<li class="card" style="margin-bottom:10px;">👤 ${u.name}</li>`).join('');
}

// ================= Tareas y Kanban =================
function saveTask() {
    const nameInput = document.getElementById('task-name');
    const priorityInput = document.getElementById('task-priority');
    const dateInput = document.getElementById('task-due-date');
    
    if (!nameInput.value.trim() || !dateInput.value || !currentProjectId) return showToast("Faltan datos", "error");

    const newTask = {
        id: 'task_' + Date.now(),
        projectId: currentProjectId, name: nameInput.value, priority: priorityInput.value, dueDate: dateInput.value, status: 'pending'
    };
    appData.tasks.push(newTask);
    logActivity(`Tarea creada: ${newTask.name}`);
    saveData(); nameInput.value = ''; dateInput.value = ''; closeModal('modal-task'); 
    renderKanban(); renderDashboard(); showToast("Tarea guardada");
}

function deleteTask(taskId) {
    if(!confirm("¿Eliminar esta tarea permanentemente?")) return;
    appData.tasks = appData.tasks.filter(t => t.id !== taskId);
    logActivity("Tarea eliminada"); saveData(); renderKanban(); renderDashboard(); showToast("Tarea eliminada");
}

function renderKanban() {
    if (!currentProjectId) return;
    const columns = { pending: '', progress: '', done: '' };
    const projectTasks = appData.tasks.filter(t => t.projectId === currentProjectId).sort((a, b) => (a.priority === 'alta' ? -1 : 1));

    projectTasks.forEach(task => {
        const safeName = task.name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        columns[task.status] += `
            <div class="task-card" draggable="true" ondragstart="drag(event)" id="${task.id}">
                <div style="display:flex; justify-content: space-between;">
                    <h4>${safeName}</h4>
                    <button onclick="deleteTask('${task.id}')" style="color:red; border:none; background:none; cursor:pointer;">✖</button>
                </div>
                <small>Prioridad: <strong>${task.priority.toUpperCase()}</strong> | Vence: ${task.dueDate}</small>
            </div>
        `;
    });
    document.getElementById('list-pending').innerHTML = columns.pending;
    document.getElementById('list-progress').innerHTML = columns.progress;
    document.getElementById('list-done').innerHTML = columns.done;
}

// Drag & Drop
function drag(ev) { ev.dataTransfer.setData("text", ev.target.id); }
function allowDrop(ev) { ev.preventDefault(); }
function drop(ev, newStatus) {
    ev.preventDefault();
    const taskId = ev.dataTransfer.getData("text");
    const taskIndex = appData.tasks.findIndex(t => t.id === taskId);
    if (taskIndex > -1) {
        appData.tasks[taskIndex].status = newStatus;
        logActivity(`Tarea movida a ${newStatus}`);
        saveData(); renderKanban(); renderDashboard();
    }
}

// ================= Calendario =================
function changeMonth(offset) {
    currentDate.setMonth(currentDate.getMonth() + offset);
    renderCalendar();
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const monthYearLabel = document.getElementById('calendar-month-year');
    grid.innerHTML = '';
    const year = currentDate.getFullYear(); const month = currentDate.getMonth();
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    monthYearLabel.innerText = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div'); emptyCell.className = 'calendar-day empty'; grid.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div'); cell.className = 'calendar-day';
        cell.innerHTML = `<div class="calendar-day-number">${day}</div>`;
        const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        const dayTasks = appData.tasks.filter(t => t.dueDate === dateString);
        dayTasks.forEach(task => {
            const taskEl = document.createElement('div'); taskEl.className = 'calendar-task';
            taskEl.innerText = task.name; taskEl.title = task.name;
            if(task.status === 'done') { taskEl.style.textDecoration = 'line-through'; taskEl.style.backgroundColor = '#7f8c8d'; }
            cell.appendChild(taskEl);
        });
        grid.appendChild(cell);
    }
}

// Inicializar
window.onload = () => { loadData(); showView('dashboard'); };