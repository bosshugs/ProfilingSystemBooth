const state = {
  role: 'renter', page: 'overview', user: null, token: null,
  month: new Date().getMonth(), year: new Date().getFullYear(),
  attendance: [], renters: [], disputes: [], report: null
};

const today = new Date();
const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(today);
const dateLabel = today.toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
});
const money = value => new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP'
}).format(Number(value || 0));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const renterNav = [
  ['overview', '▦', 'Overview'], ['attendance', '◷', 'Attendance'],
  ['billing', '＄', 'Rent & billing'], ['disputes', '◇', 'Disputes']
];
const adminNav = [
  ['overview', '▦', 'Overview'], ['renters', '♙', 'Manage renters'],
  ['register', '＋', 'Register renter'], ['report', '▤', 'Transparency report'],
  ['attendance', '◷', 'Attendance'], ['disputes', '◇', 'Disputes']
];

async function api(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    throw new Error('Cannot reach StallCheck. Start it with npm.cmd start, then open http://localhost:3000 (do not open index.html directly).');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Something went wrong. Please try again.');
  return payload;
}

document.querySelectorAll('.role-toggle button').forEach(button => {
  button.addEventListener('click', () => {
    state.role = button.dataset.role;
    document.querySelectorAll('.role-toggle button').forEach(item => item.classList.toggle('active', item === button));
    document.getElementById('loginButton').textContent = `Sign in as ${state.role === 'admin' ? 'administrator' : 'renter'}`;
    document.getElementById('activateLink').classList.toggle('hidden', state.role === 'admin');
  });
});

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('loginButton');
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    const result = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value,
        role: state.role
      })
    });
    state.token = result.token;
    state.user = result.user;
    state.page = 'overview';
    document.getElementById('loginView').classList.add('hidden');
    document.getElementById('appView').classList.remove('hidden');
    document.getElementById('userName').textContent = state.user.name;
    document.getElementById('userRole').textContent = state.user.role === 'admin'
      ? 'Administrator' : `Stall owner · ${state.user.stall || 'Pending assignment'}`;
    document.getElementById('avatar').textContent = state.user.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    await render();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = `Sign in as ${state.role === 'admin' ? 'administrator' : 'renter'}`;
  }
});

document.getElementById('logoutButton').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* Local token is still cleared. */ }
  state.token = null;
  state.user = null;
  document.getElementById('appView').classList.add('hidden');
  document.getElementById('loginView').classList.remove('hidden');
});

document.getElementById('supportLink').addEventListener('click', event => {
  event.preventDefault();
  toast('Contact your market administrator for account and device support.');
});
document.getElementById('forgotLink').addEventListener('click', event => {
  event.preventDefault();
  toast('Ask the market administrator to reset your password.');
});
document.getElementById('activateLink').addEventListener('click', event => {
  event.preventDefault();
  document.getElementById('signupModal').classList.remove('hidden');
});

document.getElementById('signupForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/register', {
      method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    document.getElementById('signupModal').classList.add('hidden');
    event.currentTarget.reset();
    toast('Account request saved. An administrator must activate it before sign-in.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

document.getElementById('closeSignup').addEventListener('click', () => document.getElementById('signupModal').classList.add('hidden'));
document.getElementById('cancelCheckin').addEventListener('click', () => document.getElementById('checkinModal').classList.add('hidden'));
document.getElementById('verifyButton').addEventListener('click', async event => {
  const button = event.currentTarget;
  const title = document.getElementById('scanTitle');
  const detail = document.getElementById('scanDetail');
  button.disabled = true;
  button.textContent = 'Recording…';
  title.textContent = 'Saving demo attendance';
  detail.textContent = 'This prototype does not connect to a biometric device.';
  try {
    const result = await api('/api/checkins', {
      method: 'POST', body: JSON.stringify({ method: document.getElementById('methodSelect').value })
    });
    document.getElementById('checkinModal').classList.add('hidden');
    toast(result.message);
    await render();
  } catch (error) { toast(error.message); }
  finally {
    button.disabled = false;
    button.textContent = 'Start verification';
    title.textContent = 'Ready for identity check';
    detail.textContent = 'Choose a demo verification method to continue.';
  }
});

function toast(message) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.textContent = message;
  document.getElementById('toastHost').append(element);
  setTimeout(() => element.remove(), 3800);
}

async function loadData() {
  if (state.user.role === 'admin') {
    const [report, renters, attendance, disputes] = await Promise.all([
      api('/api/admin/report'), api('/api/admin/renters'),
      api('/api/attendance'), api('/api/disputes')
    ]);
    state.report = report;
    state.renters = renters.renters;
    state.attendance = attendance.attendance;
    state.disputes = disputes.disputes;
  } else {
    const [attendance, disputes] = await Promise.all([api('/api/attendance'), api('/api/disputes')]);
    state.attendance = attendance.attendance;
    state.disputes = disputes.disputes;
  }
}

function go(page) { state.page = page; render(); }

function renderNav() {
  const links = state.user.role === 'admin' ? adminNav : renterNav;
  document.getElementById('navigation').innerHTML = links.map(([id, icon, label]) => `
    <button data-page="${id}" class="${state.page === id ? 'active' : ''}">
      <span class="nav-icon">${icon}</span>${label}
    </button>`).join('');
  document.querySelectorAll('#navigation [data-page]').forEach(button => {
    button.addEventListener('click', () => go(button.dataset.page));
  });
}

function pageHead(title, description, action = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${description}</p></div><div class="date-tag">${dateLabel}</div></div>${action}`;
}

function statCards(items) {
  return `<div class="grid stats">${items.map(([label, value, note, icon]) => `
    <article class="card"><div class="stat"><div><div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>
      <div class="stat-icon">${icon}</div></div></article>`).join('')}</div>`;
}

function attendanceTable(rows) {
  if (!rows.length) return '<div class="empty">No attendance records yet.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Renter</th><th>Stall</th><th>Date</th><th>Time</th><th>Method</th><th>Status</th></tr></thead><tbody>
    ${rows.map(row => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.stall || 'Unassigned')}</td>
      <td>${escapeHtml(row.business_date)}</td><td>${escapeHtml(new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</td>
      <td>${escapeHtml(row.method)} <small>(demo)</small></td><td><span class="status">Verified</span></td></tr>`).join('')}
    </tbody></table></div>`;
}

function renterOverview() {
  const todays = state.attendance.some(item => item.business_date === localDate);
  const monthTotal = state.attendance.filter(item => item.business_date.startsWith(localDate.slice(0, 7))).length;
  const weekly = state.attendance.slice(0, 7).length;
  const rate = Number(state.user.daily_rate || 5);
  return `${pageHead(`Welcome, ${escapeHtml(state.user.name.split(' ')[0])}`, 'Here’s your attendance and stall rental overview.')}
    <section class="welcome"><div><h2>${todays ? 'Your attendance is recorded' : 'Your stall is ready for today'}</h2>
      <p>${todays ? 'Today’s demo check-in is saved to the local database.' : 'Record your demo check-in to add today’s attendance.'}</p></div>
      ${todays ? '<span class="status">✓ Checked in today</span>' : '<button class="primary" id="checkinOpen">◎ &nbsp; Check in for today</button>'}</section>
    ${statCards([['Attendance this month', `${monthTotal} days`, 'Saved check-in records', '◷'],
      ['Assigned stall', escapeHtml(state.user.stall || 'Pending'), 'Market assignment', '⌂'],
      ['Estimated rent', money(weekly * rate), `${weekly} saved days × ${money(rate)}`, '＄'],
      ['Open disputes', state.disputes.filter(item => item.status === 'Open').length, 'Awaiting administrator review', '◇']])}
    <div class="grid columns"><article class="card"><div class="card-head"><h3>Recent attendance</h3><button class="text-btn" data-page="attendance">View history</button></div>
      ${attendanceTable(state.attendance.slice(0, 6))}</article><article class="card"><div class="card-head"><h3>How your estimate works</h3><span class="status neutral">Estimated</span></div>
      <div class="breakdown"><div class="row"><span>Saved attendance days</span><strong>${weekly}</strong></div><div class="row"><span>Daily stall rate</span><strong>${money(rate)}</strong></div><div class="divider"></div><div class="row"><span>Estimate</span><strong class="total">${money(weekly * rate)}</strong></div>
      <p style="font-size:11px;color:#909b95;line-height:1.55">Only recorded check-ins appear here. A missing record needs review; it is not proof of absence.</p><button class="secondary" data-page="billing">View rent details</button></div></article></div>`;
}

function adminOverview() {
  const report = state.report;
  const recent = state.attendance.slice(0, 5);
  return `${pageHead('Market overview', 'Manage stall owners and review clear, attendance-based rental records.')}
    <section class="welcome"><div><h2>Good day, administrator</h2><p>Keep renter assignments, attendance records, and estimated charges in one place.</p></div><button class="primary" data-page="register">＋ &nbsp; Register a renter</button></section>
    ${statCards([['Active renters', report.activeRenters, `${report.pendingRenters} pending approval`, '♙'],
      ['Verified today', report.checkinsToday, 'Unique renter check-ins', '◷'],
      ['Estimated rent today', money(report.estimatedToday), 'Verified check-ins × daily rates', '＄'],
      ['Open disputes', report.openDisputes, 'Need review', '◇']])}
    <div class="grid columns"><article class="card"><div class="card-head"><h3>Recent verified check-ins</h3><button class="text-btn" data-page="attendance">Full attendance</button></div>
      ${attendanceTable(recent)}</article><article class="card"><div class="card-head"><h3>Administrator shortcuts</h3><span class="status neutral">Workspace</span></div>
      <div class="activity"><button class="activity-item shortcut" data-page="renters"><div class="activity-icon">♙</div><div class="activity-text">Manage renters<small>Review stall assignments and activate accounts</small></div></button>
        <button class="activity-item shortcut" data-page="register"><div class="activity-icon">＋</div><div class="activity-text">Register renter<small>Create an owner login and assign a stall</small></div></button>
        <button class="activity-item shortcut" data-page="report"><div class="activity-icon">▤</div><div class="activity-text">Transparency report<small>See how daily estimates are calculated</small></div></button></div></article></div>
    <article class="card" style="margin-top:18px"><div class="card-head"><h3>Transparency at a glance</h3><button class="text-btn" data-page="report">Open full report</button></div>
      <div class="report-highlight">This report counts only saved demo check-ins. A missing check-in stays unresolved until reviewed; the system does not treat it as proof that an owner was absent or made no sales.</div>
      <div class="row"><span>Billing approach</span><strong>Verified check-in × assigned daily rate</strong></div></article>`;
}

function renterTable() {
  if (!state.renters.length) return '<div class="empty">No renters registered yet. Use Register renter to add the first stall owner.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Renter</th><th>Username</th><th>Email</th><th>Stall</th><th>Today</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${state.renters.map(renter => `<tr><td><strong>${escapeHtml(renter.name)}</strong></td><td>${escapeHtml(renter.username)}</td><td>${escapeHtml(renter.email)}</td>
      <td>${escapeHtml(renter.stall || 'Unassigned')}</td><td>${renter.checked_in_today ? '<span class="status">Checked in</span>' : '<span class="status neutral">No record</span>'}</td>
      <td><span class="status ${renter.status === 'Pending' ? 'pending' : ''}">${escapeHtml(renter.status)}</span></td>
      <td>${renter.status === 'Pending' ? `<button class="text-btn" data-approve="${renter.id}">Approve account</button>` : `<button class="text-btn" data-edit-renter="${renter.id}">Edit assignment</button>`}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function rentersPage() {
  return `${pageHead('Manage renters', 'Review stall-owner accounts, assignments, and daily check-ins.', '<button class="primary" data-page="register" style="width:auto">＋ &nbsp; Register renter</button>')}
    <div class="filterbar"><input id="renterSearch" placeholder="Search name, username, stall, or email"><select id="renterStatus"><option value="">All account statuses</option><option>Active</option><option>Pending</option></select></div>
    <article class="card" id="renterTable">${renterTable()}</article>`;
}

function registerPage() {
  return `${pageHead('Register a renter', 'Create a stall-owner login and assign their booth.')}
    <div class="grid columns"><article class="card"><div class="card-head"><h3>Renter account and stall</h3><span class="status neutral">Admin registration</span></div>
      <form id="adminRegisterForm"><label class="field">Renter’s full name<input name="name" required maxlength="80" placeholder="e.g. Jamie Mercado"></label>
      <label class="field">Username<input name="username" required minlength="3" maxlength="40" autocomplete="off" placeholder="Choose a username"></label>
      <label class="field">Email address<input name="email" type="email" required maxlength="160" placeholder="owner@example.com"></label>
      <label class="field">Temporary password<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px"><label class="field">Stall / booth ID<input name="stall" required maxlength="30" placeholder="e.g. B-14"></label>
      <label class="field">Daily rate (USD)<input name="daily_rate" type="number" min="0" step="0.01" value="5.00" required></label></div>
      <button class="primary" style="margin-top:22px">Create renter account</button></form></article>
      <article class="card"><div class="card-head"><h3>Before you save</h3></div><div class="report-highlight">The account and stall assignment are stored in the local SQLite database. The renter can sign in with the username and temporary password you set.</div>
      <p style="font-size:13px;color:#72817b;line-height:1.7">Daily attendance records use the assigned rate to show an estimate. The prototype’s check-in is simulated and does not verify a real face or fingerprint.</p></article></div>`;
}

function attendancePage() {
  const rows = state.user.role === 'admin' ? state.attendance : state.attendance;
  const methods = [...new Set(rows.map(row => row.method).filter(Boolean))];
  return `${pageHead(state.user.role === 'admin' ? 'Attendance records' : 'Your attendance', 'Review saved check-in records by date and verification method.')}
    <div class="report-highlight">A record means a successful demo check-in. It is not proof of sales. Missing records are not automatically treated as confirmed absences.</div>
    <div class="filterbar attendance-filters">
      <input id="attendanceSearch" type="search" placeholder="Search date${state.user.role === 'admin' ? ', renter, or stall' : ' or method'}" aria-label="Search attendance records">
      <select id="attendanceMethod" aria-label="Filter by check-in method"><option value="">All methods</option>${methods.map(method => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`).join('')}</select>
      <button class="secondary" id="resetAttendanceFilters" type="button">Reset filters</button>
      <button class="secondary print-button" id="printAttendance" type="button">Print / Save PDF</button>
    </div>
    <article class="card" id="attendanceTable">${attendanceTable(rows)}</article>`;
}

function reportPage() {
  const report = state.report;
  const topRenter = report.topRenters.map(renter => `<tr><td><strong>${escapeHtml(renter.name)}</strong></td><td>${escapeHtml(renter.stall || 'Unassigned')}</td><td>${renter.checkins}</td><td>${money(renter.estimate)}</td></tr>`).join('');
  return `${pageHead('Transparency report', 'A clear summary of how attendance-based rental estimates are formed.')}
    ${statCards([['Recorded check-ins', report.totalCheckins, 'All saved demo records', '◷'],
      ['Check-ins today', report.checkinsToday, 'Market local date', '▦'],
      ['Estimated rent this week', money(report.weekEstimate), 'Verified records × each stall rate', '＄'],
      ['Open disputes', report.openDisputes, 'Awaiting administrator review', '◇']])}
    <article class="card"><div class="card-head"><h3>Weekly estimate by renter</h3><button class="secondary" id="downloadReport">↓ &nbsp; Download CSV</button></div>
      <div class="report-highlight">Formula: count of saved check-ins in the current market week × the renter’s assigned daily rate. This is an estimate, not a finalized invoice. Adjustments and device exceptions need administrator review.</div>
      ${topRenter ? `<div class="table-wrap"><table><thead><tr><th>Renter</th><th>Stall</th><th>Verified demo days</th><th>Estimated rent</th></tr></thead><tbody>${topRenter}</tbody></table></div>` : '<div class="empty">No attendance has been recorded for this week.</div>'}</article>`;
}

function disputesPage() {
  const admin = state.user.role === 'admin';
  const rows = state.disputes.length ? state.disputes.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.stall || 'Unassigned')}</td>
    <td>${escapeHtml(item.business_date)}</td><td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.details)}</td>
    <td><span class="status ${item.status === 'Open' ? 'pending' : ''}">${escapeHtml(item.status)}</span></td>
    <td>${admin && item.status === 'Open' ? `<button class="text-btn" data-resolve="${item.id}">Resolve</button>` : escapeHtml(item.review_note || '—')}</td></tr>`).join('') : '';
  return `${pageHead(admin ? 'Dispute review' : 'Disputes & support', admin ? 'Review renter requests and document a resolution.' : 'Report a missing record, device issue, or billing question.')}
    <article class="card">${admin ? `<div class="card-head"><h3>Renter disputes</h3><span class="status pending">${state.disputes.filter(item => item.status === 'Open').length} open</span></div>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>Renter</th><th>Stall</th><th>Date</th><th>Reason</th><th>Details</th><th>Status</th><th>Resolution</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No disputes have been submitted.</div>'}` :
      `<div class="card-head"><h3>Submit a dispute</h3><span class="status neutral">Visible to administrators</span></div>
      <form id="disputeForm"><label class="field">Date to review<input name="business_date" type="date" value="${localDate}" required></label>
      <label class="field">Reason<select name="reason"><option>Biometric device issue</option><option>Incorrect attendance record</option><option>Billing calculation question</option><option>Approved absence / exception</option></select></label>
      <label class="field">Details<textarea name="details" rows="4" required maxlength="1000" placeholder="Tell us what happened…"></textarea></label>
      <button class="primary" style="margin-top:20px">Submit dispute</button></form>`}</article>`;
}

function billingPage() {
  if (state.user.role === 'admin') return reportPage();
  const rate = Number(state.user.daily_rate || 5);
  const checkins = state.attendance.slice(0, 30);
  return `${pageHead('Rent & billing', 'Your estimate is based on the attendance records saved to your account.')}
    <div class="report-highlight">This prototype estimates rent by multiplying recorded check-ins by your assigned daily rate. It is not a finalized invoice; missing records need review.</div>
    ${statCards([['Saved attendance days', checkins.length, 'All time', '◷'], ['Daily rate', money(rate), 'Assigned by administrator', '＄'], ['Estimated total', money(checkins.length * rate), 'Check-ins × daily rate', '∑'], ['Billing status', 'Estimate', 'Not an invoice', '▤']])}
    <article class="card"><div class="card-head"><h3>Attendance used in estimate</h3></div>${attendanceTable(checkins)}</article>`;
}

function settingsPage() {
  return `${pageHead('Settings', 'Account details and local market policy.')}
    <article class="card"><div class="card-head"><h3>Your profile</h3></div><div class="row"><span>Name</span><strong>${escapeHtml(state.user.name)}</strong></div>
    <div class="row" style="margin-top:15px"><span>Username</span><strong>${escapeHtml(state.user.username)}</strong></div>
    <div class="row" style="margin-top:15px"><span>Stall</span><strong>${escapeHtml(state.user.stall || 'Awaiting assignment')}</strong></div>
    <p style="font-size:12px;color:#72817b;line-height:1.7;margin-top:24px">Contact your administrator if your account or stall assignment needs to change.</p></article>`;
}

async function render() {
  renderNav();
  const main = document.getElementById('mainContent');
  main.innerHTML = '<article class="card empty">Loading saved records…</article>';
  try { await loadData(); }
  catch (error) { main.innerHTML = `<article class="card empty">${escapeHtml(error.message)}</article>`; return; }

  const pages = {
    overview: () => state.user.role === 'admin' ? adminOverview() : renterOverview(),
    renters: rentersPage, register: registerPage,
    report: reportPage, attendance: attendancePage,
    disputes: disputesPage, billing: billingPage, settings: settingsPage
  };
  main.innerHTML = (pages[state.page] || pages.overview)();
  main.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => go(button.dataset.page)));

  const checkin = document.getElementById('checkinOpen');
  if (checkin) checkin.addEventListener('click', () => document.getElementById('checkinModal').classList.remove('hidden'));

  const adminRegister = document.getElementById('adminRegisterForm');
  if (adminRegister) adminRegister.addEventListener('submit', async event => {
    event.preventDefault();
    const button = adminRegister.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const form = new FormData(adminRegister);
      const body = Object.fromEntries(form.entries());
      body.daily_rate = Number(body.daily_rate);
      const result = await api('/api/admin/renters', { method: 'POST', body: JSON.stringify(body) });
      toast(`Renter account created for ${result.renter.name}.`);
      state.page = 'renters';
      await render();
    } catch (error) { toast(error.message); button.disabled = false; }
  });

  const search = document.getElementById('renterSearch');
  if (search) {
    const status = document.getElementById('renterStatus');
    const update = () => {
      const query = search.value.toLowerCase();
      const filterStatus = status.value;
      const filtered = state.renters.filter(renter =>
        (!filterStatus || renter.status === filterStatus) &&
        [renter.name, renter.username, renter.email, renter.stall].some(value => String(value || '').toLowerCase().includes(query))
      );
      document.getElementById('renterTable').innerHTML = renterTableFrom(filtered);
      bindApprovals();
    };
    search.addEventListener('input', update);
    status.addEventListener('change', update);
  }

  const attendanceSearch = document.getElementById('attendanceSearch');
  if (attendanceSearch) {
    const methodFilter = document.getElementById('attendanceMethod');
    const updateAttendance = () => {
      const query = attendanceSearch.value.trim().toLowerCase();
      const method = methodFilter.value;
      const filtered = state.attendance.filter(row =>
        (!method || row.method === method) &&
        [row.business_date, row.method, row.name, row.stall].some(value => String(value || '').toLowerCase().includes(query))
      );
      document.getElementById('attendanceTable').innerHTML = attendanceTable(filtered);
    };
    attendanceSearch.addEventListener('input', updateAttendance);
    methodFilter.addEventListener('change', updateAttendance);
    document.getElementById('resetAttendanceFilters').addEventListener('click', () => {
      attendanceSearch.value = '';
      methodFilter.value = '';
      updateAttendance();
    });
    document.getElementById('printAttendance').addEventListener('click', () => window.print());
  }

  bindApprovals();
  bindRenterEdits();
  const disputeForm = document.getElementById('disputeForm');
  if (disputeForm) disputeForm.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api('/api/disputes', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(disputeForm).entries())) });
      toast('Dispute saved for administrator review.');
      await render();
    } catch (error) { toast(error.message); }
  });
  main.querySelectorAll('[data-resolve]').forEach(button => button.addEventListener('click', async () => {
    const note = prompt('Enter a short resolution note:');
    if (!note?.trim()) return;
    try {
      await api(`/api/admin/disputes/${button.dataset.resolve}`, { method: 'PATCH', body: JSON.stringify({ review_note: note.trim() }) });
      toast('Dispute marked resolved.');
      await render();
    } catch (error) { toast(error.message); }
  }));
  const download = document.getElementById('downloadReport');
  if (download) download.addEventListener('click', downloadCsv);
  document.getElementById('exportAttendance')?.addEventListener('click', downloadCsv);
}

function renterTableFrom(renters) {
  if (!renters.length) return '<div class="empty">No matching renters.</div>';
  const previous = state.renters;
  state.renters = renters;
  const html = renterTable();
  state.renters = previous;
  return html;
}

function bindApprovals() {
  document.querySelectorAll('[data-approve]').forEach(button => button.addEventListener('click', async () => {
    try {
      await api(`/api/admin/renters/${button.dataset.approve}/approve`, { method: 'POST' });
      toast('Renter account approved.');
      await render();
    } catch (error) { toast(error.message); }
  }));
}

function bindRenterEdits() {
  document.querySelectorAll('[data-edit-renter]').forEach(button => button.addEventListener('click', () => {
    const renter = state.renters.find(item => item.id === Number(button.dataset.editRenter));
    if (!renter) return;
    document.getElementById('editRenterId').value = renter.id;
    document.getElementById('editRenterStall').value = renter.stall || '';
    document.getElementById('editRenterRate').value = renter.daily_rate;
    document.getElementById('editRenterName').textContent = renter.name;
    document.getElementById('editRenterModal').classList.remove('hidden');
  }));
}

document.getElementById('closeEditRenter').addEventListener('click', () => {
  document.getElementById('editRenterModal').classList.add('hidden');
});

document.getElementById('editRenterForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const id = document.getElementById('editRenterId').value;
    await api(`/api/admin/renters/${id}`, {
      method: 'PATCH', body: JSON.stringify({
        stall: document.getElementById('editRenterStall').value.trim(),
        daily_rate: Number(document.getElementById('editRenterRate').value)
      })
    });
    document.getElementById('editRenterModal').classList.add('hidden');
    toast('Stall assignment and daily rate updated.');
    await render();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

function downloadCsv() {
  const rows = [['Renter', 'Stall', 'Date', 'Method']];
  state.attendance.forEach(item => rows.push([item.name, item.stall || '', item.business_date, item.method]));
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'stallcheck-transparency-report.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

renderNav();
