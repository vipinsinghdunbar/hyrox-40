/* IndexedDB repository: each action writes the full session and an undo checkpoint atomically. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HyroxStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DB_NAME = 'hyrox40-local-v1';
  const DB_VERSION = 1;
  const SESSION_STORE = 'sessions';
  const META_STORE = 'meta';

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }
  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
    });
  }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function openDatabase(indexedDB = globalThis.indexedDB) {
    if (!indexedDB) return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open local workout storage.'));
      req.onblocked = () => reject(new Error('Local workout database upgrade is blocked by another tab.'));
    });
  }

  function createRepository({ indexedDB = globalThis.indexedDB, now = () => Date.now() } = {}) {
    let dbPromise;
    function db() { return dbPromise ||= openDatabase(indexedDB); }
    return {
      async save(session, { checkpoint = true } = {}) {
        const database = await db();
        const tx = database.transaction([SESSION_STORE, META_STORE], 'readwrite');
        const done = transactionDone(tx);
        const sessions = tx.objectStore(SESSION_STORE);
        const meta = tx.objectStore(META_STORE);
        const previous = await requestResult(sessions.get(session.id));
        if (checkpoint && previous) {
          const historyReq = meta.get(`undo:${session.id}`);
          const history = await requestResult(historyReq) || { key: `undo:${session.id}`, items: [] };
          history.items.push(previous);
          if (history.items.length > 50) history.items.shift();
          meta.put(history);
        }
        sessions.put(clone(session));
        await done;
        return clone(session);
      },
      async get(id) {
        const database = await db();
        const tx = database.transaction(SESSION_STORE, 'readonly');
        const result = await requestResult(tx.objectStore(SESSION_STORE).get(id));
        await transactionDone(tx);
        return result || null;
      },
      async latest() {
        const database = await db();
        const tx = database.transaction(SESSION_STORE, 'readonly');
        const all = await requestResult(tx.objectStore(SESSION_STORE).getAll());
        await transactionDone(tx);
        return all.sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt))[0] || null;
      },
      async list() {
        const database = await db();
        const tx = database.transaction(SESSION_STORE, 'readonly');
        const all = await requestResult(tx.objectStore(SESSION_STORE).getAll());
        await transactionDone(tx);
        return all.sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt));
      },
      async undo(id) {
        const database = await db();
        const tx = database.transaction([SESSION_STORE, META_STORE], 'readwrite');
        const done = transactionDone(tx);
        const sessions = tx.objectStore(SESSION_STORE);
        const meta = tx.objectStore(META_STORE);
        const history = await requestResult(meta.get(`undo:${id}`));
        if (!history?.items?.length) { await done; return null; }
        const restored = history.items.pop();
        sessions.put(restored);
        if (history.items.length) meta.put(history); else meta.delete(`undo:${id}`);
        await done;
        return clone(restored);
      },
      async remove(id) {
        const database = await db();
        const tx = database.transaction([SESSION_STORE, META_STORE], 'readwrite');
        tx.objectStore(SESSION_STORE).delete(id);
        tx.objectStore(META_STORE).delete(`undo:${id}`);
        await transactionDone(tx);
      },
      async exportAll() {
        return { format: 'hyrox40-local-backup', version: 1, exportedAt: new Date(now()).toISOString(), sessions: await this.list() };
      },
      async importAll(backup) {
        if (!backup || backup.format !== 'hyrox40-local-backup' || backup.version !== 1 || !Array.isArray(backup.sessions)) {
          throw new Error('This backup file is not a supported HYROX 40 backup.');
        }
        if (backup.sessions.some(s => !s || typeof s.id !== 'string' || !Array.isArray(s.segments))) throw new Error('The backup contains an invalid workout.');
        const database = await db();
        const tx = database.transaction(SESSION_STORE, 'readwrite');
        for (const session of backup.sessions) tx.objectStore(SESSION_STORE).put(clone(session));
        await transactionDone(tx);
        return backup.sessions.length;
      },
      async requestPersistentStorage(storage = globalThis.navigator?.storage) {
        if (!storage?.persist) return false;
        try { return await storage.persist(); } catch (_) { return false; }
      },
      close() { dbPromise?.then(database => database.close()).catch(() => {}); dbPromise = null; },
    };
  }
  return { DB_NAME, createRepository, openDatabase };
});
