/**
 * trackit/js/state.js
 * Warehouse state management — mirrors WWT7.java operations exactly.
 * Persists to localStorage for GitHub Pages (no server).
 */

'use strict';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const STORAGE_KEY = 'trackit_state_v2';
const HISTORY_KEY = 'trackit_history_v2';

const State = (() => {
  let _items     = [];
  let _locations = [];
  let _alerts    = [];       // from alerts-compvis.csv (read-only)
  let _liveAlerts = [];      // runtime-added alerts (simulate CV)
  let _history   = [];       // session checkin/checkout log
  let _workArea  = {};       // partNumber → {checkedOutAt, savedFromStorage (from server.js model)}

  // ── Persistence ────────────────────────────────────────────────

  function save() {
    try {
      // Only save mutable state (locationIndex, workAreaCheckoutTime)
      const snapshot = {
        items: _items.map(i => ({
          partNumber:            i.partNumber,
          locationIndex:         i.locationIndex,
          workAreaCheckoutTime:  i.workAreaCheckoutTime,
        })),
        liveAlerts: _liveAlerts,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(_history));
    } catch (e) { /* storage quota */ }
  }

  function loadPersistedState(baseItems) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const snapshot = JSON.parse(raw);
      if (!snapshot.items) return;

      const map = {};
      snapshot.items.forEach(s => { map[s.partNumber] = s; });

      baseItems.forEach(item => {
        if (map[item.partNumber]) {
          item.locationIndex        = map[item.partNumber].locationIndex;
          item.workAreaCheckoutTime = map[item.partNumber].workAreaCheckoutTime;
        }
      });
      _liveAlerts = snapshot.liveAlerts || [];
    } catch (e) { /* corrupt storage — start fresh */ }

    try {
      const rawH = localStorage.getItem(HISTORY_KEY);
      if (rawH) _history = JSON.parse(rawH);
    } catch (e) {}
  }

  // ── Init ───────────────────────────────────────────────────────

  function init(items, locations, alerts) {
    _locations = locations.map(l => ({ ...l }));
    _items     = items.map(i => ({ ...i }));
    _alerts    = alerts;

    // Restore persisted mutable state (overrides CSV-loaded locationIndex)
    // First recalculate remainingArea from scratch based on restored positions
    loadPersistedState(_items);
    _recomputeRemainingAreas();
  }

  function _recomputeRemainingAreas() {
    // Reset all remaining areas to total
    _locations.forEach(l => { l.remainingArea = l.totalArea; });
    // Re-subtract based on current item placements
    _items.forEach(item => {
      if (item.locationIndex >= 0 && item.locationIndex < _locations.length && !isInWorkArea(item)) {
        _locations[item.locationIndex].remainingArea -= item.area;
        if (_locations[item.locationIndex].remainingArea < 0) {
          _locations[item.locationIndex].remainingArea = 0;
        }
      }
    });
  }

  // ── Derived helpers — mirrors WWT7.java helpers ─────────────────

  function isInWorkArea(item) {
    return item.workAreaCheckoutTime > 0;
  }

  function getItemStatus(item) {
    if (isInWorkArea(item))          return 'IN_WORK_AREA';
    if (item.locationIndex !== -1)   return 'IN_STORAGE';
    return 'NOT_STORED';
  }

  function getLocationName(item) {
    if (isInWorkArea(item))         return 'WORK AREA';
    if (item.locationIndex === -1)  return 'NOT STORED';
    return _locations[item.locationIndex]?.name || '?';
  }

  function getStats() {
    const totalArea = _locations.reduce((s, l) => s + l.totalArea, 0);
    const usedArea  = _locations.reduce((s, l) => s + (l.totalArea - l.remainingArea), 0);
    const workItems = _items.filter(isInWorkArea);
    return {
      total:      _items.length,
      stored:     _items.filter(i => i.locationIndex !== -1 && !isInWorkArea(i)).length,
      unassigned: _items.filter(i => i.locationIndex === -1 && !isInWorkArea(i)).length,
      workArea:   workItems.length,
      totalValue: _items.reduce((s, i) => s + i.price, 0),
      workAreaValue: workItems.reduce((s, i) => s + i.price, 0),
      totalArea,
      usedArea,
      utilPct: totalArea > 0 ? Math.round(usedArea / totalArea * 100) : 0,
      locCount: _locations.length,
    };
  }

  // ── OP 2: Move Item — mirrors moveItem() ───────────────────────

  function moveItem(partNumber, newLocIndex) {
    const item = findItem(partNumber);
    if (!item)             throw new Error('Part number not found');
    if (isInWorkArea(item)) throw new Error('Item is in work area — check it in first');

    const newLoc = _locations[newLocIndex];
    if (!newLoc) throw new Error('Invalid location');

    // Temp-free current loc to compute accurate remaining space
    const tempRemaining = newLoc.remainingArea + (item.locationIndex === newLocIndex ? item.area : 0);
    const effectiveRemaining = item.locationIndex === newLocIndex
      ? tempRemaining
      : newLoc.remainingArea + (item.locationIndex >= 0 ? 0 : 0);

    // For a different destination: check space excluding item's own contribution
    const available = item.locationIndex === newLocIndex
      ? newLoc.remainingArea + item.area
      : newLoc.remainingArea;

    if (available < item.area) throw new Error('Not enough space in that location');

    // Return space to old location
    if (item.locationIndex >= 0 && item.locationIndex < _locations.length) {
      _locations[item.locationIndex].remainingArea += item.area;
    }
    // Assign new location
    item.locationIndex = newLocIndex;
    _locations[newLocIndex].remainingArea -= item.area;
    save();
    return item;
  }

  // ── OP 3: Check Out — mirrors checkOutToWorkArea() ────────────
  // Space is NOT freed (slot reserved for return) — key WWT7 behavior

  function checkOut(partNumber) {
    const item = findItem(partNumber);
    if (!item)              throw new Error('Part number not found');
    if (isInWorkArea(item)) throw new Error('Already in work area');
    if (item.locationIndex === -1) throw new Error('Item must be in a storage location first');

    item.workAreaCheckoutTime = Date.now();
    save();
    return item;
  }

  // ── OP 4: Check In — mirrors checkInFromWorkArea() ─────────────

  function checkIn(partNumber) {
    const item = findItem(partNumber);
    if (!item)               throw new Error('Part number not found');
    if (!isInWorkArea(item)) throw new Error('Item is not in work area');

    const elapsed  = Date.now() - item.workAreaCheckoutTime;
    const minutes  = Math.floor(elapsed / 60000);
    const isLate   = elapsed > FIFTEEN_MINUTES_MS;
    const retLoc   = item.locationIndex !== -1 ? _locations[item.locationIndex]?.name : 'NOT STORED';

    item.workAreaCheckoutTime = 0;

    // Log to history
    _history.unshift({
      time:           new Date().toLocaleTimeString('en-US', { hour12: false }),
      partNumber,
      description:    item.description,
      minutesElapsed: minutes,
      overdue:        isLate,
      returnedTo:     retLoc,
    });
    if (_history.length > 200) _history.pop();

    save();
    return { item, minutes, isLate, retLoc };
  }

  // ── OP 5: Work Area Status ─────────────────────────────────────

  function getWorkAreaItems() {
    const now = Date.now();
    return _items
      .filter(isInWorkArea)
      .map(item => {
        const elapsed   = now - item.workAreaCheckoutTime;
        const minutes   = Math.floor(elapsed / 60000);
        const seconds   = Math.floor(elapsed / 1000);
        const sLeft     = Math.max(0, 900 - seconds);
        const isLate    = elapsed > FIFTEEN_MINUTES_MS;
        const retLoc    = item.locationIndex !== -1 ? _locations[item.locationIndex]?.name : 'NOT STORED';
        return {
          ...item,
          elapsed, minutes, seconds, sLeft, isLate,
          remaining: 15 - minutes,
          retLoc,
          timerPct: Math.min(100, (seconds / 900) * 100),
        };
      });
  }

  // ── OP 6: AI placement helpers ─────────────────────────────────

  /** Return temp-freed location list for AI prompt (mirrors Java pre-AI temp-free). */
  function getTempLocationsForItem(partNumber) {
    const item = findItem(partNumber);
    if (!item) return _locations.map(l => ({ ...l }));
    const tempLocs = _locations.map(l => ({ ...l }));
    if (item.locationIndex >= 0) {
      tempLocs[item.locationIndex].remainingArea += item.area;
    }
    return tempLocs;
  }

  /** Apply AI placement result */
  function applyAiPlacement(partNumber, locIndex) {
    const item = findItem(partNumber);
    if (!item) throw new Error('Item not found');
    const loc = _locations[locIndex];
    if (!loc) throw new Error('Invalid location index');

    const tempLocs = getTempLocationsForItem(partNumber);
    if (tempLocs[locIndex].remainingArea < item.area) {
      throw new Error('Not enough space');
    }

    // Free old slot
    if (item.locationIndex >= 0) {
      _locations[item.locationIndex].remainingArea += item.area;
    }
    item.locationIndex = locIndex;
    _locations[locIndex].remainingArea -= item.area;
    save();
    return item;
  }

  // ── CV Alert management ────────────────────────────────────────

  function addLiveAlert(location, status) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
    _liveAlerts.unshift({ timestamp, location, status });
    if (_liveAlerts.length > 500) _liveAlerts.pop();
    save();
  }

  function getAllAlerts() {
    // Live alerts (simulated from UI) at top, then historical CSV alerts
    return [..._liveAlerts, ..._alerts];
  }

  // ── History ───────────────────────────────────────────────────

  function getHistory() { return _history; }
  function clearHistory() { _history = []; save(); }

  // ── Getters ───────────────────────────────────────────────────

  function getItems()        { return _items; }
  function getLocations()    { return _locations; }
  function getAlerts()       { return _alerts; }
  function findItem(pn)      { return _items.find(i => i.partNumber === pn) || null; }

  // ── Export CSV — mirrors WWT7.java save block ──────────────────

  function exportCSV() {
    const header = 'PartNumber,Description,Area (ft^2),Price,Location,Status';
    const rows = _items.map(item => {
      const st  = isInWorkArea(item) ? 'IN WORK AREA' : 'IN STORAGE';
      const loc = isInWorkArea(item) ? 'WORK AREA'
                : item.locationIndex !== -1 ? (_locations[item.locationIndex]?.name || 'UNKNOWN')
                : 'NOT STORED';
      return [
        item.partNumber,
        `"${item.description.replace(/"/g, '""')}"`,
        item.area,
        item.price,
        loc,
        st,
      ].join(',');
    });
    return [header, ...rows].join('\n');
  }

  function resetToCSVState() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(HISTORY_KEY);
    _history = [];
    _liveAlerts = [];
  }

  return {
    init, save,
    isInWorkArea, getItemStatus, getLocationName,
    getStats, getItems, getLocations, getAlerts, getAllAlerts, findItem,
    moveItem, checkOut, checkIn,
    getWorkAreaItems, getTempLocationsForItem, applyAiPlacement,
    addLiveAlert, getHistory, clearHistory, exportCSV, resetToCSVState,
    FIFTEEN_MINUTES_MS,
  };
})();
