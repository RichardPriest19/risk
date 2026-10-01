// Core: API, helpers, auth, routing, dashboard, admin and data pages.
'use strict';

const T = window.TR;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const nl2br = (v) => esc(v).replace(/\n/g, '<br>');
const state = { user: null, iv: null, dirty: false, minPassword: 12 };

// ---------- API ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'X-TR-Request': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !url.endsWith('/login') && !url.endsWith('/change-password')) {
    state.user = null; state.dirty = false;
    renderLogin('Your session has ended. Please sign in again.');
    throw new Error('Not signed in');
  }
  const ct = res.headers.get('Content-Type') || '';
  const data = ct.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
async function download(url, fallbackName) {
  const res = await fetch(url, { credentials: 'same-origin', headers: { 'X-TR-Request': '1' } });
  if (!res.ok) { let m = 'Download failed'; try { m = (await res.json()).error; } catch {} throw new Error(m); }
  const cd = res.headers.get('Content-Disposition') || '';
  const utf8 = (cd.match(/filename\*=UTF-8''([^;]+)/) || [])[1];
  const name = (utf8 && decodeURIComponent(utf8)) || (cd.match(/filename="([^"]+)"/) || [])[1] || fallbackName;
  saveBlob(await res.blob(), name);
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const saveJson = (obj, name) => saveBlob(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), name);

// ---------- helpers ----------
function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`; t.setAttribute('role', 'status'); t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
}
const fail = (e) => { if (e.message !== 'Not signed in') toast(e.message, 'error'); };
const canEdit = () => state.user && (state.user.role === 'admin' || state.user.role === 'assessor');
const isAdmin = () => state.user && state.user.role === 'admin';
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtDateTime(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
const today = () => new Date().toISOString().slice(0, 10);
function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); }
function setPath(o, p, v) {
  const ks = p.split('.'); let cur = o;
  ks.slice(0, -1).forEach((k) => { if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; });
  cur[ks[ks.length - 1]] = v;
}
function options(list, value, placeholder) {
  return (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '') +
    list.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
}
function scoreRating(s) { return !s ? '' : s >= 20 ? 'Critical' : s >= 10 ? 'High' : s >= 5 ? 'Medium' : 'Low'; }
function ratingChip(r, score) {
  if (!r) return '<span class="chip chip-none">Not rated</span>';
  const icon = { Low: '●', Medium: '▲', High: '◆', Critical: '■' }[r];
  return `<span class="chip chip-${r.toLowerCase()}"><span aria-hidden="true">${icon}</span> ${esc(r)}${score ? ` (${score})` : ''}</span>`;
}
function findingScores(f) {
  const inh = (Number(f.likelihood) || 0) * (Number(f.impact) || 0);
  const res = (Number(f.residualLikelihood) || 0) * (Number(f.residualImpact) || 0);
  return { inh, inhR: scoreRating(inh), res, resR: scoreRating(res), eff: res || inh, effR: scoreRating(res || inh) };
}
const isOverdue = (f) => f.targetDate && f.targetDate < today() && !['Closed', 'Risk accepted'].includes(f.status);
function modalConfirm(message, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dialog';
    d.innerHTML = `<form method="dialog"><p>${esc(message)}</p><div class="row-end"><button value="cancel" class="btn">Cancel</button><button value="ok" class="btn btn-danger">${esc(okLabel)}</button></div></form>`;
    document.body.appendChild(d);
    onDialogChoice(d, (choice) => resolve(choice === 'ok'));
    d.showModal();
  });
}
// Calls done(value) once when a <form method="dialog"> button is pressed, or with 'cancel' on Esc, then removes the
// dialog. Uses the form's submit event rather than the dialog's close event, which browsers may delay for a page
// that is in the background.
function onDialogChoice(d, done) {
  let settled = false;
  const finish = (v) => { if (settled) return; settled = true; setTimeout(() => d.remove()); done(v); };
  $('form', d).addEventListener('submit', (e) => finish(e.submitter?.value || 'ok'));
  d.addEventListener('cancel', () => finish('cancel'));
  d.addEventListener('close', () => finish(d.returnValue || 'cancel'));
}
function pickFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files[0] || null);
    i.click();
  });
}

// ---------- chart tooltip ----------
(function tooltip() {
  const tip = document.createElement('div');
  tip.id = 'tip'; tip.setAttribute('role', 'tooltip');
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(tip));
  const show = (el, x, y) => {
    tip.replaceChildren();
    const [strong, ...rest] = el.dataset.tip.split('|');
    const b = document.createElement('strong'); b.textContent = strong; tip.appendChild(b);
    rest.forEach((r) => { const s = document.createElement('div'); s.textContent = r; tip.appendChild(s); });
    tip.style.display = 'block';
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, x + 12) + 'px';
    tip.style.top = Math.max(8, y - h - 10) + 'px';
  };
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else tip.style.display = 'none';
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); }
  });
  document.addEventListener('focusout', () => { tip.style.display = 'none'; });
})();

// ---------- layout ----------
function renderShell() {
  document.body.classList.remove('auth-mode');
  const u = state.user;
  $('#topbar').innerHTML = `
    <a class="brand" href="#/dashboard"><span class="brand-mark" aria-hidden="true">TR</span><span>Technology Risk<br><small>Interview Workbench</small></span></a>
    <nav class="mainnav" aria-label="Main">
      <a href="#/dashboard" data-nav="dashboard">Dashboard</a>
      <a href="#/interviews" data-nav="interviews interview">Interviews</a>
      <a href="#/services" data-nav="services">Services</a>
      <a href="#/evidence" data-nav="evidence">Evidence</a>
      <a href="#/compare" data-nav="compare">Compare</a>
      <a href="#/findings" data-nav="findings finding">Findings</a>
      <a href="#/reports" data-nav="reports">Reports</a>
      <a href="#/library" data-nav="library">Guide &amp; library</a>
      ${canEdit() ? '<a href="#/data" data-nav="data">Import / export</a>' : ''}
      ${isAdmin() ? '<a href="#/admin/users" data-nav="admin">Admin</a>' : ''}
    </nav>
    <div class="userbox">
      <details class="menu help-menu"><summary class="btn btn-small" aria-label="Help">? Help</summary><div class="menu-list">
        <button type="button" data-help-action="tour">Take the tour</button>
        <a href="#/library/guide">How to use this guide</a>
        <a href="#/library/templates">Finding templates</a>
        ${canEdit() ? '<button type="button" data-help-action="load-demo">Load demo data</button><button type="button" data-help-action="remove-demo">Remove demo data</button>' : ''}
      </div></details>
      <a href="#/account" title="Account">${esc(u.fullName)} <span class="role-tag">${esc(u.role)}</span></a>
      <button class="btn btn-small" id="logoutBtn">Sign out</button>
    </div>`;
  $('#logoutBtn').onclick = async () => { await flushSave(); await api('POST', '/api/logout').catch(() => {}); state.user = null; renderLogin('You have signed out.'); };
}
function setActiveNav(name) {
  $$('.mainnav a').forEach((a) => a.classList.toggle('active', a.dataset.nav.split(' ').includes(name)));
}
const view = () => $('#view');

// ---------- auth screens ----------
function authFrame(inner) {
  document.body.classList.add('auth-mode');
  $('#topbar').innerHTML = '';
  view().innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-brand"><span class="brand-mark" aria-hidden="true">TR</span><div><h1>Technology Risk</h1><p>Interview Workbench</p></div></div>
    ${inner}
    <p class="auth-notice">Authorised users only. Sign-ins, changes, exports and downloads are recorded in an audit log.</p>
  </div></div>`;
}
function renderLogin(message) {
  if (location.hash !== '#/login') history.replaceState(null, '', '#/login');
  authFrame(`
    <form id="loginForm" class="stack">
      ${message ? `<p class="notice">${esc(message)}</p>` : ''}
      <label>Username <input name="username" autocomplete="username" required autofocus></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
      <p class="form-error" id="loginErr" role="alert"></p>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>`);
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('POST', '/api/login', { username: f.get('username'), password: f.get('password') });
      await boot(true);
    } catch (err) { $('#loginErr').textContent = err.message; }
  };
}
function renderSetup() {
  authFrame(`
    <form id="setupForm" class="stack">
      <h2>First-time setup</h2>
      <p>Create the administrator account. The administrator can then add assessors and read-only viewers.</p>
      <label>Full name <input name="fullName" required></label>
      <label>Username <input name="username" autocomplete="username" required pattern="[A-Za-z0-9._\\-]{3,40}"></label>
      <label>Password <input name="password" type="password" autocomplete="new-password" required minlength="${state.minPassword}"></label>
      <label>Confirm password <input name="confirm" type="password" autocomplete="new-password" required></label>
      <p class="hint">At least ${state.minPassword} characters, including three of: lower case, upper case, number, symbol.</p>
      <p class="form-error" id="setupErr" role="alert"></p>
      <button class="btn btn-primary" type="submit">Create administrator</button>
    </form>`);
  $('#setupForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.password !== f.confirm) { $('#setupErr').textContent = 'Passwords do not match.'; return; }
    try { await api('POST', '/api/setup', f); renderLogin('Administrator created. Please sign in.'); }
    catch (err) { $('#setupErr').textContent = err.message; }
  };
}
function passwordForm(forced) {
  return `<form id="pwForm" class="stack narrow">
    ${forced ? '<p class="notice">You must set a new password before continuing.</p>' : ''}
    <label>Current password <input name="current" type="password" autocomplete="current-password" required></label>
    <label>New password <input name="password" type="password" autocomplete="new-password" required minlength="${state.minPassword}"></label>
    <label>Confirm new password <input name="confirm" type="password" autocomplete="new-password" required></label>
    <p class="hint">At least ${state.minPassword} characters, including three of: lower case, upper case, number, symbol.</p>
    <p class="form-error" id="pwErr" role="alert"></p>
    <button class="btn btn-primary" type="submit">Change password</button>
  </form>`;
}
function bindPasswordForm(after) {
  $('#pwForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.password !== f.confirm) { $('#pwErr').textContent = 'Passwords do not match.'; return; }
    try { await api('POST', '/api/change-password', f); toast('Password changed.'); after(); }
    catch (err) { $('#pwErr').textContent = err.message; }
  };
}
function renderForcedPassword() {
  authFrame(`<h2>Change your password</h2>${passwordForm(true)}`);
  bindPasswordForm(() => boot(true));
}
function viewAccount() {
  setActiveNav('');
  view().innerHTML = `<div class="page-head"><h1>My account</h1></div>
    <div class="card"><dl class="kv"><dt>Name</dt><dd>${esc(state.user.fullName)}</dd><dt>Username</dt><dd>${esc(state.user.username)}</dd><dt>Role</dt><dd>${esc(state.user.role)}</dd></dl></div>
    <div class="card"><h2>Change password</h2>${passwordForm(false)}</div>`;
  bindPasswordForm(() => viewAccount());
}

// ---------- router ----------
const routes = [
  [/^#\/dashboard$/, () => viewDashboard()],
  [/^#\/interviews$/, () => viewInterviews()],
  [/^#\/interview\/(\d+)(?:\/([\w-]+))?$/, (m) => viewInterview(Number(m[1]), m[2] || 'overview')],
  [/^#\/meet\/(\d+)$/, (m) => viewMeeting(Number(m[1]))],
  [/^#\/evidence$/, () => viewEvidence()],
  [/^#\/compare(?:\?(.*))?$/, (m) => viewCompare(new URLSearchParams(m[1] || ''))],
  [/^#\/print\/compare\?(.*)$/, (m) => viewPrintCompare(new URLSearchParams(m[1]))],
  [/^#\/findings$/, () => viewFindings()],
  [/^#\/finding\/(new|\d+)(?:\?interview=(\d+)(?:&section=((?:[a-z]{2,12}-)?s\d+)(?:&q=([\w-]+))?)?)?$/, (m) => viewFinding(m[1], m[2], m[3], m[4])],
  [/^#\/reports(?:\/(board|compliance|technology|briefing|stats|themes|trends))?(?:\?svc=(\d+))?$/, (m) => { if (m[2]) lastReportFilters = { ...lastReportFilters, svc: m[2] }; return viewReports(m[1] || 'board'); }],
  [/^#\/services$/, () => viewServices()],
  [/^#\/service\/(new|\d+)$/, (m) => viewService(m[1])],
  [/^#\/library(?:\/([\w-]+))?$/, (m) => viewLibrary(m[1] || 'guide')],
  [/^#\/data$/, () => viewData()],
  [/^#\/admin\/users$/, () => viewUsers()],
  [/^#\/admin\/audit$/, () => viewAudit()],
  [/^#\/admin\/backups$/, () => viewBackups()],
  [/^#\/account$/, () => viewAccount()],
  [/^#\/print\/([\w-]+)(?:\/(\d+))?(?:\?qn=([a-z]+))?$/, (m) => viewPrint(m[1], m[2] ? Number(m[2]) : null, m[3])],
];
async function route() {
  if (!state.user) return;
  const h = location.hash || '#/dashboard';
  const leavingInterview = state.iv && !h.startsWith(`#/interview/${state.iv.id}`) && h !== `#/meet/${state.iv.id}` && !h.startsWith('#/print/');
  if (leavingInterview) { await flushSave(); state.iv = null; }
  document.body.classList.toggle('print-mode', h.startsWith('#/print/'));
  if (!h.startsWith('#/meet/') && document.body.classList.contains('meeting-mode')) { document.body.classList.remove('meeting-mode'); await flushSave(); }
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) { try { await fn(m); } catch (e) { fail(e); } window.scrollTo(0, 0); return; }
  }
  location.hash = '#/dashboard';
}
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

async function boot(fromLogin) {
  try {
    const s = await api('GET', '/api/status');
    state.minPassword = s.minPassword;
    if (s.setupRequired) return renderSetup();
    if (!s.user) return renderLogin();
    state.user = s.user;
    if (s.user.mustChange) return renderForcedPassword();
    renderShell();
    if (fromLogin || !location.hash || location.hash === '#/login') location.hash = '#/dashboard';
    route();
  } catch (e) {
    view().innerHTML = `<div class="card"><h2>Cannot reach the server</h2><p>${esc(e.message)}</p><p>Make sure the app window (start.bat) is still running, then refresh this page.</p></div>`;
  }
}
document.addEventListener('DOMContentLoaded', () => boot(false));

// ---------- dashboard ----------
async function viewDashboard() {
  setActiveNav('dashboard');
  const [ivs, fs] = await Promise.all([api('GET', '/api/interviews'), api('GET', '/api/findings')]);
  const open = fs.filter((f) => f.status !== 'Closed');
  const highOpen = open.filter((f) => ['High', 'Critical'].includes(findingScores(f).effR));
  const overdue = fs.filter(isOverdue);
  const bk = isAdmin() ? await api('GET', '/api/backup/status').catch(() => null) : null;
  const svcs = await loadServices().catch(() => []);
  const ibs = svcs.filter(isIbs);
  const ibsAttention = ibs.filter((s) => !s.scenarioResult || s.scenarioResult === 'Not tested' || s.scenarioResult === 'Breached tolerance' || monthsSince(s.scenarioTestDate) > 12).length;
  const tile = (label, value, sub, href) => `<a class="tile" href="${href}"><span class="tile-label">${esc(label)}</span><span class="tile-value">${value}</span><span class="tile-sub">${esc(sub)}</span></a>`;
  view().innerHTML = `
    <div class="page-head"><h1>Dashboard</h1>
      ${canEdit() ? '<button class="btn btn-primary" id="newIv">New interview</button>' : ''}</div>
    ${bk && bk.warning ? `<div class="notice notice-warn" role="alert"><p><strong>Backups need attention:</strong> ${esc(bk.warning)} <a href="#/admin/backups">Open backup settings</a></p></div>` : ''}
    <div class="tiles">
      ${tile('Interviews', ivs.length, `${ivs.filter((i) => i.status === 'Complete').length} complete`, '#/interviews')}
      ${tile('Open findings', open.length, `${fs.length} recorded in total`, '#/findings')}
      ${tile('High / critical open', highOpen.length, 'by residual rating (inherent if no residual)', '#/findings')}
      ${tile('Overdue actions', overdue.length, 'past target date, not closed', '#/findings')}
      ${tile('Important business services', ibs.length, ibs.length ? `${ibsAttention} untested, out of date or breached` : 'none in the register yet', '#/services')}
      ${tile('Evidence outstanding', ivs.reduce((a, i) => a + (i.evidence?.outstanding || 0), 0), `${ivs.reduce((a, i) => a + (i.evidence?.overdue || 0), 0)} overdue`, '#/evidence')}
    </div>
    ${welcomeHtml(ivs)}
    <div id="worklist"></div>
    <section class="card"><h2>Recent interviews</h2>
      ${ivs.length ? `<table class="table"><thead><tr><th>Ref</th><th>Interviewee</th><th>Team</th><th>Date</th><th>Status</th></tr></thead><tbody>
      ${ivs.slice(0, 8).map((i) => `<tr><td><a href="#/interview/${i.id}">${esc(i.ref)}</a>${i.demo ? ' <span class="demo-tag">DEMO</span>' : ''}</td><td>${esc(i.header.developerName || '(unnamed)')}</td><td>${esc(i.header.team)}</td><td>${fmtDate(i.header.date)}</td><td><span class="status status-${esc(i.status.replace(/\s/g, '-').toLowerCase())}">${esc(i.status)}</span></td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">No interviews yet.</p>'}
    </section>
    <section class="card golden"><h2>The Technology Risk Specialist's Golden Rule</h2><blockquote>“${esc(T.goldenRule.quote)}”</blockquote></section>`;
  const b = $('#newIv'); if (b) b.onclick = newInterview;
  bindWelcome();
  renderWorklist(ivs, fs);
  maybeStartTour();
}

// ---------- personal worklist ----------
function getPref(k, d) { try { return localStorage.getItem(`tr-${state.user.username}-${k}`) ?? d; } catch { return d; } }
function setPref(k, v) { try { localStorage.setItem(`tr-${state.user.username}-${k}`, v); } catch { /* storage unavailable - preference not remembered */ } }
function renderWorklist(ivs, fs) {
  const u = state.user, scope = getPref('worklist', 'mine');
  const myIv = (i) => i.createdBy === u.username || (i.header.interviewer || '').trim().toLowerCase() === u.fullName.trim().toLowerCase();
  const myIvIds = new Set(ivs.filter(myIv).map((i) => i.id));
  const mine = scope === 'mine';
  const ivScope = mine ? ivs.filter(myIv) : ivs;
  const fScope = mine ? fs.filter((f) => f.createdBy === u.username || myIvIds.has(f.interviewId) || (f.controlOwner || '').trim().toLowerCase() === u.fullName.trim().toLowerCase()) : fs;
  const ivRef = Object.fromEntries(ivs.map((i) => [i.id, i]));
  const t = today(), monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const drafts = ivScope.filter((i) => ['Draft', 'In progress'].includes(i.status));
  const evOver = ivScope.filter((i) => i.evidence?.overdue > 0);
  const due = fScope.filter((f) => f.targetDate && f.targetDate <= monthEnd && !['Closed', 'Risk accepted'].includes(f.status)).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  // Risk acceptances expiring are shown to everyone regardless of scope: they need a decision.
  const expiring = fs.filter((f) => f.status === 'Risk accepted' && f.riskAcceptanceExpiry && f.riskAcceptanceExpiry <= in30).sort((a, b) => a.riskAcceptanceExpiry.localeCompare(b.riskAcceptanceExpiry));
  const expired = expiring.filter((f) => f.riskAcceptanceExpiry < t);
  const panel = (title, count, body, help) => `<section class="card work-card"><h2>${esc(title)} <span class="count${count ? '' : ' zero'}">${count}</span></h2>${help ? `<p class="hint">${esc(help)}</p>` : ''}${body}</section>`;
  const empty = (s) => `<p class="empty">${esc(s)}</p>`;
  $('#worklist').innerHTML = `
    ${expiring.length ? `<div class="notice ${expired.length ? 'notice-bad' : 'notice-warn'}" role="alert"><p><strong>${(() => {
      const nx = expired.length, ns = expiring.length - expired.length, ra = (n) => `${n} risk acceptance${n === 1 ? '' : 's'}`;
      return [nx && `${ra(nx)} ${nx === 1 ? 'has' : 'have'} expired`, ns && `${nx ? ns : ra(ns)} ${ns === 1 ? 'expires' : 'expire'} within 30 days`].filter(Boolean).join(' and ');
    })()}.</strong>
      Each needs re-approval or remediation: ${expiring.slice(0, 4).map((f) => `<a href="#/finding/${f.id}">${esc(f.ref)}</a> (${f.riskAcceptanceExpiry < t ? 'expired' : 'expires'} ${fmtDate(f.riskAcceptanceExpiry)})`).join(', ')}${expiring.length > 4 ? '…' : ''}</p></div>` : ''}
    <div class="work-head"><h2>${mine ? 'My work' : 'Everyone\'s work'}</h2>
      <div class="seg" role="group" aria-label="Show"><button type="button" class="${mine ? 'on' : ''}" data-scope="mine" aria-pressed="${mine}">Mine</button><button type="button" class="${mine ? '' : 'on'}" data-scope="all" aria-pressed="${!mine}">Everyone</button></div></div>
    <div class="grid-2 work-grid">
      ${panel(mine ? 'My interviews to finish' : 'Interviews to finish', drafts.length, drafts.length ? `<ul class="work-list">${drafts.slice(0, 8).map((i) => `<li><a href="#/interview/${i.id}">${esc(i.ref)} · ${esc(i.header.developerName || 'unnamed')}</a>${i.demo ? ' <span class="demo-tag">DEMO</span>' : ''}
          <span class="hint">${esc(i.status)} · ${i.progress?.rated || 0} section(s) rated${i.progress?.later ? ` · <strong>${i.progress.later} marked to come back to</strong>` : ''}${i.header.date ? ` · ${fmtDate(i.header.date)}` : ''}</span></li>`).join('')}</ul>` : empty(mine ? 'Nothing in draft. Start one with “New interview”.' : 'No interviews in draft.'), mine ? 'Interviews you created or are named as interviewer on.' : '')}
      ${panel('Evidence overdue', evOver.reduce((a, i) => a + i.evidence.overdue, 0), evOver.length ? `<ul class="work-list">${evOver.slice(0, 8).map((i) => `<li><a href="#/evidence" data-evfilter="${i.id}">${esc(i.ref)} · ${esc(i.header.developerName || 'unnamed')}</a>
          <span class="hint"><strong class="bad-tag">${i.evidence.overdue} overdue</strong> of ${i.evidence.outstanding} outstanding</span></li>`).join('')}</ul>` : empty('No overdue evidence.'))}
      ${panel('Findings due this month', due.length, due.length ? `<ul class="work-list">${due.slice(0, 8).map((f) => `<li><a href="#/finding/${f.id}">${esc(f.ref)} · ${esc(f.title || '')}</a>
          <span class="hint">${isOverdue(f) ? `<strong class="bad-tag">overdue since ${fmtDate(f.targetDate)}</strong>` : `due ${fmtDate(f.targetDate)}`}${f.controlOwner ? ` · ${esc(f.controlOwner)}` : ''} · ${esc(f.status)}${f.interviewId && ivRef[f.interviewId] ? ` · ${esc(ivRef[f.interviewId].ref)}` : ''}</span></li>`).join('')}</ul>` : empty('Nothing due this month.'), 'Target date this month or earlier, not closed or risk-accepted.')}
      ${panel('Risk acceptances expiring', expiring.length, expiring.length ? `<ul class="work-list">${expiring.map((f) => `<li><a href="#/finding/${f.id}">${esc(f.ref)} · ${esc(f.title || '')}</a>
          <span class="hint">${f.riskAcceptanceExpiry < t ? `<strong class="bad-tag">expired ${fmtDate(f.riskAcceptanceExpiry)}</strong>` : `expires ${fmtDate(f.riskAcceptanceExpiry)}`} · approved: ${esc(f.riskAcceptanceRef || '-')}</span></li>`).join('')}</ul>` : empty('None in the next 30 days.'), 'Across all findings - these need a decision whoever raised them.')}
    </div>`;
  $$('#worklist [data-scope]').forEach((b) => { b.onclick = () => { setPref('worklist', b.dataset.scope); renderWorklist(ivs, fs); }; });
  $$('#worklist [data-evfilter]').forEach((a) => { a.onclick = () => { evFilter.iv = a.dataset.evfilter; evFilter.overdue = true; evFilter.status = 'Requested'; }; });
}
function dueTable(fs) {
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const due = fs.filter((f) => f.targetDate && f.targetDate <= soon && !['Closed', 'Risk accepted'].includes(f.status)).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  if (!due.length) return '<p class="empty">Nothing overdue or due in the next 30 days.</p>';
  return `<table class="table"><thead><tr><th>Finding</th><th>Owner</th><th>Target</th><th>Rating</th></tr></thead><tbody>
    ${due.slice(0, 12).map((f) => { const s = findingScores(f); return `<tr><td><a href="#/finding/${f.id}">${esc(f.ref)}</a> ${esc(f.title)}</td><td>${esc(f.controlOwner)}</td><td class="${isOverdue(f) ? 'overdue' : ''}">${fmtDate(f.targetDate)}${isOverdue(f) ? ' <strong>(overdue)</strong>' : ''}</td><td>${ratingChip(s.effR)}</td></tr>`; }).join('')}
  </tbody></table>`;
}
async function newInterview() {
  try {
    const qn = MULTI_QN ? await chooseQuestionnaire() : T.qnById(T.DEFAULT_QN);
    if (!qn) return;
    const iv = await api('POST', '/api/interviews', { data: { questionnaireId: qn.id, questionnaireVersion: T.QUESTIONNAIRE_VERSION, header: { interviewer: state.user.fullName, date: today(), depth: 'standard' } } });
    location.hash = `#/interview/${iv.id}/overview`;
  } catch (e) { fail(e); }
}

// Which questionnaire a new interview uses. It cannot be changed afterwards.
function chooseQuestionnaire() {
  return new Promise((resolve) => {
    const d = document.createElement('dialog'); d.className = 'dialog';
    d.innerHTML = `<form method="dialog"><h2>New interview</h2><p>Choose the questionnaire. It cannot be changed once the interview has started, because answers are stored against its questions.</p>
      <div class="qn-choices">${T.questionnaires.map((q, i) => `<label class="qn-choice"><input type="radio" name="qn" value="${q.id}"${i ? '' : ' checked'}> <span><strong>${esc(q.title)}</strong><br><small>${esc(q.desc || '')}</small></span></label>`).join('')}</div>
      <div class="row-end"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">Create interview</button></div></form>`;
    document.body.appendChild(d);
    onDialogChoice(d, (v) => { const id = d.querySelector('input[name="qn"]:checked')?.value; resolve(v === 'ok' ? T.qnById(id) : null); });
    d.showModal();
  });
}

// ---------- interviews list ----------
async function viewInterviews() {
  setActiveNav('interviews');
  const [ivs, fs] = await Promise.all([api('GET', '/api/interviews'), api('GET', '/api/findings')]);
  const counts = {}; fs.forEach((f) => { if (f.interviewId) counts[f.interviewId] = (counts[f.interviewId] || 0) + 1; });
  view().innerHTML = `
    <div class="page-head"><h1>Interviews</h1>
      <div class="row">${canEdit() ? '<button class="btn btn-primary" id="newIv">New interview</button>' : ''}
      ${blankGuideMenu('Print blank guide or checklist')}</div></div>
    <div class="filters card">
      <label>Search <input id="q" placeholder="Interviewee, team, application, ref"></label>
      <label>Status <select id="st">${options(['Draft', 'In progress', 'Complete', 'Archived'], '', 'All')}</select></label>
      ${MULTI_QN ? `<label>Questionnaire <select id="qnf">${options(T.questionnaires.map((q) => [q.id, q.title]), '', 'All')}</select></label>` : ''}
    </div>
    <div class="card"><table class="table" id="ivTable"><thead><tr><th>Ref</th><th>Interviewee</th><th>Role</th><th>Team</th><th>Applications</th><th>Date</th><th>Findings</th><th>Status</th><th>Updated</th></tr></thead><tbody></tbody></table></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), st = $('#st').value, qf = $('#qnf')?.value;
    const rows = ivs.filter((i) => (!st || i.status === st) && (!qf || qnIdOf(i) === qf) && (!q || [i.ref, i.header.developerName, i.header.team, i.header.applications, i.header.developerRole].join(' ').toLowerCase().includes(q)));
    $('#ivTable tbody').innerHTML = rows.length ? rows.map((i) => `<tr>
      <td><a href="#/interview/${i.id}">${esc(i.ref)}</a>${i.demo ? ' <span class="demo-tag">DEMO</span>' : ''} ${qnBadge(i)}</td><td>${esc(i.header.developerName || '(unnamed)')}</td><td>${esc(i.header.developerRole)}</td>
      <td>${esc(i.header.team)}</td><td>${esc(i.header.applications)}</td><td>${fmtDate(i.header.date)}</td><td class="num">${counts[i.id] || 0}</td>
      <td><span class="status status-${esc(i.status.replace(/\s/g, '-').toLowerCase())}">${esc(i.status)}</span></td><td>${fmtDateTime(i.updatedAt)} <small>${esc(i.updatedBy)}</small></td></tr>`).join('')
      : '<tr><td colspan="9" class="empty">No interviews match.</td></tr>';
  };
  $('#q').oninput = draw; $('#st').onchange = draw; if ($('#qnf')) $('#qnf').onchange = draw; draw();
  const b = $('#newIv'); if (b) b.onclick = newInterview;
}

// ---------- questionnaires ----------
// qnOf accepts an interview (full or list summary) or an interview's data object.
const MULTI_QN = T.questionnaires.length > 1;
const qnOf = (x) => T.qnById(x && (x.questionnaireId || x.data?.questionnaireId)) || T.qnById(T.DEFAULT_QN);
const qnIdOf = (x) => qnOf(x).id;
// Questionnaires used by a set of interviews (registry order); the default one when there are none.
const qnsIn = (ivs) => { const used = new Set(ivs.map(qnIdOf)); const l = T.questionnaires.filter((q) => used.has(q.id)); return l.length ? l : [T.qnById(T.DEFAULT_QN)]; };
// Section label for views that mix interviews. Sections outside the original software development questionnaire
// carry their questionnaire's title, so "3. ..." is never ambiguous; development labels are unchanged.
const secLabel = (s) => `${s.qn && s.qn !== T.DEFAULT_QN ? T.qnById(s.qn).title + ' - ' : ''}${s.no}. ${s.title}`;
// Filters shown on printed reports.
const filterLabel = (flt) => [flt.svc && svcName(flt.svc) && 'service ' + svcName(flt.svc).ref + ' ' + svcName(flt.svc).name, flt.qn && T.qnById(flt.qn) && 'questionnaire ' + T.qnById(flt.qn).title, flt.from && 'from ' + flt.from, flt.to && 'to ' + flt.to, flt.team && 'team ' + flt.team, flt.app && 'application contains "' + flt.app + '"'].filter(Boolean).join(', ');
// "developers" when every interview uses one questionnaire, "interviewees" otherwise.
const subjectsFor = (ivs) => { const l = qnsIn(ivs); return l.length === 1 ? l[0].subjects : 'interviewees'; };
const qnBadge = (x) => (MULTI_QN ? `<span class="tag qn-tag">${esc(qnOf(x).title)}</span>` : '');

// ---------- data: import / export ----------
const FINDING_CSV = [
  ['Finding ID', 'ref'], ['Interview', 'interviewRef'], ['Application/system', 'application'], ['Interviewee/team', 'developerTeam', '', 'Developer/team'],
  ['Risk category', 'category'], ['Title', 'title'], ['Description', 'description'], ['Evidence', 'evidence'],
  ['Existing control', 'existingControl'], ['Control effectiveness', 'controlEffectiveness'],
  ['Likelihood', 'likelihood', 'n'], ['Impact', 'impact', 'n'], ['Residual likelihood', 'residualLikelihood', 'n'], ['Residual impact', 'residualImpact', 'n'],
  ['Classification', 'classification'], ['Regulatory areas', 'ukAreas', 'list'], ['Regulatory relevance', 'regulatoryRelevance'],
  ['UK regulatory relevance', 'ukRelevance'], ['Security relevance', 'securityRelevance'], ['Operational resilience relevance', 'opresRelevance'],
  ['Recommended remediation', 'remediation'], ['Control owner', 'controlOwner'], ['Target date', 'targetDate'],
  ['Risk acceptance required', 'riskAcceptance'], ['Risk acceptance reference', 'riskAcceptanceRef'], ['Risk acceptance expiry', 'riskAcceptanceExpiry'],
  ['Escalation required', 'escalation'], ['Escalated to', 'escalatedTo'], ['Status', 'status'],
  ['Closure evidence', 'closureEvidence'], ['Closure verified by', 'closureVerifiedBy'],
];
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
function csvCell(v) {
  let s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

function viewData() {
  setActiveNav('data');
  if (!canEdit()) { view().innerHTML = '<div class="card"><p>You do not have permission to import or export data.</p></div>'; return; }
  view().innerHTML = `
    <div class="page-head"><h1>Import / export</h1></div>
    <div class="grid-2">
      <section class="card"><h2>Export</h2>
        <p>Exports are recorded in the audit log. Exported files may contain personal and confidential information - store them in line with the bank's data handling policy.</p>
        <div class="stack-btns">
          <button class="btn" data-dl="/api/export/backup" data-name="tech-risk-backup.json">Full backup - all interviews and findings (JSON)</button>
          <button class="btn" data-dl="/api/export/interviews.csv" data-name="interviews.csv">Interviews summary (CSV, opens in Excel)</button>
          <button class="btn" data-dl="/api/export/findings.csv" data-name="findings.csv">Findings register (CSV, opens in Excel)</button>
          ${isAdmin() ? '<button class="btn" data-dl="/api/export/database" data-name="tech-risk.db">Database snapshot (.db - includes users and audit log)</button>' : ''}
        </div>
      </section>
      <section class="card"><h2>Import</h2>
        <p>Imports are <strong>added</strong> to existing data; nothing is overwritten. Records whose reference already exists are given a new reference.</p>
        <div class="stack-btns">
          <button class="btn" id="impJson">Import backup or interview file (JSON)</button>
          <button class="btn" id="impCsv">Import findings (CSV in the export format)</button>
          <button class="btn btn-ghost" id="tplCsv">Download blank findings CSV template</button>
        </div>
        <div id="impResult"></div>
      </section>
    </div>`;
  $$('[data-dl]').forEach((b) => { b.onclick = () => download(b.dataset.dl, b.dataset.name).then(() => toast('Download started.')).catch(fail); });
  $('#tplCsv').onclick = () => saveBlob(new Blob([toCsv([FINDING_CSV.map((c) => c[0])])], { type: 'text/csv' }), 'findings-template.csv');
  $('#impJson').onclick = async () => {
    const file = await pickFile('.json,application/json'); if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (obj.format !== 'tech-risk-interview-app') throw new Error('This file was not exported from this app.');
      const ok = await modalConfirm(`Import ${obj.interviews?.length || 0} interview(s) and ${obj.findings?.length || 0} finding(s) from ${file.name}?`, 'Import');
      if (!ok) return;
      const r = await api('POST', '/api/import', { services: obj.services || [], interviews: obj.interviews || [], findings: obj.findings || [], source: file.name });
      showImportResult(r);
    } catch (e) { fail(e); }
  };
  $('#impCsv').onclick = async () => {
    const file = await pickFile('.csv,text/csv'); if (!file) return;
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error('The CSV has no data rows.');
      const head = rows[0].map((h) => h.trim());
      const ivs = await api('GET', '/api/interviews');
      const refToId = Object.fromEntries(ivs.map((i) => [i.ref, i.id]));
      const findings = rows.slice(1).map((r) => {
        const f = {};
        FINDING_CSV.forEach(([label, key, type, alias]) => {
          let idx = head.indexOf(label); if (idx < 0 && alias) idx = head.indexOf(alias); if (idx < 0) return; // alias: older column name
          let v = (r[idx] || '').trim().replace(/^'(?=[=+\-@])/, '');
          if (type === 'n') v = v ? Number(v) || '' : '';
          if (type === 'list') v = v ? v.split(/;\s*/) : [];
          if (v !== '') f[key] = v;
        });
        if (f.interviewRef) { f.interviewId = refToId[f.interviewRef] || null; delete f.interviewRef; }
        return f;
      }).filter((f) => f.title || f.description);
      if (!findings.length) throw new Error('No rows with a Title or Description were found. Check the header row matches the template.');
      const ok = await modalConfirm(`Import ${findings.length} finding(s) from ${file.name}?`, 'Import');
      if (!ok) return;
      showImportResult(await api('POST', '/api/import', { findings, linkExisting: true, source: file.name }));
    } catch (e) { fail(e); }
  };
}
function showImportResult(r) {
  toast(`Imported ${r.services ? r.services + ' service(s), ' : ''}${r.interviews} interview(s) and ${r.findings} finding(s).`);
  $('#impResult').innerHTML = `<div class="notice"><p>Imported ${r.services ? r.services + ' service(s), ' : ''}${r.interviews} interview(s) and ${r.findings} finding(s).</p>
    ${r.renumbered.length ? `<p>Renumbered to avoid clashes:</p><ul>${r.renumbered.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;
}

// ---------- admin ----------
function adminTabs(active) {
  return `<div class="tabs"><a href="#/admin/users" class="${active === 'users' ? 'active' : ''}">Users</a><a href="#/admin/audit" class="${active === 'audit' ? 'active' : ''}">Audit log</a><a href="#/admin/backups" class="${active === 'backups' ? 'active' : ''}">Backups</a></div>`;
}
async function viewUsers() {
  setActiveNav('admin');
  const users = await api('GET', '/api/users');
  const roleHelp = 'Admin: everything including users, deletion and audit log. Assessor: create and edit interviews and findings, import/export. Viewer: read-only, reports and printing.';
  view().innerHTML = `<div class="page-head"><h1>Administration</h1></div>${adminTabs('users')}
    <section class="card"><h2>Users</h2><p class="hint">${esc(roleHelp)}</p>
      <table class="table"><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Actions</th></tr></thead><tbody>
      ${users.map((u) => `<tr data-id="${u.id}">
        <td>${esc(u.username)}</td><td>${esc(u.fullName)}</td>
        <td><select data-act="role" ${u.id === state.user.id ? 'disabled' : ''}>${options(['admin', 'assessor', 'viewer'], u.role)}</select></td>
        <td>${u.active ? 'Active' : '<strong>Disabled</strong>'}${u.lockedUntil && u.lockedUntil > Date.now() ? ' · <strong>Locked</strong>' : ''}${u.mustChange ? ' · must change password' : ''}</td>
        <td>${fmtDateTime(u.lastLogin) || 'Never'}</td>
        <td class="row">${u.id !== state.user.id ? `<button class="btn btn-small" data-act="toggle">${u.active ? 'Disable' : 'Enable'}</button>` : ''}
          ${u.lockedUntil && u.lockedUntil > Date.now() ? '<button class="btn btn-small" data-act="unlock">Unlock</button>' : ''}
          <button class="btn btn-small" data-act="reset">Reset password</button></td></tr>`).join('')}
      </tbody></table></section>
    <section class="card"><h2>Add user</h2>
      <form id="addUser" class="form-grid">
        <label>Username <input name="username" required pattern="[A-Za-z0-9._\\-]{3,40}"></label>
        <label>Full name <input name="fullName" required></label>
        <label>Role <select name="role">${options([['assessor', 'Assessor'], ['viewer', 'Viewer'], ['admin', 'Admin']], 'assessor')}</select></label>
        <label>Temporary password <input name="password" type="password" autocomplete="new-password" required minlength="${state.minPassword}"></label>
        <div class="full"><p class="hint">The user will be required to change the temporary password at first sign-in. Give it to them through a separate channel.</p>
        <button class="btn btn-primary">Add user</button></div>
      </form></section>`;
  $('#addUser').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/users', Object.fromEntries(new FormData(e.target))); toast('User added.'); viewUsers(); } catch (err) { fail(err); }
  };
  $$('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id; const u = users.find((x) => String(x.id) === id);
    const put = (body, msg) => api('PUT', `/api/users/${id}`, body).then(() => { toast(msg); viewUsers(); }).catch(fail);
    const sel = $('[data-act=role]', tr); if (sel) sel.onchange = () => put({ role: sel.value }, 'Role updated.');
    const tg = $('[data-act=toggle]', tr); if (tg) tg.onclick = () => put({ active: !u.active }, u.active ? 'User disabled.' : 'User enabled.');
    const ul = $('[data-act=unlock]', tr); if (ul) ul.onclick = () => put({ unlock: true }, 'Account unlocked.');
    $('[data-act=reset]', tr).onclick = () => {
      const d = document.createElement('dialog'); d.className = 'dialog';
      d.innerHTML = `<form method="dialog" class="stack"><h3>Reset password for ${esc(u.username)}</h3>
        <label>Temporary password <input type="password" name="pw" required minlength="${state.minPassword}" autocomplete="new-password"></label>
        <p class="hint">The user must change it at next sign-in. Their current sessions are ended.</p>
        <div class="row-end"><button value="cancel" formnovalidate class="btn">Cancel</button><button value="ok" class="btn btn-primary">Reset</button></div></form>`;
      document.body.appendChild(d);
      onDialogChoice(d, (choice) => { if (choice === 'ok') put({ password: $('input', d).value }, 'Password reset.'); });
      d.showModal();
    };
  });
}
async function viewAudit() {
  setActiveNav('admin');
  const rows = await api('GET', '/api/audit?limit=5000');
  view().innerHTML = `<div class="page-head"><h1>Administration</h1></div>${adminTabs('audit')}
    <div class="filters card"><label>Filter <input id="aq" placeholder="User, action, reference, detail"></label>
      <button class="btn" id="aCsv">Export audit log (CSV)</button></div>
    <div class="card"><table class="table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Item</th><th>Detail</th><th>Address</th></tr></thead><tbody id="aBody"></tbody></table></div>`;
  const draw = () => {
    const q = $('#aq').value.toLowerCase();
    const list = rows.filter((r) => !q || [r.username, r.action, r.entity, r.entity_id, r.detail].join(' ').toLowerCase().includes(q));
    $('#aBody').innerHTML = list.slice(0, 1000).map((r) => `<tr><td>${fmtDateTime(r.ts)}</td><td>${esc(r.username)}</td><td><code>${esc(r.action)}</code></td><td>${esc(r.entity)} ${esc(r.entity_id)}</td><td>${esc(r.detail)}</td><td>${esc(r.ip)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No entries.</td></tr>';
  };
  $('#aq').oninput = draw; draw();
  $('#aCsv').onclick = () => saveBlob(new Blob([toCsv([['Time', 'User', 'Action', 'Entity', 'Entity ID', 'Detail', 'Address'], ...rows.map((r) => [r.ts, r.username, r.action, r.entity, r.entity_id, r.detail, r.ip])])], { type: 'text/csv' }), 'audit-log.csv');
}
