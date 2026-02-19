/**
 * trackit/js/app.js
 * Main application controller — orchestrates State, UI, GeminiService.
 * All onclick="App.xxx()" handlers live here.
 */

'use strict';

const App = (() => {

  // ── App state ─────────────────────────────────────────────────
  let _currentView    = 'dashboard';
  let _inventoryFilter = 'ALL';
  let _locSortMode    = 'default';
  let _moveTargetPN   = null;
  let _moveTargetLoc  = null;
  let _checkoutPN     = null;
  let _checkinPN      = null;
  let _aiTargetPN     = null;
  let _alertSearch    = '';
  let _inventorySearch = '';
  let _bulkRunning    = false;
  let _dataLoaded     = false;

  // ── Boot ───────────────────────────────────────────────────────
  async function boot() {
    UI.showLoader();
    UI.animateLoader();

    try {
      const { items, locations, alerts } = await DataLoader.loadAll();
      State.init(items, locations, alerts);
      _dataLoaded = true;
      UI.setConnectionStatus('local');
    } catch (e) {
      console.error('Data load failed:', e);
      UI.setConnectionStatus('offline');
      // Even if data load fails, app works with empty state
      State.init([], [], []);
      _dataLoaded = true;
    }

    // Render all views
    refreshAll();

    // Start timers
    setInterval(refreshTimers,  1000);
    setInterval(refreshAll,    10000);
    setInterval(UI.updateClock, 1000);
    UI.updateClock();

    // Keyboard shortcuts
    document.addEventListener('keydown', _handleKeydown);

    // Modal overlay close on backdrop click
    document.querySelectorAll('.modal-overlay').forEach(el =>
      el.addEventListener('click', e => {
        if (e.target === el) UI.closeAllModals();
      })
    );

    // Enter key for inputs
    document.getElementById('checkout-direct-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') directCheckout();
    });
    document.getElementById('checkin-direct-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') directCheckin();
    });
    document.getElementById('aiBarPN')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') aiPlaceByPN();
    });

    // Hide loader after boot animation
    setTimeout(() => UI.hideLoader(), 1700);

    // Show keyboard hint briefly
    setTimeout(() => {
      const hint = document.getElementById('shortcuts-hint');
      if (hint) {
        hint.classList.add('visible');
        setTimeout(() => hint.classList.remove('visible'), 3500);
      }
    }, 2000);
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────
  const VIEW_KEYS = ['dashboard','inventory','placement','workarea','cvalerts','locations','history'];
  function _handleKeydown(e) {
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
    const n = parseInt(e.key);
    if (n >= 1 && n <= VIEW_KEYS.length) showView(VIEW_KEYS[n - 1]);
    if (e.key === 'Escape') UI.closeAllModals();
    if (e.key === '?') {
      document.getElementById('shortcuts-hint')?.classList.toggle('visible');
    }
  }

  // ── View routing ───────────────────────────────────────────────
  function showView(name) {
    _currentView = name;

    // Update top nav tabs (WWT style)
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    const tabMap = { dashboard:0, inventory:1, placement:2, workarea:3, cvalerts:4, locations:5, history:6 };
    const tabs   = document.querySelectorAll('.nav-tab');
    if (tabMap[name] !== undefined && tabs[tabMap[name]]) {
      tabs[tabMap[name]].classList.add('active');
    }

    // Update sidebar nav items
    document.querySelectorAll('.sidebar-nav-item').forEach(t => t.classList.remove('active'));
    const sideItem = document.querySelector(`.sidebar-nav-item[data-view="${name}"]`);
    if (sideItem) sideItem.classList.add('active');

    // Switch panels
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const panel = document.getElementById(`view-${name}`);
    if (panel) {
      panel.classList.remove('active');
      void panel.offsetWidth; // force reflow for animation
      panel.classList.add('active');
    }

    // Close mobile sidebar
    document.querySelector('.sidebar')?.classList.remove('open');

    if (name === 'history') UI.renderHistory();
    refreshAll();
  }

  // ── Global refresh ─────────────────────────────────────────────
  function refreshAll() {
    if (!_dataLoaded) return;
    UI.renderDashboard();
    UI.renderInventory(_inventorySearch, _inventoryFilter);
    UI.renderPlacement();
    UI.renderWorkArea();
    UI.renderCVAlerts(State.getAllAlerts(), _alertSearch);
    UI.renderLocationPanel(_locSortMode);
    if (_currentView === 'history') UI.renderHistory();
  }

  function refreshTimers() {
    // Live-update timer displays without full re-render
    const workItems = State.getWorkAreaItems();
    workItems.forEach(item => {
      const pn = item.partNumber;
      // WWT work area view timer
      const waTimer = document.getElementById(`wa-timer-${pn}`);
      if (waTimer) {
        waTimer.textContent  = item.isLate ? `OVERDUE ${Math.abs(item.remaining)}m` : `${item.remaining}m left`;
        waTimer.className    = `wa-timer ${item.isLate ? 'timer-late' : 'timer-ok'}`;
      }
      const waTbar = document.getElementById(`wa-tbar-${pn}`);
      if (waTbar) {
        const barPct   = item.isLate ? 100 : item.timerPct;
        const barClass = item.isLate ? 'bar-red' : item.timerPct > 70 ? 'bar-amber' : 'bar-green';
        waTbar.style.width = `${barPct}%`;
        waTbar.className   = `timer-bar-fill ${barClass}`;
      }
      // Dashboard banner timer
      const dashTimer = document.getElementById(`dash-timer-${pn}`);
      if (dashTimer) {
        dashTimer.textContent = item.isLate ? `OVERDUE ${Math.abs(item.remaining)}m` : `${item.remaining}m left`;
        dashTimer.className   = `wa-timer ${item.isLate ? 'timer-late' : 'timer-ok'}`;
      }
      // TrackIT-style work item panels
      ['work-items-overview', 'work-items-wa'].forEach(cId => {
        const timerEl = document.getElementById(`ttimer-${pn}-${cId}`);
        if (timerEl) {
          timerEl.textContent = UI.fmtTime(item.sLeft, item.isLate, item.minutes);
          timerEl.className   = `trackit-timer ${item.isLate ? 'warn' : ''}`;
        }
        const tbarEl = document.getElementById(`tbar-${pn}-${cId}`);
        if (tbarEl) {
          const barPct   = item.isLate ? 100 : item.timerPct;
          const barClass = item.isLate ? 'bar-red' : item.timerPct > 70 ? 'bar-amber' : 'bar-green';
          tbarEl.style.width = `${barPct}%`;
          tbarEl.className   = `trackit-timer-fill ${barClass}`;
        }
      });
    });
  }

  // ── Inventory controls ──────────────────────────────────────────
  function setInventoryFilter(el, filter) {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    _inventoryFilter = filter;
    UI.renderInventory(_inventorySearch, _inventoryFilter);
  }

  function onInventorySearch() {
    _inventorySearch = document.getElementById('searchInput')?.value || '';
    UI.renderInventory(_inventorySearch, _inventoryFilter);
  }

  // ── OP 2: Move Item ────────────────────────────────────────────
  function openMoveModal(pn) {
    const item = State.findItem(pn);
    if (!item) return UI.toast('Item not found', 'error');
    if (State.isInWorkArea(item)) return UI.toast('Item is in work area — check it in first', 'error');

    _moveTargetPN  = pn;
    _moveTargetLoc = null;

    const tempLocs = State.getTempLocationsForItem(pn);
    UI.populateMoveModal(item, tempLocs);
    UI.openModal('moveModal');
  }

  function selectMoveTarget(locId) {
    _moveTargetLoc = locId;
    document.querySelectorAll('.modal-loc-row').forEach(r => r.classList.remove('selected'));
    const rows = document.querySelectorAll('#moveLocList .modal-loc-row');
    if (rows[locId]) rows[locId].classList.add('selected');
    const btn = document.getElementById('moveConfirmBtn');
    if (btn) btn.disabled = false;
  }

  function confirmMove() {
    if (!_moveTargetPN || _moveTargetLoc === null) return;
    try {
      const item = State.moveItem(_moveTargetPN, _moveTargetLoc);
      const loc  = State.getLocations()[_moveTargetLoc];
      UI.closeModal('moveModal');
      UI.toast(`✓ Moved ${_moveTargetPN} to ${loc?.name}`, 'success');
      refreshAll();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  }

  // ── OP 3: Check Out ────────────────────────────────────────────
  function openCheckoutModal(pn) {
    const item = State.findItem(pn);
    if (!item) return UI.toast('Item not found', 'error');
    if (State.isInWorkArea(item)) return UI.toast('Already in work area', 'error');
    if (item.locationIndex === -1) return UI.toast('Item must be in a storage location first', 'warning');

    _checkoutPN = pn;
    const loc   = State.getLocations()[item.locationIndex];
    const sub   = document.getElementById('checkoutModalSub');
    if (sub) sub.textContent = `${item.description} · ${UI.fmt$(item.price)} · from ${loc?.name || 'storage'}`;
    UI.openModal('checkoutModal');
  }

  function confirmCheckout() {
    try {
      const item = State.checkOut(_checkoutPN);
      UI.closeModal('checkoutModal');
      UI.toast(`⏱ ${item.partNumber} checked out — 15 min limit started`, 'warning');
      refreshAll();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  }

  // ── OP 3b: Direct checkout (Work Area panel form) ──────────────
  function directCheckout() {
    const input  = document.getElementById('checkout-direct-input');
    const result = document.getElementById('checkout-direct-result');
    const pn     = (input?.value || '').trim().toUpperCase();
    if (!pn) return;

    const item = State.findItem(pn);
    if (!item) {
      _setResult(result, `Part number "${pn}" not found.`, 'err');
      return;
    }
    if (State.isInWorkArea(item)) {
      _setResult(result, `${pn} is already in the work area.`, 'err');
      return;
    }
    if (item.locationIndex === -1) {
      _setResult(result, `${pn} is not in a storage location.`, 'warn');
      return;
    }

    // Show confirm modal
    _checkoutPN = pn;
    const loc = State.getLocations()[item.locationIndex];
    const sub = document.getElementById('checkoutModalSub');
    if (sub) sub.textContent = `${item.description} · ${UI.fmt$(item.price)} · from ${loc?.name || 'storage'}`;
    UI.openModal('checkoutModal');
    input.value = '';
  }

  // ── OP 4: Check In ─────────────────────────────────────────────
  function openCheckinModal(pn) {
    const item = State.findItem(pn);
    if (!item) return UI.toast('Item not found', 'error');
    if (!State.isInWorkArea(item)) return UI.toast('Item is not in work area', 'error');

    _checkinPN = pn;
    UI.populateCheckinModal(item);
    UI.openModal('checkinModal');
  }

  function confirmCheckin() {
    try {
      const { item, minutes, isLate, retLoc } = State.checkIn(_checkinPN);
      UI.closeModal('checkinModal');
      const msg = isLate
        ? `⚠️ Late return — ${minutes - 15}m overdue. Back to ${retLoc}`
        : `✓ Checked in on time (${minutes}m). Back to ${retLoc}`;
      UI.toast(msg, isLate ? 'warning' : 'success');
      refreshAll();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  }

  // ── OP 4b: Direct checkin (Work Area panel form) ───────────────
  function directCheckin() {
    const input  = document.getElementById('checkin-direct-input');
    const result = document.getElementById('checkin-direct-result');
    const pn     = (input?.value || '').trim().toUpperCase();
    if (!pn) return;

    const item = State.findItem(pn);
    if (!item) { _setResult(result, `Part number "${pn}" not found.`, 'err'); return; }
    if (!State.isInWorkArea(item)) { _setResult(result, `${pn} is not in the work area.`, 'err'); return; }

    try {
      const { minutes, isLate, retLoc } = State.checkIn(pn);
      const msg = isLate
        ? `${pn} checked in — ${minutes}m elapsed. LATE return.`
        : `${pn} checked in on time (${minutes}m). Returned to ${retLoc}.`;
      _setResult(result, msg, isLate ? 'warn' : 'ok');
      UI.toast(msg, isLate ? 'warning' : 'success');
      input.value = '';
      refreshAll();
    } catch (e) {
      _setResult(result, e.message, 'err');
    }
  }

  function _setResult(el, msg, type) {
    if (!el) return;
    el.textContent = msg;
    el.className   = `direct-result ${type}`;
    setTimeout(() => { el.textContent = ''; el.className = 'direct-result'; }, 5000);
  }

  // ── OP 6: AI ──────────────────────────────────────────────────
  function openAiModal(pn) {
    const item = State.findItem(pn);
    if (!item) return UI.toast('Item not found', 'error');
    if (State.isInWorkArea(item)) return UI.toast('Item is in work area — check it in first', 'error');

    _aiTargetPN = pn;
    UI.showAiThinking(item);
    UI.openModal('aiModal');
    _runGemini(pn);
  }

  async function _runGemini(pn) {
    const item     = State.findItem(pn);
    const tempLocs = State.getTempLocationsForItem(pn);
    try {
      const result = await GeminiService.chooseLocation(item, tempLocs);
      if (result.success) {
        State.applyAiPlacement(pn, result.locIndex);
        const loc = State.getLocations()[result.locIndex];
        UI.showAiResult(true, {
          locIndex:    result.locIndex,
          locName:     loc?.name || '?',
          remaining:   loc?.remainingArea || 0,
          rawResponse: result.rawResponse,
        });
        refreshAll();
      } else {
        UI.showAiResult(false, { reason: result.reason, rawResponse: result.rawResponse });
      }
    } catch (e) {
      UI.showAiResult(false, { reason: `API Error: ${e.message}`, rawResponse: '' });
    }
  }

  async function aiPlaceByPN() {
    const input = document.getElementById('aiBarPN');
    const pn    = (input?.value || '').trim();
    if (!pn) return UI.toast('Enter a part number', 'warning');
    if (!State.findItem(pn)) return UI.toast('Part number not found', 'error');
    if (input) input.value = '';
    openAiModal(pn);
  }

  async function bulkAiPack() {
    if (_bulkRunning) return UI.toast('Bulk pack already in progress...', 'warning');
    const unplaced = State.getItems().filter(i => i.locationIndex === -1 && !State.isInWorkArea(i));
    if (!unplaced.length) return UI.toast('All items are already placed', 'warning');

    if (!confirm(`AI will attempt to place ${unplaced.length} unassigned items using LAFF algorithm. This may take a moment. Continue?`)) return;

    _bulkRunning = true;
    UI.toast(`⚡ AI placing ${unplaced.length} items (LAFF)...`, 'success');

    try {
      const { placed, failed } = await GeminiService.bulkPack(
        unplaced,
        pn => State.getTempLocationsForItem(pn),
        (p, f, total) => {
          UI.toast(`⚡ AI packing... ${p + f} / ${total}`, 'success');
          refreshAll();
        }
      );
      UI.toast(`✓ Placed ${placed} · Could not place ${failed}`, placed > 0 ? 'success' : 'warning');
    } catch (e) {
      UI.toast(`Bulk pack error: ${e.message}`, 'error');
    }
    _bulkRunning = false;
    refreshAll();
  }

  // ── Export CSV ────────────────────────────────────────────────
  function exportCSV() {
    const csv  = State.exportCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url, download: `trackit_inventory_${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.toast('✓ Exported inventory CSV', 'success');
  }

  function exportAlerts() {
    const alerts = State.getAllAlerts();
    if (!alerts.length) return UI.toast('No alerts to export', 'warning');
    const rows   = [['Timestamp', 'Location', 'Status'], ...alerts.map(a => [a.timestamp, a.location, a.status])];
    const csv    = rows.map(r => r.join(',')).join('\n');
    const blob   = new Blob([csv], { type: 'text/csv' });
    const url    = URL.createObjectURL(blob);
    const a      = Object.assign(document.createElement('a'), {
      href: url, download: `trackit_alerts_${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.toast('✓ Exported alerts CSV', 'success');
  }

  // ── CV Alerts ─────────────────────────────────────────────────
  function onAlertSearch() {
    _alertSearch = document.getElementById('alert-search')?.value || '';
    UI.renderCVAlerts(State.getAllAlerts(), _alertSearch);
  }

  function clearAlertSearch() {
    const inp = document.getElementById('alert-search');
    if (inp) inp.value = '';
    _alertSearch = '';
    UI.renderCVAlerts(State.getAllAlerts(), '');
  }

  // Simulate a CV alert (for demo purposes when no CV system is running)
  function simulateCVAlert() {
    const locations = ['Storage Location 1', 'Storage Location 2', 'Bay A3', 'Shelf B7'];
    const statuses  = ['MISSING', 'MISSING', 'MISSING', 'PRESENT'];
    const loc       = locations[Math.floor(Math.random() * locations.length)];
    const status    = statuses[Math.floor(Math.random() * statuses.length)];
    State.addLiveAlert(loc, status);
    UI.toast(`📷 CV Alert: ${loc} — ${status}`, status === 'MISSING' ? 'warning' : 'success');
    UI.renderCVAlerts(State.getAllAlerts(), _alertSearch);
  }

  // ── Location panel ────────────────────────────────────────────
  function toggleLocSort() {
    const modes = ['default', 'desc', 'asc'];
    const idx   = modes.indexOf(_locSortMode);
    _locSortMode = modes[(idx + 1) % modes.length];
    const btn = document.getElementById('loc-sort-btn');
    if (btn) btn.textContent = `SORT: ${
      _locSortMode === 'default' ? 'DEFAULT' :
      _locSortMode === 'desc'    ? 'HIGHEST' : 'LOWEST'
    }`;
    UI.renderLocationPanel(_locSortMode);
  }

  // ── History ───────────────────────────────────────────────────
  function clearHistory() {
    if (!confirm('Clear all session history?')) return;
    State.clearHistory();
    UI.renderHistory();
    UI.toast('History cleared', 'success');
  }

  // ── Theme ─────────────────────────────────────────────────────
  function toggleTheme() {
    const html    = document.documentElement;
    const isDark  = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    const icon  = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');
    if (icon)  icon.textContent  = isDark ? '☾' : '☀';
    if (label) label.textContent = isDark ? 'DARK MODE' : 'LIGHT MODE';
    localStorage.setItem('trackit_theme', isDark ? 'light' : 'dark');
  }

  function loadTheme() {
    const saved = localStorage.getItem('trackit_theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
      const icon  = document.getElementById('theme-icon');
      const label = document.getElementById('theme-label');
      if (icon)  icon.textContent  = saved === 'dark' ? '☀' : '☾';
      if (label) label.textContent = saved === 'dark' ? 'LIGHT MODE' : 'DARK MODE';
    }
  }

  // ── Reset ─────────────────────────────────────────────────────
  function resetState() {
    if (!confirm('Reset all placement data? This will restore original CSV positions.')) return;
    State.resetToCSVState();
    location.reload();
  }

  // ── Mobile sidebar ────────────────────────────────────────────
  function toggleSidebar() {
    document.querySelector('.sidebar')?.classList.toggle('open');
  }

  return {
    boot, showView, refreshAll,
    // inventory
    setInventoryFilter, onInventorySearch,
    // WWT ops
    openMoveModal, selectMoveTarget, confirmMove,
    openCheckoutModal, confirmCheckout, directCheckout,
    openCheckinModal, confirmCheckin, directCheckin,
    openAiModal, aiPlaceByPN, bulkAiPack,
    exportCSV, exportAlerts,
    // CV
    onAlertSearch, clearAlertSearch, simulateCVAlert,
    // locations
    toggleLocSort,
    // history
    clearHistory,
    // theme
    toggleTheme, loadTheme,
    // misc
    resetState, toggleSidebar,
  };
})();

// ── Bootstrap ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  App.loadTheme();
  App.boot();
});
