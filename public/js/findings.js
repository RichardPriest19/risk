// Findings register and finding editor (section 31 risk assessment framework).
'use strict';

const FINDING_STATUSES = ['Open', 'In remediation', 'Risk accepted', 'Closed'];

async function viewFindings() {
  setActiveNav('findings');
  const [fs, ivs] = await Promise.all([api('GET', '/api/findings'), api('GET', '/api/interviews'), loadServices()]);
  const ivRef = Object.fromEntries(ivs.map((i) => [i.id, i.ref]));
  const ivSvc = Object.fromEntries(ivs.map((i) => [i.id, svcIdsOf(i)]));
  const inService = (f, id) => (f.serviceIds || []).includes(id) || (ivSvc[f.interviewId] || []).includes(id);
  view().innerHTML = `
    <div class="page-head"><h1>Findings register</h1>
      <div class="row">${canEdit() ? '<a class="btn btn-primary" href="#/finding/new">+ New finding</a><button class="btn" id="fCsv">Export CSV</button>' : ''}
      <a class="btn" href="#/print/findings">Print register</a><button class="btn" id="fWord">Word (.docx)</button></div></div>
    <div class="filters card">
      <label>Search <input id="fq" placeholder="Title, ref, application, owner"></label>
      <label>Status <select id="fst">${options(FINDING_STATUSES, '', 'All')}</select></label>
      <label>Rating <select id="frt">${options(['Critical', 'High', 'Medium', 'Low'], '', 'All')}</select></label>
      <label>Category <select id="fcat">${options(T.riskCategories, '', 'All')}</select></label>
      <label>Classification <select id="fcl">${options(T.classifications.map((c) => c.id), '', 'All')}</select></label>
      ${state.services.length ? `<label>Service <select id="fsvc">${options(state.services.map((s) => [s.id, `${s.ref} ${s.name}`]), '', 'All')}</select></label>` : ''}
      <label class="check"><input type="checkbox" id="fod"> Overdue only</label>
    </div>
    <div class="card"><p class="hint">Rating shown is residual where assessed, otherwise inherent. Score = likelihood × impact (1-4 Low, 5-9 Medium, 10-16 High, 20-25 Critical).</p>
    <table class="table"><thead><tr><th>Ref</th><th>Title</th><th>Application</th><th>Category</th><th>Rating</th><th>Owner</th><th>Target</th><th>Status</th><th>Interview</th></tr></thead><tbody id="fBody"></tbody></table></div>`;
  const draw = () => {
    const sv = Number($('#fsvc')?.value) || 0;
    const q = $('#fq').value.toLowerCase(), st = $('#fst').value, rt = $('#frt').value, cat = $('#fcat').value, cl = $('#fcl').value, od = $('#fod').checked;
    const rows = fs.filter((f) => (!sv || inService(f, sv)) && (!st || f.status === st) && (!rt || findingScores(f).effR === rt) && (!cat || f.category === cat) && (!cl || f.classification === cl) && (!od || isOverdue(f))
      && (!q || [f.ref, f.title, f.application, f.controlOwner, f.description].join(' ').toLowerCase().includes(q)));
    $('#fBody').innerHTML = rows.length ? rows.map((f) => { const s = findingScores(f); return `<tr>
      <td><a href="#/finding/${f.id}">${esc(f.ref)}</a>${f.demo ? ' <span class="demo-tag">DEMO</span>' : ''}</td><td>${esc(f.title)}</td><td>${esc(f.application)}</td><td>${esc(f.category)}</td>
      <td>${ratingChip(s.effR, s.eff)}</td><td>${esc(f.controlOwner)}</td><td class="${isOverdue(f) ? 'overdue' : ''}">${fmtDate(f.targetDate)}${isOverdue(f) ? ' (overdue)' : ''}</td>
      <td>${esc(f.status)}</td><td>${f.interviewId ? `<a href="#/interview/${f.interviewId}">${esc(ivRef[f.interviewId])}</a>` : ''}</td></tr>`; }).join('')
      : '<tr><td colspan="9" class="empty">No findings match.</td></tr>';
  };
  ['fq', 'fst', 'frt', 'fcat', 'fcl', 'fod', 'fsvc'].filter((id) => $('#' + id)).forEach((id) => { $('#' + id).addEventListener('input', draw); $('#' + id).addEventListener('change', draw); });
  draw();
  const c = $('#fCsv'); if (c) c.onclick = () => download('/api/export/findings.csv', 'findings.csv').catch(fail);
  $('#fWord').onclick = () => wordFindingsRegister().then(() => toast('Word document downloaded.')).catch(fail);
}

async function viewFinding(idOrNew, ivId, sectionId, qId) {
  setActiveNav('finding');
  const [ivs] = await Promise.all([api('GET', '/api/interviews'), loadServices()]);
  let f;
  if (idOrNew === 'new') {
    if (!canEdit()) throw new Error('You do not have permission to create findings.');
    f = { status: 'Open', likelihood: '', impact: '', ukAreas: [], securityRelevance: '', opresRelevance: '', riskAcceptance: 'No', escalation: 'No' };
    if (ivId) {
      const iv = ivs.find((i) => i.id === Number(ivId));
      if (iv) {
        f.interviewId = iv.id;
        f.application = iv.header.applications || '';
        f.developerTeam = [iv.header.developerName, iv.header.team].filter(Boolean).join(' / ');
      }
      const s = sectionId && sectionById(sectionId);
      if (s) {
        f.category = SECTION_CATEGORY[s.id];
        f.ukAreas = ukAreasForSection(s);
        f.existingControl = '';
        f.sourceSection = secLabel(s);
        f.regulatoryRelevance = `PRA: ${s.reg.pra}\nAlso relevant: ${s.reg.also}`;
        const q = qId === 'opener' ? s.opener : s.questions.find((x) => x.id === qId);
        if (q) {
          f.sourceQuestion = q.q;
          const full = state.iv && state.iv.id === Number(ivId) ? state.iv : await api('GET', `/api/interviews/${ivId}`);
          const r = full.data?.sections?.[s.id]?.answers?.[qId]?.r;
          f.description = `Question: ${q.q}\nResponse: ${r || ''}`;
        }
      }
    }
    // Pre-fill from elsewhere (a comparison, a red flag or the template library) overrides the defaults above.
    if (state.findingPrefill) { Object.assign(f, state.findingPrefill); state.findingPrefill = null; }
  } else {
    f = (await api('GET', '/api/findings')).find((x) => x.id === Number(idOrNew));
    if (!f) throw new Error('Finding not found.');
  }
  // A new finding inherits the services of the interview it comes from.
  if (!f.id && !f.serviceIds && f.interviewId) f.serviceIds = svcIdsOf(ivs.find((i) => i.id === Number(f.interviewId)));
  // Yes/No fields with no value yet (e.g. imported findings) mean "No" - otherwise the select would show and save "Yes".
  ['riskAcceptance', 'escalation'].forEach((k) => { if (!f[k]) f[k] = 'No'; });
  const ro = !canEdit();
  const fv = (k) => f[k] ?? '';
  const I = (k, type = 'text', ph = '') => `<input type="${type}" name="${k}" value="${esc(fv(k))}" placeholder="${esc(ph)}">`;
  const A = (k, rows = 3, ph = '') => `<textarea name="${k}" rows="${rows}" placeholder="${esc(ph)}">${esc(fv(k))}</textarea>`;
  const S = (k, list, ph) => `<select name="${k}">${options(list, fv(k), ph)}</select>`;
  const lik = T.likelihood.map(([n, l]) => [n, `${n} - ${l}`]), imp = T.impact.map(([n, l]) => [n, `${n} - ${l}`]);
  view().innerHTML = `
    <div class="page-head"><div><a class="back" href="${f.interviewId ? `#/interview/${f.interviewId}/findings` : '#/findings'}">← Back</a>
      <h1>${f.ref ? esc(f.ref) + ' · ' + esc(f.title || '') : 'New finding'}</h1></div>
      <div class="row">${f.id ? `<a class="btn" href="#/print/finding/${f.id}">Print</a>` : ''}${f.id && isAdmin() ? '<button class="btn btn-danger" id="fDel">Delete</button>' : ''}</div></div>
    ${f.demo ? '<div class="notice demo-notice"><p><span class="demo-tag">DEMO</span> Demonstration finding - an example, not a real record.</p></div>' : ''}
    <form id="fForm" class="card finding-form">
      <fieldset ${ro ? 'disabled' : ''}>
      ${f.sourceSection ? `<p class="hint">Raised from ${/^\d/.test(f.sourceSection) ? 'section ' : ''}${esc(f.sourceSection)}${f.sourceQuestion ? ' - ' + esc(f.sourceQuestion) : ''}</p>` : ''}
      <input type="hidden" name="templateId" value="${esc(fv('templateId'))}">
      ${ro ? (f.templateId ? `<p class="hint">Based on template: ${esc(templateById(f.templateId)?.title || f.templateId)}</p>` : '') : templatePickerHtml(f)}
      <h2>Identification</h2>
      <div class="form-grid">
        <label class="full">Title <input name="title" required value="${esc(fv('title'))}" placeholder="Short description of the finding"></label>
        <label>Interview <select name="interviewId">${options(ivs.map((i) => [i.id, `${i.ref} - ${i.header.developerName || 'unnamed'}`]), fv('interviewId'), 'Not linked')}</select></label>
        <fieldset class="full svc-link"><legend>Business services affected ${helpBtn('services')}</legend>${serviceCheckboxes('serviceIds', f.serviceIds || [])}</fieldset>
        <label>Application / system ${I('application')}</label>
        <label>Interviewee / team ${I('developerTeam')}</label>
        <label>Risk category ${S('category', T.riskCategories, 'Select…')}</label>
        <label class="full">Description ${A('description', 4)}</label>
        <label class="full">Evidence ${A('evidence', 3, 'Evidence reviewed or requested, with references')}</label>
      </div>
      <h2>Control and risk</h2>
      <div class="form-grid">
        <label class="full">Existing control ${A('existingControl', 2)}</label>
        <label>Control effectiveness ${helpBtn('controlEffectiveness')} ${S('controlEffectiveness', T.effectiveness, 'Select…')}</label>
        <span></span>
        <label>Inherent likelihood ${helpBtn('inherentResidual')} ${S('likelihood', lik, 'Select…')}</label>
        <label>Inherent impact ${S('impact', imp, 'Select…')}</label>
        <div class="score-box full">Inherent risk: <span id="inhOut"></span></div>
        <label>Residual likelihood ${helpBtn('inherentResidual')} ${S('residualLikelihood', lik, 'Select…')}</label>
        <label>Residual impact ${S('residualImpact', imp, 'Select…')}</label>
        <div class="score-box full">Residual risk: <span id="resOut"></span></div>
      </div>
      <h2>Classification and relevance</h2>
      <div class="form-grid">
        <label>Classification ${helpBtn('classification')} ${S('classification', T.classifications.map((c) => c.id), 'Select…')}</label>
        <p class="hint" id="clHelp"></p>
        <label class="full">Regulatory relevance ${A('regulatoryRelevance', 3, 'Cite the specific rule/expectation and why it applies to this entity and system')}</label>
        <fieldset class="full area-grid uk-areas"><legend>Regulatory areas - PRA first ${helpBtn('ukAreas')}</legend>
          ${T.ukAreas.map((a) => `<label class="check" title="${esc(a.source)}"><input type="checkbox" name="ukAreas" value="${esc(a.area)}"${(f.ukAreas || []).includes(a.area) ? ' checked' : ''}> ${esc(a.area)} <span class="reg-tag reg-${a.regulator.toLowerCase()}">${esc(a.regulator)}</span></label>`).join('')}
        </fieldset>
        <label class="full">Specific rules ${I('ukRelevance', 'text', 'e.g. PRA SS1/21 impact tolerance for payments; PRA Fundamental Rule 6')}</label>
        <label>Security relevance ${S('securityRelevance', ['Yes', 'No'], 'Select…')}</label>
        <label>Operational resilience relevance ${S('opresRelevance', ['Yes', 'No'], 'Select…')}</label>
      </div>
      <h2>Remediation and governance</h2>
      <div class="form-grid">
        <label class="full">Recommended remediation ${A('remediation', 3)}</label>
        <label>Control owner ${I('controlOwner')}</label>
        <label>Target date ${I('targetDate', 'date')}</label>
        <label>Escalation required ${S('escalation', ['Yes', 'No'])}</label>
        <label>Escalated to ${I('escalatedTo', 'text', 'e.g. CIO, Operational Risk Committee')}</label>
        <label>Status ${helpBtn('findingStatus')} ${S('status', FINDING_STATUSES)}</label>
        <span></span>
        <label class="full">Progress notes ${A('progressNotes', 3)}</label>
      </div>
      <div id="raBox" class="status-box">
        <h2>Risk acceptance ${helpBtn('riskAcceptance')}</h2>
        <div class="form-grid">
          <label>Risk acceptance required ${S('riskAcceptance', ['Yes', 'No'])}</label>
          <label>Approved by / reference <span class="req-when">required to accept</span> ${I('riskAcceptanceRef', 'text', 'e.g. CIO - RA-2026-014')}</label>
          <label>Acceptance expires on <span class="req-when">required to accept</span> ${I('riskAcceptanceExpiry', 'date')}</label>
          <p class="hint">An accepted risk must be re-approved or remediated by this date. The dashboard warns 30 days before.</p>
        </div>
      </div>
      <div id="closeBox" class="status-box">
        <h2>Closure ${helpBtn('closure')}</h2>
        <div class="form-grid">
          <label class="full">Closure evidence <span class="req-when">required to close</span> ${A('closureEvidence', 3, 'What was changed, and what you saw that proves it - e.g. "Branch protection now blocks self-approval (setting screenshot 30/09); MR !482 shows independent approval."')}</label>
          <label>Verified by <span class="req-when">required to close</span> ${I('closureVerifiedBy', 'text', 'Name of the person who checked the evidence')}</label>
          <div>${f.id ? `<span class="field-label">Closure evidence files</span><br><button type="button" class="btn btn-small" id="closeFiles">📎 Attach or view files</button>` : '<p class="hint">Save the finding first to attach files.</p>'}</div>
          ${f.closedAt ? `<p class="hint full">Closed ${fmtDateTime(f.closedAt)}.</p>` : ''}
        </div>
      </div>
      </fieldset>
      ${f.id ? `<p class="hint">Created by ${esc(f.createdBy)} ${fmtDateTime(f.createdAt)} · last updated by ${esc(f.updatedBy)} ${fmtDateTime(f.updatedAt)}</p>` : ''}
      ${ro ? '' : '<div class="row-end"><button class="btn btn-primary" type="submit">Save finding</button></div>'}
    </form>
    ${f.id ? '<section class="card"><h2>History</h2><div id="fHistory"><p class="hint">Loading…</p></div></section>' : ''}`;
  const form = $('#fForm');
  const upd = () => {
    const g = (n) => Number(form.elements[n].value) || 0;
    const inh = g('likelihood') * g('impact'), res = g('residualLikelihood') * g('residualImpact');
    $('#inhOut').innerHTML = inh ? ratingChip(scoreRating(inh), inh) : 'select likelihood and impact';
    $('#resOut').innerHTML = res ? ratingChip(scoreRating(res), res) : 'select likelihood and impact after existing controls';
    const c = T.classifications.find((x) => x.id === form.elements.classification.value);
    $('#clHelp').textContent = c ? c.desc : 'Distinguish binding requirements from expectations, good practice and internal policy.';
    const st = form.elements.status.value;
    $('#closeBox').classList.toggle('active', st === 'Closed');
    $('#raBox').classList.toggle('active', st === 'Risk accepted');
  };
  form.addEventListener('change', upd); upd();
  form.elements.status.addEventListener('change', () => {
    const box = form.elements.status.value === 'Closed' ? $('#closeBox') : form.elements.status.value === 'Risk accepted' ? $('#raBox') : null;
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  bindTemplatePicker(form, ivs, upd);
  const cf = $('#closeFiles');
  if (cf) cf.onclick = () => filesDialog(null, 'closure', `${f.ref} closure evidence`, (list) => { cf.textContent = list.length ? `📎 ${list.length} file(s)` : '📎 Attach or view files'; loadFindingHistory(f.id); }, f.id);
  if (f.id) {
    loadFindingHistory(f.id);
    api('GET', `/api/attachments?finding=${f.id}`).then((l) => { const n = l.filter((a) => a.path === 'closure').length; if (cf && n) cf.textContent = `📎 ${n} file(s)`; }).catch(() => {});
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    // Same rules the server enforces - checked here first for a friendlier message.
    const el = form.elements, wasStatus = f.status || '';
    if (el.status.value === 'Closed' && wasStatus !== 'Closed' && (el.closureEvidence.value.trim().length < 20 || !el.closureVerifiedBy.value.trim())) {
      toast('To close a finding, describe the closure evidence (at least 20 characters) and who verified it.', 'error');
      $('#closeBox').scrollIntoView({ block: 'center' }); (el.closureEvidence.value.trim().length < 20 ? el.closureEvidence : el.closureVerifiedBy).focus(); return;
    }
    if (el.status.value === 'Risk accepted' && wasStatus !== 'Risk accepted' && (!el.riskAcceptanceRef.value.trim() || !el.riskAcceptanceExpiry.value)) {
      toast('To accept a risk, record who approved it and when the acceptance expires.', 'error');
      $('#raBox').scrollIntoView({ block: 'center' }); (!el.riskAcceptanceRef.value.trim() ? el.riskAcceptanceRef : el.riskAcceptanceExpiry).focus(); return;
    }
    const body = { ...f };
    const fd = new FormData(form);
    for (const el of form.elements) if (el.name && el.name !== 'ukAreas' && el.name !== 'serviceIds') body[el.name] = fd.get(el.name);
    body.serviceIds = fd.getAll('serviceIds').map(Number);
    delete body.doraAreas; delete body.doraRelevance; // DORA no longer recorded
    body.ukAreas = fd.getAll('ukAreas');
    ['likelihood', 'impact', 'residualLikelihood', 'residualImpact'].forEach((k) => { body[k] = body[k] ? Number(body[k]) : ''; });
    body.interviewId = body.interviewId ? Number(body.interviewId) : null;
    try {
      const saved = f.id ? await api('PUT', `/api/findings/${f.id}`, body) : await api('POST', '/api/findings', body);
      toast(`Finding ${saved.ref} saved.`);
      location.hash = `#/finding/${saved.id}`;
      if (f.id) viewFinding(String(saved.id));
    } catch (err) { fail(err); }
  };
  const del = $('#fDel');
  if (del) del.onclick = async () => {
    if (!(await modalConfirm(`Permanently delete ${f.ref}? This cannot be undone.`, 'Delete'))) return;
    try { await api('DELETE', `/api/findings/${f.id}`); toast('Finding deleted.'); location.hash = '#/findings'; } catch (err) { fail(err); }
  };
}

// ---------- finding templates ----------
const templateById = (id) => T.findingTemplates.find((t) => t.id === id);
// A finding's UK regulatory areas. Findings created from a template before UK areas existed inherit the template's.
const areaRegulator = (name) => (T.ukAreas.find((a) => a.area === name) || {}).regulator || 'UK';
function findingUkAreas(f) { return f.ukAreas && f.ukAreas.length ? f.ukAreas : (templateById(f.templateId)?.ukAreas || []); }
const SECURITY_CATS = ['Access management', 'Application security', 'CI/CD and pipeline security', 'Cloud security', 'Container security', 'Data protection', 'Logging and monitoring', 'Secrets management', 'Software supply chain', 'Vulnerability management', 'Testing'];
const OPRES_CATS = ['Backup and recovery', 'Business continuity', 'Incident management', 'Operational resilience', 'Third-party risk', 'Change management'];
// Values a template contributes, with impact adjusted for the application's criticality.
function templateValues(tpl, criticality) {
  const adj = /^Tier 1/.test(criticality || '') ? 1 : /^Tier [34]/.test(criticality || '') ? -1 : 0;
  return {
    title: tpl.title, category: tpl.category, templateId: tpl.id,
    description: `${tpl.description}\n\nExpected control: ${tpl.control}`,
    evidence: `To request: ${tpl.evidence}`, remediation: tpl.remediation,
    likelihood: tpl.L, impact: Math.max(1, Math.min(5, tpl.I + adj)),
    ukAreas: tpl.ukAreas, ukRelevance: tpl.uk, classification: 'Potential risk',
    securityRelevance: SECURITY_CATS.includes(tpl.category) ? 'Yes' : 'No', opresRelevance: OPRES_CATS.includes(tpl.category) ? 'Yes' : 'No',
  };
}
function templatePickerHtml(f) {
  const src = T.sections.find((s) => secLabel(s) === f.sourceSection); // the section the finding was raised from, in any questionnaire
  const secNo = src && src.no;
  // Templates for this section first (in the order they list it), then others in the same category.
  const named = src ? (src.templates || []).map(templateById).filter(Boolean) : [];
  const bySection = src ? [...named, ...T.findingTemplates.filter((t) => !named.includes(t) && t.qn === src.qn && t.sections.includes(src.no)).sort((x, y) => x.sections.indexOf(src.no) - y.sections.indexOf(src.no))] : [];
  const suggested = [...bySection, ...T.findingTemplates.filter((t) => !bySection.includes(t) && f.category && t.category === f.category)];
  const rest = T.findingTemplates.filter((t) => !suggested.includes(t));
  const opt = (t) => `<option value="${t.id}"${t.id === f.templateId ? ' selected' : ''}>${esc(t.title)}</option>`;
  return `<div class="tpl-picker"><label>Start from a standard finding template ${helpBtn('template')}
      <select id="tplSel"><option value="">Choose a template…</option>
        ${suggested.length ? `<optgroup label="Suggested for this ${secNo ? 'section' : 'category'}">${suggested.map(opt).join('')}</optgroup>` : ''}
        <optgroup label="All templates">${rest.map(opt).join('')}</optgroup></select></label>
    <button type="button" class="btn" id="tplApply">Apply</button>
    <p class="hint">Templates keep wording consistent across assessors and let the Themes report count recurring findings. Applying fills empty fields only (you'll be asked before anything is replaced); likelihood and impact are suggestions, with impact adjusted for the application's criticality. <a href="#/library/templates">Browse the templates</a></p></div>`;
}
function bindTemplatePicker(form, ivs, after) {
  const btn = $('#tplApply', form); if (!btn) return;
  btn.onclick = async () => {
    const tpl = templateById($('#tplSel', form).value);
    if (!tpl) return toast('Choose a template first.', 'error');
    const iv = ivs.find((i) => String(i.id) === form.elements.interviewId.value);
    const vals = templateValues(tpl, iv?.header?.criticality);
    const filled = Object.keys(vals).filter((k) => k !== 'ukAreas' && k !== 'templateId' && form.elements[k] && String(form.elements[k].value || '').trim() && String(form.elements[k].value) !== String(vals[k]));
    const overwrite = filled.length ? await modalConfirm(`${filled.length} field(s) already have content (${filled.join(', ')}). Replace them with the template wording? Choose Cancel to fill only the empty fields. Existing description text is kept below the template either way.`, 'Replace') : false;
    for (const [k, v] of Object.entries(vals)) {
      if (k === 'ukAreas') { $$(`[name=${k}]`, form).forEach((c) => { if (v.includes(c.value)) c.checked = true; }); continue; }
      const el = form.elements[k]; if (!el) continue;
      const cur = String(el.value || '').trim();
      if (k === 'description' && cur && cur !== v) { el.value = `${v}\n\nInterview notes:\n${cur}`; continue; }
      if (!cur || overwrite || k === 'templateId') el.value = v;
    }
    after(); toast(`Template applied: ${tpl.title}`);
  };
}
// A red flag heard in an interview -> finding pre-filled from its matching template and the six-point guidance.
function redFlagFindingPrefill(iv, rf) {
  const tpl = templateById(T.redFlagTemplate[rf.id]);
  const note = iv.data.redFlags?.[rf.id]?.note;
  const base = tpl ? templateValues(tpl, iv.data.header?.criticality) : {};
  return {
    ...base,
    title: tpl ? tpl.title : `Red flag: ${rf.quote}`,
    description: `Red flag heard: "${rf.quote}"${note ? `\nWhat was said: ${note}` : ''}\n\nWhy it matters: ${rf.why}\nRisk: ${rf.risk}${tpl ? `\n\n${tpl.description}` : ''}\n\nExpected control: ${rf.control}`,
    evidence: `To request: ${rf.evidence}`,
    progressNotes: `When this may become material: ${rf.material}\nFollow-up question: ${rf.followUp}`,
    sourceSection: `red flag "${rf.quote}"`,
  };
}

// ---------- history timeline ----------
const HISTORY_LABELS = {
  serviceIds: 'Business services',
  ...Object.fromEntries(FINDING_CSV.map(([label, key]) => [key, label])),
  interview: 'Interview', riskAcceptanceExpiry: 'Risk acceptance expiry', closureEvidence: 'Closure evidence', closureVerifiedBy: 'Closure verified by',
  templateId: 'Template', progressNotes: 'Progress notes', riskAcceptanceRef: 'Risk acceptance reference', demo: 'Demo flag', source: 'Source',
};
const ACTION_CLASS = { Created: 'h-created', Closed: 'h-closed', Reopened: 'h-reopened', 'Risk accepted': 'h-accepted', 'File attached': 'h-file', 'File deleted': 'h-file', Imported: 'h-created' };
async function loadFindingHistory(id) {
  const box = $('#fHistory'); if (!box) return;
  try {
    const h = await api('GET', `/api/findings/${id}/history`);
    const val = (k, v) => (k === 'templateId' ? templateById(v)?.title || v : k === 'serviceIds' ? v.split(', ').map((x) => svcName(x)?.ref || x).join(', ') : v);
    const cut = (s) => (s.length > 300 ? s.slice(0, 300) + '…' : s);
    box.innerHTML = `<ol class="timeline">${h.entries.map((e) => `<li class="${ACTION_CLASS[e.action] || ''}">
        <div class="tl-head"><strong>${esc(e.action)}</strong> · ${fmtDateTime(e.ts)} · ${esc(e.username || '')}</div>
        ${e.changes.length ? `<table class="table tl-table"><tbody>${e.changes.map((c) => `<tr><th>${esc(HISTORY_LABELS[c.f] || c.f)}</th>
          <td>${c.from ? `<span class="tl-from" title="${esc(c.from)}">${esc(cut(val(c.f, c.from)))}</span>` : '<span class="hint">(empty)</span>'}</td><td class="tl-arrow">→</td>
          <td>${c.to ? `<span title="${esc(c.to)}">${esc(cut(val(c.f, c.to)))}</span>` : '<span class="hint">(empty)</span>'}</td></tr>`).join('')}</tbody></table>` : ''}</li>`).join('')}
      ${!h.entries.some((e) => e.action === 'Created' || e.action === 'Imported') ? `<li class="h-created"><div class="tl-head"><strong>Created</strong> · ${fmtDateTime(h.createdAt)} · ${esc(h.createdBy || '')}</div><p class="hint">Detailed change history is recorded from this version of the app onwards.</p></li>` : ''}</ol>`;
  } catch (e) { box.innerHTML = `<p class="hint">History unavailable: ${esc(e.message)}</p>`; }
}
