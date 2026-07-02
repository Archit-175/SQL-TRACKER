# SQL Practice Tracker

**🔗 Live site: https://sql-tracker-steel.vercel.app**

A personal, static website to track the LeetCode Database (SQL) problems you're practicing.
No framework, no build step, no dependencies — just plain HTML/CSS/vanilla JS. All progress is
stored in your browser's `localStorage`, with optional sync to a private GitHub repo.

![data model](docs/00_SalesDB_DataModel.png)

## Running it

Either:

- **Open directly** — double-click `index.html` (works from `file://`), or
- **Serve the folder** (recommended, avoids any browser file:// quirks):

  ```bash
  python3 -m http.server 8000
  # then open http://localhost:8000
  ```

## Features

- **105 seeded problems** with pre-marked progress.
- **Group by Difficulty or Topic**, collapsible sections with `solved / total` counts.
- **Overall progress** bar + per-difficulty counts.
- **Search** (id or title) and **filters** (difficulty / topic / status).
- **Per-question tracking**: status (Todo / Attempted / Solved), free-text notes, and a
  monospace SQL-solution editor. Date solved is set automatically the first time you mark
  a problem **Solved**.
- **Question of the day** — a deterministic unsolved pick, seeded by today's date.
- **Analytics tab** — a GitHub-style activity **heatmap**, solved-over-time line chart,
  breakdowns by difficulty and topic, current streak, total solved, completion %.
  All charts are hand-drawn inline SVG.
- **PIN edit lock** — view-only by default; unlock to edit.
- **Optional GitHub sync**.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup shell + modals |
| `styles.css` | Dark theme, green accent, `@font-face` |
| `questions.js` | The `QUESTIONS` seed array (edit this to add problems) |
| `storage.js` | `localStorage` persistence, keyed by `id` |
| `app.js` | List view, grouping, filters, PIN lock, question of the day, wiring |
| `analytics.js` | SVG charts + stats |
| `sync.js` | GitHub Contents-API push/pull |
| `fonts/` | Self-hosted Comic Shanns + Comic Shanns Mono |

## Adding questions

Append objects to the `QUESTIONS` array in [`questions.js`](questions.js):

```js
{ id: 9999, title: "My New Problem", difficulty: "Medium", topic: "Window",
  url: "https://leetcode.com/problems/my-new-problem/", done: false }
```

- `difficulty`: `"Easy"` | `"Medium"` | `"Hard"`
- `topic`: `"Basics"` | `"Joins"` | `"Aggregation"` | `"Subqueries"` | `"Window"` | `"String"` | `"Date"` | `"Pivot"`
- `done: true` seeds the problem as **Solved**.

Your saved progress is keyed by `id`, so **existing notes, statuses, and solutions survive**
when you add, remove, or reorder questions. Only the `id` needs to stay stable.

### Solve dates (heatmap / streak)

The already-solved problems are seeded with their real "date solved" from a `SOLVED_DATES`
map at the bottom of [`questions.js`](questions.js) (`{ id: "YYYY-MM-DD" }`). These drive the
activity heatmap, the solved-over-time chart, and the streak. When you mark a new problem
**Solved** in the app, today's date is recorded automatically. Anything you edit in-app always
overrides the seeded date.

## The PIN

Editing is locked by default. Click the **🔒 Locked** button and enter the PIN to unlock.
The PIN is **`6612`**. Change it by editing this line near the top of
[`app.js`](app.js):

```js
const EDIT_PIN = "6612"; // change this to set your own PIN
```

This is a light client-side gate (it just discourages accidental edits — it is **not** real
security, since the PIN lives in the JS). The unlocked state is remembered for the browser
tab/session and clears when you close the tab or click the lock button again.

## GitHub sync (optional)

Sync keeps a JSON snapshot of your progress in a **private GitHub Gist** so you can move between
machines. No repo needed.

1. Create a personal access token with just the **`gist`** scope:
   - Classic token: **Settings → Developer settings → Tokens (classic)**, check only **`gist`**.
   - (Set a finite expiration rather than "No expiration".)
2. Click the **☁ sync** button in the app and fill in:
   - **Token** — pasted PAT (stored **only** in this browser's `localStorage`; never committed)
   - **Gist ID** — leave **blank** the first time
   - **Filename** — default `progress.json`
3. **Push** — the first push creates a new **secret gist** and fills the Gist ID back into the
   form (copy it / it's saved locally). Later pushes update that same gist.
4. **Pull** — on another machine, paste the same token **and** the Gist ID, then Pull. It fetches
   the gist and merges into local storage (remote values win per `id`).
5. Use **Clear token** to remove the stored token from a machine that isn't yours.

Notes:
- The token never leaves your browser except in the `Authorization` header of requests to
  `api.github.com`. It is not written into any file in this project.
- The gist is **secret** (not listed publicly), but "secret" gists are still viewable by anyone
  with the URL — don't put anything truly sensitive in your notes/solutions.

## Fonts

The UI uses **Comic Shanns** (body) and **Comic Shanns Mono** (code/solutions), self-hosted in
`fonts/` so the app works fully offline. If a font file is missing, the CSS falls back to the
system sans-serif / monospace stack automatically. Sources:
[Comic Shanns](https://github.com/shannpersand/comic-shanns) ·
[Comic Shanns Mono](https://github.com/jesusmgg/comic-shanns-mono).
