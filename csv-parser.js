/**
 * trackit/js/csv-parser.js
 * Lightweight CSV parser + data loader for GitHub Pages (no server required)
 */

'use strict';

const CSVParser = (() => {

  function parse(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (!lines.length) return [];
    const headers = parseRow(lines[0]);
    const results = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const values = parseRow(line);
      if (!values.length) continue;
      const obj = {};
      headers.forEach((h, idx) => { obj[h.trim()] = (values[idx] || '').trim(); });
      results.push(obj);
    }
    return results;
  }

  /** Parse a CSV that has NO header row — returns string[][] */
  function parseRaw(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map(l => parseRow(l));
  }

  function parseRow(line) {
    const result = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        result.push(cur); cur = '';
      } else { cur += ch; }
    }
    result.push(cur);
    return result;
  }

  async function load(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return parse(await res.text());
    } catch (e) {
      console.warn('[CSVParser] Could not load ' + path + ': ' + e.message);
      return [];
    }
  }

  async function loadRaw(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return parseRaw(await res.text());
    } catch (e) {
      console.warn('[CSVParser] Could not load ' + path + ': ' + e.message);
      return [];
    }
  }

  return { parse, parseRaw, load, loadRaw };
})();


const DataLoader = (() => {

  async function loadAll() {
    // alerts-compvis.csv has NO header — use loadRaw
    const [rawItems, rawLocations, alertRows, rawInventory] = await Promise.all([
      CSVParser.load('data/items_with_area.csv'),
      CSVParser.load('data/locations_with_areas.csv'),
      CSVParser.loadRaw('data/alerts-compvis.csv'),
      CSVParser.load('data/inventory.csv'),
    ]);

    // Locations: "Location","Area (ft^2)"
    const locations = rawLocations
      .filter(r => r['Location'] && r['Area (ft^2)'])
      .map((r, i) => ({
        id: i,
        name: r['Location'].trim(),
        totalArea: parseFloat(r['Area (ft^2)']) || 0,
        remainingArea: parseFloat(r['Area (ft^2)']) || 0,
      }));

    const locByName = {};
    locations.forEach(l => { locByName[l.name] = l.id; });

    // Inventory map: PartNumber -> LOCATION string
    const inventoryMap = {};
    rawInventory.forEach(r => {
      const pn = (r['PartNumber'] || '').trim();
      if (pn) inventoryMap[pn] = (r['LOCATION'] || '').trim();
    });

    // Items: "PartNumber","Description","Area (ft^2)","Price"
    const items = rawItems
      .filter(r => r['PartNumber'] && r['Area (ft^2)'])
      .map((r, i) => {
        const pn  = r['PartNumber'].trim();
        const loc = inventoryMap[pn] || '';
        return {
          id: i,
          partNumber:           pn,
          description:          (r['Description'] || '').trim(),
          area:                 parseFloat(r['Area (ft^2)']) || 0,
          price:                parseInt(r['Price'], 10)     || 0,
          locationIndex:        (loc && locByName[loc] !== undefined) ? locByName[loc] : -1,
          workAreaCheckoutTime: 0,
        };
      });

    // Recompute remaining areas
    items.forEach(item => {
      if (item.locationIndex >= 0 && locations[item.locationIndex]) {
        locations[item.locationIndex].remainingArea -= item.area;
        if (locations[item.locationIndex].remainingArea < 0)
          locations[item.locationIndex].remainingArea = 0;
      }
    });

    // Alerts: headerless CSV — col0=timestamp, col1=location, col2=status
    const alerts = alertRows
      .filter(cols => cols.length >= 3 && cols[1] && cols[2])
      .map(cols => ({
        timestamp: cols[0].trim(),
        location:  cols[1].trim(),
        status:    cols[2].trim().replace(/\r/g, ''),
      }))
      .filter(a => a.status === 'MISSING' || a.status === 'PRESENT');

    return { items, locations, alerts };
  }

  return { loadAll };
})();
