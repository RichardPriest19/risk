// Evidence tracker, evidence request letter, and fingerprinted evidence files.
'use strict';

const EV_OPEN = ['Requested', 'Seen - not verified'];
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const shortHash = (h) => (h ? h.slice(0, 12) + '…' : '');
const evOverdue = (r) => r.status === 'Requested' && r.due && r.due < today();

// Every evidence item recorded on an interview, as tracker rows with a stable reference such as "7.E1" or "7.Q3".
function evidenceRows(iv, attachments) {
  const rows = [], d = iv.data;
  qnOf(iv).sections.forEach((s) => {
    const sd = d.sections?.[s.id] || {}, ev = sd.evidence || {};
    const push = (kind, key, label, x, code) => {
      const path = `sections.${s.id}.${kind}.${key}`;
      const files = attachments.filter((a) => a.interviewId === iv.id && a.path === path);
      if ((x.status && x.status !== 'Not requested') || files.length) rows.push({ iv, s, kind, key, path, label, code, files, ...x });
    };
    const fromItem = (x) => ({ status: x?.status, ref: x?.ref, due: x?.due, owner: x?.owner, notes: x?.notes, chases: x?.chases || [] });
    s.evidence.forEach((e) => push('evidence', e.id, e.text, fromItem(ev[e.id]), `${s.no}.E${e.id.split('-e')[1]}`));
    if (ev.other?.name) push('evidence', 'other', ev.other.name, fromItem(ev.other), `${s.no}.E-other`);
    orphanEvidence(s, sd).forEach(([id, x]) => push('evidence', id, `(item ${id} - no longer in the questionnaire)`, fromItem(x), `${s.no}.${id}`));
    [s.opener, ...s.questions].forEach((q) => {
      const a = sd.answers?.[q.id];
      push('answers', q.id, `Evidence for: ${q.q}`, { status: a?.ev, ref: a?.evRef, due: a?.evDue, owner: a?.evOwner, notes: a?.evNotes, chases: a?.evChases || [] }, `${s.no}.Q${q.id === 'opener' ? '0' : q.id.split('-q')[1]}`);
    });
  });
  return rows;
}

async function patchEvidence(ivId, path, set) {
  return api('PATCH', `/api/interviews/${ivId}/evidence`, { path, set });
}

// ---------- tracker page ----------
let evFilter = { status: 'open', overdue: false, team: '', iv: '', q: '' };
async function viewEvidence() {
  setActiveNav('evidence');
  const [ivs, files] = await Promise.all([api('GET', '/api/interviews?full=1'), api('GET', '/api/attachments')]);
  const all = ivs.flatMap((iv) => evidenceRows(iv, files));
  const teams = [...new Set(ivs.map((i) => i.data.header?.team).filter(Boolean))].sort();
  const count = (f) => all.filter(f).length;
  const tile = (l, v, s, key) => `<button type="button" class="tile tile-btn" data-status="${key}"><span class="tile-label">${esc(l)}</span><span class="tile-value">${v}</span><span class="tile-sub">${esc(s)}</span></button>`;
  const tilesHtml = () => `      ${tile('Outstanding', count((r) => r.status === 'Requested'), 'requested, not yet received', 'Requested')}
      ${tile('Overdue', count(evOverdue), 'past the due date', 'overdue')}
      ${tile('To verify', count((r) => r.status === 'Seen - not verified'), 'received, not yet verified', 'Seen - not verified')}
      ${tile('Verified', count((r) => r.status === 'Seen - verified'), 'seen and verified', 'Seen - verified')}
      ${tile('Not available', count((r) => r.status === 'Not available'), 'evidence does not exist', 'Not available')}
`;
  view().innerHTML = `
    <div class="page-head"><h1>Evidence tracker</h1>
      <div class="row"><button class="btn" id="evCsv">Export CSV</button><button class="btn" id="evLetter" disabled title="Choose one interview in the filter first">Print evidence request letter</button></div></div>
    <p class="intro">Every piece of evidence requested in any interview. Update status, due dates and chases here or in the interview itself. Attach the files you receive: each is fingerprinted (SHA-256) when uploaded and checked on every download, so you can show it has not been altered since it was received.</p>
    <div class="tiles" id="evTiles"></div>
    <div class="filters card">
      <label>Search <input id="efq" value="${esc(evFilter.q)}" placeholder="Evidence, interviewee, reference"></label>
      <label>Status <select id="efs">${options([['open', 'Open (requested or to verify)'], ...T.evidenceStatuses.filter((x) => x !== 'Not requested').map((x) => [x, x]), ['all', 'All']], evFilter.status)}</select></label>
      <label>Team <select id="eft">${options(teams, evFilter.team, 'All teams')}</select></label>
      <label>Interview <select id="efi">${options(ivs.map((i) => [i.id, `${i.ref} - ${i.data.header?.developerName || 'unnamed'}`]), evFilter.iv, 'All interviews')}</select></label>
      <label class="check"><input type="checkbox" id="efo"${evFilter.overdue ? ' checked' : ''}> Overdue only</label>
    </div>
    <div class="card"><div class="table-scroll"><table class="table ev-table"><thead><tr><th>Interview</th><th>Ref</th><th>Evidence</th><th>Status ${helpBtn('evidenceStatus')}</th><th>Requested from</th><th>Due</th><th>Chased</th><th>Reference / location</th><th>Files</th></tr></thead><tbody id="evBody"></tbody></table></div></div>`;

  const filtered = () => all.filter((r) => {
    const f = evFilter;
    if (f.status === 'open' ? !EV_OPEN.includes(r.status) : f.status !== 'all' && r.status !== f.status) return false;
    if (f.overdue && !evOverdue(r)) return false;
    if (f.team && r.iv.data.header?.team !== f.team) return false;
    if (f.iv && String(r.iv.id) !== String(f.iv)) return false;
    return !f.q || [r.label, r.code, r.iv.ref, r.iv.data.header?.developerName, r.ref, r.notes, r.owner].join(' ').toLowerCase().includes(f.q.toLowerCase());
  }).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.iv.ref.localeCompare(b.iv.ref));
  let rows = [];
  const draw = () => {
    rows = filtered();
    const ro = !canEdit();
    $('#evBody').innerHTML = rows.length ? rows.map((r, i) => `<tr class="${evOverdue(r) ? 'row-overdue' : ''}">
      <td><a href="#/interview/${r.iv.id}/${r.s.id}">${esc(r.iv.ref)}</a><br><small>${esc(r.iv.data.header?.developerName || '')}</small></td>
      <td><code>${esc(r.code)}</code></td>
      <td>${esc(r.label)}<br><small class="hint">${esc(secLabel(r.s))}</small>
        <input class="ev-notes" data-i="${i}" data-f="notes" value="${esc(r.notes || '')}" placeholder="Notes" ${ro ? 'disabled' : ''}></td>
      <td><select data-i="${i}" data-f="status" ${ro ? 'disabled' : ''}>${options(T.evidenceStatuses, r.status)}</select>${evOverdue(r) ? '<br><strong class="bad-tag">Overdue</strong>' : ''}</td>
      <td><input data-i="${i}" data-f="owner" value="${esc(r.owner || '')}" placeholder="${esc(r.iv.data.header?.developerName || '')}" ${ro ? 'disabled' : ''}></td>
      <td><input type="date" data-i="${i}" data-f="due" value="${esc(r.due || '')}" ${ro ? 'disabled' : ''}></td>
      <td class="nowrap">${r.chases.length ? `${r.chases.length}× · last ${fmtDate(r.chases[r.chases.length - 1])}` : '<span class="hint">Not chased</span>'}${ro ? '' : `<br><button class="btn btn-small" data-chase="${i}">Log chase today</button>`}</td>
      <td><input data-i="${i}" data-f="ref" value="${esc(r.ref || '')}" ${ro ? 'disabled' : ''}></td>
      <td><button class="btn btn-small" data-files="${i}">📎 ${r.files.length || 'Add'}</button></td></tr>`).join('')
      : '<tr><td colspan="9" class="empty">No evidence items match these filters.</td></tr>';
    $('#evLetter').disabled = !evFilter.iv;
    $('#evTiles').innerHTML = tilesHtml();
    $$('.tile-btn').forEach((t) => { t.onclick = () => { const k = t.dataset.status; evFilter.overdue = k === 'overdue'; evFilter.status = k === 'overdue' ? 'Requested' : k; $('#efs').value = evFilter.status; $('#efo').checked = evFilter.overdue; draw(); }; });
  };
  const save = async (r, set, redraw) => {
    try { await patchEvidence(r.iv.id, r.path, set); Object.assign(r, set); if (redraw) draw(); }
    catch (e) { fail(e); }
  };
  const timers = {};
  $('#evBody').addEventListener('input', (e) => {
    const el = e.target; if (!el.dataset.f || el.tagName === 'SELECT' || el.type === 'date') return;
    const r = rows[el.dataset.i]; clearTimeout(timers[el.dataset.i + el.dataset.f]);
    timers[el.dataset.i + el.dataset.f] = setTimeout(() => save(r, { [el.dataset.f]: el.value }), 700);
  });
  $('#evBody').addEventListener('change', (e) => {
    const el = e.target, r = rows[el.dataset.i]; if (!r || !el.dataset.f) return;
    if (el.dataset.f === 'status') {
      const set = { status: el.value };
      if (el.value === 'Requested' && !r.due) set.due = r.iv.data.final?.evidenceDue || addDays(14);
      if (el.value === 'Requested' && !r.owner) set.owner = r.iv.data.header?.developerName || '';
      save(r, set, true);
    } else if (el.dataset.f === 'due') save(r, { due: el.value }, true);
  });
  $('#evBody').addEventListener('click', (e) => {
    const c = e.target.closest('[data-chase]'); if (c) { const r = rows[c.dataset.chase]; save(r, { chases: [...r.chases, today()] }, true); return; }
    const f = e.target.closest('[data-files]');
    if (f) { const r = rows[f.dataset.files]; filesDialog(r.iv.id, r.path, `${r.code} ${r.label}`, (list) => { r.files = list; draw(); }); }
  });
  const bindF = (id, key, prop = 'value') => $(id).addEventListener(prop === 'checked' ? 'change' : 'input', (e) => { evFilter[key] = e.target[prop]; draw(); });
  bindF('#efq', 'q'); bindF('#efs', 'status'); bindF('#eft', 'team'); bindF('#efi', 'iv'); bindF('#efo', 'overdue', 'checked');
  $('#evLetter').onclick = () => { location.hash = `#/print/evrequest/${evFilter.iv}`; };
  $('#evCsv').onclick = () => saveBlob(new Blob([toCsv([['Interview', 'Interviewee', 'Team', 'Ref', 'Section', 'Evidence', 'Status', 'Requested from', 'Due', 'Overdue', 'Times chased', 'Last chased', 'Reference', 'Notes', 'Files', 'File fingerprints (SHA-256)'],
    ...filtered().map((r) => [r.iv.ref, r.iv.data.header?.developerName, r.iv.data.header?.team, r.code, secLabel(r.s), r.label, r.status, r.owner, r.due, evOverdue(r) ? 'Yes' : '', r.chases.length, r.chases[r.chases.length - 1] || '', r.ref, r.notes, r.files.map((x) => x.filename).join('; '), r.files.map((x) => `${x.filename}: ${x.sha256}`).join('; ')])])], { type: 'text/csv' }), `evidence-tracker-${today()}.csv`);
  draw();
}

// ---------- evidence files dialog ----------
// Files belong to an interview evidence item, or (when findingId is given) to a finding, e.g. path 'closure'.
async function filesDialog(ivId, path, label, onChange, findingId) {
  const d = document.createElement('dialog'); d.className = 'dialog dialog-wide';
  document.body.appendChild(d);
  const listUrl = findingId ? `/api/attachments?finding=${findingId}` : `/api/attachments?interview=${ivId}`;
  const uploadUrl = findingId ? `/api/findings/${findingId}/attachments` : `/api/interviews/${ivId}/attachments`;
  const load = async () => (await api('GET', listUrl)).filter((a) => a.path === path);
  const render = async () => {
    const list = await load();
    d.innerHTML = `<h3>Evidence files</h3><p class="hint">${esc(label)}</p>
      ${list.length ? `<table class="table"><thead><tr><th>File</th><th class="num">Size</th><th>Received</th><th>Fingerprint (SHA-256)</th><th></th></tr></thead><tbody>
      ${list.map((a) => `<tr><td>${esc(a.filename)}${a.note ? `<br><small class="hint">${esc(a.note)}</small>` : ''}</td><td class="num">${fmtSize(a.size)}</td><td>${fmtDateTime(a.uploadedAt)}<br><small>${esc(a.uploadedBy)}</small></td>
        <td><code title="${esc(a.sha256)}">${shortHash(a.sha256)}</code> <span data-vres="${a.id}"></span></td>
        <td class="row"><button class="btn btn-small" data-verify="${a.id}">Verify</button><button class="btn btn-small" data-dl="${a.id}">Download</button>${isAdmin() ? `<button class="btn btn-small btn-ghost danger-text" data-del="${a.id}">Delete</button>` : ''}</td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">No files attached yet.</p>'}
      ${canEdit() ? `<div class="upload-box"><label>Add files <input type="file" id="fdFiles" multiple></label>
        <label>Note (optional) <input id="fdNote" placeholder="e.g. Exported from GitLab 30/09/2026 by S. Patel"></label>
        <p class="hint">Up to 25 MB each. Remove passwords, keys and real customer data first. Files are kept inside the app's database and included in backups.</p>
        <button class="btn btn-primary" id="fdUpload">Upload</button></div>` : ''}
      <div class="row-end"><button class="btn" id="fdClose">Close</button></div>`;
    $('#fdClose', d).onclick = () => d.close();
    $$('[data-verify]', d).forEach((b) => { b.onclick = async () => {
      try { const r = await api('GET', `/api/attachments/${b.dataset.verify}/verify`); $(`[data-vres="${b.dataset.verify}"]`, d).innerHTML = r.ok ? '<span class="ok-tag">✓ unchanged</span>' : '<strong class="bad-tag">✗ does not match</strong>'; } catch (e) { fail(e); }
    }; });
    $$('[data-dl]', d).forEach((b) => { b.onclick = async () => {
      const a = list.find((x) => String(x.id) === b.dataset.dl);
      try { await download(`/api/attachments/${a.id}/download`, a.filename); }
      catch (e) {
        if (!/fingerprint/.test(e.message)) return fail(e);
        if (await modalConfirm(`${e.message} Download it anyway? The download will be recorded in the audit log.`, 'Download anyway')) download(`/api/attachments/${a.id}/download?anyway=1`, a.filename).catch(fail);
      }
    }; });
    $$('[data-del]', d).forEach((b) => { b.onclick = async () => {
      const a = list.find((x) => String(x.id) === b.dataset.del);
      if (!(await modalConfirm(`Permanently delete ${a.filename}? The deletion (with the file's fingerprint) is recorded in the audit log.`, 'Delete'))) return;
      try { await api('DELETE', `/api/attachments/${a.id}`); toast('File deleted.'); await render(); } catch (e) { fail(e); }
    }; });
    const up = $('#fdUpload', d);
    if (up) up.onclick = async () => {
      const files = [...$('#fdFiles', d).files]; if (!files.length) return toast('Choose one or more files first.', 'error');
      up.disabled = true;
      for (const f of files) {
        if (f.size > 25 * 1024 * 1024) { toast(`${f.name} is larger than 25 MB and was skipped.`, 'error'); continue; }
        try {
          const res = await fetch(uploadUrl, { method: 'POST', credentials: 'same-origin', body: f,
            headers: { 'X-TR-Request': '1', 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name), 'X-Item-Path': encodeURIComponent(path), 'X-Note': encodeURIComponent($('#fdNote', d).value) } });
          const r = await res.json(); if (!res.ok) throw new Error(r.error || 'Upload failed');
          toast(`${f.name} attached. Fingerprint ${shortHash(r.sha256)}`);
        } catch (e) { fail(e); }
      }
      await render();
    };
    if (onChange) onChange(list);
  };
  d.addEventListener('close', () => d.remove());
  await render();
  d.showModal();
}

// ---------- evidence request letter (printed from #/print/evrequest/<interview>) ----------
function evidenceLetterHtml(iv, rows) {
  const h = iv.data.header || {};
  const items = rows.filter((r) => r.status === 'Requested');
  const dues = items.map((r) => r.due).filter(Boolean).sort();
  return `<header class="doc-head"><h1>Evidence request</h1>
    <table class="kv-table">
      <tr><th>To</th><td>${esc(h.developerName || '')}${h.developerRole ? ', ' + esc(h.developerRole) : ''}${h.team ? ' - ' + esc(h.team) : ''}</td></tr>
      <tr><th>From</th><td>${esc(h.interviewer || state.user.fullName)}, Technology Risk</td></tr>
      <tr><th>Date</th><td>${fmtDate(today())}</td></tr>
      <tr><th>Interview reference</th><td>${esc(iv.ref)}${h.date ? ` (meeting on ${fmtDate(h.date)})` : ''}</td></tr>
      <tr><th>Application(s)</th><td>${esc(h.applications || '')}</td></tr>
    </table></header>
    <p>Thank you for your time${h.date ? ` on ${fmtDate(h.date)}` : ''}. As discussed, please provide the evidence listed below${dues.length ? ` by <strong>${fmtDate(dues[0])}</strong>${dues.length > 1 && dues[dues.length - 1] !== dues[0] ? ` (some items have later dates, shown against each)` : ''}` : ''}.
      Please quote the <strong>reference</strong> (for example ${esc(items[0]?.code || '7.E1')}) with each item so that it can be matched to this request.</p>
    ${items.length ? `<table class="table print-table"><thead><tr><th>Ref</th><th>Topic</th><th>Evidence requested</th><th>Due</th><th>Provided</th></tr></thead><tbody>
      ${items.map((r) => `<tr><td><strong>${esc(r.code)}</strong></td><td>${esc(r.s.title)}</td><td>${esc(r.label)}${r.notes ? `<br><em>${esc(r.notes)}</em>` : ''}</td><td class="nowrap">${r.due ? fmtDate(r.due) : ''}</td><td>☐</td></tr>`).join('')}
    </tbody></table>` : '<p><strong>No evidence is currently outstanding for this interview.</strong></p>'}
    <h2>Guidance</h2>
    <ul>
      <li>Evidence should show the control <strong>operating</strong> - for example a specific recent change, pull request, pipeline run, test report or access review - not only the policy that says it should.</li>
      <li>System-generated evidence is best: exports, reports or screenshots that show the system name, date and time.</li>
      <li><strong>Do not include passwords, keys, tokens or other secrets.</strong> Remove or mask real customer and personal data unless it has been agreed that it is needed.</li>
      <li>If an item does not exist, please say so. That is useful information in itself.</li>
      <li>If anything is unclear, or a date is not achievable, contact ${esc(h.interviewer || 'the interviewer')} before the due date.</li>
    </ul>
    <p class="hint">Evidence received is recorded against ${esc(iv.ref)} and fingerprinted on receipt so that it can later be shown to be unaltered.</p>
    <section class="print-sec signoff"><div class="pf-grid">${['Issued by', 'Date', 'Received by (interviewee)', 'Date'].map((l) => `<div class="pf"><span>${l}</span><span class="pf-line"></span></div>`).join('')}</div></section>`;
}
