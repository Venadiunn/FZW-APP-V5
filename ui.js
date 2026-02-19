/**
 * trackit/js/ui.js
 * All UI rendering functions — no business logic here.
 * Every renderer reads from State and writes to DOM.
 */

'use strict';

const UI = (() => {

  // ── Formatters ────────────────────────────────────────────────
  const fmt$    = v => '$' + Number(v).toLocaleString('en-US');
  const fmtFt2  = v => Number(v).toFixed(1);
  const esc     = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function fmtTime(sLeft, overdue, mElapsed) {
    if (overdue) return `+${Math.max(0, mElapsed - 15)}m OVERDUE`;
    const m = String(Math.floor(sLeft / 60)).padStart(2, '0');
    const s = String(sLeft % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  // ── Toast ─────────────────────────────────────────────────────
  let _toastTimer;
  function toast(msg, type = 'success') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast ${type} show`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
  }

  // ── Modal helpers ─────────────────────────────────────────────
  function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
  function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
  }

  // ── setStat helper (animate on change) ───────────────────────
  function setStat(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    const s = String(val);
    if (el.textContent !== s) {
      el.textContent = s;
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }
  }

  // ── Dashboard ─────────────────────────────────────────────────
  function renderDashboard() {
    const s = State.getStats();

    // WWT top-tab stat cards
    setStat('statTotal',      s.total);
    setStat('statStored',     s.stored);
    setStat('statUnassigned', s.unassigned);
    setStat('statWorkArea',   s.workArea);

    // Utilization bar
    const utilBar    = document.getElementById('utilBar');
    const utilPct    = document.getElementById('utilPct');
    const utilDetail = document.getElementById('utilDetail');
    if (utilBar)    utilBar.style.width   = s.utilPct + '%';
    if (utilPct)    utilPct.textContent   = s.utilPct + '%';
    if (utilDetail) utilDetail.textContent = `${s.usedArea.toFixed(1)} / ${s.totalArea.toFixed(1)} ft²`;

    // Quick action subtitles
    setStat('qaItemCount',  `${s.total} items in inventory`);
    setStat('qaUnassigned', `${s.unassigned} unassigned items ready to place`);
    setStat('qaLocCount',   `${s.locCount} storage locations`);

    // Overview stat-strip (TrackIT style)
    setStat('v-items',   s.total);
    setStat('v-locs',    s.locCount);
    setStat('v-work',    s.workArea);
    setStat('v-work-wa', s.workArea);

    _renderDashWorkAreaBanner();
  }

  function _renderDashWorkAreaBanner() {
    const workItems = State.getWorkAreaItems();
    const dashWA    = document.getElementById('dashWorkArea');
    if (!dashWA) return;

    if (!workItems.length) { dashWA.innerHTML = ''; return; }

    const hasOD = workItems.some(i => i.isLate);
    dashWA.innerHTML = `
      <div class="work-area-card ${hasOD ? 'overdue' : ''}">
        <div class="work-area-header">
          <span>${hasOD ? '🚨' : '⏱'}</span>
          <span class="work-area-title" style="color:${hasOD ? 'var(--red)' : 'var(--amber)'}">
            Work Area — ${workItems.length} Item(s)${hasOD ? ' — OVERDUE' : ''}
          </span>
        </div>
        ${workItems.map(item => `
          <div class="work-area-item ${item.isLate ? 'overdue' : ''}"
               onclick="App.openCheckinModal('${esc(item.partNumber)}')">
            <div>
              <div class="wa-pn">${esc(item.partNumber)}</div>
              <div class="wa-desc">${esc(item.description)}</div>
            </div>
            <div class="wa-timer ${item.isLate ? 'timer-late' : 'timer-ok'}" id="dash-timer-${esc(item.partNumber)}">
              ${item.isLate ? `OVERDUE ${Math.abs(item.remaining)}m` : `${item.remaining}m left`}
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  // ── Inventory ─────────────────────────────────────────────────
  function renderInventory(searchQuery, filter) {
    const q = (searchQuery || '').toLowerCase();
    let items = State.getItems();

    if (q) items = items.filter(i =>
      i.partNumber.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
    );
    if (filter && filter !== 'ALL') {
      items = items.filter(i => State.getItemStatus(i) === filter);
    }

    const list = document.getElementById('inventoryList');
    if (!list) return;

    const noteEl = document.getElementById('inventoryNote');
    if (noteEl) noteEl.textContent = `Showing ${items.length} of ${State.getItems().length} items`;

    // Update inventory-panel stats
    setStat('v-items-inv',      State.getStats().total);
    setStat('v-items-filtered', items.length);

    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No items match</div></div>';
      return;
    }

    list.innerHTML = items.map(item => {
      const status = State.getItemStatus(item);
      const inWA   = State.isInWorkArea(item);
      const badgeCls = status === 'IN_STORAGE'  ? 'badge-stored'
                     : status === 'IN_WORK_AREA' ? 'badge-workarea'
                     :                            'badge-unstored';
      const badgeTxt = status === 'IN_STORAGE'  ? 'Stored'
                     : status === 'IN_WORK_AREA' ? '⏱ Work Area'
                     :                            'Unassigned';

      return `
        <div class="item-row">
          <div class="item-pn">${esc(item.partNumber)}</div>
          <div class="item-desc" title="${esc(item.description)}">${esc(item.description)}</div>
          <div class="item-area">${fmtFt2(item.area)}</div>
          <div class="item-price">${fmt$(item.price)}</div>
          <div class="item-loc">
            <span class="badge ${badgeCls}">${badgeTxt}</span>
            <div style="font-size:11px;margin-top:2px;color:var(--muted)">${esc(State.getLocationName(item))}</div>
          </div>
          <div class="item-actions">
            ${!inWA ? `<button class="btn btn-primary" onclick="App.openMoveModal('${esc(item.partNumber)}')">Move</button>` : ''}
            ${!inWA ? `<button class="btn btn-green"   onclick="App.openAiModal('${esc(item.partNumber)}')">AI</button>` : ''}
            ${!inWA ? `<button class="btn btn-amber"   onclick="App.openCheckoutModal('${esc(item.partNumber)}')">Out</button>` : ''}
            ${inWA  ? `<button class="btn btn-red"     onclick="App.openCheckinModal('${esc(item.partNumber)}')">In</button>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  // ── Placement (Location Grid) ──────────────────────────────────
  function renderPlacement() {
    const grid = document.getElementById('locGrid');
    if (!grid) return;
    const locations = State.getLocations();
    const items     = State.getItems();

    grid.innerHTML = locations.map(loc => {
      const locItems = items.filter(i => i.locationIndex === loc.id && !State.isInWorkArea(i));
      const usedArea = loc.totalArea - loc.remainingArea;
      const pct      = loc.totalArea > 0 ? Math.min(100, Math.round(usedArea / loc.totalArea * 100)) : 0;
      const col      = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)';

      return `
        <div class="loc-card">
          <div class="loc-header" onclick="UI.toggleLocItems(${loc.id})">
            <div class="loc-header-left">
              <div class="loc-index">${loc.id}</div>
              <div>
                <div class="loc-name">${esc(loc.name)}</div>
                <div class="loc-count">${locItems.length} item${locItems.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
            <div class="loc-pct" style="color:${col}">${pct}%</div>
          </div>
          <div class="loc-bar-bg">
            <div class="loc-bar-fill" style="width:${pct}%;background:${col}"></div>
          </div>
          <div class="loc-meta">
            <span class="loc-meta-text">Used ${usedArea.toFixed(1)} ft²</span>
            <span class="loc-meta-text">Free ${loc.remainingArea.toFixed(1)} ft²</span>
            <span class="loc-meta-text">Total ${loc.totalArea.toFixed(1)} ft²</span>
          </div>
          <div class="loc-items" id="locItems-${loc.id}">
            <div class="loc-items-header">Items at this location</div>
            ${locItems.length === 0
              ? '<div class="loc-empty">No items stored here</div>'
              : locItems.map(i => `
                  <div class="loc-item-row">
                    <span class="loc-item-pn">${esc(i.partNumber)}</span>
                    <span class="loc-item-desc" title="${esc(i.description)}">${esc(i.description)}</span>
                    <span class="loc-item-area">${fmtFt2(i.area)} ft²</span>
                    <button class="btn btn-amber" style="font-size:10px;padding:3px 7px"
                            onclick="App.openCheckoutModal('${esc(i.partNumber)}')">Check Out</button>
                    <button class="btn btn-green" style="font-size:10px;padding:3px 7px;margin-left:3px"
                            onclick="App.openAiModal('${esc(i.partNumber)}')">Re-Place</button>
                  </div>`)
                .join('')
            }
          </div>
        </div>`;
    }).join('');
  }

  function toggleLocItems(id) {
    document.getElementById(`locItems-${id}`)?.classList.toggle('open');
  }

  // ── Work Area (full table view) ────────────────────────────────
  function renderWorkArea() {
    const now       = Date.now();
    const workItems = State.getWorkAreaItems();
    const list      = document.getElementById('workAreaList');
    const summary   = document.getElementById('waSummary');

    if (!list) return;

    // WWT style full table
    list.innerHTML = workItems.length === 0
      ? '<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-text">Work area is empty — all items in storage</div></div>'
      : workItems.map(item => `
          <div class="wa-row ${item.isLate ? 'overdue' : ''}" id="wa-row-${esc(item.partNumber)}">
            <div style="font-family:var(--mono);font-size:12px;font-weight:600;color:var(--blue)">${esc(item.partNumber)}</div>
            <div style="font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(item.description)}</div>
            <div style="font-family:var(--mono);font-size:12px;font-weight:600">${fmt$(item.price)}</div>
            <div style="font-size:12px;color:var(--muted)">${esc(item.retLoc)}</div>
            <div>
              <div class="wa-timer ${item.isLate ? 'timer-late' : 'timer-ok'}" id="wa-timer-${esc(item.partNumber)}">
                ${item.isLate ? `OVERDUE ${Math.abs(item.remaining)}m` : `${item.remaining}m left`}
              </div>
              <div class="timer-bar-wrap" style="margin-top:4px">
                <div class="timer-bar-fill ${item.isLate ? 'bar-red' : item.timerPct > 70 ? 'bar-amber' : 'bar-green'}"
                     id="wa-tbar-${esc(item.partNumber)}"
                     style="width:${item.isLate ? 100 : item.timerPct}%"></div>
              </div>
            </div>
            <div><button class="btn btn-red" onclick="App.openCheckinModal('${esc(item.partNumber)}')">Check In</button></div>
          </div>`)
        .join('');

    if (workItems.length > 0) {
      const totalVal = workItems.reduce((s, i) => s + i.price, 0);
      const overdue  = workItems.filter(i => i.isLate).length;
      summary.innerHTML = `
        <div class="wa-summary-item">
          <span class="wa-summary-label">Items:</span>
          <span class="wa-summary-value">${workItems.length}</span>
        </div>
        <div class="wa-summary-item">
          <span class="wa-summary-label">Total Value:</span>
          <span class="wa-summary-value">${fmt$(totalVal)}</span>
        </div>
        <div class="wa-summary-item">
          <span class="wa-summary-label">Overdue:</span>
          <span class="wa-summary-value" style="color:${overdue > 0 ? 'var(--red)' : 'var(--green)'}">${overdue}</span>
        </div>`;
      setStat('v-work-overdue', overdue);
    } else {
      summary.innerHTML = '';
    }

    // TrackIT-style work items panels
    _renderWorkItemsPanels(workItems);
  }

  function _renderWorkItemsPanels(workItems) {
    ['work-items-overview', 'work-items-wa'].forEach(cId => {
      const c = document.getElementById(cId);
      if (!c) return;
      if (!workItems.length) {
        c.innerHTML = '<div class="empty-state" style="font-size:13px;padding:20px;color:var(--muted)">Work area is empty.</div>';
        return;
      }
      c.innerHTML = workItems.map(item => {
        const barPct   = item.isLate ? 100 : item.timerPct;
        const barClass = item.isLate ? 'bar-red' : item.timerPct > 70 ? 'bar-amber' : 'bar-green';
        return `
          <div class="trackit-work-item ${item.isLate ? 'overdue' : ''}">
            <div>
              <div class="trackit-item-id">${esc(item.partNumber)}</div>
              <div class="trackit-item-desc">${esc(item.description)} · ${fmt$(item.price)}</div>
              <div class="trackit-timer-bar">
                <div class="trackit-timer-fill ${barClass}"
                     id="tbar-${esc(item.partNumber)}-${cId}"
                     style="width:${barPct}%"></div>
              </div>
            </div>
            <div class="trackit-timer ${item.isLate ? 'warn' : ''}"
                 id="ttimer-${esc(item.partNumber)}-${cId}">
              ${fmtTime(item.sLeft, item.isLate, item.minutes)}
            </div>
            <button class="trackit-checkin-btn"
                    onclick="App.openCheckinModal('${esc(item.partNumber)}')">CHECK IN</button>
          </div>`;
      }).join('');
    });
  }

  // ── CV Alerts ─────────────────────────────────────────────────
  function renderCVAlerts(alerts, searchQuery) {
    const q = (searchQuery || '').toLowerCase();
    let filtered = alerts;
    if (q) filtered = alerts.filter(a =>
      (a.location || '').toLowerCase().includes(q) ||
      (a.status   || '').toLowerCase().includes(q)
    );

    const total   = alerts.length;
    const missing = alerts.filter(a => a.status === 'MISSING').length;
    const present = alerts.filter(a => a.status === 'PRESENT').length;

    setStat('v-cv-total',    total);
    setStat('v-cv-missing',  missing);
    setStat('v-cv-present',  present);
    setStat('v-cv-filtered', filtered.length);
    setStat('v-alerts',      missing);

    const countEl = document.getElementById('alert-filter-count');
    if (countEl) countEl.textContent = q ? `${filtered.length} of ${total}` : '';

    _renderAlertList('alert-list-cv', filtered);
    _renderAlertList('alert-list-overview', alerts.slice(0, 8));
    _renderBreakdownTable(alerts);
    _updateNavBadge(missing);
  }

  function _renderAlertList(id, items) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!items.length) {
      el.innerHTML = '<div class="alert-empty">No alerts to display.</div>';
      return;
    }
    el.innerHTML = items.map(a => `
      <div class="alert-row">
        <span class="alert-ts">${esc((a.timestamp || '').substring(0, 19))}</span>
        <span class="alert-loc">${esc(a.location || '—')}</span>
        <span class="alert-status ${esc(a.status)}">${esc(a.status || '—')}</span>
      </div>`).join('');
  }

  function _renderBreakdownTable(alerts) {
    const byLoc = {};
    alerts.forEach(a => {
      const loc = a.location || 'Unknown';
      if (!byLoc[loc]) byLoc[loc] = { missing: 0, present: 0 };
      if (a.status === 'MISSING') byLoc[loc].missing++;
      else byLoc[loc].present++;
    });
    const tbody   = document.getElementById('alert-breakdown-body');
    if (!tbody) return;
    const entries = Object.entries(byLoc).sort((a, b) => b[1].missing - a[1].missing);
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:16px">No data.</td></tr>';
      return;
    }
    tbody.innerHTML = entries.map(([loc, c]) => `
      <tr>
        <td>${esc(loc)}</td>
        <td style="color:${c.missing > 0 ? 'var(--red)' : 'var(--muted)'};font-weight:${c.missing > 0 ? 700 : 400}">${c.missing}</td>
        <td style="color:var(--green)">${c.present}</td>
        <td style="color:var(--muted)">${c.missing + c.present}</td>
      </tr>`).join('');
  }

  function _updateNavBadge(count) {
    const badge = document.getElementById('nav-alert-badge');
    if (badge) {
      badge.textContent = count;
      badge.classList.toggle('visible', count > 0);
    }
  }

  // ── Locations panel (TrackIT style) ──────────────────────────
  function renderLocationPanel(sortMode) {
    const locs   = State.getLocations();
    let sorted = [...locs];
    if (sortMode === 'desc') sorted.sort((a, b) => {
      const pa = a.totalArea > 0 ? (a.totalArea - a.remainingArea) / a.totalArea : 0;
      const pb = b.totalArea > 0 ? (b.totalArea - b.remainingArea) / b.totalArea : 0;
      return pb - pa;
    });
    else if (sortMode === 'asc') sorted.sort((a, b) => {
      const pa = a.totalArea > 0 ? (a.totalArea - a.remainingArea) / a.totalArea : 0;
      const pb = b.totalArea > 0 ? (b.totalArea - b.remainingArea) / b.totalArea : 0;
      return pa - pb;
    });

    const high = locs.filter(l => {
      const pct = l.totalArea > 0 ? (l.totalArea - l.remainingArea) / l.totalArea * 100 : 0;
      return pct > 80;
    }).length;
    const low = locs.filter(l => {
      const pct = l.totalArea > 0 ? (l.totalArea - l.remainingArea) / l.totalArea * 100 : 0;
      return pct < 40;
    }).length;

    setStat('v-locs-loc',  locs.length);
    setStat('v-locs-high', high);
    setStat('v-locs-low',  low);

    const el = document.getElementById('loc-grid-main');
    if (!el) return;
    el.innerHTML = sorted.map(loc => {
      const used = loc.totalArea - loc.remainingArea;
      const pct  = loc.totalArea > 0 ? Math.min(100, Math.round(used / loc.totalArea * 100)) : 0;
      const cls  = pct > 80 ? 'high' : pct > 40 ? 'mid' : 'low';
      return `
        <div class="trackit-loc-card">
          <div class="trackit-loc-header">
            <div class="trackit-loc-name">LOC ${esc(loc.name)}</div>
            <div class="trackit-loc-pct ${cls}">${pct}%</div>
          </div>
          <div class="trackit-loc-detail">${used.toFixed(1)} / ${loc.totalArea.toFixed(1)} ft²</div>
          <div class="trackit-loc-bar-bg">
            <div class="trackit-loc-bar-fill ${cls}" style="width:${pct}%"></div>
          </div>
        </div>`;
    }).join('');
  }

  // ── History panel ─────────────────────────────────────────────
  function renderHistory() {
    const history = State.getHistory();
    const late    = history.filter(h => h.overdue).length;
    const ontime  = history.filter(h => !h.overdue).length;

    setStat('v-hist-total',  history.length);
    setStat('v-hist-late',   late);
    setStat('v-hist-ontime', ontime);

    const el = document.getElementById('history-list');
    if (!el) return;
    if (!history.length) {
      el.innerHTML = '<div class="alert-empty">No transactions this session.</div>';
      return;
    }
    el.innerHTML = history.map(h => `
      <div class="trackit-history-row">
        <span class="h-time">${esc(h.time)}</span>
        <span class="h-part">${esc(h.partNumber)}</span>
        <span class="h-desc" title="${esc(h.description)}">${esc(h.description)}</span>
        <span class="h-dur">${h.minutesElapsed}m elapsed</span>
        <span class="h-status ${h.overdue ? 'late' : 'on-time'}">${h.overdue ? 'LATE' : 'ON TIME'}</span>
      </div>`).join('');
  }

  // ── Move Modal ────────────────────────────────────────────────
  function populateMoveModal(item, tempLocs) {
    const sub = document.getElementById('moveModalSub');
    if (sub) sub.textContent = `${item.description} · ${fmtFt2(item.area)} ft² · ${fmt$(item.price)}`;

    const btn = document.getElementById('moveConfirmBtn');
    if (btn) btn.disabled = true;

    const listEl = document.getElementById('moveLocList');
    if (!listEl) return;
    listEl.innerHTML = tempLocs.map(loc => {
      const canFit = loc.remainingArea >= item.area;
      const isCurr = loc.id === item.locationIndex;
      return `
        <div class="modal-loc-row ${canFit ? '' : 'disabled'}"
             onclick="${canFit ? `App.selectMoveTarget(${loc.id})` : ''}">
          <span class="modal-loc-name">[${loc.id}] ${esc(loc.name)}${isCurr ? ' (current)' : ''}</span>
          <span class="modal-loc-space" style="color:${canFit ? 'var(--green)' : 'var(--red)'}">
            ${fmtFt2(loc.remainingArea)} ft² ${canFit ? '✓' : '✗'}
          </span>
        </div>`;
    }).join('');
  }

  // ── Checkin Modal ──────────────────────────────────────────────
  function populateCheckinModal(item) {
    const elapsed = Date.now() - item.workAreaCheckoutTime;
    const minutes = Math.floor(elapsed / 60000);
    const isLate  = elapsed > State.FIFTEEN_MINUTES_MS;
    const retLoc  = item.locationIndex !== -1
      ? State.getLocations()[item.locationIndex]?.name
      : 'NOT STORED';

    const sub = document.getElementById('checkinModalSub');
    if (sub) sub.textContent = `${item.description} · ${fmt$(item.price)}`;

    const info = document.getElementById('checkinTimingInfo');
    if (info) info.innerHTML = isLate
      ? `<div class="timing-box timing-late">
           <strong>⚠️ OVERDUE by ${minutes - 15} minute(s)</strong> (${minutes} min elapsed)<br>
           Will be returned to: <strong>${esc(retLoc)}</strong>
         </div>`
      : `<div class="timing-box timing-ok">
           ✓ <strong>On time</strong> — ${minutes} min elapsed, ${15 - minutes} min remaining<br>
           Will be returned to: <strong>${esc(retLoc)}</strong>
         </div>`;
  }

  // ── AI Modal ──────────────────────────────────────────────────
  function showAiThinking(item) {
    const sub = document.getElementById('aiModalSub');
    if (sub) sub.textContent = `${item.description} · ${fmtFt2(item.area)} ft² · ${fmt$(item.price)}`;
    document.getElementById('aiThinking')?.classList.add('show');
    const rc = document.getElementById('aiResultContent');
    if (rc) { rc.style.display = 'none'; rc.innerHTML = ''; }
  }

  function showAiResult(success, data) {
    document.getElementById('aiThinking')?.classList.remove('show');
    const rc = document.getElementById('aiResultContent');
    if (!rc) return;
    if (success) {
      rc.innerHTML = `
        <div class="ai-result-ok">
          <div class="ai-result-title">✓ AI placed item successfully</div>
          <div>Location: <strong>[${data.locIndex}] ${esc(data.locName)}</strong></div>
          <div style="margin-top:4px">Remaining space: <strong>${data.remaining.toFixed(2)} ft²</strong></div>
          <div class="ai-result-raw">Gemini response: "${esc(data.rawResponse.trim())}"</div>
        </div>`;
    } else {
      rc.innerHTML = `
        <div class="ai-result-err">
          <div class="ai-result-title">⚠️ AI could not find a suitable location</div>
          <div>${esc(data.reason || 'No valid location with enough space. Try manual placement.')}</div>
          ${data.rawResponse ? `<div class="ai-result-raw">Response: "${esc(data.rawResponse.trim())}"</div>` : ''}
        </div>`;
    }
    rc.style.display = 'block';
  }

  // ── Loader screen ─────────────────────────────────────────────
  function showLoader() {
    const loader = document.getElementById('loader');
    if (loader) loader.classList.remove('hidden');
  }

  function hideLoader() {
    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hidden');
  }

  function animateLoader() {
    const lines = [
      '> kernel init...',
      '> loading modules...',
      '> parsing CSV data...',
      '> initializing inventory...',
      '> cv subsystem ready...',
      '> READY',
    ];
    const el = document.getElementById('loader-lines');
    if (!el) return;
    lines.forEach((line, i) => {
      setTimeout(() => { el.innerHTML += line + '<br>'; }, i * 280);
    });
  }

  // ── Clock ──────────────────────────────────────────────────────
  function updateClock() {
    const now = new Date();
    const el  = document.getElementById('sidebar-clock');
    if (el) el.textContent =
      now.toLocaleTimeString('en-US', { hour12: false }) + ' · ' +
      now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  }

  // ── Connection status ──────────────────────────────────────────
  function setConnectionStatus(mode) {
    // mode: 'live' | 'offline' | 'local'
    const dot   = document.getElementById('conn-dot');
    const label = document.getElementById('conn-label');
    if (dot)   dot.dataset.status = mode;
    if (label) label.textContent  = mode === 'live' ? 'LIVE DATA' : mode === 'local' ? 'LOCAL MODE' : 'OFFLINE';
  }

  return {
    toast, openModal, closeModal, closeAllModals, setStat, fmt$, fmtFt2, fmtTime,
    renderDashboard, renderInventory, renderPlacement, renderWorkArea,
    renderCVAlerts, renderLocationPanel, renderHistory,
    populateMoveModal, populateCheckinModal,
    showAiThinking, showAiResult,
    toggleLocItems,
    showLoader, hideLoader, animateLoader,
    updateClock, setConnectionStatus,
  };
})();
