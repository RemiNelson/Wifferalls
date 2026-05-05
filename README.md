# WIF Reader

A browser-based viewer and editor for **Weaving Information Files** (WIF 1.0 / 1.1). Open a `.wif` file, inspect the draft, edit thread colours and structure, and export a finished file — no installation or server required.

---

## Features

### Viewing
- Renders the full weaving draft: **Threading**, **Tie-up**, **Drawdown** (fabric preview), and **Treadling** panels
- Supports both standard treadle-based drafts and **liftplan** files (tie-up and treadling panels are hidden automatically)
- Displays draft metadata: title, author, shaft/treadle counts, warp/weft end counts, rising-shed setting
- Shows any notes embedded in the WIF file
- Auto-fits the draft to the viewport on load; adjustable cell size (2 – 32 px) via slider

### Colour editing
- Full **colour palette** built from the WIF colour table, shown as clickable swatches
- **Paint** warp or weft threads by clicking or dragging across the Threading, Drawdown, or Treadling canvas
- **Eyedropper** tool to sample any colour already on the draft
- Custom colour via the native **colour picker**
- **Undo** (Ctrl + Z) — up to 50 steps, covering both colour and structure changes

### Structure editing
- Toggle **Edit threading / treadling** mode to reassign shaft and treadle connections
- Click any threading cell to toggle which shaft that warp end is threaded on
- Click any treadling cell to toggle which treadle that weft pick activates
- **Add or remove** threading columns (warp ends) and treadling rows (weft picks):
  - Click a column or row to select it (highlighted in blue)
  - Enter a count and press **+** to insert that many columns/rows immediately after the selection
  - Enter a count and press **−** to remove that many columns/rows starting from the selection
  - Confirmation dialog on removal, with a "don't ask again this session" option

### Export
- **Export WIF** — downloads a `.wif` file containing all colour and structure edits
- **Export PDF** — generates a print-ready landscape A4 PDF; if the draft is too wide for one page, choose between *fit to page* (clips to whole repeats) or *grid layout* (tiles across multiple sheets)

---

## Quickstart

### 1. Open a file

Drag and drop a `.wif` file onto the drop zone, or click **Choose File** to browse. The draft renders automatically and the view zooms to fit your screen.

### 2. Navigate the draft

| Panel | What it shows |
|---|---|
| **Threading** (top left) | Which shaft each warp end passes through |
| **Tie-up** (top right) | Which shafts each treadle raises |
| **Drawdown** (bottom left) | Simulated fabric — the woven cloth preview |
| **Treadling** (bottom right) | Which treadle each weft pick activates |

Use the controls bar (sticks to the top as you scroll) to adjust **cell size**, toggle **grid lines**, and toggle **shaft/treadle number labels**.

### 3. Change thread colours

1. Click a swatch in the **Color Palette** bar, or use the colour picker for a custom colour, or click **Sample** then click any point on the draft to pick that colour.
2. Click or click-drag across the **Threading** canvas to repaint warp threads, or across the **Treadling** / **Drawdown** canvas to repaint weft picks.
3. Press **Ctrl + Z** (or click **Undo**) to step back.

### 4. Edit threading and treadling structure

1. Check **Edit threading / treadling** in the controls bar.
2. Click any cell in the **Threading** panel to toggle that warp end on or off the corresponding shaft. The **Drawdown** updates immediately.
3. Click any cell in the **Treadling** panel to toggle that weft pick on or off the corresponding treadle.
4. The selected column/row is highlighted in blue and shown in the controls bar.

### 5. Add or remove columns and rows

With **Edit threading / treadling** enabled:

- **Add** — click the column (threading) or row (treadling) you want to insert after, then enter a count in the number field next to **+** and click **+** (or press Enter). New columns/rows inherit the adjacent thread's colour and start with no shaft/treadle assignment.
- **Remove** — click the column or row to start from, enter a count next to **−** and click **−** (or press Enter). A confirmation dialog appears; check *Don't ask again this session* to skip future confirmations.

All structural changes are undoable with Ctrl + Z.

### 6. Export

- **↓ Export WIF** — saves a `.wif` file with your edits applied to colour and structure sections.
- **⌁ Export PDF** — opens a print-ready PDF. If the draft is wider than one landscape A4 page at the minimum cell size, a dialog lets you choose:
  - *Fit to page* — shows as many complete warp repeats as fit on one page
  - *Grid layout* — tiles the full draft across multiple pages to print and piece together

### 7. Load another file

Click **Load Another** in the top bar to return to the upload screen.

---

## File support

| Feature | Supported |
|---|---|
| WIF 1.0 | ✓ |
| WIF 1.1 | ✓ |
| Liftplan (direct shaft activation) | ✓ |
| Treadle-based drafts | ✓ |
| Rising-shed and sinking-shed looms | ✓ |
| Per-thread colour tables | ✓ |

---

## Running locally

No build step needed. Open `index.html` directly in any modern browser.

PDF export uses [jsPDF](https://github.com/parallax/jsPDF) loaded from a CDN — an internet connection is required the first time PDF export is used.
