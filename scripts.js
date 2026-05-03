'use strict';

/* ═══════════════════════════════════════════════════
   FILE LOADING
═══════════════════════════════════════════════════ */

let wifData = null;
let cellSize = 12;

// Editable thread colors (1-indexed, initialized from WIF on each file load)
let editableWarpColors = null;
let editableWeftColors = null;

// Painting state
let selectedColor    = null;
let isPainting       = false;
let paintingCanvas   = null;
let eyedropperActive = false;

// Undo history: array of { warp, weft } color snapshots
const colorHistory = [];

// Cached render state for hit-testing during painting
let paintDraft   = null;
let paintLblSize = 0;

// When true, renderDraft uses a white background (for PDF export)
let printMode = false;

const dropZone  = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');

browseBtn.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', e => { if (e.target !== browseBtn) fileInput.click(); });
fileInput.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });

dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('over');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      wifData = parseWIF(e.target.result);
      document.getElementById('fileName').textContent = file.name;
      document.getElementById('fileSize').textContent = `(${(file.size/1024).toFixed(1)} KB)`;
      document.getElementById('uploadArea').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      document.getElementById('errorBox').style.display = 'none';
      editableWarpColors = null; // will be seeded from WIF on first renderDraft
      editableWeftColors = null;
      colorHistory.length = 0;
      buildMeta();
      document.getElementById('paletteSection').style.display = 'block';
      // Auto-fit: pick the largest cell size that makes the full draft width
      // fit the current viewport, then let the user adjust from there.
      const autoCs = computeAutoFitCellSize();
      cellSize = autoCs;
      const range = document.getElementById('cellSizeRange');
      range.min   = 2;                        // allow finer zoom-out than default
      range.max   = Math.max(32, autoCs);     // extend upper end if draft is narrow
      range.value = autoCs;
      document.getElementById('cellSizeLbl').textContent = autoCs + 'px';
      renderDraft();
    } catch (err) {
      showError(err.message);
    }
  };
  reader.readAsText(file);
}

function resetApp() {
  wifData = null;
  editableWarpColors = null;
  editableWeftColors = null;
  selectedColor = null;
  paintDraft = null;
  colorHistory.length = 0;
  eyedropperActive = false;
  fileInput.value = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('uploadArea').style.display = 'flex';
  document.getElementById('notesSection').style.display = 'none';
  document.getElementById('paletteSection').style.display = 'none';
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
  const eyeBtn = document.getElementById('eyedropperBtn');
  if (eyeBtn) eyeBtn.classList.remove('active');
}

function showError(msg) {
  const el = document.getElementById('errorBox');
  el.textContent = '⚠ ' + msg;
  el.style.display = 'block';
}

/* ═══════════════════════════════════════════════════
   WIF PARSER
═══════════════════════════════════════════════════ */

function parseWIF(text) {
  const sections = Object.create(null);
  let current = null;

  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) continue;
    if (line[0] === ';') continue;       // full-line comment

    if (line[0] === '[') {
      const end = line.indexOf(']');
      if (end > 0) {
        current = line.slice(1, end).trim().toUpperCase();
        if (!sections[current]) sections[current] = Object.create(null);
      }
      continue;
    }

    if (current !== null) {
      const eq = line.indexOf('=');
      if (eq >= 0) {
        const k = line.slice(0, eq).trim().toUpperCase();
        const v = line.slice(eq + 1).trim();
        // First occurrence wins (spec says no duplicates)
        if (!(k in sections[current])) {
          sections[current][k] = v;
        }
      }
    }
  }

  if (!sections['WIF']) {
    throw new Error('Not a valid WIF file — no [WIF] section found. Make sure you\'re opening a .wif file.');
  }

  return sections;
}

/* ═══════════════════════════════════════════════════
   VALUE HELPERS
═══════════════════════════════════════════════════ */

function stripComment(v) {
  // Remove trailing ; comment from numeric/boolean values
  if (!v) return '';
  const i = v.indexOf(';');
  return i >= 0 ? v.slice(0, i).trim() : v.trim();
}

function parseBool(v) {
  if (v === undefined || v === null) return false;
  const s = stripComment(v).toLowerCase();
  return s === 'true' || s === 'yes' || s === 'on' || s === '1';
}

function parseIntVal(v) {
  if (v === undefined || v === null) return NaN;
  return parseInt(stripComment(v), 10);
}

function parseIntList(v) {
  if (!v) return [];
  return stripComment(v)
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));
}

function getSection(name) {
  return (wifData && wifData[name.toUpperCase()]) || Object.create(null);
}

function getKey(section, key) {
  const s = getSection(section);
  return s[key.toUpperCase()];
}

/* ═══════════════════════════════════════════════════
   DRAFT DATA EXTRACTION
═══════════════════════════════════════════════════ */

function extractDraft() {
  const weaving = getSection('WEAVING');
  const warp    = getSection('WARP');
  const weft    = getSection('WEFT');

  const shafts   = parseIntVal(weaving['SHAFTS'])   || 4;
  const treadles = parseIntVal(weaving['TREADLES']) || 4;
  const risingShed = parseBool(weaving['RISING SHED']);

  let warpThreads = parseIntVal(warp['THREADS']) || 0;
  let weftThreads = parseIntVal(weft['THREADS']) || 0;

  // ── Color table ──────────────────────────────────
  const colorPalSec = getSection('COLOR PALETTE');
  const rangeList   = colorPalSec['RANGE'] ? parseIntList(colorPalSec['RANGE']) : [0, 255];
  const rangeFrom   = rangeList[0] ?? 0;
  const rangeTo     = rangeList[1] ?? 255;
  const rangeSpan   = rangeTo - rangeFrom;
  const scale       = rangeSpan > 0 ? 255 / rangeSpan : 1;

  const colorTableSec = getSection('COLOR TABLE');
  const colorTable = Object.create(null); // index → css string

  for (const [k, v] of Object.entries(colorTableSec)) {
    const idx = parseInt(k, 10);
    if (isNaN(idx)) continue;
    const rgb = parseIntList(v);
    if (rgb.length >= 3) {
      const r = Math.round((rgb[0] - rangeFrom) * scale);
      const g = Math.round((rgb[1] - rangeFrom) * scale);
      const b = Math.round((rgb[2] - rangeFrom) * scale);
      colorTable[idx] = `rgb(${r},${g},${b})`;
    }
  }

  // Default colors from WARP / WEFT sections
  // Color= can be "PaletteIdx" or "PaletteIdx,R,G,B"
  function resolveDefaultColor(sectionName, fallback) {
    const sec = getSection(sectionName);
    const v = sec['COLOR'];
    if (!v) return fallback;
    const parts = parseIntList(v);
    if (parts.length === 0) return fallback;
    // First value is palette index
    return colorTable[parts[0]] || fallback;
  }

  const warpDefaultColor = resolveDefaultColor('WARP', '#ffffff');
  const weftDefaultColor = resolveDefaultColor('WEFT', '#2c2c2c');

  // ── Per-thread colors ─────────────────────────────
  function buildThreadColors(count, colorsSec, defaultColor) {
    const out = new Array(count + 1); // 1-indexed
    for (let i = 1; i <= count; i++) {
      const v = colorsSec[String(i)];
      if (v) {
        const idx = parseIntList(v)[0];
        out[i] = (idx && colorTable[idx]) ? colorTable[idx] : defaultColor;
      } else {
        out[i] = defaultColor;
      }
    }
    return out;
  }

  // ── Threading ─────────────────────────────────────
  // thread index (1-based) → array of shaft numbers
  const threadingSec = getSection('THREADING');
  const threading = Object.create(null);
  for (const [k, v] of Object.entries(threadingSec)) {
    const idx = parseInt(k, 10);
    if (!isNaN(idx)) threading[idx] = parseIntList(v);
  }

  // ── Tieup ─────────────────────────────────────────
  // treadle index → array of shaft numbers
  const tieupSec = getSection('TIEUP');
  const tieup = Object.create(null);
  for (const [k, v] of Object.entries(tieupSec)) {
    const idx = parseInt(k, 10);
    if (!isNaN(idx)) tieup[idx] = parseIntList(v);
  }

  // ── Treadling ─────────────────────────────────────
  // weft pick index → array of treadle numbers
  const treadlingSec = getSection('TREADLING');
  const treadling = Object.create(null);
  for (const [k, v] of Object.entries(treadlingSec)) {
    const idx = parseInt(k, 10);
    if (!isNaN(idx)) treadling[idx] = parseIntList(v);
  }

  // ── Liftplan ──────────────────────────────────────
  // weft pick index → array of shaft numbers (raised)
  const liftplanSec = getSection('LIFTPLAN');
  const liftplan = Object.create(null);
  let hasLiftplan = false;
  for (const [k, v] of Object.entries(liftplanSec)) {
    const idx = parseInt(k, 10);
    if (!isNaN(idx)) { liftplan[idx] = parseIntList(v); hasLiftplan = true; }
  }

  // ── Infer thread counts if WARP/WEFT Threads= was absent ────────────────
  if (warpThreads === 0) {
    const keys = Object.keys(threadingSec).map(k => parseInt(k, 10)).filter(n => !isNaN(n));
    if (keys.length) warpThreads = Math.max(...keys);
  }
  if (weftThreads === 0) {
    const tKeys = Object.keys(treadlingSec).map(k => parseInt(k, 10)).filter(n => !isNaN(n));
    const lKeys = Object.keys(liftplanSec).map(k => parseInt(k, 10)).filter(n => !isNaN(n));
    const allKeys = [...tKeys, ...lKeys];
    if (allKeys.length) weftThreads = Math.max(...allKeys);
  }

  const warpColors = buildThreadColors(warpThreads, getSection('WARP COLORS'), warpDefaultColor);
  const weftColors = buildThreadColors(weftThreads, getSection('WEFT COLORS'), weftDefaultColor);

  // ── Raised shafts per pick ────────────────────────
  function getRaisedShafts(pickIdx) {
    if (hasLiftplan) {
      return new Set(liftplan[pickIdx] || []);
    }
    const trs = treadling[pickIdx] || [];
    const s = new Set();
    for (const tr of trs) {
      for (const sh of (tieup[tr] || [])) s.add(sh);
    }
    return s;
  }

  return {
    shafts, treadles, risingShed,
    warpThreads, weftThreads,
    colorTable, rangeFrom, rangeTo,
    threading, tieup, treadling, liftplan,
    hasLiftplan,
    warpColors, weftColors,
    warpDefaultColor, weftDefaultColor,
    getRaisedShafts,
  };
}

/* ═══════════════════════════════════════════════════
   METADATA PANEL
═══════════════════════════════════════════════════ */

function buildMeta() {
  const textSec    = getSection('TEXT');
  const weavingSec = getSection('WEAVING');
  const warpSec    = getSection('WARP');
  const weftSec    = getSection('WEFT');
  const wifSec     = getSection('WIF');

  const rawTitle = textSec['TITLE'];
  const title = rawTitle ? rawTitle.replace(/\/\//g, ' / ') : rawTitle;

  const fields = [
    ['Title',       title],
    ['Author',      textSec['AUTHOR']],
    ['Email',       textSec['EMAIL']],
    ['Software',    wifSec['SOURCE PROGRAM']],
    ['Shafts',      weavingSec['SHAFTS']    ? parseIntVal(weavingSec['SHAFTS'])    : null],
    ['Treadles',    weavingSec['TREADLES']  ? parseIntVal(weavingSec['TREADLES'])  : null],
    ['Warp ends',   warpSec['THREADS']      ? parseIntVal(warpSec['THREADS'])      : null],
    ['Weft picks',  weftSec['THREADS']      ? parseIntVal(weftSec['THREADS'])      : null],
    ['Rising shed', weavingSec['RISING SHED'] !== undefined
                      ? (parseBool(weavingSec['RISING SHED']) ? 'Yes' : 'No') : null],
  ];

  const cardsHtml = fields
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([l, v]) => `
      <div class="info-card">
        <div class="lbl">${l}</div>
        <div class="val">${escHtml(String(v))}</div>
      </div>`)
    .join('');

  document.getElementById('metaSection').innerHTML =
    `<div class="section-label">Draft Information</div>
     <div class="info-grid">${cardsHtml}</div>`;

  // Notes
  const notesSec = getSection('NOTES');
  const noteKeys = Object.keys(notesSec)
    .map(k => parseInt(k, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (noteKeys.length) {
    const txt = noteKeys.map(k => notesSec[String(k)]).join('\n');
    document.getElementById('notesContent').textContent = txt;
    document.getElementById('notesSection').style.display = 'block';
  }

  // Color swatches
  const colorPalSec   = getSection('COLOR PALETTE');
  const rangeList     = colorPalSec['RANGE'] ? parseIntList(colorPalSec['RANGE']) : [0, 255];
  const swRangeFrom   = rangeList[0] ?? 0;
  const swRangeTo     = rangeList[1] ?? 255;
  const swSpan        = swRangeTo - swRangeFrom;
  const sc            = swSpan > 0 ? 255 / swSpan : 1;
  const colorTableSec = getSection('COLOR TABLE');
  const idxs = Object.keys(colorTableSec).map(k => parseInt(k, 10))
    .filter(n => !isNaN(n)).sort((a, b) => a - b);

  if (idxs.length) {
    const html = idxs.map(idx => {
      const rgb = parseIntList(colorTableSec[String(idx)]);
      if (rgb.length < 3) return '';
      const r = Math.round((rgb[0] - swRangeFrom) * sc);
      const g = Math.round((rgb[1] - swRangeFrom) * sc);
      const b = Math.round((rgb[2] - swRangeFrom) * sc);
      const hex = toHex(r, g, b);
      return `<div class="swatch" style="background:${hex}" title="#${idx} ${hex}" data-color="${hex}" onclick="selectPaletteColor(this)"></div>`;
    }).join('');
    document.getElementById('swatches').innerHTML = html;
  }
}

/* ═══════════════════════════════════════════════════
   DRAFT RENDERING
═══════════════════════════════════════════════════ */

function changeCellSize(v) {
  cellSize = v;
  document.getElementById('cellSizeLbl').textContent = v + 'px';
  renderDraft();
}

// Compute the largest integer cell size that fits the full draft width inside
// the viewport.  Called once on file load so the draft fills the window by
// default; the user can then adjust with the slider.
function computeAutoFitCellSize() {
  if (!wifData) return 12;
  const d         = extractDraft();
  const totalCols = d.warpThreads + (d.hasLiftplan ? 0 : d.treadles);
  if (totalCols === 0) return 12;

  // clientWidth excludes the scrollbar; subtract the fixed horizontal
  // padding of #app (24 px × 2) and .draft-scroll (20 px × 2).
  const available = document.documentElement.clientWidth - 88;

  // First pass ignoring the shaft-label strip, then refine once.
  let cs       = Math.floor(available / totalCols);
  const lblSize = cs >= 8 ? Math.max(16, cs) : 0;
  cs            = Math.floor((available - lblSize) / totalCols);

  return Math.max(2, cs);
}

function renderDraft() {
  if (!wifData) return;

  const d         = extractDraft();
  const cs        = cellSize;
  const showGrid  = document.getElementById('showGrid').checked;
  const showLbls  = document.getElementById('showLabels').checked;

  const W = d.warpThreads;
  const E = d.weftThreads;
  const S = d.shafts;
  const T = d.hasLiftplan ? 0 : d.treadles;

  // Label column/row size
  const lblSize = (showLbls && cs >= 8) ? Math.max(16, cs) : 0;

  // Seed editable colors once per file load; preserve across re-renders
  if (!editableWarpColors) {
    editableWarpColors = d.warpColors.slice();
    editableWeftColors = d.weftColors.slice();
  }
  // Cache state for hit-testing during painting
  paintDraft   = d;
  paintLblSize = lblSize;

  // Canvas pixel dimensions (including optional label strips)
  // Threading: (W cols + label col) × S rows + label row
  // The label col for shaft numbers sits on the left; label row on top for thread numbers (optional at small sizes)
  const threadingW = W * cs + (lblSize > 0 ? lblSize : 0);
  const threadingH = S * cs;
  const tieupW     = T > 0 ? (T * cs)  : 0;
  const tieupH     = S * cs;
  const drawdownW  = W * cs + (lblSize > 0 ? lblSize : 0);
  const drawdownH  = E * cs;
  const treadlingW = T > 0 ? (T * cs)  : 0;
  const treadlingH = E * cs;

  // Show/hide tieup+treadling panels when using liftplan
  document.getElementById('tieupWrap').style.display     = T > 0 ? '' : 'none';
  document.getElementById('treadlingWrap').style.display = T > 0 ? '' : 'none';

  // Helper: size a canvas
  function prep(id, w, h) {
    const c = document.getElementById(id);
    c.width  = Math.max(w, 1);
    c.height = Math.max(h, 1);
    c.style.width  = c.width  + 'px';
    c.style.height = c.height + 'px';
    return c.getContext('2d');
  }

  const tCtx = prep('cThreading', threadingW, threadingH);
  const uCtx = prep('cTieup',     tieupW,     tieupH);
  const dCtx = prep('cDrawdown',  drawdownW,  drawdownH);
  const rCtx = prep('cTreadling', treadlingW, treadlingH);
  syncOverlaySize('cThreading');
  syncOverlaySize('cDrawdown');
  syncOverlaySize('cTreadling');

  // Theme colors — swap to light palette when rendering for print
  const BG        = printMode ? '#ffffff'            : '#0c0d14';
  const GRID_COL  = printMode ? 'rgba(0,0,0,0.12)'  : 'rgba(255,255,255,0.1)';
  const MARK_COL  = '#e05c6e';
  const LBL_COL   = printMode ? 'rgba(50,50,70,0.7)': 'rgba(180,185,210,0.55)';
  const EMPTY     = BG;

  function clearCanvas(ctx, w, h) {
    ctx.fillStyle = EMPTY;
    ctx.fillRect(0, 0, w, h);
  }

  function drawGridLines(ctx, cols, rows, xOff, yOff) {
    ctx.save();
    ctx.strokeStyle = GRID_COL;
    ctx.lineWidth   = 0.5;
    for (let c = 0; c <= cols; c++) {
      const x = xOff + c * cs + 0.5;
      ctx.beginPath(); ctx.moveTo(x, yOff); ctx.lineTo(x, yOff + rows * cs); ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      const y = yOff + r * cs + 0.5;
      ctx.beginPath(); ctx.moveTo(xOff, y); ctx.lineTo(xOff + cols * cs, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawShaftLabels(ctx, shaftCount, xOff, yOff) {
    if (lblSize <= 0) return;
    ctx.save();
    ctx.fillStyle = LBL_COL;
    const fs = Math.min(cs - 2, 10);
    ctx.font = `${fs}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let s = 1; s <= shaftCount; s++) {
      const row = shaftCount - s;
      ctx.fillText(s, xOff - 3, yOff + row * cs + cs / 2);
    }
    ctx.restore();
  }

  function drawTreadleLabels(ctx, treadleCount, xOff, yOff) {
    if (lblSize <= 0) return;
    ctx.save();
    ctx.fillStyle = LBL_COL;
    const fs = Math.min(cs - 2, 9);
    ctx.font = `${fs}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 1; t <= treadleCount; t++) {
      ctx.fillText(t, xOff + (t - 1) * cs + cs / 2, yOff + 1);
    }
    ctx.restore();
  }

  // ── THREADING ──────────────────────────────────────────
  clearCanvas(tCtx, threadingW, threadingH);
  const txOff = lblSize; // X offset for the actual grid (shaft labels on left)

  for (let wi = 1; wi <= W; wi++) {
    const shafts = d.threading[wi] || [];
    const col    = wi - 1;
    const x      = txOff + col * cs;
    const [wr, wg, wb] = parseRGB(editableWarpColors[wi] || '#ffffff');
    for (const sh of shafts) {
      if (sh < 1 || sh > S) continue;
      const row = S - sh;
      const y   = row * cs;
      const cx  = x + cs / 2, cy = y + cs / 2, rad = cs * 0.42;
      // Filled circle with radial gradient to look like thread cross-section
      const rg = tCtx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, 0, cx, cy, rad);
      const c = v => Math.min(255, Math.max(0, Math.round(v)));
      rg.addColorStop(0,   `rgb(${c(wr*1.6)},${c(wg*1.6)},${c(wb*1.6)})`);
      rg.addColorStop(0.5, `rgb(${wr},${wg},${wb})`);
      rg.addColorStop(1,   `rgb(${c(wr*.35)},${c(wg*.35)},${c(wb*.35)})`);
      tCtx.beginPath();
      tCtx.arc(cx, cy, rad, 0, Math.PI * 2);
      tCtx.fillStyle = rg;
      tCtx.fill();
    }
  }
  if (showGrid) drawGridLines(tCtx, W, S, txOff, 0);
  drawShaftLabels(tCtx, S, txOff, 0);

  // ── TIEUP ──────────────────────────────────────────────
  if (T > 0) {
    clearCanvas(uCtx, tieupW, tieupH);
    for (let tr = 1; tr <= T; tr++) {
      const shafts = d.tieup[tr] || [];
      const col    = tr - 1;
      for (const sh of shafts) {
        if (sh < 1 || sh > S) continue;
        const row = S - sh;
        uCtx.fillStyle = MARK_COL;
        uCtx.fillRect(col * cs, row * cs, cs, cs);
      }
    }
    if (showGrid) drawGridLines(uCtx, T, S, 0, 0);
  }

  // ── DRAWDOWN ───────────────────────────────────────────
  clearCanvas(dCtx, drawdownW, drawdownH);

  // Pre-compute warp-on-top for every cell (Uint8Array for speed)
  const wotGrid = new Array(E + 1);
  for (let pick = 1; pick <= E; pick++) {
    const rs = d.getRaisedShafts(pick);
    wotGrid[pick] = new Uint8Array(W + 1);
    for (let wi = 1; wi <= W; wi++) {
      const ws = d.threading[wi] || [];
      const hasShaft = ws.length > 0 && !(ws.length === 1 && ws[0] === 0);
      if (hasShaft && rs.size > 0) {
        wotGrid[pick][wi] = d.risingShed
          ? (ws.some(sh => rs.has(sh)) ? 1 : 0)
          : (ws.some(sh => rs.has(sh)) ? 0 : 1);
      }
    }
  }

  // Pass A — warp threads (vertical): horizontal cylindrical gradient per column
  for (let wi = 1; wi <= W; wi++) {
    const x = txOff + (wi - 1) * cs;
    const [r, g, b] = parseRGB(editableWarpColors[wi] || d.warpDefaultColor);
    dCtx.fillStyle = threadGrad(dCtx, x, 0, x + cs, 0, r, g, b);
    for (let pick = 1; pick <= E; pick++) {
      if (wotGrid[pick][wi]) dCtx.fillRect(x, (pick - 1) * cs, cs, cs);
    }
  }

  // Pass B — weft threads (horizontal): vertical cylindrical gradient per row
  for (let pick = 1; pick <= E; pick++) {
    const y = (pick - 1) * cs;
    const [r, g, b] = parseRGB(editableWeftColors[pick] || d.weftDefaultColor);
    dCtx.fillStyle = threadGrad(dCtx, 0, y, 0, y + cs, r, g, b);
    for (let wi = 1; wi <= W; wi++) {
      if (!wotGrid[pick][wi]) dCtx.fillRect(txOff + (wi - 1) * cs, y, cs, cs);
    }
  }

  // Pass C — interlacing crimp shadows (skip at very small cell sizes)
  if (cs >= 5) {
    const sh = Math.max(2, Math.floor(cs * 0.36));

    // Warp column shadows: where warp thread dips under a weft thread
    for (let wi = 1; wi <= W; wi++) {
      const x = txOff + (wi - 1) * cs;
      for (let pick = 1; pick <= E; pick++) {
        if (!wotGrid[pick][wi]) continue;
        const y = (pick - 1) * cs;
        // Top edge shadow — weft was on top in previous pick
        if (pick === 1 || !wotGrid[pick - 1][wi]) {
          const sg = dCtx.createLinearGradient(0, y, 0, y + sh);
          sg.addColorStop(0, 'rgba(0,0,0,0.52)');
          sg.addColorStop(1, 'rgba(0,0,0,0)');
          dCtx.fillStyle = sg;
          dCtx.fillRect(x, y, cs, sh);
        }
        // Bottom edge shadow — weft is on top in next pick
        if (pick === E || !wotGrid[pick + 1][wi]) {
          const sg = dCtx.createLinearGradient(0, y + cs - sh, 0, y + cs);
          sg.addColorStop(0, 'rgba(0,0,0,0)');
          sg.addColorStop(1, 'rgba(0,0,0,0.52)');
          dCtx.fillStyle = sg;
          dCtx.fillRect(x, y + cs - sh, cs, sh);
        }
      }
    }

    // Weft row shadows: where weft thread dips under a warp thread
    for (let pick = 1; pick <= E; pick++) {
      const y = (pick - 1) * cs;
      for (let wi = 1; wi <= W; wi++) {
        if (wotGrid[pick][wi]) continue;
        const x = txOff + (wi - 1) * cs;
        // Left edge shadow — warp was on top in previous column
        if (wi === 1 || wotGrid[pick][wi - 1]) {
          const sg = dCtx.createLinearGradient(x, 0, x + sh, 0);
          sg.addColorStop(0, 'rgba(0,0,0,0.52)');
          sg.addColorStop(1, 'rgba(0,0,0,0)');
          dCtx.fillStyle = sg;
          dCtx.fillRect(x, y, sh, cs);
        }
        // Right edge shadow — warp is on top in next column
        if (wi === W || wotGrid[pick][wi + 1]) {
          const sg = dCtx.createLinearGradient(x + cs - sh, 0, x + cs, 0);
          sg.addColorStop(0, 'rgba(0,0,0,0)');
          sg.addColorStop(1, 'rgba(0,0,0,0.52)');
          dCtx.fillStyle = sg;
          dCtx.fillRect(x + cs - sh, y, sh, cs);
        }
      }
    }
  }

  if (showGrid) drawGridLines(dCtx, W, E, txOff, 0);

  // ── TREADLING ──────────────────────────────────────────
  if (T > 0) {
    clearCanvas(rCtx, treadlingW, treadlingH);

    for (let pick = 1; pick <= E; pick++) {
      const treadles = d.treadling[pick] || [];
      const weftColor = editableWeftColors[pick] || d.weftDefaultColor;
      const row       = pick - 1;
      for (const tr of treadles) {
        if (tr < 1 || tr > T) continue;
        const col = tr - 1;
        rCtx.fillStyle = weftColor;
        rCtx.fillRect(col * cs, row * cs, cs, cs);
      }
    }
    if (showGrid) drawGridLines(rCtx, T, E, 0, 0);
  }

  // Drawdown left label: use it for weft pick numbers in lieu of a weft color bar
  // Clear and redraw left label strip in drawdown with pick numbers
  if (lblSize > 0) {
    dCtx.save();
    dCtx.fillStyle = LBL_COL;
    const fs = Math.min(cs - 2, 9);
    dCtx.font = `${fs}px sans-serif`;
    dCtx.textAlign = 'right';
    dCtx.textBaseline = 'middle';
    for (let pick = 1; pick <= E; pick++) {
      const row = pick - 1;
      if (pick % Math.max(1, Math.floor(20 / cs)) === 0) {
        dCtx.fillText(pick, txOff - 3, row * cs + cs / 2);
      }
    }
    dCtx.restore();

  }
}

/* ═══════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════ */

function parseRGB(c) {
  if (!c) return [180, 180, 180];
  if (c[0] === '#') {
    return [
      parseInt(c.slice(1, 3), 16),
      parseInt(c.slice(3, 5), 16),
      parseInt(c.slice(5, 7), 16),
    ];
  }
  const m = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  return m ? [+m[1], +m[2], +m[3]] : [180, 180, 180];
}

// Build a cylindrical thread gradient along the given axis.
// For warp (vertical thread): gradient runs left→right (x1≠x2, y1=y2=0).
// For weft (horizontal thread): gradient runs top→bottom (x1=x2=0, y1≠y2).
function threadGrad(ctx, x1, y1, x2, y2, r, g, b) {
  const g_ = ctx.createLinearGradient(x1, y1, x2, y2);
  const c = v => Math.min(255, Math.max(0, Math.round(v)));
  g_.addColorStop(0,    `rgb(${c(r*.42)},${c(g*.42)},${c(b*.42)})`);
  g_.addColorStop(0.28, `rgb(${c(r*.78)},${c(g*.78)},${c(b*.78)})`);
  g_.addColorStop(0.5,  `rgb(${c(r*1.5)},${c(g*1.5)},${c(b*1.5)})`);
  g_.addColorStop(0.72, `rgb(${c(r*.78)},${c(g*.78)},${c(b*.78)})`);
  g_.addColorStop(1,    `rgb(${c(r*.42)},${c(g*.42)},${c(b*.42)})`);
  return g_;
}

function toHex(r, g, b) {
  return '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0');
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ═══════════════════════════════════════════════════
   WIF EXPORT
═══════════════════════════════════════════════════ */

function serializeWIF() {
  if (!wifData || !editableWarpColors || !editableWeftColors) return null;

  const d = extractDraft();

  // ── Build a fresh colour palette from the edited thread colours ────────
  const colorMap  = new Map(); // '#rrggbb' → 1-based palette index
  const colorList = [];        // [[r,g,b], …] in palette order

  function addColor(css) {
    const [r, g, b] = parseRGB(css);
    const key = toHex(r, g, b);
    if (!colorMap.has(key)) {
      colorList.push([r, g, b]);
      colorMap.set(key, colorList.length); // 1-based
    }
    return colorMap.get(key);
  }

  // Collect every thread colour so the palette is complete before we write
  const warpPalIdx = new Array(d.warpThreads + 1);
  for (let i = 1; i <= d.warpThreads; i++)
    warpPalIdx[i] = addColor(editableWarpColors[i] || d.warpDefaultColor);

  const weftPalIdx = new Array(d.weftThreads + 1);
  for (let i = 1; i <= d.weftThreads; i++)
    weftPalIdx[i] = addColor(editableWeftColors[i] || d.weftDefaultColor);

  // ── Deep-copy all parsed sections so we don't mutate the live data ──────
  const secs = {};
  for (const [name, keys] of Object.entries(wifData)) secs[name] = { ...keys };

  // ── Overwrite the four colour sections ────────────────────────────────
  secs['COLOR PALETTE'] = { ENTRIES: String(colorList.length), FORM: 'RGB', RANGE: '0,255' };

  const ct = {};
  colorList.forEach(([r, g, b], i) => { ct[String(i + 1)] = `${r},${g},${b}`; });
  secs['COLOR TABLE'] = ct;

  const wcSec = {};
  for (let i = 1; i <= d.warpThreads; i++) wcSec[String(i)] = String(warpPalIdx[i]);
  secs['WARP COLORS'] = wcSec;

  const wfcSec = {};
  for (let i = 1; i <= d.weftThreads; i++) wfcSec[String(i)] = String(weftPalIdx[i]);
  secs['WEFT COLORS'] = wfcSec;

  // Update the default-colour pointer in [WARP] and [WEFT] if those keys exist
  if (secs['WARP'] && d.warpThreads > 0) secs['WARP']['COLOR'] = String(warpPalIdx[1]);
  if (secs['WEFT'] && d.weftThreads > 0) secs['WEFT']['COLOR'] = String(weftPalIdx[1]);

  // If there is a [CONTENTS] section, make sure the colour sections are listed
  if (secs['CONTENTS']) {
    secs['CONTENTS']['COLOR PALETTE'] = 'true';
    secs['CONTENTS']['COLOR TABLE']   = 'true';
    secs['CONTENTS']['WARP COLORS']   = 'true';
    secs['CONTENTS']['WEFT COLORS']   = 'true';
  }

  // ── Serialise sections in canonical WIF order ─────────────────────────
  const ORDER = [
    'WIF', 'CONTENTS', 'TEXT', 'WEAVING',
    'WARP', 'WEFT',
    'COLOR PALETTE', 'COLOR TABLE',
    'WARP COLORS', 'WEFT COLORS',
    'THREADING', 'TIEUP', 'TREADLING', 'LIFTPLAN',
    'NOTES',
  ];

  let out = '';
  const written = new Set();

  function writeSection(name) {
    const data = secs[name];
    if (!data || Object.keys(data).length === 0) return;
    out += `[${name}]\r\n`;
    for (const [k, v] of Object.entries(data)) out += `${k}=${v}\r\n`;
    out += '\r\n';
    written.add(name);
  }

  for (const name of ORDER) writeSection(name);
  for (const name of Object.keys(secs)) { if (!written.has(name)) writeSection(name); }

  return out;
}

function exportWIF() {
  if (!wifData || !editableWarpColors) return;
  const text = serializeWIF();
  if (!text) return;
  const base = (document.getElementById('fileName').textContent || 'draft')
    .replace(/\.wif$/i, '');
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = base + '_edited.wif';
  a.click();
  URL.revokeObjectURL(url);
}

function showPDFLayoutDialog(numColPages, numRowPages) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#1c1e2b;border:1px solid #2e3048;border-radius:12px;padding:1.75rem 2rem;max-width:400px;width:90%;font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#dde1f5;';
    box.innerHTML = `
      <h3 style="margin:0 0 0.4rem;font-size:1rem;font-weight:700;color:#e05c6e;">Draft too wide for one page</h3>
      <p style="margin:0 0 1.25rem;font-size:0.82rem;color:#7a7f9a;line-height:1.5;">The full warp doesn’t fit on a single landscape A4 page at the smallest cell size. How would you like to export?</p>
      <div style="display:flex;flex-direction:column;gap:0.6rem;margin-bottom:1.25rem;">
        <button id="dlgFit" style="text-align:left;background:transparent;border:1px solid #2e3048;border-radius:8px;padding:0.75rem 1rem;cursor:pointer;color:inherit;">
          <div style="font-weight:600;font-size:0.88rem;margin-bottom:0.15rem;">Fit to page</div>
          <div style="font-size:0.75rem;color:#7a7f9a;">Show as many complete warp repeats as fit; drop the rest.</div>
        </button>
        <button id="dlgGrid" style="text-align:left;background:transparent;border:1px solid #2e3048;border-radius:8px;padding:0.75rem 1rem;cursor:pointer;color:inherit;">
          <div style="font-weight:600;font-size:0.88rem;margin-bottom:0.15rem;">Grid layout <span style="color:#7b8cde;">${numColPages}×${numRowPages} sheets</span></div>
          <div style="font-size:0.75rem;color:#7a7f9a;">Tile the complete draft across ${numColPages * numRowPages} pages to print and piece together.</div>
        </button>
      </div>
      <button id="dlgCancel" style="background:none;border:none;color:#7a7f9a;font-size:0.8rem;cursor:pointer;padding:0;">Cancel</button>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const done = choice => { document.body.removeChild(overlay); resolve(choice); };
    box.querySelector('#dlgFit').addEventListener('click',    () => done('fit'));
    box.querySelector('#dlgGrid').addEventListener('click',   () => done('grid'));
    box.querySelector('#dlgCancel').addEventListener('click', () => done('cancel'));
    overlay.addEventListener('click', e => { if (e.target === overlay) done('cancel'); });
  });
}

async function exportPDF() {
  if (!wifData) return;

  const d    = paintDraft || extractDraft();
  const hasT = !d.hasLiftplan && d.treadles > 0;
  const T    = hasT ? d.treadles : 0;

  function sortedStr(arr) { return (arr || []).slice().sort((a, b) => a - b).join(','); }
  function findRepeat(getData, count) {
    const limit = Math.min(count, 512);
    for (let p = 1; p <= Math.floor(limit / 2); p++) {
      let ok = true;
      for (let i = 1; i + p <= limit; i++) {
        if (sortedStr(getData(i)) !== sortedStr(getData(i + p))) { ok = false; break; }
      }
      if (ok) return p;
    }
    return count;
  }

  const warpRepeat = findRepeat(i => d.threading[i], d.warpThreads);

  const PAGE_W   = 1009;
  const MIN_CS   = 4;
  const showLbls = document.getElementById('showLabels').checked;

  function csForWarp(warpCols) {
    const total = warpCols + T;
    if (total === 0) return MIN_CS;
    const rough = Math.floor(PAGE_W / total);
    const lbl   = (showLbls && rough >= 8) ? Math.max(16, rough) : 0;
    return Math.max(1, Math.floor((PAGE_W - lbl) / total));
  }

  // ── Prompt when draft is too wide for a single page ───────────────────────
  let useGrid = false;
  if (csForWarp(d.warpThreads) < MIN_CS) {
    const PX_PER_MM_D   = 96 / 25.4;
    const GRID_OVERHEAD = 14; // mm: sheet label + rule + panel-label rows
    const warpPerPageG  = Math.max(1, Math.floor((PAGE_W - T * MIN_CS) / MIN_CS));
    const numColPages   = Math.ceil(d.warpThreads / warpPerPageG);
    const tHG           = Math.max(1, d.shafts || 0) * MIN_CS;
    const availBodyMmG  = 210 - 15 - 15 - GRID_OVERHEAD - tHG / PX_PER_MM_D;
    const rowsPerPageG  = Math.max(1, Math.floor(availBodyMmG / (MIN_CS / PX_PER_MM_D)));
    const numRowPages   = Math.ceil(d.weftThreads / rowsPerPageG);

    const choice = await showPDFLayoutDialog(numColPages, numRowPages);
    if (choice === 'cancel') return;
    useGrid = choice === 'grid';
  }

  // ── Display dimensions ────────────────────────────────────────────────────
  let displayWarp = d.warpThreads;
  let clippedWarp = false;

  if (!useGrid && csForWarp(displayWarp) < MIN_CS) {
    clippedWarp = true;
    const lblEst  = (showLbls && MIN_CS >= 8) ? Math.max(16, MIN_CS) : 0;
    const budget  = PAGE_W - T * MIN_CS - lblEst;
    const maxRpts = Math.max(1, Math.floor(budget / (warpRepeat * MIN_CS)));
    displayWarp   = maxRpts * warpRepeat;
  }

  const displayWeft = d.weftThreads;
  const cs      = useGrid ? MIN_CS : Math.max(MIN_CS, csForWarp(displayWarp));
  const lblSize = (showLbls && cs >= 8) ? Math.max(16, cs) : 0;

  // ── Render at the computed cell size with a white background, then crop ───
  const origCs = cellSize;
  cellSize  = cs;
  printMode = true;
  renderDraft();

  const captureWarp = useGrid ? d.warpThreads : displayWarp;
  const captureWeft = useGrid ? d.weftThreads : displayWeft;
  const warpPx = captureWarp * cs;
  const weftPx = captureWeft * cs;

  function cropCanvas(el, x0, y0, w, h) {
    const dst = document.createElement('canvas');
    dst.width  = Math.max(1, Math.min(w, el.width  - x0));
    dst.height = Math.max(1, Math.min(h, el.height - y0));
    dst.getContext('2d').drawImage(el, x0, y0, dst.width, dst.height, 0, 0, dst.width, dst.height);
    return dst;
  }

  const elThread  = document.getElementById('cThreading');
  const elDraw    = document.getElementById('cDrawdown');
  const capThread = cropCanvas(elThread, 0, 0, lblSize + warpPx, elThread.height);
  const capDraw   = cropCanvas(elDraw,   0, 0, lblSize + warpPx, weftPx);
  let capTieup = null, capTread = null;
  if (hasT) {
    const elTieup = document.getElementById('cTieup');
    const elTread = document.getElementById('cTreadling');
    capTieup = cropCanvas(elTieup, 0, 0, elTieup.width, elTieup.height);
    capTread = cropCanvas(elTread, 0, 0, elTread.width, weftPx);
  }

  const tW = capThread.width;
  const tH = capThread.height;
  const uW = capTieup ? capTieup.width : 0;
  const rW = capTread ? capTread.width : 0;

  printMode = false;
  cellSize  = origCs;
  renderDraft();

  if (!window.jspdf) { showError('PDF export requires the jsPDF library (needs internet connection on first load).'); return; }

  // ── Shared metadata ───────────────────────────────────────────────────────
  const filename   = document.getElementById('fileName').textContent;
  const base       = filename.replace(/\.wif$/i, '');
  const textSec    = getSection('TEXT');
  const weavingSec = getSection('WEAVING');
  const warpSec    = getSection('WARP');
  const weftSec    = getSection('WEFT');
  const meta = [
    ['Title',       textSec['TITLE'] ? textSec['TITLE'].replace(/\/\//g, ' / ') : textSec['TITLE']],
    ['Author',      textSec['AUTHOR']],
    ['Shafts',      weavingSec['SHAFTS']   ? String(parseIntVal(weavingSec['SHAFTS']))   : null],
    ['Treadles',    weavingSec['TREADLES'] ? String(parseIntVal(weavingSec['TREADLES'])) : null],
    ['Warp ends',   warpSec['THREADS']     ? String(parseIntVal(warpSec['THREADS']))     : null],
    ['Weft picks',  weftSec['THREADS']     ? String(parseIntVal(weftSec['THREADS']))     : null],
    ['Rising shed', weavingSec['RISING SHED'] !== undefined
                      ? (parseBool(weavingSec['RISING SHED']) ? 'Yes' : 'No') : null],
  ].filter(([, v]) => v != null && v !== '');

  const colorSet = new Set();
  const addC = css => { if (css) { const [r, g, b] = parseRGB(css); colorSet.add(toHex(r, g, b)); } };
  if (editableWarpColors) for (let i = 1; i < editableWarpColors.length; i++) addC(editableWarpColors[i]);
  if (editableWeftColors) for (let i = 1; i < editableWeftColors.length; i++) addC(editableWeftColors[i]);

  const notesEl   = document.getElementById('notesSection');
  const hasNotes  = notesEl.style.display !== 'none';
  const notesText = hasNotes ? document.getElementById('notesContent').textContent : '';

  const { jsPDF } = window.jspdf;
  const ML = 15, CW = 267, PAGE_H = 210, BMARGIN = 15;
  const PX_PER_MM = 96 / 25.4;

  if (useGrid) {
    // ═══════════════════════════════════════════════════════════════════════
    // GRID LAYOUT — tile the full draft across numColPages × numRowPages sheets.
    // cs = MIN_CS = 4, lblSize = 0 (cs < 8 ⟹ no label strips rendered).
    // ═══════════════════════════════════════════════════════════════════════
    const GRID_OVERHEAD = 14; // mm: sheet-label row (5) + rule (3) + panel-label row (3) + gap (3)
    const warpPerPage   = Math.max(1, Math.floor((PAGE_W - T * cs) / cs));
    const numColPages   = Math.ceil(captureWarp / warpPerPage);
    const headerMmG     = tH / PX_PER_MM;
    const availBodyMmG  = PAGE_H - BMARGIN - ML - GRID_OVERHEAD - headerMmG;
    const rowsPerPage   = Math.max(1, Math.floor(availBodyMmG / (cs / PX_PER_MM)));
    const numRowPages   = Math.ceil(captureWeft / rowsPerPage);

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    let firstPage = true;

    for (let rp = 0; rp < numRowPages; rp++) {
      const weftStart   = rp * rowsPerPage;
      const weftRows    = Math.min(rowsPerPage, captureWeft - weftStart);
      const weftPxSlice = weftRows * cs;

      for (let cp = 0; cp < numColPages; cp++) {
        if (!firstPage) doc.addPage();
        firstPage = false;

        const warpStart      = cp * warpPerPage;
        const warpCols       = Math.min(warpPerPage, captureWarp - warpStart);
        const warpPxSlice    = warpCols * cs;
        const isRightmostCol = cp === numColPages - 1;
        const pageImgPx      = warpPxSlice + (isRightmostCol ? uW : 0);
        const pageImgScale   = Math.min(1, CW / (pageImgPx / PX_PER_MM));
        const imgWmm         = (pageImgPx / PX_PER_MM) * pageImgScale;

        let y = ML;

        // Sheet identifier
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(224, 92, 110);
        doc.text(`Sheet ${cp + 1}/${numColPages} × ${rp + 1}/${numRowPages}`, ML, y);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(130);
        doc.text(filename, ML + CW, y, { align: 'right' });
        y += 5;
        doc.setDrawColor(210); doc.setLineWidth(0.2);
        doc.line(ML, y, ML + CW, y);
        y += 3;

        // Panel labels
        const tWmm_g = (warpPxSlice / PX_PER_MM) * pageImgScale;
        const uWmm_g = (isRightmostCol && uW > 0) ? (uW / PX_PER_MM) * pageImgScale : 0;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(130);
        doc.text('Threading', ML + tWmm_g / 2, y, { align: 'center' });
        if (hasT && isRightmostCol) doc.text('Tie-up', ML + tWmm_g + uWmm_g / 2, y, { align: 'center' });
        y += 3;

        // Header: threading slice + tieup (tieup only on rightmost column page)
        const hCvs = document.createElement('canvas');
        hCvs.width  = pageImgPx;
        hCvs.height = tH;
        const hCtx = hCvs.getContext('2d');
        hCtx.fillStyle = '#ffffff'; hCtx.fillRect(0, 0, hCvs.width, hCvs.height);
        hCtx.drawImage(capThread, warpStart * cs, 0, warpPxSlice, tH, 0, 0, warpPxSlice, tH);
        if (hasT && isRightmostCol) hCtx.drawImage(capTieup, 0, 0, uW, tH, warpPxSlice, 0, uW, tH);
        const hMm = (tH / PX_PER_MM) * pageImgScale;
        doc.addImage(hCvs, 'PNG', ML, y, imgWmm, hMm);
        y += hMm;

        // Body: drawdown slice + treadling (treadling only on rightmost column page)
        const bCvs = document.createElement('canvas');
        bCvs.width  = pageImgPx;
        bCvs.height = weftPxSlice;
        const bCtx = bCvs.getContext('2d');
        bCtx.fillStyle = '#ffffff'; bCtx.fillRect(0, 0, bCvs.width, bCvs.height);
        bCtx.drawImage(capDraw, warpStart * cs, weftStart * cs, warpPxSlice, weftPxSlice,
                       0, 0, warpPxSlice, weftPxSlice);
        if (hasT && isRightmostCol) bCtx.drawImage(capTread, 0, weftStart * cs, rW, weftPxSlice,
                       warpPxSlice, 0, rW, weftPxSlice);
        const bMm = (weftPxSlice / PX_PER_MM) * pageImgScale;
        doc.addImage(bCvs, 'PNG', ML, y, imgWmm, bMm);
      }
    }

    // ── Final info page ───────────────────────────────────────────────────────
    doc.addPage();
    let y = ML;
    const newPageG = needed => { if (y + needed > PAGE_H - BMARGIN) { doc.addPage(); y = ML; } };
    const sectionRuleG = label => {
      newPageG(8);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150);
      doc.text(label, ML, y);
      doc.setDrawColor(210); doc.setLineWidth(0.2);
      doc.line(ML, y + 1.5, ML + CW, y + 1.5);
      y += 6; doc.setTextColor(30);
    };

    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(30);
    doc.text('Weaving Draft', ML, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
    doc.text(filename, ML, y); y += 4;
    doc.setFontSize(7.5); doc.setTextColor(150);
    doc.text(`Grid export: ${numColPages} column × ${numRowPages} row sheets at ${cs} px cell size.`, ML, y);
    y += 6;

    if (meta.length) {
      sectionRuleG('DRAFT INFORMATION');
      const CARD_W = 32, CARD_H = 12;
      let cx = ML;
      for (const [l, v] of meta) {
        newPageG(CARD_H);
        doc.setFontSize(6.5); doc.setTextColor(140); doc.text(l.toUpperCase(), cx, y);
        doc.setFontSize(9);   doc.setTextColor(30);  doc.text(String(v), cx, y + 4.5);
        cx += CARD_W;
        if (cx + CARD_W > ML + CW) { cx = ML; y += CARD_H; }
      }
      y += (cx > ML ? CARD_H : 0) + 3;
    }
    if (colorSet.size) {
      sectionRuleG('COLOR PALETTE');
      const SW = 6, GAP = 2.5;
      let px = ML;
      for (const hex of colorSet) {
        newPageG(SW + 4);
        const [r, g, b] = parseRGB(hex);
        doc.setFillColor(r, g, b); doc.setDrawColor(200); doc.setLineWidth(0.2);
        doc.roundedRect(px, y, SW, SW, 0.8, 0.8, 'FD');
        px += SW + GAP;
        if (px + SW > ML + CW) { px = ML; y += SW + GAP; }
      }
      y += SW + 5;
    }
    if (hasNotes && notesText) {
      sectionRuleG('NOTES');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(50);
      for (const line of doc.splitTextToSize(notesText, CW)) {
        newPageG(5); doc.text(line, ML, y); y += 4.5;
      }
    }

    doc.save(base + '.pdf');

  } else {
    // ═══════════════════════════════════════════════════════════════════════
    // FIT LAYOUT — single page width, weft cascades onto subsequent pages.
    // ═══════════════════════════════════════════════════════════════════════
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    let y = ML;

    const newPageIfNeeded = needed => {
      if (y + needed > PAGE_H - BMARGIN) { doc.addPage(); y = ML; }
    };
    const sectionRule = label => {
      newPageIfNeeded(8);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150);
      doc.text(label, ML, y);
      doc.setDrawColor(210); doc.setLineWidth(0.2);
      doc.line(ML, y + 1.5, ML + CW, y + 1.5);
      y += 6; doc.setTextColor(30);
    };

    // Title
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(30);
    doc.text('Weaving Draft', ML, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110);
    doc.text(filename, ML, y); y += 7;

    // Metadata
    if (meta.length) {
      sectionRule('DRAFT INFORMATION');
      const CARD_W = 32, CARD_H = 12;
      let cx = ML;
      for (const [l, v] of meta) {
        newPageIfNeeded(CARD_H);
        doc.setFontSize(6.5); doc.setTextColor(140); doc.text(l.toUpperCase(), cx, y);
        doc.setFontSize(9);   doc.setTextColor(30);  doc.text(String(v), cx, y + 4.5);
        cx += CARD_W;
        if (cx + CARD_W > ML + CW) { cx = ML; y += CARD_H; }
      }
      y += (cx > ML ? CARD_H : 0) + 3;
    }

    sectionRule('DRAFT');

    const natImgW  = tW + uW;
    const imgScale = Math.min(1, CW / (natImgW / PX_PER_MM));
    const imgWmm   = (natImgW / PX_PER_MM) * imgScale;
    const rowMm    = (cs / PX_PER_MM) * imgScale;

    // Header composite: threading + tieup
    const capHeader = document.createElement('canvas');
    capHeader.width  = natImgW;
    capHeader.height = tH;
    const hCtxF = capHeader.getContext('2d');
    hCtxF.fillStyle = '#ffffff'; hCtxF.fillRect(0, 0, capHeader.width, capHeader.height);
    hCtxF.drawImage(capThread, 0, 0);
    if (hasT) hCtxF.drawImage(capTieup, tW, 0);
    const headerMm = (tH / PX_PER_MM) * imgScale;

    const tWmm = (tW / natImgW) * imgWmm;
    const uWmm = uW > 0 ? (uW / natImgW) * imgWmm : 0;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(130);
    doc.text('Threading', ML + tWmm / 2, y, { align: 'center' });
    if (hasT) doc.text('Tie-up', ML + tWmm + uWmm / 2, y, { align: 'center' });
    y += 3;

    newPageIfNeeded(headerMm);
    doc.addImage(capHeader, 'PNG', ML, y, imgWmm, headerMm);
    y += headerMm;

    // Paginate body: drawdown + treadling rows
    let weftRow = 0;
    while (weftRow < displayWeft) {
      const availBodyMm = PAGE_H - BMARGIN - y;
      const rowsFit     = Math.max(1, Math.floor(availBodyMm / rowMm));
      const rowsSlice   = Math.min(rowsFit, displayWeft - weftRow);
      const slicePx     = rowsSlice * cs;
      const sliceMm     = slicePx / PX_PER_MM * imgScale;

      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width  = natImgW;
      sliceCanvas.height = slicePx;
      const sCtx = sliceCanvas.getContext('2d');
      sCtx.fillStyle = '#ffffff'; sCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      sCtx.drawImage(capDraw,  0, weftRow * cs, tW, slicePx, 0,  0, tW, slicePx);
      if (hasT) sCtx.drawImage(capTread, 0, weftRow * cs, rW, slicePx, tW, 0, rW, slicePx);

      doc.addImage(sliceCanvas, 'PNG', ML, y, imgWmm, sliceMm);
      y += sliceMm;
      weftRow += rowsSlice;
      if (weftRow < displayWeft) { doc.addPage(); y = ML; }
    }

    if (clippedWarp) {
      newPageIfNeeded(6);
      doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(150);
      const rpts = displayWarp / warpRepeat;
      const note = warpRepeat < d.warpThreads
        ? `Warp clipped to fit: ${rpts} of ${Math.round(d.warpThreads / warpRepeat)} repeats (${warpRepeat}-end repeat).`
        : `Warp clipped to fit: ${displayWarp} of ${d.warpThreads} ends.`;
      doc.text(note, ML, y); y += 5;
    }

    if (colorSet.size) {
      sectionRule('COLOR PALETTE');
      const SW = 6, GAP = 2.5;
      let px = ML;
      for (const hex of colorSet) {
        newPageIfNeeded(SW + 4);
        const [r, g, b] = parseRGB(hex);
        doc.setFillColor(r, g, b); doc.setDrawColor(200); doc.setLineWidth(0.2);
        doc.roundedRect(px, y, SW, SW, 0.8, 0.8, 'FD');
        px += SW + GAP;
        if (px + SW > ML + CW) { px = ML; y += SW + GAP; }
      }
      y += SW + 5;
    }

    if (hasNotes && notesText) {
      sectionRule('NOTES');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(50);
      for (const line of doc.splitTextToSize(notesText, CW)) {
        newPageIfNeeded(5); doc.text(line, ML, y); y += 4.5;
      }
    }

    doc.save(base + '.pdf');
  }
}

/* ═══════════════════════════════════════════════════
   COLOR PAINTING
═══════════════════════════════════════════════════ */

// ── Overlay canvases (positioned on top of each painting canvas) ──────────

function setupOverlays() {
  ['cThreading', 'cDrawdown', 'cTreadling'].forEach(id => {
    const main = document.getElementById(id);
    // Wrap the canvas itself so the overlay aligns with the canvas,
    // not with the panel-wrap (which may include a label above the canvas).
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;display:block;line-height:0;';
    main.parentNode.insertBefore(wrapper, main);
    wrapper.appendChild(main);
    const ov = document.createElement('canvas');
    ov.id = id + 'Ov';
    ov.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    wrapper.appendChild(ov);
  });
}

function syncOverlaySize(id) {
  const main = document.getElementById(id);
  const ov   = document.getElementById(id + 'Ov');
  if (!ov || !main) return;
  ov.width        = main.width;
  ov.height       = main.height;
  ov.style.width  = main.style.width;
  ov.style.height = main.style.height;
}

function clearOverlay(id) {
  const ov = document.getElementById(id + 'Ov');
  if (ov) ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
}

function clearAllOverlays() {
  clearOverlay('cThreading');
  clearOverlay('cDrawdown');
  clearOverlay('cTreadling');
}

// Draw hover / drag selection preview on the overlay canvas.
function drawPreview(canvasId, mouseX, mouseY) {
  const ov = document.getElementById(canvasId + 'Ov');
  if (!ov || !paintDraft || !selectedColor) return;

  const ctx  = ov.getContext('2d');
  ctx.clearRect(0, 0, ov.width, ov.height);

  const cs = cellSize;
  const ls = paintLblSize;
  const d  = paintDraft;
  const [sr, sg, sb] = parseRGB(selectedColor);
  const fill   = `rgba(${sr},${sg},${sb},0.28)`;
  const border = 'rgba(255,255,255,0.85)';
  const lw     = 1.5;

  if (canvasId === 'cThreading') {
    if (ls > 0 && mouseX < ls) return;
    const hoverCol = Math.floor((mouseX - ls) / cs);
    if (hoverCol < 0 || hoverCol >= d.warpThreads) return;
    const hoverThread = hoverCol + 1;

    // During drag: highlight the full range from start to current position
    const lo = isPainting && dragStartThread > 0 ? Math.min(dragStartThread, hoverThread) : hoverThread;
    const hi = isPainting && dragStartThread > 0 ? Math.max(dragStartThread, hoverThread) : hoverThread;
    ctx.fillStyle = fill;
    for (let t = lo; t <= hi; t++) ctx.fillRect(ls + (t - 1) * cs, 0, cs, ov.height);

    // Border on the current hover column only
    ctx.strokeStyle = border;
    ctx.lineWidth   = lw;
    ctx.strokeRect(ls + hoverCol * cs + lw / 2, lw / 2, cs - lw, ov.height - lw);

  } else if (canvasId === 'cTreadling') {
    const hoverRow = Math.floor(mouseY / cs);
    if (hoverRow < 0 || hoverRow >= d.weftThreads) return;
    const hoverThread = hoverRow + 1;

    // During drag: highlight the full range from start to current position
    const lo = isPainting && dragStartThread > 0 ? Math.min(dragStartThread, hoverThread) : hoverThread;
    const hi = isPainting && dragStartThread > 0 ? Math.max(dragStartThread, hoverThread) : hoverThread;
    ctx.fillStyle = fill;
    for (let t = lo; t <= hi; t++) ctx.fillRect(0, (t - 1) * cs, ov.width, cs);

    // Border on the current hover row only
    ctx.strokeStyle = border;
    ctx.lineWidth   = lw;
    ctx.strokeRect(lw / 2, hoverRow * cs + lw / 2, ov.width - lw, cs - lw);

  } else if (canvasId === 'cDrawdown') {
    if (ls > 0 && mouseX < ls) return;
    const col = Math.floor((mouseX - ls) / cs);
    const row = Math.floor(mouseY / cs);
    if (col < 0 || col >= d.warpThreads) return;
    if (row < 0 || row >= d.weftThreads) return;

    if (isPainting && dragStartThread > 0 && dragStartType) {
      // Range preview locked to the axis determined at mousedown
      if (dragStartType === 'warp') {
        const lo = Math.min(dragStartThread, col + 1);
        const hi = Math.max(dragStartThread, col + 1);
        ctx.fillStyle = fill;
        for (let t = lo; t <= hi; t++) ctx.fillRect(ls + (t - 1) * cs, 0, cs, ov.height);
        ctx.strokeStyle = border;
        ctx.lineWidth   = lw;
        ctx.strokeRect(ls + col * cs + lw / 2, lw / 2, cs - lw, ov.height - lw);
      } else {
        const lo = Math.min(dragStartThread, row + 1);
        const hi = Math.max(dragStartThread, row + 1);
        ctx.fillStyle = fill;
        for (let t = lo; t <= hi; t++) ctx.fillRect(ls, (t - 1) * cs, ov.width - ls, cs);
        ctx.strokeStyle = border;
        ctx.lineWidth   = lw;
        ctx.strokeRect(ls + lw / 2, row * cs + lw / 2, ov.width - ls - lw, cs - lw);
      }
    } else {
      const x0 = ls + col * cs;
      const y0 = row * cs;
      ctx.fillStyle   = fill;
      ctx.fillRect(x0, y0, cs, cs);
      ctx.strokeStyle = border;
      ctx.lineWidth   = lw;
      ctx.strokeRect(x0 + lw / 2, y0 + lw / 2, cs - lw, cs - lw);
    }
  }
}

// ── Palette selection & color tools ──────────────────────────────────────

// Central setter: updates selectedColor, the picker, and swatch highlights.
function setActiveColor(hex) {
  selectedColor = hex;
  const picker = document.getElementById('colorPicker');
  if (picker) picker.value = hex;
  document.querySelectorAll('.swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === hex);
  });
  ['cThreading', 'cDrawdown', 'cTreadling'].forEach(id => {
    document.getElementById(id).style.cursor = 'crosshair';
  });
}

function selectPaletteColor(el) {
  if (el.classList.contains('selected')) {
    el.classList.remove('selected');
    selectedColor = null;
    clearAllOverlays();
    ['cThreading', 'cDrawdown', 'cTreadling'].forEach(id => {
      document.getElementById(id).style.cursor = '';
    });
    return;
  }
  setActiveColor(el.dataset.color);
}

function toggleEyedropper() {
  eyedropperActive = !eyedropperActive;
  document.getElementById('eyedropperBtn').classList.toggle('active', eyedropperActive);
  const all = ['cThreading', 'cTieup', 'cDrawdown', 'cTreadling'];
  if (eyedropperActive) {
    all.forEach(id => { const el = document.getElementById(id); if (el) el.style.cursor = 'crosshair'; });
  } else {
    all.forEach(id => { const el = document.getElementById(id); if (el) el.style.cursor = ''; });
    if (selectedColor) {
      ['cThreading', 'cDrawdown', 'cTreadling'].forEach(id => {
        document.getElementById(id).style.cursor = 'crosshair';
      });
    }
  }
}

function sampleColor(canvasId, x, y) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const px = canvas.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
  if (px[3] < 32) return; // skip near-transparent (background / empty cells)
  setActiveColor(toHex(px[0], px[1], px[2]));
  eyedropperActive = false;
  document.getElementById('eyedropperBtn').classList.remove('active');
  // Restore tieup cursor (setActiveColor handles the painting canvases)
  const tieup = document.getElementById('cTieup');
  if (tieup) tieup.style.cursor = '';
}

// ── Undo ──────────────────────────────────────────────────────────────────

function pushHistory() {
  colorHistory.push({ warp: editableWarpColors.slice(), weft: editableWeftColors.slice() });
  if (colorHistory.length > 50) colorHistory.shift();
}

function undo() {
  if (!colorHistory.length || !wifData) return;
  const prev = colorHistory.pop();
  editableWarpColors = prev.warp;
  editableWeftColors = prev.weft;
  renderDraft();
}

// Returns { type: 'warp'|'weft', thread: 1-based-index } or null
function hitTest(canvasId, x, y) {
  const d  = paintDraft;
  if (!d) return null;
  const cs = cellSize;
  const ls = paintLblSize;

  if (canvasId === 'cThreading') {
    if (ls > 0 && x < ls) return null;
    const col = Math.floor((x - ls) / cs);
    if (col < 0 || col >= d.warpThreads) return null;
    return { type: 'warp', thread: col + 1 };
  }

  if (canvasId === 'cTreadling') {
    const row = Math.floor(y / cs);
    if (row < 0 || row >= d.weftThreads) return null;
    return { type: 'weft', thread: row + 1 };
  }

  if (canvasId === 'cDrawdown') {
    if (ls > 0 && x < ls) return null;
    const col = Math.floor((x - ls) / cs);
    const row = Math.floor(y / cs);
    if (col < 0 || col >= d.warpThreads) return null;
    if (row < 0 || row >= d.weftThreads) return null;
    const wi   = col + 1;
    const pick = row + 1;
    const rs   = d.getRaisedShafts(pick);
    const ws   = d.threading[wi] || [];
    const hasShaft = ws.length > 0 && !(ws.length === 1 && ws[0] === 0);
    const warpOnTop = hasShaft && rs.size > 0 && (
      d.risingShed ? ws.some(sh => rs.has(sh)) : !ws.some(sh => rs.has(sh))
    );
    return warpOnTop
      ? { type: 'warp', thread: wi }
      : { type: 'weft', thread: pick };
  }

  return null;
}

// Per-drag state: range is defined by mousedown start and current mouse position.
// The painted range is only committed (and finalized) on mouseup.
let dragStartThread   = -1;   // 1-based index at mousedown
let dragCurrentThread = -1;   // 1-based index at current mouse position
let dragStartType     = null; // 'warp' or 'weft', fixed at mousedown

function trackDrag(canvasId, x, y) {
  if (!paintDraft) return;
  const d  = paintDraft;
  const cs = cellSize;
  const ls = paintLblSize;

  if (canvasId === 'cThreading') {
    if (ls > 0 && x < ls) return;
    const col = Math.floor((x - ls) / cs);
    if (col >= 0 && col < d.warpThreads) dragCurrentThread = col + 1;
  } else if (canvasId === 'cTreadling') {
    const row = Math.floor(y / cs);
    if (row >= 0 && row < d.weftThreads) dragCurrentThread = row + 1;
  } else if (canvasId === 'cDrawdown') {
    if (ls > 0 && x < ls) return;
    if (dragStartType === 'warp') {
      const col = Math.floor((x - ls) / cs);
      if (col >= 0 && col < d.warpThreads) dragCurrentThread = col + 1;
    } else if (dragStartType === 'weft') {
      const row = Math.floor(y / cs);
      if (row >= 0 && row < d.weftThreads) dragCurrentThread = row + 1;
    }
  }
}

function commitPaint() {
  if (!selectedColor || dragStartThread < 0 || dragCurrentThread < 0 || !paintingCanvas) {
    dragStartThread = dragCurrentThread = -1;
    dragStartType = null;
    return;
  }

  const id   = paintingCanvas.id;
  const lo   = Math.min(dragStartThread, dragCurrentThread);
  const hi   = Math.max(dragStartThread, dragCurrentThread);
  const isWarp = id === 'cThreading' || (id === 'cDrawdown' && dragStartType === 'warp');
  const arr    = isWarp ? editableWarpColors : editableWeftColors;

  let changed = false;
  for (let t = lo; t <= hi; t++) {
    if (arr[t] !== selectedColor) { changed = true; break; }
  }
  if (changed) {
    pushHistory();
    for (let t = lo; t <= hi; t++) arr[t] = selectedColor;
  }

  dragStartThread = dragCurrentThread = -1;
  dragStartType = null;

  if (changed) renderDraft();
}

// Canvas event wiring
(function () {
  setupOverlays();

  function canvasXY(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }

  // Eyedropper: registered first so stopImmediatePropagation blocks the paint handler.
  ['cThreading', 'cTieup', 'cDrawdown', 'cTreadling'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('mousedown', e => {
      if (!eyedropperActive) return;
      e.stopImmediatePropagation();
      const { x, y } = canvasXY(el, e);
      sampleColor(id, x, y);
    });
  });

  // Painting canvases
  ['cThreading', 'cDrawdown', 'cTreadling'].forEach(id => {
    const el = document.getElementById(id);

    el.addEventListener('mousedown', e => {
      if (eyedropperActive || !selectedColor || !paintDraft) return;
      isPainting     = true;
      paintingCanvas = el;
      const { x, y } = canvasXY(el, e);
      // Lock the drag-start position and type at mousedown
      const hit = hitTest(id, x, y);
      if (hit) {
        dragStartType   = hit.type;
        dragStartThread = hit.thread;
        dragCurrentThread = dragStartThread; // pure click: end = start
      } else {
        dragStartThread = dragCurrentThread = -1;
        dragStartType   = null;
      }
      clearAllOverlays();
      drawPreview(id, x, y);
    });

    el.addEventListener('mousemove', e => {
      if (!selectedColor || isPainting) return;
      const { x, y } = canvasXY(el, e);
      clearAllOverlays();
      drawPreview(id, x, y);
    });

    el.addEventListener('mouseleave', () => {
      if (!isPainting) clearOverlay(id);
    });
  });

  document.addEventListener('mousemove', e => {
    if (!isPainting || !paintingCanvas) return;
    const { x, y } = canvasXY(paintingCanvas, e);
    trackDrag(paintingCanvas.id, x, y);
    clearAllOverlays();
    drawPreview(paintingCanvas.id, x, y);
  });

  document.addEventListener('mouseup', () => {
    if (isPainting) commitPaint();
    clearAllOverlays();
    isPainting     = false;
    paintingCanvas = null;
  });

  // Native colour picker
  const picker = document.getElementById('colorPicker');
  if (picker) picker.addEventListener('input', e => setActiveColor(e.target.value));

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undo();
    }
    if (e.key === 'Escape' && eyedropperActive) toggleEyedropper();
  });
}());