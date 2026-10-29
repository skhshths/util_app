# Utilities

A calm, minimal set of seven everyday tools in one static web app. A sleek home page lets you pick a tool. Everything runs in your browser: there is no server, no account, no build step and no third-party JavaScript.

| # | Tool | What it does |
| --- | --- | --- |
| 1 | **JSON · YAML · CSV** | Paste data in any of the three formats, browse it as a collapsible tree, convert between formats, repair broken JSON and query it with JSONPath. |
| 2 | **Regex playground** | Live match highlighting, capture-group details, replace preview, a plain-English explanation of the pattern and a clickable cheat sheet. |
| 3 | **Diff viewer** | Side-by-side or unified diff with word-level highlights, options to ignore whitespace and case, folding of unchanged lines and `.patch` export. |
| 4 | **Encoder toolbox** | Base64, URL encoding with a URL breakdown, JWT decoding with HMAC verification, MD5/SHA hashing of text or files, Unix timestamps and HTML entities. |
| 5 | **Habit grid** | A GitHub-style year grid for each habit, with streaks, 30-day completion and per-weekday schedules. |
| 6 | **Workout logger** | Logs sets × reps × weight, can repeat a previous session, and charts your progress (estimated 1RM, top set, volume, reps) and personal records. |
| 7 | **SQL viewer** | Opens SQL dumps (MySQL, MariaDB, PostgreSQL, SQLite) and SQLite database files of any size, multi-gigabyte included. Huge tables are shown a page at a time, and a full-file search finds specific rows. |

The look and feel matches [skhshths/goals](https://github.com/skhshths/goals): Inter, warm neutrals, soft cards, oklch accent colours, light and dark themes, and small spring animations.

---

## Contents

- [Quick start](#quick-start)
- [The home page](#the-home-page)
- [Tool guide](#tool-guide)
  - [JSON · YAML · CSV](#1-json--yaml--csv)
  - [Regex playground](#2-regex-playground)
  - [Diff viewer](#3-diff-viewer)
  - [Encoder toolbox](#4-encoder-toolbox)
  - [Habit grid](#5-habit-grid)
  - [Workout logger](#6-workout-logger)
  - [SQL viewer](#7-sql-viewer)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Data, backups and privacy](#data-backups-and-privacy)
- [Hosting it](#hosting-it)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
- [Adding your own tool](#adding-your-own-tool)
- [Customising](#customising)
- [Browser support](#browser-support)
- [Accessibility](#accessibility)
- [Troubleshooting](#troubleshooting)

---

## Quick start

**Option 1: open the file.** Clone or download the repo, then open `index.html`.

```bash
git clone https://github.com/skhshths/util_app.git
cd util_app
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

**Option 2: serve it locally (recommended).** Hashing and JWT verification use the browser's Web Crypto API, which needs a secure context. `http://localhost` counts as secure, and most browsers also treat `file://` as secure. Serving locally also lets you open the app on your phone over your Wi‑Fi.

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Each tool has a **Sample** or **Try examples** button, so you can see it working straight away.

---

## The home page

- Each tool is a card with an icon, a short description and a live status line. Examples: “Draft saved · 2.1 KB”, “2/4 done today” (with a 14-day mini grid) or “Last: Yesterday · 3 in 7 days”.
- Press **1–7** to open a tool, **/** to search, and **Enter** in the search box to open the first match. Search matches tool names, descriptions and keywords, so “hash”, “gym”, “epoch” and “streak” all work.
- The **☾/☀** button switches light and dark mode. Your choice is remembered; until you pick one, the app follows your system setting.
- The **⋯** menu has **Export backup**, **Import backup**, **Keyboard shortcuts** and **Erase all data**.
- Inside a tool, the breadcrumb at the top shows where you are. Click **Utilities** or press **Esc** to go back.

URLs are hash-based (`#/json`, `#/regex`, `#/diff`, `#/encode`, `#/habits`, `#/workouts`, `#/sql`), so you can bookmark a tool directly.

---

## Tool guide

### 1. JSON · YAML · CSV

**Input (left)**
- Paste text, open a file with **Open file**, or drag a file onto the box. `.json`, `.yaml`, `.yml`, `.csv`, `.tsv` and `.txt` files are accepted, up to 20 MB.
- The input format is **Auto**-detected, or you can force **JSON**, **YAML** or **CSV**.
- The status bar shows the format, line count and size. On an error it shows the **line and column** and a **Show** button that jumps the cursor there.
- **Repair** fixes common JSON mistakes and lists what it changed (with Undo):
  - `//`, `/* */` and `#` comments
  - single-quoted strings and unquoted keys
  - trailing commas and missing commas
  - Python and JS literals: `True`, `False`, `None`, `undefined`, `NaN`
  - leading zeros, hex numbers, `+1`, `.5`
  - raw line breaks inside strings
  - unclosed brackets at the end of the input
  - several values one after another (for example NDJSON), which get wrapped in an array
- If the input isn't strict JSON but is repairable, the output side still shows a **repaired preview**. The status bar explains the problem in amber.
- **Format** rewrites the input as pretty JSON. The shortcut is **Ctrl/⌘ + Shift + F**.
- **Tab** inserts two spaces.

**Output (right)**
- **Tree** is a collapsible view coloured by type. Large arrays load in pages of 200. **Click any key to copy its JSONPath** (for example `$.store.book[2].title`).
- **JSON** output can use 2 spaces, 4 spaces, tabs or be minified.
- **YAML** output uses block style. Multi-line strings become `|` literals, and strings are quoted only when they'd otherwise be read as a number, boolean or null.
- **CSV** output takes an array of objects, adds a header row with the union of all keys, and flattens nested objects to dotted columns (`address.city`). Arrays are written as JSON inside the cell.
- **Sort** orders object keys alphabetically at every depth.
- Copy and download buttons are in the panel header.

**JSONPath query.** Type a path in the box above the output, and the output (tree or converted text) shows only the matches.

| Syntax | Meaning |
| --- | --- |
| `$` | the root |
| `.key`, `['key with spaces']` | child property |
| `[0]`, `[-1]` | array index, negative counts from the end |
| `[0,2]`, `['a','b']` | union |
| `[1:4]`, `[::2]`, `[-2:]` | slice (start:end:step) |
| `*`, `[*]` | all children |
| `..key`, `..*` | recursive descent |
| `[?(@.price < 10)]` | filter. Operators: `==` `!=` `<` `<=` `>` `>=`, `=~ /regex/i`, existence `[?(@.isbn)]`, `!`, `&&`, `||` |

Example: `$..book[?(@.price < 13 && @.tags)].title`

**CSV input details.** The delimiter (comma, tab, semicolon or pipe) is detected automatically. Quoted fields with embedded commas, quotes (`""`) and line breaks are handled. Numbers and `true`/`false`/`null` get converted to their types, but values with leading zeros such as `007` stay strings. Dotted headers (`a.b`) become nested objects.

**YAML support.** The parser handles the YAML you'll meet in config files:
- block maps and sequences, including `- key: value` items
- flow `[a, b]` and `{a: 1}`
- plain, single-quoted and double-quoted scalars, and multi-line plain scalars
- `|` and `>` block scalars with `-`/`+` chomping
- comments, anchors and aliases (`&a`, `*a`) and merge keys (`<<: *a`)

It reads the first document of a multi-document stream. Tags are ignored, and complex keys (`? key`) aren't supported.

### 2. Regex playground

- Type a pattern between the slashes. Click the **g i m s u y** flag buttons to toggle them; hover a flag to see what it does.
- **Common patterns…** loads a ready-made pattern. Options: email, URL, IPv4, ISO date with named groups, hex colour, UUID, number, US phone number, trailing spaces and duplicate words.
- **Test text** highlights matches as you type. Adjacent matches alternate colour, and zero-length matches show as a thin bar. The badge counts the matches.
- **Matches** lists each match with its index range and every capture group, including group names. **Not matched** and **empty** groups are shown as such.
- **Explain** breaks the pattern into parts and describes each one in plain English, indented to show nesting. For example, `[a-z]+?` reads “One character from “a” to “z”, one or more times, as few as possible”.
- **Cheat sheet** lists 24 common tokens. Click one to insert it at the cursor.
- **Replace with** previews `String.replace` live. Use `$1`, `$<name>`, `$&`, `` $` `` and `$'` in the replacement.
- The copy button next to the flags copies the regex as a JavaScript literal, `/pattern/flags`.
- **Safe by design.** Matching runs in a Web Worker. If a pattern takes longer than 1.5 s (catastrophic backtracking such as `(a+)+$`), the worker is stopped and you get an explanation instead of a frozen tab. The match list is capped at 5,000 matches.

### 3. Diff viewer

- Paste the **Original** on the left and the **Changed** text on the right. You can also drop or open a file on each side, up to 10 MB.
- The diff updates as you type. The header shows lines added (**+**), removed (**−**), changed rows and how long the diff took.
- **Split** shows the two versions side by side; **Unified** shows them interleaved. Inside each changed line, the exact words that changed are highlighted.
- **Ignore whitespace** treats runs of spaces and tabs as equal and ignores leading and trailing whitespace. **Ignore case** compares case-insensitively.
- **Hide unchanged** folds unchanged regions down to 3 lines of context. Click a fold to expand it.
- **Patch** copies a standard unified diff (`--- a/original`, `+++ b/changed`, `@@ -l,s +l,s @@` hunks) that works with `git apply` or `patch`.
- **Swap** exchanges the two sides; **Clear** empties both, with Undo.
- The algorithm is Myers' O((N+M)·D) diff with common prefix and suffix trimming. On a typical laptop, two 20,000-line files with a few changes compare in about 25 ms.

### 4. Encoder toolbox

Six tabs. The last tab you used is remembered.

| Tab | Features |
| --- | --- |
| **Base64** | Encodes and decodes UTF‑8 text. **URL-safe** mode uses `-` and `_` without padding. Decoding accepts standard and URL-safe Base64, missing padding, whitespace and `data:` URLs. Binary output is shown as a hex dump with **Save file**. **File** encodes any file (up to 25 MB) and **Copy as data URL** copies it ready for inline use. **Swap** feeds the output back in and flips the direction. |
| **URL** | **Encode value** (`encodeURIComponent`), **Encode URL** (`encodeURI`) or **Decode** (`+` is read as a space). Pasting a full URL shows a **breakdown**: protocol, host, port, path, fragment and every decoded query parameter. |
| **JWT** | Paste a token, with or without `Bearer `. The parts are colour-coded, and the header and payload are pretty-printed. A claims table turns `exp`, `iat`, `nbf` and `auth_time` into local dates with relative times, and badges show **Expired**, **Valid** or **Not valid yet**. To **verify an HS256/384/512 signature**, enter the secret; it's never saved. Encrypted 5-part tokens (JWE) and `alg: none` are detected. **Sample** loads a token signed with the secret `secret`. |
| **Hash** | MD5, SHA‑1, SHA‑256, SHA‑384 and SHA‑512 of text or of a file you drop in (up to 200 MB, read locally). Has an uppercase toggle. **Compare with an expected hash** checks a pasted checksum against all five and tells you which algorithm matches. |
| **Timestamp** | A live clock in Unix seconds, milliseconds and ISO format. Paste a Unix timestamp (seconds, ms, µs or ns are detected by size) or any date string, or pick one with the date picker. Shows Unix s/ms, ISO 8601 in UTC and local time, local time with time zone, UTC, relative time, day of year and ISO week. Every value has a copy button. |
| **HTML entities** | **Escape** `& < > " '`, optionally with every non-ASCII character as a numeric entity. **Unescape** decodes all named and numeric entities. |

### 5. Habit grid

- Use **New habit** (or **N**) to add a habit. Give it a name, choose one of 8 colours, and set the days it repeats on: every day, weekdays, weekends or any combination.
- Each habit card has:
  - a big **check button** to tick it off for today, with a little pop animation
  - a **current streak**, **best streak** and **30-day completion rate**
  - a **53-week grid** of weeks running Monday to Sunday, with today outlined. **Click any past square** to mark or unmark that day. Days the habit isn't scheduled show as hollow squares and don't break a streak.
- The stats row at the top shows today's progress, your top current streak, the average 30-day rate and total check-ins.
- **1–9** tick habits 1–9 for today. When everything due today is done, you get a small celebration toast.
- **Edit** (the pencil) lets you rename, recolour, reschedule, reorder (move up or down) or delete a habit. Deleting has Undo.
- **Try examples** loads four habits with about 200 days of history, so you can see what a full grid looks like.

How the numbers work:
- **Current streak** counts consecutive scheduled days that are done, going back from today. If today isn't done yet, it starts from yesterday, so the streak doesn't drop to 0 in the morning.
- **30-day rate** is done ÷ scheduled days over the last 30 days. Days before the habit was created don't count, and neither does today unless it's already done.
- The page rolls over to the new day if you leave it open past midnight.

### 6. Workout logger

- **Log workout** (or **N**) opens the editor:
  - a name (for example “Push”) and a date
  - one or more **exercises**. Names autocomplete from your history.
  - **sets** of reps × weight. **Add set** copies the previous set, so logging 5×5 takes a few clicks. Leave the weight empty for bodyweight moves.
  - a **Last time** hint under each exercise, showing your previous sets
  - **Start from a previous workout**: one-click chips that copy an earlier session's exercises and sets
  - notes
- **Saving** checks for new personal records and says so (“Saved. New PR: Bench press!”).
- **Stats:** sessions in the last 7 and 30 days, volume over the last 7 days, a **weekly streak** (consecutive weeks with at least one session) and total sessions logged.
- **Progress chart:** pick an exercise and a metric:
  - **Est. 1RM**: the Epley formula, `weight × (1 + reps/30)`, using your best set of the session
  - **Top set**: the heaviest weight that session
  - **Volume**: Σ reps × weight
  - **Reps**: total reps, chosen automatically for bodyweight exercises

  Hover a point to see the date, value and every set. Filled points are new records.
- **Personal records:** the best set per exercise by estimated 1RM (bodyweight moves rank by reps). Click a record to chart that exercise.
- **History:** newest first. Click a session to edit or delete it (with Undo). Identical sets collapse to “3×5 @ 100 kg”.
- **kg / lb:** weights are stored in kilograms and shown in your chosen unit, so switching back and forth never loses precision.
- **Try example data** loads 9 weeks of a push/pull/legs programme with gradual progression and a deload week.

### 7. SQL viewer

Open a `.sql` dump or a SQLite database file (`.db`, `.sqlite`, `.sqlite3`) with **Open file**, drag it onto the page, or use **Paste SQL** for a snippet. **Generate a 105,000-row sample** creates a realistic MySQL dump with products, customers and orders so you can try it straight away.

**What it reads**

| Source | Details |
| --- | --- |
| MySQL / MariaDB | `mysqldump` output. Handles extended multi-row `INSERT`s, backslash escapes, `_utf8mb4'…'` introducers, `/*!40101 … */` conditional comments, `#` comments, `LOCK TABLES` and `REPLACE INTO`. |
| PostgreSQL | `pg_dump` plain format. Reads `COPY … FROM stdin` blocks (tab-separated, `\N` for NULL, backslash escapes) and `--inserts` / `--column-inserts` output, including `E'…'` strings and `'…'::type` casts. |
| SQLite text | `sqlite3 db .dump` output (`INSERT INTO "t" VALUES(…)`, `''` escaping). |
| SQLite database | The binary `.db` file itself. It's read directly from the SQLite page format: rowid and `WITHOUT ROWID` tables, `INTEGER PRIMARY KEY` aliases, overflow pages, UTF‑8/UTF‑16, integers up to 64-bit, floats and BLOBs. |
| Anything else | Generic `CREATE TABLE` + `INSERT` SQL. If there's no `CREATE TABLE`, columns are named from the `INSERT` column list or as `column1, column2…`. |

**How huge files are handled**

- **Streaming:** the file is never loaded into memory whole. A background Web Worker reads it in 4 MB slices.
- **Indexing (dumps):** a single pass understands quoting, escapes, comments and `COPY` blocks. For every table it records:
  - the exact row count
  - the columns and `CREATE` statement
  - the first 100 rows
  - a compact index of byte offsets, with one entry per run of up to 2,000 rows

  A progress bar shows the percentage, speed, time left and tables found, and you can cancel.
- **Indexing (SQLite files):** the schema loads instantly. Row counts are filled in in the background by walking each table's b-tree, and the first page shows as soon as it's reachable.
- **Paging:** any page of any table is fetched by reading only the run that holds it, so jumping to row 23,999,950 takes milliseconds.
- **Measured** with headless Chromium in this repo's test setup:

| Input | Result |
| --- | --- |
| 3.0 GB MySQL dump, 24 million rows | indexed in about 16 s; deep page in about 60 ms; full-file search in about 19 s; browser memory grew about 300 MB |
| 185 MB MySQL dump, 3 million rows | indexed in about 2 s |
| 60 MB SQLite database, 1 million rows | opened and counted in under a second |

**Browsing**
- The left sidebar shows the file type, size, table count, total rows and statement count. **Other objects** opens the views, indexes, triggers and sequences found in the file. You can filter the table list by name.
- The grid has a sticky header with each column's name and type, row numbers, right-aligned numbers, italic `NULL`, `BLOB · size` and `↵` for line breaks.
- **Large tables are shortened:** the pager shows *Rows 1–100 of 24,000,000* with first, previous, next and last buttons, **Go to row**, and 50/100/250/500 rows per page. Press **J** / **K** (or **→** / **←**) to page.
- **Click any cell** to see its full value in a dialog. JSON values are pretty-printed, and there's a copy button. Values over 100,000 characters are truncated for display.
- **Schema** shows a column table (name, type, constraints) and the original `CREATE` statement.
- An open file stays open while you visit other tools. **Close** releases it.

**Searching**
- Type in the search bar and press **Enter**, or **/** to focus it. Options:
  - **Where:** all tables, or only the current table
  - **Column:** any column, or one specific column (current table only)
  - **Mode:** **Contains**, **Exact** (whole value) or **Regex**
  - **Aa:** match case
- Results stream in while the scan runs, with a progress bar and a **Stop** button. They're grouped by table, with the matching cell highlighted.
- Click a result's row number to **jump to that row** in the table: it opens the right page and highlights the row. Click a cell to see its full value.
- **Speed:** before parsing, each `INSERT` (or `COPY` line) is checked for the query text. Most statements are skipped without being parsed, so Contains and Exact searches run at close to disk speed. Searching one table only reads that table's byte ranges.
- **Limit:** results stop at 1,000 matches. The header tells you when there are more; narrow the search to one table or column.

**Limits**
- Compressed files (`.gz`, `.zip`) need unzipping first. The viewer detects them and tells you.
- Files must be UTF‑8; UTF‑16 dumps are detected and rejected with a message.
- For SQLite, changes still in a `-wal` file aren't visible. Run `PRAGMA wal_checkpoint;` or close the database cleanly first. Encrypted databases (SQLCipher) can't be read.
- Views are listed with their SQL but not evaluated; this is a viewer, not a query engine.
- Exotic syntax inside an `INSERT`, such as `ON DUPLICATE KEY UPDATE … VALUES(x)`, can make that statement's row count off by one.

---

## Keyboard shortcuts

| Where | Keys | Action |
| --- | --- | --- |
| Anywhere | `?` | Show all shortcuts |
| Anywhere | `T` | Toggle dark mode |
| Anywhere | `Esc` | Leave a text field, close a dialog, or go back home |
| Dialogs | `Ctrl/⌘ + Enter` | Confirm (save) |
| Home | `1`–`7` | Open a tool |
| Home | `/` | Search tools, then `Enter` to open the first match |
| JSON | `Ctrl/⌘ + Shift + F` | Format input as pretty JSON |
| Habits | `N` | New habit |
| Habits | `1`–`9` | Tick habit 1–9 for today |
| Workouts | `N` | Log a workout |
| SQL viewer | `/` | Focus the search box |
| SQL viewer | `J` / `K` (or `→` / `←`) | Next / previous page |

Shortcuts are ignored while you're typing in a field.

---

## Data, backups and privacy

- **Nothing is sent anywhere.** The app makes no network requests apart from loading the Inter font from Google Fonts, and it works fine without it. Files you open, hash or view in the SQL viewer are read in the browser and never uploaded.
- Data lives in `localStorage` under keys that start with `util-app/`:

| Key | Contents |
| --- | --- |
| `util-app/settings` | theme, when each tool was last opened |
| `util-app/habits` | habits and their done days |
| `util-app/workouts` | sessions and the weight unit |
| `util-app/workouts-view` | selected exercise and chart metric |
| `util-app/sql`, `util-app/sql-last` | SQL viewer page size and search options; the name and size of the last file opened (never its contents) |
| `util-app/json`, `regex`, `diff`, `encode` | your last inputs, so a refresh doesn't lose work. JSON and diff drafts over about 400 KB aren't saved. |

- JWT secrets are **never** stored.
- **Export backup** (⋯ menu) downloads `utilities-backup-YYYY-MM-DD.json` with everything above. **Import backup** replaces the current data with a backup's contents, after asking you to confirm.
- **Erase all data** removes every `util-app/` key.
- `localStorage` belongs to one *origin*. Data saved at `localhost:8000` won't appear on your GitHub Pages URL, and private windows start empty. Use export and import to move data between them.

---

## Hosting it

The app is a static folder, so any static host works.

**GitHub Pages**
1. Go to the repo's **Settings → Pages**.
2. Under *Build and deployment*, choose **Deploy from a branch**. Pick `main` and the folder `/ (root)`, then click **Save**.
3. After a minute the app is live at `https://skhshths.github.io/util_app/`.

The repo includes an empty `.nojekyll` file so Pages serves the files as they are.

**Cloudflare Pages, Netlify or Vercel:** point the host at this repo with no build command and `/` as the output directory. Netlify Drop also works: just drag the folder in.

To add the app to your phone's home screen, open it in Safari or Chrome and choose **Add to Home Screen**.

---

## Project structure

```
util_app/
├── index.html            Shell: top bar, theme bootstrap, script tags
├── css/
│   └── styles.css        Design tokens (light/dark), layout and every component
├── js/
│   ├── app.js            Core: storage, DOM helpers, icons, toasts, modals, menus,
│   │                     theme, tool registry, hash router, home page, backups, shortcuts
│   ├── lib/
│   │   ├── formats.js    JSON (strict + lenient/repair), YAML parse/emit, CSV, JSONPath
│   │   └── md5.js        MD5 (RFC 1321), since Web Crypto has no MD5
│   └── tools/
│       ├── json.js       JSON · YAML · CSV
│       ├── regex.js      Regex playground (+ Web Worker + explainer)
│       ├── diff.js       Diff viewer (Myers diff, word diff, patch export)
│       ├── encode.js     Encoder toolbox (6 tabs)
│       ├── habits.js     Habit grid
│       ├── workouts.js   Workout logger (+ SVG chart)
│       └── sql.js        SQL viewer (streaming dump indexer, SQLite page reader, search worker)
├── .nojekyll
└── README.md
```

There are no dependencies and no build step. The scripts are plain classic scripts rather than ES modules, so the app also runs from `file://`, where browsers block module imports.

---

## How it works

- **Router.** `#/<tool-id>` selects a tool. When you switch tools, the router calls the previous tool's cleanup function, which removes intervals, workers, observers and key listeners. It then mounts the new tool into `#view` and sets the `--h` accent hue for that page.
- **Tools** register themselves with `U.register({...})`. The order of the `<script>` tags in `index.html` sets the order on the home page and the `1`–`7` shortcuts.
- **Theme.** A tiny inline script picks the theme before first paint, so there's no flash. Colours are CSS custom properties on `:root` and `:root[data-theme="dark"]`. Accents are `oklch(L C hue)`, with lightness and chroma tuned for each theme, so every hue looks balanced in both.
- **Lenient JSON parser.** A hand-written recursive-descent parser. In strict mode it raises an error at the first non-standard construct, with an exact line and column. In loose mode it records each repair category instead, which gives Repair its summary.
- **Regex worker.** Built from a Blob URL. Each run gets an id, and stale results are dropped. If a job doesn't answer within 1.5 s, the worker is terminated and recreated.
- **Diff.** Line-level Myers diff on normalised keys, which is how the whitespace and case options work. Paired deleted and added lines get a second, token-level Myers diff for the word highlights.
- **SQL viewer worker.** A byte-level state machine walks the dump in 4 MB slices. It tracks quotes, backslash escapes (MySQL only), comments, parenthesis depth and `COPY` data, and reports every statement's exact byte range. Strings are skipped with native `indexOf`, so indexing runs at roughly 150–200 MB/s. Rows are counted from top-level `(` groups without parsing values, and only the preview and requested pages are fully parsed. For SQLite files, pages are read with `File.slice` through a 64 MB LRU page cache. Tables are walked in order, and a leaf-page index with cumulative counts makes any row reachable with a binary search.
- **Charts** are hand-built SVG with “nice” axis ticks, a pointer-tracking tooltip and a ResizeObserver that redraws the chart when its width changes.

---

## Adding your own tool

1. Create `js/tools/mytool.js`:

```js
(function () {
  'use strict';
  U.register({
    id: 'mytool',                 // URL: #/mytool
    name: 'My tool',
    desc: 'One sentence for the home card.',
    hue: 200,                     // accent hue (0–360, oklch)
    icon: 'sparkles',             // a key from ICONS in js/app.js
    keywords: ['search', 'terms'],
    shortcuts: [['Do the thing', ['D']]],      // optional, listed under "?"
    homeStat: function () { return ''; },       // optional HTML for the card footer
    mount: function (root) {
      root.innerHTML = '<div class="tool-head"><div><h1>My tool</h1></div></div>';
      // ...build the UI, persist with U.store.get/set('mytool', ...)
      return function cleanup() { /* clear timers, listeners */ };
    }
  });
})();
```

2. Add `<script src="js/tools/mytool.js"></script>` to `index.html`.

Helpers available on `U`:

| Helper | What it does |
| --- | --- |
| `U.store` | storage get, set, remove and keys, under the `util-app/` prefix |
| `U.h` and `U.esc` | build DOM from HTML and escape text |
| `U.icon` | inline SVG icons |
| `U.toast(msg, { action, onAction })` | toast notifications, with an optional action such as Undo |
| `U.modal` and `U.confirm` | dialogs |
| `U.seg` | segmented controls |
| `U.copy`, `U.download`, `U.pickFile` | clipboard, file download and file picker |
| `U.debounce`, `U.dayKey`, `U.relTime`, `U.fmtNum` | timing, date and number formatting |

---

## Customising

- **Colours:** edit the tokens at the top of `css/styles.css`. `--bg`, `--surface`, `--text` and the other base colours are defined for light and dark separately. `--al` and `--ac` set accent lightness and chroma.
- **Tool accents:** change `hue` in each tool's `U.register` call.
- **Habit colours:** the `HUES` array in `js/tools/habits.js`.
- **Diff context:** `CONTEXT` in `js/tools/diff.js` (3 lines by default).
- **Regex time limit:** the `1500` ms timeout in `js/tools/regex.js`.
- **Font:** swap the Google Fonts link in `index.html` and the `font` rule on `body`.

---

## Browser support

Current Chrome, Edge, Firefox and Safari, on desktop and mobile. The app uses CSS `oklch()`, `color-mix()`, `:has()`-free selectors, `dvh` units, `ResizeObserver`, Web Workers, `TextEncoder`/`TextDecoder` and Web Crypto. View Transitions are used for the theme switch when available and skipped otherwise.

---

## Accessibility

- Everything works from the keyboard and has visible focus rings. Dialogs trap focus and return it when they close.
- Icon buttons have `aria-label`s, segmented controls expose `aria-pressed`/`aria-selected`, and dialogs use `role="dialog"` and `aria-modal`.
- Toasts are announced through an `aria-live` region.
- Habit grid squares have labels such as “Thu, Oct 29, 2026, done”.
- `prefers-reduced-motion` turns off animations, and `prefers-color-scheme` sets the default theme.
- Layouts reflow down to a 320 px width without horizontal scrolling. The habit grid scrolls inside its card on narrow screens, with today in view.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Hash or JWT verify says “Needs HTTPS or localhost” | Web Crypto only runs in a secure context. Serve the folder with `python3 -m http.server` and open `http://localhost:8000`. |
| My habits or workouts disappeared | You're probably on a different origin or in a private window. See [Data, backups and privacy](#data-backups-and-privacy) and restore from an exported backup. |
| “Stopped after 1.5 s” in the regex tool | The pattern backtracks catastrophically on your text. Avoid nested quantifiers such as `(a+)+` or `(\w*)*`. Use more specific character classes or anchors instead. |
| YAML that works elsewhere fails here | The parser covers the common subset described above. Complex keys (`? `), tags and multi-document streams beyond the first aren't supported. |
| A CSV column such as `007` stayed as a string | That's deliberate: values with leading zeros keep their exact text, so zip codes and IDs survive. |
| SQL viewer says the file is gzip/ZIP/UTF-16 | Decompress it (`gunzip dump.sql.gz`) or re-save it as UTF‑8, then open it again. |
| SQLite rows look out of date | Recent changes may still be in the `-wal` file next to the database. Checkpoint it (`sqlite3 app.db "PRAGMA wal_checkpoint;"`) and reopen. |
| A table shows `column1, column2…` | The dump has `INSERT`s but no `CREATE TABLE` for that table, so column names were unavailable. |
| The page looks unstyled | Make sure the `css/` and `js/` folders sit next to `index.html`. |
