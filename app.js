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
let currentSession = null; // { userId, name, role }
let adminViewUserId = 'all'; // Para el selector admin en dashboard

// Instancias de Chart.js
let chartDonut = null;
let chartPriority = null;
let chartBar = null;

// ================= SEGURIDAD =================
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutos
let loginAttempts = {}; // { key: { count, lockedUntil } }
let lockoutTimer = null;

// Hash SHA-256 con Web Crypto API (asíncrono)
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'taskflow_salt_2025');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getLockoutKey(username, role) {
    return `${role}::${username.toLowerCase()}`;
}

function isLockedOut(username, role) {
    const key = getLockoutKey(username, role);
    const record = loginAttempts[key];
    if (!record) return false;
    if (record.lockedUntil && Date.now() < record.lockedUntil) return record.lockedUntil;
    return false;
}

function registerFailedAttempt(username, role) {
    const key = getLockoutKey(username, role);
    if (!loginAttempts[key]) loginAttempts[key] = { count: 0, lockedUntil: null };
    loginAttempts[key].count++;
    if (loginAttempts[key].count >= MAX_ATTEMPTS) {
        loginAttempts[key].lockedUntil = Date.now() + LOCKOUT_MS;
        loginAttempts[key].count = 0;
    }
    return MAX_ATTEMPTS - loginAttempts[key].count;
}

function clearAttempts(username, role) {
    const key = getLockoutKey(username, role);
    delete loginAttempts[key];
}

function startLockoutCountdown(lockedUntil, errorEl) {
    if (lockoutTimer) clearInterval(lockoutTimer);
    lockoutTimer = setInterval(() => {
        const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
        if (remaining <= 0) {
            clearInterval(lockoutTimer);
            lockoutTimer = null;
            errorEl.innerHTML = 'Bloqueo expirado. Puedes intentarlo de nuevo.';
            return;
        }
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        errorEl.innerHTML = `🔒 Cuenta bloqueada por demasiados intentos.<br>
            <span style="font-size:1.1em; font-weight:700; color:#fbbf24;">${mins}:${secs.toString().padStart(2,'0')}</span> para desbloquear.`;
    }, 1000);
}

// Validación de fortaleza de contraseña
function validatePasswordStrength(password) {
    const errors = [];
    if (password.length < 8) errors.push('Mínimo 8 caracteres');
    if (!/[A-Z]/.test(password)) errors.push('Al menos una mayúscula');
    if (!/[0-9]/.test(password)) errors.push('Al menos un número');
    return errors;
}

function updateStrengthBar(password) {
    const bar = document.getElementById('strength-bar');
    const label = document.getElementById('strength-label');
    if (!bar || !label) return;

    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    const levels = [
        { pct: '0%',   color: 'transparent', text: '' },
        { pct: '25%',  color: '#ef4444',      text: '⚠️ Muy débil' },
        { pct: '50%',  color: '#f59e0b',      text: '⚡ Débil' },
        { pct: '75%',  color: '#3b82f6',      text: '✔ Aceptable' },
        { pct: '90%',  color: '#10b981',      text: '✔ Fuerte' },
        { pct: '100%', color: '#10b981',      text: '✔✔ Muy fuerte' },
    ];
    const lvl = levels[score] || levels[0];
    bar.style.width = lvl.pct;
    bar.style.background = lvl.color;
    label.textContent = lvl.text;
    label.style.color = lvl.color;
}

// ================= AUTH =================
let pendingRole = null;

function showLoginForm(role) {
    pendingRole = role;
    document.getElementById('login-mode-select').style.display = 'none';
    document.getElementById('login-form-container').style.display = 'block';
    document.getElementById('login-form-title').textContent =
        role === 'admin' ? '🛡️ Administrador' : '👤 Usuario';

    // Reset tabs to login
    switchAuthTab('login');

    // Para admin: registro solo si no hay admin aún
    const hasAdmin = appData.users.some(u => u.role === 'admin');
    const tabRegisterBtn = document.getElementById('tab-register-btn');
    if (role === 'admin') {
        // Mostrar tab registro solo si no existe un admin todavía
        if (tabRegisterBtn) tabRegisterBtn.style.display = hasAdmin ? 'none' : 'block';
        document.getElementById('login-hint').innerHTML =
            hasAdmin
                ? '<strong>Admin existente:</strong> inicia sesión con tus credenciales.'
                : 'No hay administrador aún. <strong>Crea tu cuenta de admin.</strong>';
    } else {
        if (tabRegisterBtn) tabRegisterBtn.style.display = 'block';
        document.getElementById('login-hint').innerHTML = '';
    }

    document.getElementById('login-username').focus();
}

function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('auth-panel-login').style.display = isLogin ? 'block' : 'none';
    document.getElementById('auth-panel-register').style.display = isLogin ? 'none' : 'block';
    document.getElementById('tab-login').classList.toggle('active', isLogin);
    document.getElementById('tab-register').classList.toggle('active', !isLogin);
    // Clear errors
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('register-error').style.display = 'none';
}

function backToRoleSelect() {
    document.getElementById('login-mode-select').style.display = 'block';
    document.getElementById('login-form-container').style.display = 'none';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
}

async function doLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    if (!username || !password) {
        errorEl.textContent = 'Por favor ingresa usuario y contraseña.';
        errorEl.style.display = 'block';
        return;
    }

    // Verificar bloqueo activo
    const lockedUntil = isLockedOut(username, pendingRole);
    if (lockedUntil) {
        errorEl.style.display = 'block';
        startLockoutCountdown(lockedUntil, errorEl);
        return;
    }

    const hashedInput = await hashPassword(password);

    const user = appData.users.find(u =>
        u.name.toLowerCase() === username.toLowerCase() &&
        u.password === hashedInput &&
        u.role === pendingRole
    );

    if (!user) {
        const remaining = registerFailedAttempt(username, pendingRole);
        const lockedNow = isLockedOut(username, pendingRole);
        if (lockedNow) {
            errorEl.style.display = 'block';
            startLockoutCountdown(lockedNow, errorEl);
        } else {
            errorEl.innerHTML = `Credenciales incorrectas. <strong>${remaining} intento${remaining !== 1 ? 's' : ''}</strong> restante${remaining !== 1 ? 's' : ''} antes del bloqueo.`;
            errorEl.style.display = 'block';
        }
        return;
    }

    clearAttempts(username, pendingRole);
    currentSession = { userId: user.id, name: user.name, role: user.role };
    errorEl.style.display = 'none';
    _enterApp(user);
}

async function doRegister() {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const password2 = document.getElementById('reg-password2').value;
    const errorEl = document.getElementById('register-error');

    if (!username || !password || !password2) {
        errorEl.textContent = 'Por favor completa todos los campos.';
        errorEl.style.display = 'block'; return;
    }
    if (username.length < 3) {
        errorEl.textContent = 'El nombre de usuario debe tener al menos 3 caracteres.';
        errorEl.style.display = 'block'; return;
    }
    const strengthErrors = validatePasswordStrength(password);
    if (strengthErrors.length > 0) {
        errorEl.innerHTML = '⚠️ La contraseña no cumple los requisitos:<br>· ' + strengthErrors.join('<br>· ');
        errorEl.style.display = 'block'; return;
    }
    if (password !== password2) {
        errorEl.textContent = 'Las contraseñas no coinciden.';
        errorEl.style.display = 'block'; return;
    }
    if (appData.users.find(u => u.name.toLowerCase() === username.toLowerCase())) {
        errorEl.textContent = 'Ese nombre de usuario ya está en uso.';
        errorEl.style.display = 'block'; return;
    }
    if (pendingRole === 'admin' && appData.users.some(u => u.role === 'admin')) {
        errorEl.textContent = 'Ya existe un administrador. Inicia sesión.';
        errorEl.style.display = 'block'; return;
    }

    const hashedPassword = await hashPassword(password);

    const newUser = {
        id: (pendingRole === 'admin' ? 'admin' : 'user_') + Date.now(),
        name: username,
        password: hashedPassword,
        role: pendingRole
    };
    appData.users.push(newUser);
    saveData();

    currentSession = { userId: newUser.id, name: newUser.name, role: newUser.role };
    errorEl.style.display = 'none';
    _enterApp(newUser);
    showToast(`¡Bienvenido, ${newUser.name}! Cuenta creada.`);
}

function _enterApp(user) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';
    document.getElementById('nav-users-btn').style.display = user.role === 'admin' ? 'block' : 'none';
    document.getElementById('sidebar-user-badge').innerHTML =
        `<strong>${user.name}</strong>${user.role === 'admin' ? '🛡️ Administrador' : '👤 Usuario'}`;
    showView('dashboard');
}

function logout() {
    currentSession = null;
    adminViewUserId = 'all';
    if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    backToRoleSelect();
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
}

// ================= Filtrado por rol =================
function getVisibleProjects() {
    if (!currentSession) return [];
    if (currentSession.role === 'admin') {
        if (adminViewUserId === 'all') return appData.projects;
        return appData.projects.filter(p => p.ownerId === adminViewUserId);
    }
    // Usuario normal: solo sus proyectos
    return appData.projects.filter(p => p.ownerId === currentSession.userId);
}

function getVisibleTasks(projectsFilter) {
    const projIds = projectsFilter.map(p => p.id);
    return appData.tasks.filter(t => projIds.includes(t.projectId));
}

function switchAdminView(userId) {
    adminViewUserId = userId;
    renderDashboard();
    renderProjects();
    renderKanban();
}

// ================= Interfaz y Notificaciones =================
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');

    if (viewId === 'kanban') renderKanban();
    if (viewId === 'projects') renderProjects();
    if (viewId === 'dashboard') renderDashboard();
    if (viewId === 'users') renderUsers();
    if (viewId === 'calendar') renderCalendar();
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `background: ${type === 'error' ? '#ef4444' : '#10b981'}; color: white; padding: 14px 18px; margin-top: 10px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); opacity: 0; transition: opacity 0.3s; font-family: 'DM Sans', sans-serif; font-size: 0.9em;`;
    container.appendChild(toast);
    setTimeout(() => toast.style.opacity = '1', 10);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function logActivity(action) {
    appData.activity.unshift({ action, time: new Date().toLocaleString() });
    if (appData.activity.length > 5) appData.activity.pop();
    saveData();
    if (!document.getElementById('view-dashboard').classList.contains('hidden')) renderDashboard();
}

// ================= Persistencia de Datos =================
function loadData() {
    const data = localStorage.getItem('taskFlowData_v2');
    if (data) {
        const parsed = JSON.parse(data);
        appData = parsed;
    }
    applyTheme();
}

function saveData() { localStorage.setItem('taskFlowData_v2', JSON.stringify(appData)); }

function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", "taskflow_backup.json");
    document.body.appendChild(dl); dl.click(); dl.remove();
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            appData = JSON.parse(e.target.result);
            saveData(); loadData(); showToast("Datos importados");
            renderDashboard();
        } catch (error) { showToast("Archivo JSON inválido", "error"); }
    };
    reader.readAsText(file);
}

function clearData() {
    if (confirm("¿Borrar TODOS los datos?")) {
        localStorage.removeItem('taskFlowData_v2');
        location.reload();
    }
}

function toggleTheme() {
    appData.settings.theme = appData.settings.theme === 'light' ? 'dark' : 'light';
    applyTheme(); saveData();
}

function applyTheme() {
    if (appData.settings.theme === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
    } else {
        document.body.removeAttribute('data-theme');
    }
    const knob = document.getElementById('theme-toggle-knob');
    if (knob) {
        if (appData.settings.theme === 'dark') {
            knob.style.transform = 'translateX(32px)';
            knob.textContent = '🌙';
        } else {
            knob.style.transform = 'translateX(0)';
            knob.textContent = '☀️';
        }
    }
    // Re-renderizar gráficos con nuevo tema
    if (currentSession) renderCharts(getVisibleProjects());
}

// ================= GRÁFICOS =================
function renderCharts(visibleProjects) {
    const visibleTasks = getVisibleTasks(visibleProjects);
    const isDark = appData.settings.theme === 'dark';

    const textColor = isDark ? '#8b98a9' : '#64748b';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    // ---- Donut: Estado de tareas ----
    const pending = visibleTasks.filter(t => t.status === 'pending').length;
    const progress = visibleTasks.filter(t => t.status === 'progress').length;
    const done = visibleTasks.filter(t => t.status === 'done').length;

    const donutCtx = document.getElementById('chart-donut')?.getContext('2d');
    if (donutCtx) {
        if (chartDonut) chartDonut.destroy();
        chartDonut = new Chart(donutCtx, {
            type: 'doughnut',
            data: {
                labels: ['Pendientes', 'En Progreso', 'Completadas'],
                datasets: [{
                    data: [pending, progress, done],
                    backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
                    borderWidth: 0,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, font: { family: 'DM Sans', size: 11 }, padding: 14, boxWidth: 12 }
                    }
                },
                cutout: '65%'
            }
        });
    }

    // ---- Bar: Prioridad ----
    const alta = visibleTasks.filter(t => t.priority === 'alta').length;
    const media = visibleTasks.filter(t => t.priority === 'media').length;
    const baja = visibleTasks.filter(t => t.priority === 'baja').length;

    const priorityCtx = document.getElementById('chart-priority')?.getContext('2d');
    if (priorityCtx) {
        if (chartPriority) chartPriority.destroy();
        chartPriority = new Chart(priorityCtx, {
            type: 'bar',
            data: {
                labels: ['Alta', 'Media', 'Baja'],
                datasets: [{
                    label: 'Tareas',
                    data: [alta, media, baja],
                    backgroundColor: ['rgba(239,68,68,0.7)', 'rgba(245,158,11,0.7)', 'rgba(16,185,129,0.7)'],
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { ticks: { color: textColor, font: { family: 'DM Sans' } }, grid: { display: false } },
                    y: { ticks: { color: textColor, font: { family: 'DM Sans' }, stepSize: 1 }, grid: { color: gridColor }, beginAtZero: true }
                }
            }
        });
    }

    // ---- Horizontal Bar: Progreso por proyecto ----
    const projLabels = visibleProjects.map(p => p.name.length > 18 ? p.name.slice(0, 16) + '…' : p.name);
    const projPcts = visibleProjects.map(proj => {
        const tasks = visibleTasks.filter(t => t.projectId === proj.id);
        if (tasks.length === 0) return 0;
        return Math.round((tasks.filter(t => t.status === 'done').length / tasks.length) * 100);
    });

    const barCtx = document.getElementById('chart-projects-bar')?.getContext('2d');
    if (barCtx) {
        if (chartBar) chartBar.destroy();
        chartBar = new Chart(barCtx, {
            type: 'bar',
            data: {
                labels: projLabels.length ? projLabels : ['Sin proyectos'],
                datasets: [{
                    label: '% Completado',
                    data: projPcts.length ? projPcts : [0],
                    backgroundColor: 'rgba(79,70,229,0.65)',
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        min: 0, max: 100,
                        ticks: { color: textColor, font: { family: 'DM Sans' }, callback: v => v + '%' },
                        grid: { color: gridColor }
                    },
                    y: { ticks: { color: textColor, font: { family: 'DM Sans', size: 11 } }, grid: { display: false } }
                }
            }
        });
    }
}

// ================= Dashboard =================
function renderDashboard() {
    // Selector de usuario para admin
    const adminBar = document.getElementById('admin-user-selector-bar');
    if (currentSession?.role === 'admin') {
        adminBar.style.display = 'flex';
        const selector = document.getElementById('admin-user-selector');
        const nonAdmins = appData.users.filter(u => u.role !== 'admin');
        selector.innerHTML = `<option value="all">Todos los usuarios (global)</option>` +
            nonAdmins.map(u => `<option value="${u.id}" ${adminViewUserId === u.id ? 'selected' : ''}>${u.name}</option>`).join('');
        selector.value = adminViewUserId;
    } else {
        adminBar.style.display = 'none';
    }

    const visibleProjects = getVisibleProjects();
    const visibleTasks = getVisibleTasks(visibleProjects);

    const pendingTasks = visibleTasks.filter(t => t.status === 'pending').length;
    const progressTasks = visibleTasks.filter(t => t.status === 'progress').length;
    const doneTasks = visibleTasks.filter(t => t.status === 'done').length;
    const totalTasks = visibleTasks.length;

    document.getElementById('dash-projects').innerText = visibleProjects.length;
    document.getElementById('dash-pending').innerText = pendingTasks;
    document.getElementById('dash-progress').innerText = progressTasks;
    document.getElementById('dash-done').innerText = doneTasks;

    const pct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);
    document.getElementById('global-progress-fill').style.width = pct + '%';
    document.getElementById('global-progress-text').innerText = `${pct}% Completado`;

    document.getElementById('activity-log').innerHTML = appData.activity.map(act =>
        `<li style="padding: 9px 0; border-bottom: 1px solid var(--border-color);"><strong>${act.action}</strong><br><small style="color:var(--text-muted)">${act.time}</small></li>`
    ).join('');

    // Progreso por proyecto
    const container = document.getElementById('projects-progress-list');
    if (visibleProjects.length === 0) {
        container.innerHTML = '<p style="opacity:0.5; padding: 10px 0;">No hay proyectos visibles.</p>';
    } else {
        container.innerHTML = visibleProjects.map(proj => {
            const allTasks = visibleTasks.filter(t => t.projectId === proj.id);
            const pending = allTasks.filter(t => t.status === 'pending');
            const inProgress = allTasks.filter(t => t.status === 'progress');
            const done = allTasks.filter(t => t.status === 'done');
            const total = allTasks.length;
            const pct = total === 0 ? 0 : Math.round((done.length / total) * 100);

            const owner = currentSession?.role === 'admin' ?
                appData.users.find(u => u.id === proj.ownerId) : null;
            const ownerLabel = owner ? `<span style="font-size:0.75em; color:var(--text-muted); margin-left:8px;">— ${owner.name}</span>` : '';

            const taskListHTML = (tasks, label, color) => tasks.length === 0 ? '' : `
                <div class="proj-task-group">
                    <div class="proj-task-group-label" style="color:${color}">● ${label} (${tasks.length})</div>
                    <ul class="proj-task-names">
                        ${tasks.map(t => `<li>${t.name.replace(/</g, '&lt;')}</li>`).join('')}
                    </ul>
                </div>`;

            return `
            <div class="card proj-progress-card">
                <div class="proj-progress-header">
                    <span class="proj-progress-name">📁 ${proj.name}${ownerLabel}</span>
                    <span class="proj-progress-pct">${pct}%</span>
                </div>
                <div class="proj-progress-bar-track">
                    <div class="proj-progress-bar-fill" style="width:${pct}%"></div>
                </div>
                <div class="proj-task-columns">
                    ${taskListHTML(pending, 'Pendientes', 'var(--danger-color)')}
                    ${taskListHTML(inProgress, 'En Progreso', '#f59e0b')}
                    ${taskListHTML(done, 'Completadas', '#10b981')}
                    ${total === 0 ? '<p style="opacity:0.5; font-size:0.85em;">Sin tareas aún.</p>' : ''}
                </div>
            </div>`;
        }).join('');
    }

    // Renderizar gráficos
    renderCharts(visibleProjects);
}

// ================= Proyectos =================
function saveProject() {
    const nameInput = document.getElementById('project-name');
    if (!nameInput.value.trim()) return showToast("El nombre es obligatorio", "error");

    const newProject = {
        id: Date.now().toString(),
        name: nameInput.value,
        createdAt: new Date().toISOString(),
        ownerId: currentSession.userId
    };
    appData.projects.push(newProject);
    logActivity(`Proyecto creado: ${newProject.name}`);
    saveData();
    nameInput.value = '';
    closeModal('modal-project');
    renderProjects();
    renderDashboard();
    if (!document.getElementById('view-kanban').classList.contains('hidden')) renderKanban();
    showToast("Proyecto creado");
}

function renderProjects() {
    const container = document.getElementById('project-list');
    container.innerHTML = '';
    const projects = getVisibleProjects();
    if (projects.length === 0) {
        container.innerHTML = '<p style="color: var(--text-color); opacity:0.5; padding: 20px 0;">No hay proyectos. Crea uno con el botón de arriba.</p>';
        return;
    }
    projects.forEach(proj => {
        const taskCount = appData.tasks.filter(t => t.projectId === proj.id).length;
        const doneCount = appData.tasks.filter(t => t.projectId === proj.id && t.status === "done").length;
        const createdDate = new Date(proj.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
        const owner = appData.users.find(u => u.id === proj.ownerId);
        const ownerMeta = currentSession?.role === 'admin' && owner ? ` · ${owner.name}` : '';

        const row = document.createElement("div");
        row.className = "project-row";
        row.innerHTML = `
            <div class="project-row-info">
                <div class="project-row-icon">📁</div>
                <div class="project-row-text">
                    <div class="project-row-name">${proj.name}</div>
                    <div class="project-row-meta">Creado el ${createdDate}${ownerMeta}</div>
                </div>
            </div>
            <div class="project-row-stats">
                <span class="project-badge">${doneCount}/${taskCount} completadas</span>
            </div>
            <button onclick="deleteProject('${proj.id}', event)" class="project-row-delete" title="Eliminar Proyecto">✖</button>
        `;
        row.querySelector(".project-row-info").onclick = () => openProject(proj.id);
        container.appendChild(row);
    });
}

function deleteProject(projectId, event) {
    event.stopPropagation();
    if (!confirm("¿Eliminar este proyecto? Se borrarán TODAS sus tareas.")) return;
    appData.projects = appData.projects.filter(p => p.id !== projectId);
    appData.tasks = appData.tasks.filter(t => t.projectId !== projectId);
    if (currentProjectId === projectId) currentProjectId = null;
    logActivity("Proyecto eliminado");
    saveData();
    renderProjects();
    renderDashboard();
    showToast("Proyecto y sus tareas eliminados");
}

function openProject(id) {
    currentProjectId = id;
    showView('kanban');
}

function switchKanbanProject(newProjectId) {
    currentProjectId = newProjectId;
    renderKanban();
}

// ================= Usuarios (solo admin) =================
async function createUser() {
    if (currentSession?.role !== 'admin') return;
    const nameInput = document.getElementById('new-user-name');
    const passInput = document.getElementById('new-user-password');
    const name = nameInput.value.trim();
    const password = passInput.value.trim();
    if (!name) return showToast("El nombre es obligatorio", "error");
    if (!password) return showToast("La contraseña es obligatoria", "error");
    const strengthErrors = validatePasswordStrength(password);
    if (strengthErrors.length > 0) {
        return showToast("Contraseña débil: " + strengthErrors[0], "error");
    }
    if (appData.users.find(u => u.name.toLowerCase() === name.toLowerCase())) {
        return showToast("Ya existe un usuario con ese nombre", "error");
    }
    const hashedPassword = await hashPassword(password);
    appData.users.push({ id: 'user_' + Date.now(), name, password: hashedPassword, role: 'user' });
    logActivity(`Usuario creado: ${name}`);
    nameInput.value = '';
    passInput.value = '';
    renderUsers();
    saveData();
    showToast("Usuario añadido");
}

function renderUsers() {
    const list = document.getElementById('users-list');
    list.innerHTML = appData.users.map(u => `
        <li class="user-list-item">
            <div style="display:flex; align-items:center; gap:12px;">
                <span style="font-size:1.3em">${u.role === 'admin' ? '🛡️' : '👤'}</span>
                <div>
                    <strong>${u.name}</strong>
                    <div style="font-size:0.8em; color:var(--text-muted); margin-top:2px;">
                        ${appData.projects.filter(p => p.ownerId === u.id).length} proyectos
                    </div>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <span class="user-role-badge ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}">
                    ${u.role === 'admin' ? 'ADMIN' : 'USUARIO'}
                </span>
                ${u.role !== 'admin' ? `<button onclick="deleteUser('${u.id}')" style="color: var(--danger-color); border:none; background:none; cursor:pointer; font-size:1.1em; opacity:0.5; transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5">✖</button>` : ''}
            </div>
        </li>
    `).join('');
}

function deleteUser(userId) {
    if (!confirm("¿Eliminar este usuario? Sus proyectos permanecerán pero quedarán sin dueño.")) return;
    appData.users = appData.users.filter(u => u.id !== userId);
    logActivity("Usuario eliminado");
    saveData(); renderUsers(); showToast("Usuario eliminado");
}

// ================= Tareas y Kanban =================
function saveTask() {
    const nameInput = document.getElementById('task-name');
    const priorityInput = document.getElementById('task-priority');
    const dateInput = document.getElementById('task-due-date');
    if (!nameInput.value.trim() || !dateInput.value || !currentProjectId) return showToast("Faltan datos", "error");

    const newTask = {
        id: 'task_' + Date.now(),
        projectId: currentProjectId,
        name: nameInput.value,
        priority: priorityInput.value,
        dueDate: dateInput.value,
        status: 'pending'
    };
    appData.tasks.push(newTask);
    logActivity(`Tarea creada: ${newTask.name}`);
    saveData();
    nameInput.value = '';
    dateInput.value = '';
    closeModal('modal-task');
    renderKanban();
    renderDashboard();
    renderProjects();
    showToast("Tarea guardada");
}

function deleteTask(taskId) {
    if (!confirm("¿Eliminar esta tarea?")) return;
    appData.tasks = appData.tasks.filter(t => t.id !== taskId);
    logActivity("Tarea eliminada");
    saveData();
    renderKanban();
    renderDashboard();
    renderProjects();
    showToast("Tarea eliminada");
}

function renderKanban() {
    const emptyState = document.getElementById('kanban-empty-state');
    const kanbanBoard = document.getElementById('kanban-board-container');
    const selector = document.getElementById('kanban-project-selector');
    const btnNewTask = document.getElementById('btn-new-task');
    const titleLabel = document.getElementById('kanban-title');

    const visibleProjects = getVisibleProjects();

    if (visibleProjects.length === 0) {
        emptyState.style.display = 'block';
        kanbanBoard.style.display = 'none';
        selector.style.display = 'none';
        btnNewTask.style.display = 'none';
        titleLabel.style.display = 'none';
        return;
    } else {
        emptyState.style.display = 'none';
        kanbanBoard.style.display = 'flex';
        selector.style.display = 'block';
        btnNewTask.style.display = 'block';
        titleLabel.style.display = 'block';
    }

    selector.innerHTML = visibleProjects.map(p =>
        `<option value="${p.id}">${p.name}</option>`
    ).join('');

    if (!currentProjectId || !visibleProjects.find(p => p.id === currentProjectId)) {
        currentProjectId = visibleProjects[0].id;
    }
    selector.value = currentProjectId;

    const columns = { pending: '', progress: '', done: '' };
    const priorityOrder = { 'alta': 0, 'media': 1, 'baja': 2 };
    const projectTasks = appData.tasks
        .filter(t => t.projectId === currentProjectId)
        .sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));

    projectTasks.forEach(task => {
        const safeName = task.name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        columns[task.status] += `
            <div class="task-card" draggable="true" ondragstart="drag(event)" id="${task.id}" data-priority="${task.priority}">
                <div style="display:flex; justify-content: space-between; align-items:flex-start;">
                    <h4 style="font-size:0.9em; font-weight:600; flex:1;">${safeName}</h4>
                    <button onclick="deleteTask('${task.id}')" style="color:var(--danger-color); border:none; background:none; cursor:pointer; margin-left:8px; opacity:0.5; transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5">✖</button>
                </div>
                <small style="color:var(--text-muted); font-size:0.78em;">Prioridad: <strong>${task.priority.toUpperCase()}</strong> · Vence: ${task.dueDate}</small>
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
        saveData();
        renderKanban();
        renderDashboard();
        renderProjects();
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
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    monthYearLabel.innerText = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const visibleProjects = getVisibleProjects();
    const visibleTasks = getVisibleTasks(visibleProjects);

    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        grid.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        cell.innerHTML = `<div class="calendar-day-number">${day}</div>`;
        const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        const dayTasks = visibleTasks.filter(t => t.dueDate === dateString);
        dayTasks.forEach(task => {
            const taskEl = document.createElement('div');
            taskEl.className = 'calendar-task';
            taskEl.innerText = task.name;
            taskEl.title = task.name;
            if (task.status === 'done') {
                taskEl.style.textDecoration = 'line-through';
                taskEl.style.backgroundColor = '#64748b';
            }
            cell.appendChild(taskEl);
        });
        grid.appendChild(cell);
    }
}

// ================= Inicializar =================
window.onload = () => {
    loadData();
    // Mostrar login al inicio
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('main-app').style.display = 'none';
};
