// progress.js — published progress snapshot (committed to the repo).
//
// On load, the app uses this as the shared baseline, so opening the site on ANY device shows the
// owner's progress even with empty localStorage. The local working copy (localStorage) then
// overrides it. Use the edit-mode "Save snapshot" button to download a fresh copy of this file
// and commit it.
//
// Shape (all maps keyed by question id):
//   status:   { id: "Solved" | "Attempted" }        (Todo values are omitted)
//   notes:    { id: string }
//   solution: { id: string }                          (my SQL)
//   solvedAt: { id: "YYYY-MM-DD" }
//   cloud:    null | { v, salt, iv, ct }              (PIN-encrypted GitHub token; useless without the PIN)
window.PUBLISHED_PROGRESS = {
  app: "sql-tracker",
  status: {},
  notes: {},
  solution: {},
  solvedAt: {},
  cloud: null
};
