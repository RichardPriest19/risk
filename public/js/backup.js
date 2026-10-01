// Admin: automatic backups, manual backup and restore.
'use strict';

const BACKUP_KIND = { backup: 'Backup', 'pre-restore': 'Safety copy before a restore', 'pre-migration': 'Safety copy before an upgrade' };
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
function afterRestore(r) {
  state.user = null; state.iv = null; state.dirty = false;
  renderLogin(`Restore complete: ${r.interviews} interviews and ${r.findings} findings restored. Your previous data was saved as ${r.safetyBackup}. Everyone must sign in again, using the accounts in the restored data.`);
}

async function viewBackups() {
  setActiveNav('admin');
  const [st, list] = await Promise.all([api('GET', '/api/backup/status'), api('GET', '/api/backup/list')]);
  const s = st.settings;
  const freq = [[12, 'Every 12 hours'], [24, 'Daily'], [48, 'Every 2 days'], [168, 'Weekly']];
  if (!freq.some(([h]) => h === s.intervalHours)) freq.push([s.intervalHours, `Every ${s.intervalHours} hours`]);
  view().innerHTML = `<div class="page-head"><h1>Administration</h1></div>${adminTabs('backups')}
    ${st.warning ? `<div class="notice notice-warn" role="alert"><p><strong>Attention:</strong> ${esc(st.warning)}</p></div>` : ''}
    <div class="grid-2">
      <section class="card"><h2>Backup status</h2>
        <dl class="kv kv-wide">
          <dt>Automatic backups</dt><dd>${s.enabled ? `On - ${esc((freq.find(([h]) => h === s.intervalHours) || [])[1] || '')}` : '<strong>Off</strong>'}</dd>
          <dt>Last successful</dt><dd>${st.lastOk ? `${fmtDateTime(st.lastOk.ts)} · ${st.lastOk.interviews} interviews, ${st.lastOk.findings} findings` : 'Never'}</dd>
          <dt>Next due</dt><dd>${st.nextDue ? fmtDateTime(st.nextDue) + ' (or shortly after the app next starts)' : '-'}</dd>
          <dt>Backup folder</dt><dd><code>${esc(s.dir)}</code></dd>
          <dt>Keeping</dt><dd>The newest ${s.retention} backups; older ones are deleted automatically</dd>
          <dt>Live data file</dt><dd><code>${esc(st.dbFile)}</code></dd>
        </dl>
        ${st.sameDrive ? '<p class="hint"><strong>Tip:</strong> the backup folder is on the same drive as the live data, which protects against mistakes and corruption but not against losing the laptop or disk. For full protection choose a USB drive or network share, e.g. <code>E:\\TechRiskBackups</code> or <code>\\\\server\\share\\TechRisk</code>.</p>' : ''}
        <p class="hint">Backups run while the app is open. If the laptop was off when one was due, it is taken shortly after the app next starts. Each backup is integrity-checked and fingerprinted (SHA-256) so a changed or damaged file is detected before any restore.</p>
        <div class="row"><button class="btn btn-primary" id="bkNow">Back up now</button></div>
      </section>
      <section class="card"><h2>Settings</h2>
        <form id="bkForm" class="stack">
          <label class="check"><input type="checkbox" name="enabled"${s.enabled ? ' checked' : ''}> Take backups automatically</label>
          <label>Backup folder <input name="dir" value="${esc(s.dir)}" required></label>
          <p class="hint">Must be a full path. OneDrive folders are not allowed. The folder is created if it does not exist.</p>
          <div class="form-grid">
            <label>How often <select name="intervalHours">${options(freq, s.intervalHours)}</select></label>
            <label>Number of backups to keep <input type="number" name="retention" min="3" max="365" value="${s.retention}"></label>
          </div>
          <div><button class="btn btn-primary">Save settings</button></div>
        </form>
      </section>
    </div>
    <section class="card"><h2>Backups in the backup folder</h2>
      ${list.backups.length ? `<table class="table"><thead><tr><th>Taken</th><th>Type</th><th>File</th><th class="num">Size</th><th>Fingerprint</th><th></th></tr></thead><tbody>
      ${list.backups.map((b) => `<tr><td>${fmtDateTime(b.modified)}</td><td>${esc(BACKUP_KIND[b.kind])}</td><td><code>${esc(b.file)}</code></td><td class="num">${fmtSize(b.size)}</td>
        <td>${b.hashOk === true ? '<span class="ok-tag">✓ Unchanged</span>' : b.hashOk === false ? '<strong class="bad-tag">✗ File has changed</strong>' : '<span class="hint">No fingerprint</span>'}</td>
        <td><button class="btn btn-small" data-restore="${esc(b.file)}"${b.hashOk === false ? ' disabled' : ''}>Restore…</button></td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">No backups yet. Use “Back up now” to take the first one.</p>'}
    </section>
    <section class="card"><h2>Restore from another file</h2>
      <p>Restore a <code>.db</code> backup or database snapshot from elsewhere, e.g. a USB drive or a copy made on another computer. Use <a href="#/data">Import / export</a> instead to <em>add</em> interviews from a JSON file without replacing anything.</p>
      <button class="btn" id="bkUpload">Choose a .db file to restore…</button>
    </section>
    <section class="card"><h2>Recent backup activity</h2>
      ${list.log.length ? `<table class="table"><thead><tr><th>Time</th><th>Event</th><th>By</th><th>Result</th></tr></thead><tbody>
      ${list.log.map((l) => `<tr><td>${fmtDateTime(l.ts)}</td><td>${esc({ scheduled: 'Automatic backup', manual: 'Manual backup', restore: 'Restore', 'pre-restore': 'Safety copy before restore', 'pre-migration': 'Safety copy before upgrade' }[l.trigger] || l.trigger)}</td>
        <td>${esc(l.by)}</td><td>${l.ok ? `${l.trigger === 'restore' ? 'Restored ' + esc(l.file) : esc(l.file || '')} ${l.interviews != null ? `(${l.interviews} interviews, ${l.findings} findings)` : ''}` : `<strong class="bad-tag">Failed:</strong> ${esc(l.error)}`}</td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">No activity yet.</p>'}
    </section>`;

  $('#bkNow').onclick = async (e) => {
    e.target.disabled = true;
    try { await flushSave(); const r = await api('POST', '/api/backup/run'); toast(`Backup saved: ${r.file}`); viewBackups(); }
    catch (err) { fail(err); e.target.disabled = false; }
  };
  $('#bkForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      await api('PUT', '/api/backup/settings', { enabled: f.enabled.checked, dir: f.dir.value, intervalHours: Number(f.intervalHours.value), retention: Number(f.retention.value) });
      toast('Backup settings saved.'); viewBackups();
    } catch (err) { fail(err); }
  };
  const confirmRestore = (what) => modalConfirm(`Restore ${what}? This REPLACES all current interviews, findings, user accounts and the audit log with the contents of the backup. A safety copy of the current data is taken first, so this can be undone by restoring that copy. Everyone will be signed out.`, 'Restore');
  $$('[data-restore]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmRestore(b.dataset.restore))) return;
      try { await flushSave(); afterRestore(await api('POST', '/api/backup/restore', { file: b.dataset.restore })); } catch (err) { fail(err); }
    };
  });
  $('#bkUpload').onclick = async () => {
    const file = await pickFile('.db');
    if (!file || !(await confirmRestore(file.name))) return;
    try {
      await flushSave();
      const res = await fetch('/api/backup/restore-upload', { method: 'POST', credentials: 'same-origin', headers: { 'X-TR-Request': '1', 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'Restore failed');
      afterRestore(r);
    } catch (err) { fail(err); }
  };
}
