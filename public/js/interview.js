// Interview workspace: capture answers, four-way comparison, evidence, red flags, checklist and report.
'use strict';

const SECTION_CATEGORY = T.sectionCategory; // finding category suggested per section (all questionnaires)
const IQ = () => qnOf(state.iv); // the open interview's questionnaire
const qNo = (k) => (IQ()[k] ? IQ()[k] + '. ' : ''); // e.g. "30. " - the questionnaire guide's own numbering, if any
const sectionById = (id) => T.sections.find((s) => s.id === id); // any questionnaire (section IDs are unique)
// Regulatory areas for a section. The shared ukAreas list refers to software development section numbers; sections of
// other questionnaires list their areas themselves (s.ukAreas).
const ukAreasForSection = (s) => (s.qn && s.qn !== T.DEFAULT_QN ? s.ukAreas || [] : T.ukAreas.filter((a) => a.sections.includes(s.no)).map((a) => a.area));

// ---------- saving ----------
let saveTimer = null, saving = null, saveAgain = false;
function setSaveStatus(msg, bad) {
  const el = $('#saveStatus'); if (!el) return;
  el.textContent = msg; el.classList.toggle('bad', !!bad);
}
function scheduleSave() {
  if (!canEdit()) return;
  state.dirty = true; setSaveStatus('Unsaved changes…');
  clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 1200);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!state.dirty || !state.iv) return;
  if (saving) { saveAgain = true; return saving; }
  const iv = state.iv;
  state.dirty = false; setSaveStatus('Saving…');
  saving = api('PUT', `/api/interviews/${iv.id}`, { version: iv.version, status: iv.status, data: iv.data })
    .then((r) => { iv.version = r.version; iv.updatedAt = r.updatedAt; setSaveStatus('All changes saved at ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); })
    .catch((e) => { state.dirty = true; setSaveStatus('Not saved: ' + e.message, true); if (e.message !== 'Not signed in') toast(e.message, 'error'); })
    .finally(() => { saving = null; if (saveAgain) { saveAgain = false; saveNow(); } });
  return saving;
}
async function flushSave() { if (saving) await saving; if (state.dirty) await saveNow(); }

// ---------- field builders (bound to state.iv.data by data-path) ----------
const val = (p) => getPath(state.iv.data, p);
const ta = (p, rows = 3, ph = '') => `<textarea data-path="${p}" rows="${rows}" placeholder="${esc(ph)}">${esc(val(p))}</textarea>`;
const inp = (p, type = 'text', ph = '') => `<input type="${type}" data-path="${p}" value="${esc(val(p))}" placeholder="${esc(ph)}">`;
const sel = (p, list, ph) => `<select data-path="${p}">${options(list, val(p), ph)}</select>`;
const chk = (p, label, cls = '') => `<label class="check ${cls}"><input type="checkbox" data-path="${p}"${val(p) ? ' checked' : ''}> ${label}</label>`;

function bindFields(root) {
  const readOnly = !canEdit();
  $$('[data-path]', root).forEach((el) => {
    if (readOnly) { el.disabled = true; return; }
    const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      setPath(state.iv.data, el.dataset.path, el.type === 'checkbox' ? el.checked : el.value);
      scheduleSave();
      if (el.dataset.path.startsWith('header.') || el.dataset.refresh) refreshNav();
    });
  });
}

// ---------- permanent IDs: which items to show for an interview ----------
// Current items always; retired items only where this interview recorded something against them.
// Answers whose ID is no longer in content.js at all are "orphans" - kept and shown read-only, never discarded.
const hasAnswer = (a) => !!a && !!((a.r || '').trim() || a.qa || a.flag || a.later || (a.ev && a.ev !== 'Not requested'));
const hasEvidence = (x) => !!x && !!((x.status && x.status !== 'Not requested') || (x.ref || '').trim());
// depth: 'core' | 'standard' | 'deep' | undefined (= no depth filter). Anything already answered is always shown.
const DEPTH_RANK = { core: 1, standard: 2, deep: 3 };
const inDepth = (q, depth) => !depth || DEPTH_RANK[q.level || 'standard'] <= DEPTH_RANK[depth];
const visibleQuestions = (s, sd, depth) => s.questions.filter((q) => hasAnswer(sd?.answers?.[q.id]) || (!q.retired && inDepth(q, depth)));
const depthOf = (d) => d?.header?.depth || 'deep'; // interviews created before depth existed show every question
// Section inclusion: explicit assessor choice wins; otherwise the automatic rule (e.g. no Cloud section for on-premises systems).
function sectionIncluded(s, d) {
  const o = d?.sectionInclude?.[s.id];
  if (o === true || o === false) return o;
  const r = qnOf(d).sectionRules[s.id];
  return !(r && r.test(d?.header || {}));
}
function exclusionReason(s, d) {
  if (d?.sectionInclude?.[s.id] === false) return 'left out by the assessor';
  const r = qnOf(d).sectionRules[s.id];
  return r && r.test(d?.header || {}) ? r.reason : '';
}
// Quick-answer buttons (shared by the section view and meeting mode). Clicking the selected answer again clears it.
function quickAnswerHtml(path, q, big) {
  const cur = getPath(state.iv.data, path + '.qa');
  return `<div class="qa-group${big ? ' qa-big' : ''}" role="group" aria-label="Quick answer">${T.quickAnswers[q.type].map((a, i) => {
    const on = cur === a;
    return `<button type="button" class="qa-btn qa-${T.answerSignal(q, a)}${on ? ' on' : ''}" aria-pressed="${on}" data-qa="${esc(path)}" data-value="${esc(a)}"${big ? ` title="Alt+${i + 1}"` : ''}${canEdit() ? '' : ' disabled'}>${big ? `<kbd>${i + 1}</kbd> ` : ''}${esc(a)}</button>`;
  }).join('')}</div>`;
}
function setQuickAnswer(path, value) {
  const cur = getPath(state.iv.data, path + '.qa');
  setPath(state.iv.data, path + '.qa', cur === value ? '' : value);
  $$(`.qa-btn[data-qa="${CSS.escape(path)}"]`).forEach((b) => { const on = b.dataset.value === getPath(state.iv.data, path + '.qa'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  scheduleSave(); refreshNav();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.qa-btn');
  if (b && canEdit() && state.iv) setQuickAnswer(b.dataset.qa, b.dataset.value);
});
const visibleEvidence = (s, sd) => s.evidence.filter((e) => !e.retired || hasEvidence(sd?.evidence?.[e.id]));
function orphanAnswers(s, sd) {
  const known = new Set(['opener', ...s.questions.map((q) => q.id)]);
  return Object.entries(sd?.answers || {}).filter(([k, a]) => !known.has(k) && hasAnswer(a));
}
function orphanEvidence(s, sd) {
  const known = new Set(['other', ...s.evidence.map((e) => e.id)]);
  return Object.entries(sd?.evidence || {}).filter(([k, x]) => !known.has(k) && hasEvidence(x));
}

// ---------- progress ----------
function sectionProgress(s) {
  const d = (state.iv.data.sections || {})[s.id] || {};
  const qs = visibleQuestions(s, d, depthOf(state.iv.data));
  const answered = qs.filter((q) => (d.answers?.[q.id]?.r || '').trim() || d.answers?.[q.id]?.qa).length;
  return { answered, total: qs.length, rating: d.rating || 'Not assessed', included: sectionIncluded(s, state.iv.data) };
}
function markedForLater(d = state.iv.data) {
  const out = [];
  qnOf(d).sections.forEach((s) => [s.opener, ...s.questions].forEach((q) => { if (d.sections?.[s.id]?.answers?.[q.id]?.later) out.push({ s, q }); }));
  return out;
}
const RATING_CLASS = { 'Effective': 'good', 'Partially effective': 'warn', 'Ineffective': 'bad', 'Not applicable': 'na', 'Not assessed': 'none' };

function refreshNav() {
  const nav = $('#ivNav'); if (!nav) return;
  const h = state.iv.data.header || {};
  $('#ivTitle').textContent = `${state.iv.ref} · ${h.developerName || 'Unnamed interviewee'}`;
  IQ().sections.forEach((s) => {
    const a = $(`[data-tab="${s.id}"]`, nav); if (!a) return;
    const p = sectionProgress(s);
    a.classList.toggle('excluded', !p.included);
    a.title = p.included ? '' : `Not included in this interview (${exclusionReason(s, state.iv.data)})`;
    $('.prog', a).textContent = p.included ? `${p.answered}/${p.total}` : 'n/a';
    const dot = $('.dot', a); dot.className = `dot dot-${RATING_CLASS[p.rating]}`; dot.title = p.rating;
  });
  const later = markedForLater().length;
  const lt = $('#laterCount'); if (lt) { lt.textContent = later ? `${later} marked to come back to` : ''; lt.hidden = !later; }
  const rf = Object.values(state.iv.data.redFlags || {}).filter((x) => x && x.on).length;
  $('[data-tab="redflags"] .prog', nav).textContent = rf ? String(rf) : '';
  const ck = Object.values(state.iv.data.checklist || {}).filter(Boolean).length;
  $('[data-tab="checklist"] .prog', nav).textContent = `${ck}/${IQ().checklist.length}`;
}

// ---------- workspace ----------
async function viewInterview(id, tab) {
  setActiveNav('interview');
  await loadInterview(id);
  if (!$('#ivNav') || $('#ivWork').dataset.id !== String(id)) renderWorkspaceFrame();
  $$('#ivNav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const panel = $('#ivPanel');
  const renderers = { overview: panelOverview, redflags: panelRedFlags, final: panelFinal, findings: panelFindings, checklist: panelChecklist, report: panelReport, later: panelLater };
  if (tab === 'overview') await loadServices().catch(() => { state.services = []; });
  if (renderers[tab]) await renderers[tab](panel);
  else if (sectionById(tab)) { state.ivFiles = await api('GET', `/api/attachments?interview=${id}`); panelSection(panel, sectionById(tab)); }
  else { location.hash = `#/interview/${id}/overview`; return; }
  bindFields(panel);
  refreshNav();
}
async function loadInterview(id) {
  if (state.iv && state.iv.id === id) return;
  await flushSave();
  state.iv = await api('GET', `/api/interviews/${id}`);
  state.iv.data = state.iv.data || {};
  ['header', 'sections', 'redFlags', 'checklist', 'final', 'report', 'sectionInclude', 'meeting'].forEach((k) => { state.iv.data[k] = state.iv.data[k] || {}; });
}
function renderWorkspaceFrame() {
  const iv = state.iv;
  const link = (tab, label, extra = '') => `<a href="#/interview/${iv.id}/${tab}" data-tab="${tab}">${extra}<span class="lbl">${label}</span><span class="prog"></span></a>`;
  view().innerHTML = `
    <div class="iv-head">
      <div><a href="#/interviews" class="back">← Interviews</a><h1 id="ivTitle"></h1>${MULTI_QN ? `<p class="qn-line">${esc(qnOf(iv).title)} questionnaire</p>` : ''}
        <a id="laterCount" class="later-link" href="#/interview/${iv.id}/later" hidden></a>
        <a class="later-link" href="#/compare?with=${iv.id}" title="Compare with other interviewees on the same team or application">⇄ Compare with colleagues</a></div>
      <div class="row">
        <a class="btn btn-primary" href="#/meet/${iv.id}" title="Full-screen, one question at a time">▶ Meeting mode</a>
        <label class="inline">Status <select id="ivStatus" ${canEdit() ? '' : 'disabled'}>${options(['Draft', 'In progress', 'Complete', 'Archived'], iv.status)}</select></label>
        <span id="saveStatus" class="save-status" aria-live="polite">${canEdit() ? 'All changes saved' : 'Read-only'}</span>
        <details class="menu"><summary class="btn">Print / export</summary><div class="menu-list">
          <a href="#/print/record/${iv.id}">Print full interview record</a>
          <a href="#/print/report/${iv.id}">Print interview report</a>
          <a href="#/print/checklist/${iv.id}">Print completed checklist</a>
          <a href="#/print/ivguide/${iv.id}">Print question sheet for this interview</a>
          <a href="#/print/evrequest/${iv.id}">Print evidence request letter</a>
          <a href="#/print/guide">Print blank interview guide (all questions)</a>
          ${canEdit() ? '<button id="ivExport">Export this interview (JSON)</button>' : ''}
          ${isAdmin() ? '<button id="ivDelete" class="danger">Delete interview…</button>' : ''}
        </div></details>
      </div>
    </div>
    ${iv.data.demo ? '<div class="notice demo-notice"><p><span class="demo-tag">DEMO</span> <strong>Demonstration interview</strong> - an example to explore, not a real record. Remove all demo data from the Help menu.</p></div>' : ''}
    <div class="iv-work" id="ivWork" data-id="${iv.id}">
      <nav class="iv-nav" id="ivNav" aria-label="Interview sections">
        ${link('overview', 'Overview & details')}
        <div class="nav-group">Questionnaire</div>
        ${IQ().sections.map((s) => link(s.id, `${s.no}. ${esc(s.title)}`, '<span class="dot"></span>')).join('')}
        <div class="nav-group">Close and record</div>
        ${link('redflags', qNo('redFlagsNo') + 'Red flags heard')}
        ${link('final', qNo('finalNo') + 'Final questions')}
        ${link('findings', qNo('findingsNo') + 'Findings')}
        ${link('checklist', 'Interview checklist')}
        ${link('report', qNo('reportNo') + 'Interview report')}
      </nav>
      <div class="iv-panel" id="ivPanel"></div>
    </div>`;
  $('#ivStatus').onchange = (e) => { iv.status = e.target.value; scheduleSave(); };
  const ex = $('#ivExport'); if (ex) ex.onclick = async () => { try { await flushSave(); saveJson(await api('GET', `/api/interviews/${iv.id}/export`), `${iv.ref}.json`); } catch (e) { fail(e); } };
  const del = $('#ivDelete'); if (del) del.onclick = async () => {
    if (!(await modalConfirm(`Permanently delete ${iv.ref}? Linked findings are kept but unlinked. This cannot be undone.`, 'Delete'))) return;
    try { state.dirty = false; await api('DELETE', `/api/interviews/${iv.id}`); state.iv = null; toast('Interview deleted.'); location.hash = '#/interviews'; } catch (e) { fail(e); }
  };
}

function panelOverview(panel) {
  const H = 'header.', Q = IQ();
  // A questionnaire can relabel or hide interview-detail fields (e.g. HR has no deployment model).
  const hf = (k, label, html) => (Q.hideHeader.includes(k) ? '' : html(Q.headerLabels[k]?.[0] || label, Q.headerLabels[k]?.[1]));
  panel.innerHTML = `
    <h2>Interview details</h2>
    <p class="hint">${esc(IQ().title)} questionnaire · version ${esc(state.iv.data.questionnaireVersion || 'not recorded')}${state.iv.data.questionnaireVersion && state.iv.data.questionnaireVersion !== T.QUESTIONNAIRE_VERSION ? ` · the current questionnaire is ${esc(T.QUESTIONNAIRE_VERSION)}; answers are matched by permanent question ID, so nothing is lost` : ''}</p>
    <div class="form-grid">
      <label>Interviewee name ${inp(H + 'developerName')}</label>
      <label>Interviewee role / job title ${inp(H + 'developerRole')}</label>
      <label>Team ${inp(H + 'team')}</label>
      <label>Line manager ${inp(H + 'lineManager')}</label>
      ${hf('applications', 'Applications / services covered', (l, ph) => `<label class="full">${esc(l)} ${inp(H + 'applications', 'text', ph || 'e.g. Payments Gateway, Customer Onboarding API')}</label>`)}
      ${hf('businessService', 'Business service(s) supported', (l, ph) => `<label class="full">${esc(l)} ${inp(H + 'businessService', 'text', ph || 'e.g. Retail payments (important business service)')}</label>`)}
      <div class="full svc-link"><span class="field-label">Linked to services in the register ${helpBtn('services')}</span>${serviceCheckboxes('data-svc', state.iv.data.header.serviceIds || [], !canEdit())}</div>
      ${hf('criticality', 'Application criticality', (l) => `<label>${esc(l)} ${sel(H + 'criticality', ['Tier 1 - critical / important business service', 'Tier 2 - high', 'Tier 3 - medium', 'Tier 4 - low', 'Unknown'], 'Select…')}</label>`)}
      <label>Highest data classification ${sel(H + 'dataClassification', ['Highly confidential / restricted', 'Confidential', 'Internal', 'Public', 'Unknown'], 'Select…')}</label>
      ${hf('deploymentModel', 'Deployment model', (l) => `<label>${esc(l)} ${sel(H + 'deploymentModel', ['On-premises', 'Public cloud', 'Hybrid', 'SaaS / third-party hosted', 'Unknown'], 'Select…')}</label>`)}
      <label>Interviewer ${inp(H + 'interviewer')}</label>
      <label>Date ${inp(H + 'date', 'date')}</label>
      <label>Location / format ${inp(H + 'location', 'text', 'e.g. Meeting room 3, Teams')}</label>
      <label>Others present ${inp(H + 'attendees')}</label>
      ${hf('containers', 'Containers / Kubernetes used?', (l) => `<label>${esc(l)} ${sel(H + 'containers', ['Yes', 'No', 'Unknown'], 'Select…')}</label>
      <span></span>`)}
      <label class="full">Preparation notes / scope ${ta(H + 'notes', 3, 'What you already know, documents reviewed beforehand, areas to focus on')}</label>
    </div>
    <h2 class="plan-head">Interview plan</h2>
    <div class="form-grid">
      <label>Depth ${helpBtn('depth')} <select id="depthSel" data-path="${H}depth">${options(T.depths.map((d) => [d.id, `${d.label} (about ${d.minutes} min)`]), depthOf(state.iv.data))}</select></label>
      <label>Planned duration (minutes) <input type="number" min="10" max="480" step="5" data-path="${H}plannedMinutes" id="minutesInp" value="${esc(val(H + 'plannedMinutes'))}" placeholder="${T.depths.find((d) => d.id === depthOf(state.iv.data)).minutes}"></label>
      <p class="hint full" id="depthHelp"></p>
    </div>
    <div id="planSummary" class="plan-summary"></div>
    <details class="guide-box"><summary>Sections included in this interview</summary>
      <p class="hint">Sections that do not apply are left out automatically (for example Cloud for on-premises systems). Tick or untick to override. Left-out sections stay available in the side menu.</p>
      <div class="section-picker">${IQ().sections.map((s) => `<label class="check"><input type="checkbox" data-include="${s.id}"${sectionIncluded(s, state.iv.data) ? ' checked' : ''}${canEdit() ? '' : ' disabled'}> ${s.no}. ${esc(s.title)} <span class="hint" data-reason="${s.id}"></span></label>`).join('')}</div>
      ${canEdit() ? '<button type="button" class="btn btn-small btn-ghost" id="resetInclude">Reset to automatic</button>' : ''}
    </details>
    <p><a class="btn btn-primary" href="#/meet/${state.iv.id}">▶ Start meeting mode</a> <span class="hint">Full screen, one question at a time, with timers and keyboard shortcuts.</span></p>
    <div class="guide-box">
      <h3>Before you start</h3>
      <p>This interview must help you answer five questions:</p>
      <ol><li>What does the ${IQ().subject} actually do?</li><li>What technology and security risks exist within their work?</li><li>What controls are supposed to prevent or detect those risks?</li><li>Are those controls actually operating in practice?</li><li>What evidence exists to demonstrate that the controls operate effectively?</li></ol>
      <p>For each section, compare what the ${IQ().subject} <strong>says</strong>, what the <strong>documented process</strong> says, what the <strong>technology enforces</strong>, and what <strong>evidence</strong> shows. Gaps between these four are where the risk lives.</p>
      <p><strong>Style:</strong> it is a conversation, not an interrogation. Open with the opener question, let the ${IQ().subject} talk, then drill down. When an answer is vague, follow up: <em>what exactly - automated or manual - who reviews - what happens if it fails - can you show me an example from a recent change?</em></p>
      <p class="hint">${esc(T.APPLIES)}</p>
    </div>`;
  const d = state.iv.data;
  const updatePlan = () => {
    const depth = depthOf(d), def = T.depths.find((x) => x.id === depth);
    const rec = T.depthForCriticality(d.header.criticality);
    $('#depthHelp').textContent = `${def.desc}${d.header.criticality ? ` Recommended for "${d.header.criticality}": ${T.depths.find((x) => x.id === rec).label}.` : ' Set the application criticality to get a recommendation.'}`;
    $('#minutesInp').placeholder = def.minutes;
    const inc = IQ().sections.filter((s) => sectionIncluded(s, d));
    const nq = inc.reduce((a, s) => a + 1 + visibleQuestions(s, d.sections[s.id], depth).length, 0);
    $('#planSummary').textContent = `${def.label} depth: ${nq} questions (including openers) across ${inc.length} of ${IQ().sections.length} sections, planned ${d.header.plannedMinutes || def.minutes} minutes - about ${Math.round(((d.header.plannedMinutes || def.minutes) * 60) / nq)} seconds per question.`;
    IQ().sections.forEach((s) => { const cb = $(`[data-include="${s.id}"]`); cb.checked = sectionIncluded(s, d); const why = exclusionReason(s, d); $(`[data-reason="${s.id}"]`).textContent = !cb.checked && why ? `(${why})` : ''; });
  };
  // Until the assessor picks a depth themselves, follow the recommendation for the chosen criticality.
  $(`[data-path="header.criticality"]`, panel).addEventListener('change', (e) => {
    if (!d.header.depthChosen) { d.header.depth = T.depthForCriticality(e.target.value); $('#depthSel').value = d.header.depth; }
    setTimeout(updatePlan);
  });
  $('#depthSel').addEventListener('change', () => { d.header.depthChosen = true; setTimeout(updatePlan); });
  ['deploymentModel', 'containers', 'plannedMinutes'].forEach((k) => $(`[data-path="header.${k}"]`, panel)?.addEventListener('input', () => setTimeout(updatePlan)));
  ['deploymentModel', 'containers'].forEach((k) => $(`[data-path="header.${k}"]`, panel)?.addEventListener('change', () => setTimeout(updatePlan)));
  $$('[data-include]', panel).forEach((cb) => cb.addEventListener('change', () => {
    const s = sectionById(cb.dataset.include);
    const auto = !(IQ().sectionRules[s.id] && IQ().sectionRules[s.id].test(d.header));
    if (cb.checked === auto) delete d.sectionInclude[s.id]; else d.sectionInclude[s.id] = cb.checked;
    scheduleSave(); refreshNav(); updatePlan();
  }));
  $$('[data-svc]', panel).forEach((cb) => cb.addEventListener('change', () => { state.iv.data.header.serviceIds = $$('[data-svc]:checked', panel).map((x) => Number(x.value)); scheduleSave(); }));
  const ri = $('#resetInclude'); if (ri) ri.onclick = () => { d.sectionInclude = {}; scheduleSave(); refreshNav(); updatePlan(); };
  updatePlan();
}

function panelLater(panel) {
  const list = markedForLater();
  panel.innerHTML = `<h2>Marked to come back to</h2>
    <p class="intro">Questions you marked during the interview to revisit - for example, waiting for the ${IQ().subject} to check something, or evidence to follow up.</p>
    ${list.length ? `<ul class="flag-list">${list.map(({ s, q }) => { const a = state.iv.data.sections[s.id].answers[q.id]; return `<li><a href="#/interview/${state.iv.id}/${s.id}">${s.no}. ${esc(s.title)}</a> - ${esc(q.q)}${a.r ? `<br><em>${esc(a.r)}</em>` : ''}</li>`; }).join('')}</ul>` : '<p class="empty">Nothing marked.</p>'}`;
}

function panelSection(panel, s) {
  const base = `sections.${s.id}`;
  const sd = val(base) || {};
  const orphans = orphanAnswers(s, sd), orphanEv = orphanEvidence(s, sd);
  const depth = depthOf(state.iv.data), showAll = !!(state.showAllQs || {})[s.id];
  const shown = visibleQuestions(s, sd, showAll ? undefined : depth);
  const extra = visibleQuestions(s, sd).length - visibleQuestions(s, sd, depth).length;
  const included = sectionIncluded(s, state.iv.data);
  const qCard = (q, idx) => {
    const p = `${base}.answers.${q.id}`;
    const beyond = !inDepth(q, depth);
    return `<div class="q-card${val(p + '.flag') ? ' flagged' : ''}${q.retired ? ' retired' : ''}${beyond ? ' beyond' : ''}">
      <div class="q-text"><span class="q-no" title="Question ID ${esc(q.id)}">${idx}</span><div><p>${q.retired ? '<span class="retired-tag">Retired question - kept because this interview answered it</span> ' : ''}${esc(q.q)} <span class="lvl lvl-${q.level}">${esc(T.depths.find((d) => d.id === q.level).label)}</span></p>
        ${q.fu.length ? `<ul class="probes">${q.fu.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</div></div>
      ${quickAnswerHtml(p, q)}
      ${ta(p + '.r', 2, 'Response…')}
      <div class="q-meta">
        <label class="inline">Evidence ${sel(p + '.ev', T.evidenceStatuses)}</label>
        ${chk(p + '.flag', 'Red flag / concern', 'flag')}
        ${chk(p + '.later', 'Come back to this', 'later')}
        ${filesButton(p, `${s.no}. ${q.q}`)}
        ${canEdit() ? `<a class="btn btn-small btn-ghost" href="#/finding/new?interview=${state.iv.id}&section=${s.id}&q=${q.id}">+ Raise finding</a>` : ''}
      </div></div>`;
  };
  panel.innerHTML = `
    <div class="sec-head">
      <div><p class="eyebrow">Section ${s.no}${s.optional ? ' · where applicable' : ''}</p><h2>${esc(s.title)}</h2></div>
      <label class="inline rating">Control assessment ${helpBtn('sectionRating')} ${sel(`${base}.rating`, T.sectionRatings)}</label>
    </div>
    ${included ? '' : `<div class="notice notice-warn"><p>This section is <strong>not included</strong> in this interview (${esc(exclusionReason(s, state.iv.data))}). You can still record answers here. ${canEdit() ? '<button type="button" class="btn btn-small" id="includeSec">Include it</button>' : ''}</p></div>`}
    <p class="intro">${esc(s.intro)}</p>
    <details class="guide-box" open><summary>Assessor guide - risk, expected control, red flags, regulation</summary>
      <dl class="guide-dl">
        <dt>Risk being assessed</dt><dd>${esc(s.risk)}</dd>
        <dt>Expected control</dt><dd>${esc(s.control)}</dd>
        <dt>Potential red flags</dt><dd><ul>${s.redFlags.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></dd>
        <dt>PRA requirement</dt><dd>${esc(s.reg.pra)}</dd>
        <dt>Also relevant (FCA, ICO, NCSC)</dt><dd>${esc(s.reg.also)}</dd>
      </dl>
      <p class="hint">${esc(T.APPLIES)}</p>
    </details>
    <h3>Opening question</h3>
    ${qCard(s.opener, '★')}
    <h3>Detailed questions ${helpBtn('quickAnswers')} <span class="hint">· ${esc(T.depths.find((d) => d.id === depth).label)} depth</span></h3>
    ${shown.map((q, i) => qCard(q, s.no + '.' + (i + 1))).join('')}
    ${extra > 0 ? `<button type="button" class="btn btn-small btn-ghost" id="toggleMore">${showAll ? `Hide the ${extra} question(s) beyond ${esc(T.depths.find((d) => d.id === depth).label)} depth` : `Show ${extra} more question(s) beyond ${esc(T.depths.find((d) => d.id === depth).label)} depth`}</button>` : ''}
    ${orphans.length ? `<div class="guide-box orphan-box"><h3>Answers to questions no longer in the questionnaire</h3>
      <p class="hint">These questions were removed from the questionnaire after this interview. The answers are kept for the record and cannot be edited here.</p>
      ${orphans.map(([id, a]) => `<div class="q-card retired"><p class="hint">Question ID ${esc(id)}</p><p>${nl2br(a.r || '-')}</p>${a.ev && a.ev !== 'Not requested' ? `<p class="hint">Evidence: ${esc(a.ev)}</p>` : ''}${a.flag ? '<p><strong class="flag-tag">⚑ red flag</strong></p>' : ''}</div>`).join('')}</div>` : ''}
    ${s.talkingPoints ? `<div class="guide-box"><h3>Explain to the ${IQ().subject}</h3><ul>${s.talkingPoints.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    <h3>Evidence to request ${helpBtn('evidenceStatus')}</h3>
    <p class="hint">Due dates, chasing and the request letter are in the <a href="#/evidence">Evidence tracker</a>.</p>
    <table class="table evidence-table"><thead><tr><th>Ref</th><th>Evidence</th><th>Status</th><th>Due</th><th>Reference / location / date seen</th><th>Files</th></tr></thead><tbody>
      ${visibleEvidence(s, sd).map((e) => `<tr><td><code>${s.no}.E${e.id.split('-e')[1]}</code></td><td>${e.retired ? '<span class="retired-tag">Retired</span> ' : ''}${esc(e.text)}</td><td>${sel(`${base}.evidence.${e.id}.status`, T.evidenceStatuses)}</td><td>${inp(`${base}.evidence.${e.id}.due`, 'date')}</td><td>${inp(`${base}.evidence.${e.id}.ref`)}</td><td>${filesButton(`${base}.evidence.${e.id}`, `${s.no}.E${e.id.split('-e')[1]} ${e.text}`)}</td></tr>`).join('')}
      <tr><td><code>${s.no}.E-other</code></td><td>Other evidence ${inp(`${base}.evidence.other.name`, 'text', 'Describe')}</td><td>${sel(`${base}.evidence.other.status`, T.evidenceStatuses)}</td><td>${inp(`${base}.evidence.other.due`, 'date')}</td><td>${inp(`${base}.evidence.other.ref`)}</td><td>${filesButton(`${base}.evidence.other`, `${s.no}.E-other ${val(`${base}.evidence.other.name`) || 'Other evidence'}`)}</td></tr>
      ${orphanEv.map(([id, x]) => `<tr class="retired"><td><code>${s.no}.${esc(id)}</code></td><td><span class="retired-tag">No longer in questionnaire</span> ${esc(id)}</td><td>${esc(x.status || '')}</td><td>${esc(x.due || '')}</td><td>${esc(x.ref || '')}</td><td>${filesButton(`${base}.evidence.${id}`, id)}</td></tr>`).join('')}
    </tbody></table>
    <h3>Four-way comparison ${helpBtn('fourWay')}</h3>
    <div class="four-way">
      ${T.fourWay.map(([k, l]) => `<label>${esc(l)} ${ta(`${base}.four.${k}`, 3)}</label>`).join('')}
    </div>
    <label class="block">Gaps identified between the four views ${ta(`${base}.gaps`, 3, 'Where does what is said, documented, enforced and evidenced diverge?')}</label>
    <div class="row-end">${canEdit() ? `<a class="btn" href="#/finding/new?interview=${state.iv.id}&section=${s.id}">+ Raise finding for this section</a>` : ''}
      ${nextSectionLink(s)}</div>`;
  $$('.q-card .flag input', panel).forEach((c) => c.addEventListener('change', () => c.closest('.q-card').classList.toggle('flagged', c.checked)));
  $$('.q-card .later input', panel).forEach((c) => c.addEventListener('change', () => setTimeout(refreshNav)));
  $$('[data-files-path]', panel).forEach((b) => {
    b.onclick = async () => {
      await flushSave(); // the file is linked to the saved item, so save any pending typing first
      filesDialog(state.iv.id, b.dataset.filesPath, b.dataset.filesLabel, (list) => {
        state.ivFiles = (state.ivFiles || []).filter((a) => a.path !== b.dataset.filesPath).concat(list);
        b.textContent = list.length ? `📎 ${list.length}` : '📎 Attach';
      });
    };
  });
  const tm = $('#toggleMore', panel);
  if (tm) tm.onclick = () => { state.showAllQs = { ...(state.showAllQs || {}), [s.id]: !showAll }; panelSection(panel, s); bindFields(panel); };
  const inc = $('#includeSec', panel);
  if (inc) inc.onclick = () => { state.iv.data.sectionInclude[s.id] = true; scheduleSave(); refreshNav(); panelSection(panel, s); bindFields(panel); };
}
function filesButton(path, label) {
  const n = (state.ivFiles || []).filter((a) => a.path === path).length;
  if (!n && !canEdit()) return '';
  return `<button type="button" class="btn btn-small btn-ghost" data-files-path="${esc(path)}" data-files-label="${esc(label)}">${n ? `📎 ${n}` : '📎 Attach'}</button>`;
}
function nextSectionLink(s) {
  const i = IQ().sections.indexOf(s);
  const next = IQ().sections.slice(i + 1).find((x) => sectionIncluded(x, state.iv.data));
  return next ? `<a class="btn btn-primary" href="#/interview/${state.iv.id}/${next.id}">Next: ${next.no}. ${esc(next.title)} →</a>`
    : `<a class="btn btn-primary" href="#/interview/${state.iv.id}/redflags">Next: Red flags →</a>`;
}

function panelRedFlags(panel) {
  const flaggedQs = [];
  IQ().sections.forEach((s) => {
    const a = state.iv.data.sections[s.id]?.answers || {};
    [{ id: 'opener', ...s.opener }, ...s.questions].forEach((q) => { if (a[q.id]?.flag) flaggedQs.push({ s, q, r: a[q.id].r }); });
  });
  panel.innerHTML = `
    <p class="eyebrow">${IQ().redFlagsNo ? 'Section ' + IQ().redFlagsNo : ''}</p><h2>Red flags heard</h2>
    <p class="intro">Tick any of these that you heard (in substance, not necessarily these words). Each one should trigger further investigation. Open the guidance for why it matters, what to ask next, what evidence to request and when it may become material.</p>
    ${IQ().redFlags.map((f) => `<div class="rf-card${val(`redFlags.${f.id}.on`) ? ' flagged' : ''}">
      ${chk(`redFlags.${f.id}.on`, `<strong>“${esc(f.quote)}”</strong>`, 'rf-check')}
      <details><summary>Guidance</summary>${redFlagGuide(f)}</details>
      ${ta(`redFlags.${f.id}.note`, 2, 'What was said, context, follow-up asked…')}
      ${canEdit() ? `<div class="rf-raise"${val(`redFlags.${f.id}.on`) ? '' : ' hidden'}><button type="button" class="btn btn-small" data-rf-finding="${f.id}">+ Raise finding</button>
        <span class="hint">Pre-filled from the “${esc(templateById(IQ().redFlagTemplate[f.id])?.title || '')}” template and this red flag's guidance.</span></div>` : ''}
    </div>`).join('')}
    <h3>Other red flags or concerns</h3>
    ${ta('redFlags.other.note', 3)}
    <h3>Questions you flagged during the interview (${flaggedQs.length})</h3>
    ${flaggedQs.length ? `<ul class="flag-list">${flaggedQs.map(({ s, q, r }) => `<li><a href="#/interview/${state.iv.id}/${s.id}">${s.no}. ${esc(s.title)}</a> - ${esc(q.q)}${r ? `<br><em>${esc(r)}</em>` : ''}</li>`).join('')}</ul>` : '<p class="empty">None flagged.</p>'}`;
  $$('.rf-check input', panel).forEach((c) => c.addEventListener('change', () => {
    const card = c.closest('.rf-card'); card.classList.toggle('flagged', c.checked);
    const r = $('.rf-raise', card); if (r) r.hidden = !c.checked;
  }));
  $$('[data-rf-finding]', panel).forEach((b) => {
    b.onclick = async () => {
      await flushSave();
      state.findingPrefill = redFlagFindingPrefill(state.iv, IQ().redFlags.find((x) => x.id === b.dataset.rfFinding));
      location.hash = `#/finding/new?interview=${state.iv.id}`;
    };
  });
}
function redFlagGuide(f) {
  return `<dl class="guide-dl"><dt>1. Why it matters</dt><dd>${esc(f.why)}</dd><dt>2. Risk created</dt><dd>${esc(f.risk)}</dd>
    <dt>3. Follow-up question</dt><dd>${esc(f.followUp)}</dd><dt>4. Evidence to request</dt><dd>${esc(f.evidence)}</dd>
    <dt>5. Control that should normally exist</dt><dd>${esc(f.control)}</dd><dt>6. When it may become material</dt><dd>${esc(f.material)}</dd></dl>`;
}

function panelFinal(panel) {
  panel.innerHTML = `
    <p class="eyebrow">${IQ().finalNo ? 'Section ' + IQ().finalNo : ''}</p><h2>Final questions</h2>
    <p class="intro">Always finish the interview with ${IQ().finalQuestions.length === 1 ? 'this question' : IQ().finalQuestions.length === 2 ? 'these two questions' : 'these questions'}, then thank the ${IQ().subject} and explain what happens next.</p>
    ${IQ().finalQuestions.map((q, i) => `<div class="q-card"><div class="q-text"><span class="q-no">${i + 1}</span><p>${esc(q)}</p></div>${ta(`final.q${i}`, 4, 'Response…')}</div>`).join('')}
    <label class="block">Closing notes - what was agreed, documents promised, follow-up meetings ${ta('final.closing', 4)}</label>
    <div class="form-grid"><label>Evidence due by ${inp('final.evidenceDue', 'date')}</label><label>Follow-up meeting ${inp('final.followUp', 'date')}</label></div>
    <div class="guide-box golden"><h3>The Technology Risk Specialist's Golden Rule</h3><blockquote>“${esc(T.goldenRule.quote)}”</blockquote></div>`;
}

async function panelFindings(panel) {
  const fs = await api('GET', `/api/findings?interview=${state.iv.id}`);
  panel.innerHTML = `
    <div class="sec-head"><div><p class="eyebrow">${IQ().findingsNo ? 'Section ' + IQ().findingsNo : ''}</p><h2>Findings from this interview</h2></div>
      ${canEdit() ? `<a class="btn btn-primary" href="#/finding/new?interview=${state.iv.id}">+ New finding</a>` : ''}</div>
    <p class="intro">Do not automatically classify every control weakness as a regulatory breach. Record whether each finding is a regulatory requirement, a regulatory expectation, industry good practice, internal policy, a control weakness, technical debt, or a potential, confirmed or material risk.</p>
    ${findingsTable(fs)}`;
}
function findingsTable(fs) {
  if (!fs.length) return '<p class="empty">No findings recorded.</p>';
  return `<table class="table"><thead><tr><th>Ref</th><th>Title</th><th>Category</th><th>Classification</th><th>Inherent</th><th>Residual</th><th>Owner</th><th>Target</th><th>Status</th></tr></thead><tbody>
    ${fs.map((f) => { const s = findingScores(f); return `<tr><td><a href="#/finding/${f.id}">${esc(f.ref)}</a></td><td>${esc(f.title)}</td><td>${esc(f.category)}</td><td>${esc(f.classification)}</td>
      <td>${ratingChip(s.inhR, s.inh)}</td><td>${ratingChip(s.resR, s.res)}</td><td>${esc(f.controlOwner)}</td>
      <td class="${isOverdue(f) ? 'overdue' : ''}">${fmtDate(f.targetDate)}</td><td>${esc(f.status)}</td></tr>`; }).join('')}
  </tbody></table>`;
}

function checklistSuggestions() {
  const sug = {};
  IQ().sections.forEach((s) => {
    const p = sectionProgress(s);
    if (p.rating !== 'Not assessed' || p.answered > 0) s.checklist.forEach((c) => { sug[c] = true; });
  });
  if ((state.iv.data.header || {}).applications) sug.apps = true;
  return sug;
}
function panelChecklist(panel) {
  const sug = checklistSuggestions();
  panel.innerHTML = `
    <div class="sec-head"><div><h2>Interview checklist</h2></div><a class="btn" href="#/print/checklist/${state.iv.id}">Print checklist</a></div>
    <p class="intro">Tick each item once you are satisfied it has been covered. Items marked “covered in questionnaire” have answers or a rating in a related section - that is a prompt, not a substitute for your judgement.</p>
    <div class="checklist-grid">
      ${IQ().checklist.map(([k, l]) => `<div class="ck-item">${chk(`checklist.${k}`, esc(l))}${sug[k] ? '<span class="sug">covered in questionnaire</span>' : ''}</div>`).join('')}
    </div>
    <label class="block">Checklist notes ${ta('checklistNotes', 3)}</label>`;
}

async function panelReport(panel) {
  const fs = await api('GET', `/api/findings?interview=${state.iv.id}`);
  panel.innerHTML = `
    <div class="sec-head"><div><p class="eyebrow">${IQ().reportNo ? 'Section ' + IQ().reportNo : ''}</p><h2>Interview report</h2></div>
      <div class="row">${canEdit() ? '<button class="btn" id="genDraft">Generate draft from interview data</button>' : ''}</div></div>
    <div class="report-actions">
      <span>Full report:</span><a class="btn btn-small" href="#/print/report/${state.iv.id}">Print / PDF</a><button class="btn btn-small" id="wordReport">Word (.docx)</button>
      <span>One-page executive summary:</span><a class="btn btn-small" href="#/print/execsum/${state.iv.id}">Print / PDF</a><button class="btn btn-small" id="wordExec">Word (.docx)</button>
    </div>
    <p class="intro">Draft generation fills <strong>empty</strong> sections from your answers, ratings, evidence and findings. Review and edit every section - it is a starting point, not a conclusion.</p>
    <h3>Executive summary</h3>
    <div class="form-grid">
      <label>Overall assessment ${helpBtn('overall')} ${sel('report.overall', OVERALL_OPTIONS, `Automatic: ${execSummaryModel(state.iv, fs).auto}`)}</label>
      <p class="hint">Leave on “Automatic” to derive it from the section ratings and findings, or choose your own conclusion.</p>
      <label class="full">Headline (two or three sentences for senior readers) ${ta('report.execSummary', 3, execSummaryModel(state.iv, fs).headline)}</label>
    </div>
    <h3>Report sections</h3>
    ${IQ().reportSections.map(([k, l, d], i) => `<label class="block report-field"><span class="rl">${i + 1}. ${esc(l)}</span><span class="hint">${esc(d)}</span>${ta(`report.${k}`, 5)}</label>`).join('')}`;
  $('#wordReport').onclick = async () => { await flushSave(); wordInterviewReport(state.iv.id).then(() => toast('Word document downloaded.')).catch(fail); };
  $('#wordExec').onclick = async () => { await flushSave(); wordExecSummary(state.iv.id).then(() => toast('Word document downloaded.')).catch(fail); };
  const g = $('#genDraft');
  if (g) g.onclick = async () => {
    const draft = buildReportDraft(fs);
    const filled = IQ().reportSections.filter(([k]) => (state.iv.data.report[k] || '').trim());
    let overwrite = false;
    if (filled.length) overwrite = await modalConfirm(`${filled.length} section(s) already contain text. Overwrite them too? Choose Cancel to fill only the empty sections.`, 'Overwrite all');
    IQ().reportSections.forEach(([k]) => { if (overwrite || !(state.iv.data.report[k] || '').trim()) state.iv.data.report[k] = draft[k]; });
    scheduleSave(); await saveNow(); panelReport(panel).then(() => bindFields(panel));
  };
}

function buildReportDraft(fs) {
  const d = state.iv.data, h = d.header || {};
  const sec = (id) => d.sections[id] || {};
  const ans = (id, q) => (sec(id).answers?.[q]?.r || '').trim();
  const lines = (arr) => arr.filter(Boolean).map((x) => '- ' + x).join('\n');
  const rated = (r) => IQ().sections.filter((s) => sec(s.id).rating === r);
  const byRating = (f) => { const s = findingScores(f); return `${f.ref} ${f.title} [${s.effR || 'not rated'}${f.classification ? ', ' + f.classification : ''}]`; };
  const open = fs.filter((f) => f.status !== 'Closed');
  const evidenceLines = [];
  IQ().sections.forEach((s) => {
    const ev = sec(s.id).evidence || {};
    s.evidence.forEach((e) => { const x = ev[e.id]; const st = x?.status; if (st && st !== 'Not requested') evidenceLines.push(`${e.text} (${s.title}) - ${st}${x.ref ? ' - ' + x.ref : ''}`); });
    if (ev.other?.name) evidenceLines.push(`${ev.other.name} (${s.title}) - ${ev.other.status || 'status not set'}`);
  });
  const further = [];
  IQ().sections.forEach((s) => {
    const r = sec(s.id).rating || 'Not assessed';
    if (r === 'Not assessed' && !s.optional) further.push(`${s.no}. ${s.title} - not assessed`);
    const ev = sec(s.id).evidence || {};
    s.evidence.forEach((e) => { const st = ev[e.id]?.status; if (st === 'Requested') further.push(`Evidence outstanding: ${e.text}`); if (st === 'Seen - not verified') further.push(`Evidence to verify: ${e.text}`); });
  });
  const rfs = IQ().redFlags.filter((f) => d.redFlags[f.id]?.on);
  const reg = new Set();
  fs.forEach((f) => { findingUkAreas(f).forEach((a) => reg.add(`${areaRegulator(a)} - ${a} (${f.ref})`)); if (f.ukRelevance) reg.add(`${f.ukRelevance} (${f.ref})`); });
  const weak = [...rated('Ineffective'), ...rated('Partially effective')];
  // Quick answers: concerns feed the weaknesses; "Don't know" / vague answers and marked items need following up.
  const quick = { concern: [], unknown: [], vague: [] };
  IQ().sections.forEach((s) => [s.opener, ...s.questions].forEach((q) => {
    const a = sec(s.id).answers?.[q.id]; const sig = a?.qa && T.answerSignal(q, a.qa);
    if (sig === 'concern') quick.concern.push(`${s.title}: "${q.q}" - answered ${a.qa}`);
    if (sig === 'unknown') quick.unknown.push(`${s.title}: "${q.q}" - ${IQ().subject} did not know`);
    if (a?.qa === 'Vague' || (sig === 'partial' && q.type === 'yn')) quick.vague.push(`${s.title}: "${q.q}" - answered ${a.qa}`);
  }));
  markedForLater(d).forEach(({ s, q }) => further.push(`Marked to come back to - ${s.title}: "${q.q}"`));
  further.push(...quick.unknown, ...quick.vague);
  return {
    role: [h.developerRole && `${h.developerName || 'The developer'} is a ${h.developerRole}${h.team ? ' in ' + h.team : ''}.`, ans('s1', 'opener'), ans('s1', 's1-q3'), ans('s1', 's1-q4'), ans('s1', 's1-q5') && 'Production access: ' + ans('s1', 's1-q5'), ans('s1', 's1-q6') && 'Privileged access: ' + ans('s1', 's1-q6')].filter(Boolean).join('\n'),
    applications: [h.applications, h.businessService && 'Business service(s): ' + h.businessService, h.criticality && 'Criticality: ' + h.criticality, h.dataClassification && 'Data classification: ' + h.dataClassification, h.deploymentModel && 'Deployment: ' + h.deploymentModel].filter(Boolean).join('\n'),
    keyRisks: lines([...open.map(byRating), ...rfs.map((f) => `Red flag heard: "${f.quote}" - ${f.risk}`)]) || 'No findings recorded yet.',
    existingControls: lines(rated('Effective').map((s) => `${s.title}${sec(s.id).four?.enforced ? ' - ' + sec(s.id).four.enforced : ''}`)) || 'No sections rated Effective.',
    weaknesses: lines([...weak.map((s) => `${s.title} (${sec(s.id).rating})${sec(s.id).gaps ? ' - ' + sec(s.id).gaps : ''}`), ...quick.concern]) || 'No sections rated Partially effective or Ineffective, and no concerning quick answers.',
    evidence: lines(evidenceLines) || 'No evidence recorded.',
    regulatory: (lines([...reg]) || 'No regulatory relevance recorded against findings.') + `\n\n${T.APPLIES}`,
    security: lines(open.filter((f) => f.securityRelevance === 'Yes').map(byRating)) || 'None recorded.',
    resilience: lines(open.filter((f) => f.opresRelevance === 'Yes').map(byRating)) || 'None recorded.',
    thirdParty: lines([...open.filter((f) => ['Third-party risk', 'Cloud security', 'Software supply chain'].includes(f.category)).map(byRating), sec('s19').gaps && 'Section 19 gaps: ' + sec('s19').gaps]) || 'None recorded.',
    immediate: lines(open.filter((f) => ['High', 'Critical'].includes(findingScores(f).effR) || f.escalation === 'Yes').map((f) => `${byRating(f)} - ${f.remediation || 'remediation to be agreed'}${f.controlOwner ? ' (owner: ' + f.controlOwner + ')' : ''}${f.targetDate ? ' by ' + f.targetDate : ''}`)) || 'None identified.',
    longerTerm: lines(open.filter((f) => ['Low', 'Medium', ''].includes(findingScores(f).effR) && f.escalation !== 'Yes').map((f) => `${byRating(f)} - ${f.remediation || 'remediation to be agreed'}`)) || 'None identified.',
    further: lines(further) || 'None identified.',
  };
}
