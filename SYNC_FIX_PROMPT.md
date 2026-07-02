Rework the cloud sync in my SQL Tracker so it is the **exact same setup as my Puzzle Tracker**.
Replace whatever is in `sync.js` (and the sync-related bits of `storage.js` / the UI) with this model.
Keep everything keyed by question `id`, and don't lose existing local progress.

## The problem
Current sync makes me paste a **Gist ID** and creates a different gist per device. I don't want that.
The Puzzle Tracker never asks for a Gist ID and every device shares one gist. Copy that behaviour.

## The Puzzle Tracker model (what to build)
There is no login server. It's three cooperating pieces:

1. **Published snapshot — `progress.js`** (committed to the repo). A file that sets
   `window.PUBLISHED_PROGRESS = {...}`. On load, the app starts from this baseline (so opening the site
   anywhere shows my progress with zero storage), then the owner's `localStorage` working copy overrides it.
   An edit-mode **"Save snapshot"** button downloads an updated `progress.js` to commit.
   Snapshot shape (keyed by `id`):
   ```js
   window.PUBLISHED_PROGRESS = {
     app: "sql-tracker",
     status:   { /* id: "Solved" | "Attempted" */ },
     notes:    { /* id: string */ },
     solution: { /* id: string (my SQL) */ },
     solvedAt: { /* id: "YYYY-MM-DD" */ },
     cloud: null   // or the PIN-encrypted token blob (see #3)
   };
   ```

2. **PIN edit-lock.** View-only by default; a lock button prompts for a PIN to enable editing. Store ONLY a
   SHA-256 hash of the PIN in code (`PIN_HASH`), never the PIN. Remember unlock in `sessionStorage`.

3. **GitHub Gist sync — ONE gist for all devices, found automatically by filename.** The gist is never
   entered by hand. On connect the app lists the account's gists and finds the one containing
   `sql-tracker-progress.json` (creating it once if absent). Because I use the **same GitHub token/account**
   on every device, this resolves to the **same gist everywhere** — that's the shared sync. On top of that,
   the token itself is **encrypted with my PIN and committed inside `progress.js`**, so on any device I just
   unlock with the PIN and it auto-connects — no token re-entry, no Gist ID. Remove any manual "Gist ID"
   field from the UI. Also delete any code that pushes to a separate `sql-tracker-data` **repo** — the gist
   replaces it (I'll delete that repo myself).

## Drop-in code (from the working Puzzle Tracker — adapt only the keys/labels)

```js
/* ---- PIN verify (store only the hash) ---- */
async function sha256Hex(str){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
}
const PIN_HASH = "PUT_YOUR_SHA256_PIN_HASH_HERE"; // generate once: await sha256Hex("myPin") in console

/* ---- PIN-encrypted GitHub token (PBKDF2 + AES-GCM) ---- */
const PIN_KDF_ITERS = 250000;
const _b64   = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const _unb64 = s   => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveAesKey(pin, salt){
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name:"PBKDF2", salt, iterations:PIN_KDF_ITERS, hash:"SHA-256" },
    base, { name:"AES-GCM", length:256 }, false, ["encrypt","decrypt"]);
}
async function encryptToken(token, pin){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveAesKey(pin, salt);
  const ct   = await crypto.subtle.encrypt({ name:"AES-GCM", iv }, key, new TextEncoder().encode(token));
  return { v:1, salt:_b64(salt), iv:_b64(iv), ct:_b64(ct) };
}
async function decryptToken(blob, pin){
  const key = await deriveAesKey(pin, _unb64(blob.salt));
  const pt  = await crypto.subtle.decrypt({ name:"AES-GCM", iv:_unb64(blob.iv) }, key, _unb64(blob.ct));
  return new TextDecoder().decode(pt);
}
let currentPin = null;            // held in memory after unlock, never persisted
let pendingCloudBlob = null;      // encrypted token staged for next Save snapshot

/* ---- Gist as cross-browser storage ---- */
const CLOUD_KEY = "sqlTracker.cloud";
const GIST_FILE = "sql-tracker-progress.json";
let cloudCfg = null;              // { token, gistId, lastSync }
let cloudPushTimer = null;

function loadCloudCfg(){ try{ const r = localStorage.getItem(CLOUD_KEY); if(r) cloudCfg = JSON.parse(r); }catch(e){} }
function saveCloudCfg(){ try{ cloudCfg ? localStorage.setItem(CLOUD_KEY, JSON.stringify(cloudCfg)) : localStorage.removeItem(CLOUD_KEY); }catch(e){} }

async function ghFetch(method, path, body){
  const res = await fetch("https://api.github.com" + path, {
    method,
    headers:{ "Authorization":"token "+cloudCfg.token, "Accept":"application/vnd.github+json", "Content-Type":"application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if(!res.ok) throw new Error("GitHub " + res.status + " " + res.statusText);
  return res.json();
}

// Build the JSON we store in the gist (and in progress.js) — keyed by id
function buildSnapshot(){
  return { app:"sql-tracker", status:state.status, notes:state.notes, solution:state.solution, solvedAt:state.solvedAt };
}

// SAME token (same account) => SAME gist on every device. No manual id.
async function resolveGist(){
  const gists = await ghFetch("GET", "/gists?per_page=100");
  const matches = gists.filter(g => g.files && g.files[GIST_FILE]);
  if(matches.length){
    matches.sort((a,b) => new Date(a.created_at) - new Date(b.created_at)); // oldest wins => all devices converge
    cloudCfg.gistId = matches[0].id;
    return;
  }
  const created = await ghFetch("POST", "/gists", {
    description:"SQL Tracker — synced progress", public:false,
    files:{ [GIST_FILE]:{ content: JSON.stringify(buildSnapshot(), null, 2) } }
  });
  cloudCfg.gistId = created.id;
}

/* merge remote into local — union; never clobber a non-empty local value */
function mergeRemote(remote){
  let changed = false;
  for(const id in (remote.status||{}))   if(remote.status[id]   && state.status[id]!=="Solved"){ state.status[id]=remote.status[id]; changed=true; if(remote.solvedAt?.[id] && !state.solvedAt[id]) state.solvedAt[id]=remote.solvedAt[id]; }
  for(const id in (remote.notes||{}))    if(remote.notes[id]    && !state.notes[id]){    state.notes[id]=remote.notes[id];       changed=true; }
  for(const id in (remote.solution||{})) if(remote.solution[id] && !state.solution[id]){ state.solution[id]=remote.solution[id]; changed=true; }
  if(changed){ saveState(); renderList(); updateProgress(); if(isAnalyticsView()) renderAnalytics(); }
}

async function cloudPushNow(){
  if(!cloudCfg?.gistId) return;
  await ghFetch("PATCH", "/gists/" + cloudCfg.gistId, { files:{ [GIST_FILE]:{ content: JSON.stringify(buildSnapshot(), null, 2) } } });
  cloudCfg.lastSync = new Date().toISOString(); saveCloudCfg(); setCloudUI("ok");
}
function schedulePush(){ if(!cloudCfg?.gistId) return; clearTimeout(cloudPushTimer); cloudPushTimer = setTimeout(() => cloudPushNow().catch(()=>setCloudUI("error")), 2500); }

async function cloudSync(){
  if(!cloudCfg?.gistId) return; setCloudUI("syncing");
  try{
    const gist = await ghFetch("GET", "/gists/" + cloudCfg.gistId);
    const raw = gist.files?.[GIST_FILE]?.content;
    if(raw) mergeRemote(JSON.parse(raw));
    await cloudPushNow(); toast("Cloud synced");
  }catch(e){ console.warn(e); setCloudUI("error"); toast("Cloud sync failed — check token or network"); }
}

async function cloudConnect(){                       // manual connect: paste token, no id
  const token = (document.getElementById("cloudTokenInput")?.value || "").trim();
  if(!token){ toast("Paste your GitHub token (gist scope) first"); return; }
  setCloudUI("syncing"); cloudCfg = { token, gistId:null, lastSync:null };
  try{
    const res = await fetch("https://api.github.com/user", { headers:{ "Authorization":"token "+token, "Accept":"application/vnd.github+json" } });
    if(!res.ok) throw new Error("Invalid token (status " + res.status + ")");
    await resolveGist(); saveCloudCfg(); setCloudUI("ok");
    const inp = document.getElementById("cloudTokenInput"); if(inp) inp.value = "";
    await cloudSync();
    await enableCrossBrowser(token);                 // stage PIN-encrypted token for progress.js
  }catch(e){ console.warn(e); cloudCfg=null; setCloudUI("off"); toast("Connect failed — " + e.message); }
}

/* encrypt token with PIN and stage it for the next Save snapshot (so other devices auto-connect) */
async function enableCrossBrowser(token){
  let pin = currentPin;
  if(!pin){ const entry = prompt("Enter your edit PIN to enable PIN-unlock sync on all devices\n(Cancel = this device only):"); if(entry==null) return; pin = entry.trim(); if((await sha256Hex(pin))!==PIN_HASH){ toast("Wrong PIN — sync stays on this device only"); return; } currentPin = pin; }
  try{ pendingCloudBlob = await encryptToken(token, pin); toast("Sync ready — click Save snapshot & commit progress.js to enable PIN-unlock everywhere"); }catch(e){ console.warn(e); }
}

/* on a fresh device: unlock with PIN -> decrypt the committed token -> auto-connect to the same gist */
async function maybeAutoConnectCloud(pin){
  if(cloudCfg?.gistId) return;
  const blob = window.PUBLISHED_PROGRESS && window.PUBLISHED_PROGRESS.cloud;
  if(!blob) return;
  setCloudUI("syncing");
  try{
    const token = await decryptToken(blob, pin);
    cloudCfg = { token, gistId:null, lastSync:null };
    await resolveGist(); saveCloudCfg(); setCloudUI("ok"); await cloudSync();
    toast("Cloud sync connected via PIN");
  }catch(e){ console.warn(e); cloudCfg=null; setCloudUI("off"); }
}

function cloudDisconnect(){
  if(!confirm("Disconnect cloud sync?\n\nLocal progress is kept. The remote gist is not deleted.")) return;
  clearTimeout(cloudPushTimer); cloudCfg=null; saveCloudCfg(); setCloudUI("off"); toast("Disconnected from cloud sync");
}
```

## Wiring (match the Puzzle Tracker)
- On PIN unlock success: keep `currentPin = pin`, then call `maybeAutoConnectCloud(pin)`.
- `saveState()` must call `schedulePush()` after writing localStorage (debounced push while connected).
- **Save snapshot** builds `progress.js` including `cloud: pendingCloudBlob || (window.PUBLISHED_PROGRESS?.cloud) || null` so the encrypted token is carried forward (safe to commit — useless without the PIN).
- On load: `loadCloudCfg()`, and `if(cloudCfg?.gistId) setTimeout(() => cloudSync(), 800);`.
- `setCloudUI(status)` updates a small header badge: Not connected / Syncing… / Synced / Error + last-synced time; show the token field only when disconnected, and the "Sync now"/"Disconnect" controls only when connected.

## Net result (the behaviour I want)
- **Device 1 (owner):** unlock PIN → paste token once → app finds/creates the single gist → enter PIN to
  encrypt the token → Save snapshot → commit `progress.js`.
- **Every other device:** just unlock with the PIN → it decrypts the committed token → connects to the
  **same** gist automatically. No token, no Gist ID, ever.
