// Project persistence (IndexedDB) + lightweight preferences (localStorage).

const DB = 'darkroom', STORE = 'projects';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); };

export const saveProject = (p) => tx('readwrite', s => s.put(p));
export const deleteProject = (id) => tx('readwrite', s => s.delete(id));
export const getProject = (id) => tx('readonly', s => s.get(id));
export const listProjects = async () => (await tx('readonly', s => s.getAll())).sort((a, b) => b.updated - a.updated);

const KEY = 'darkroom-prefs';
export function prefs() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
export function setPrefs(patch) { const p = { ...prefs(), ...patch }; localStorage.setItem(KEY, JSON.stringify(p)); return p; }
