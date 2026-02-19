/**
 * trackit/js/gemini.js
 * Gemini AI integration — mirrors WWT7.java geminiChooseLocation() exactly.
 * Handles single-item placement and bulk LAFF packing.
 */

'use strict';

const GeminiService = (() => {
  const API_KEY  = 'AIzaSyDPd44Nt5IsOT0XVmm5zroyHXNnpO0wS-g';
  const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${API_KEY}`;

  // ── Build Prompt — mirrors Java prompt exactly ─────────────────

  function buildPrompt(item, tempLocs) {
    const locInfo = tempLocs
      .map((l, i) => `Location ${i}: ${l.name} (remaining ${l.remainingArea.toFixed(2)} ft²)`)
      .join('\n');

    return `You are a warehouse management AI. Choose the BEST storage location for this item.
Part Number: ${item.partNumber}.
Description: ${item.description}.
Item requires: ${item.area} square feet of space.
Available locations:
${locInfo}
RULES:
(1) Choose a location with enough remaining space.
(2) Prefer locations with less wasted space (best-fit).
(3) Respond with ONLY the location number (0-${tempLocs.length - 1}). Do not include any other text.`;
  }

  // ── Raw API call ───────────────────────────────────────────────

  async function callAPI(prompt) {
    const res = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  // ── Parse response — mirrors Java: content.replaceAll("\\D+", "") ─

  function parseResponse(content, maxIndex) {
    const cleaned = content.replace(/\D+/g, '');
    const num = parseInt(cleaned, 10);
    if (isNaN(num) || num < 0 || num > maxIndex) return null;
    return num;
  }

  // ── Single-item placement — mirrors geminiChooseLocation() ─────

  async function chooseLocation(item, tempLocs) {
    const prompt  = buildPrompt(item, tempLocs);
    const content = await callAPI(prompt);
    const num     = parseResponse(content, tempLocs.length - 1);

    if (num === null) {
      return { success: false, rawResponse: content, reason: 'Invalid response from AI' };
    }

    // Client-side safety validation (mirrors Java check)
    if (tempLocs[num].remainingArea < item.area) {
      return {
        success: false,
        rawResponse: content,
        reason: `Location ${num} has insufficient space (${tempLocs[num].remainingArea.toFixed(2)} ft² < ${item.area} ft² required)`,
      };
    }

    return { success: true, locIndex: num, rawResponse: content };
  }

  // ── Bulk LAFF pack — mirrors bulkAiPack() ────────────────────
  // Sorts descending by area (LAFF), then AI-places each item.
  // Calls onProgress(placed, failed, total) during operation.

  async function bulkPack(unplacedItems, getLocsFn, onProgress) {
    // LAFF sort: largest area first
    const sorted = [...unplacedItems].sort((a, b) => b.area - a.area);
    let placed = 0, failed = 0;

    for (const item of sorted) {
      const tempLocs = getLocsFn(item.partNumber);
      try {
        const result = await chooseLocation(item, tempLocs);
        if (result.success) {
          State.applyAiPlacement(item.partNumber, result.locIndex);
          placed++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
      if (onProgress) onProgress(placed, failed, sorted.length);
      // Throttle to avoid rate limits
      await new Promise(r => setTimeout(r, 250));
    }

    return { placed, failed, total: sorted.length };
  }

  return { chooseLocation, bulkPack, buildPrompt };
})();
