/* Local-only IndexedDB repository. No server, account, telemetry, or third-party calls. */
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
  const META_KEYS = Object.freeze(['profile', 'measurements', 'calendar', 'program']);

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
        if (!session || typeof session.id !== 'string') throw new TypeError('A session id is required.');
        const database = await db();
        const tx = database.transaction([SESSION_STORE, META_STORE], 'readwrite');
        const done = transactionDone(tx);
        const sessions = tx.objectStore(SESSION_STORE), meta = tx.objectStore(META_STORE);
        const previous = await requestResult(sessions.get(session.id));
        if (checkpoint && previous) {
          const history = await requestResult(meta.get(`undo:${session.id}`)) || { key: `undo:${session.id}`, items: [] };
          history.items.push(previous);
          if (history.items.length > 50) history.items.shift();
          meta.put(history);
        }
        sessions.put(clone(session));
        await done;
        return clone(session);
      },
      async get(id) {
        const database = await db(), tx = database.transaction(SESSION_STORE, 'readonly');
        const done = transactionDone(tx), result = await requestResult(tx.objectStore(SESSION_STORE).get(id));
        await done;
        return result || null;
      },
      async latest() {
        const all = await this.list();
        return all[0] || null;
      },
      async list() {
        const database = await db(), tx = database.transaction(SESSION_STORE, 'readonly');
        const done = transactionDone(tx), all = await requestResult(tx.objectStore(SESSION_STORE).getAll());
        await done;
        return all.sort((a, b) => (b.startedAt ?? b.createdAt ?? 0) - (a.startedAt ?? a.createdAt ?? 0));
      },
      async undo(id) {
        const database = await db(), tx = database.transaction([SESSION_STORE, META_STORE], 'readwrite');
        const done = transactionDone(tx), sessions = tx.objectStore(SESSION_STORE), meta = tx.objectStore(META_STORE);
        const history = await requestResult(meta.get(`undo:${id}`));
        if (!history?.items?.length) { await done; return null; }
        const restored = history.items.pop();
        sessions.put(restored);
        if (history.items.length) meta.put(history); else meta.delete(`undo:${id}`);
        await done;
        return clone(restored);
      },
      async remove(id) {
        const database = await db(), tx = database.transaction([SESSION_STORE, META_STORE], 'readwrite');
        const done = transactionDone(tx);
        tx.objectStore(SESSION_STORE).delete(id);
        tx.objectStore(META_STORE).delete(`undo:${id}`);
        await done;
      },
      async getMetadata(key, fallback = null) {
        if (!META_KEYS.includes(key)) throw new Error('Unknown local-data key.');
        const database = await db(), tx = database.transaction(META_STORE, 'readonly');
        const done = transactionDone(tx), item = await requestResult(tx.objectStore(META_STORE).get(key));
        await done;
        return item ? clone(item.value) : clone(fallback);
      },
      async setMetadata(key, value) {
        if (!META_KEYS.includes(key)) throw new Error('Unknown local-data key.');
        const database = await db(), tx = database.transaction(META_STORE, 'readwrite'), done = transactionDone(tx);
        tx.objectStore(META_STORE).put({ key, value: clone(value), updatedAt: now() });
        await done;
        return clone(value);
      },
      async exportAll() {
        const [sessions, ...values] = await Promise.all([this.list(), ...META_KEYS.map(key => this.getMetadata(key))]);
        const metadata = Object.fromEntries(META_KEYS.map((key, index) => [key, values[index]]));
        return { format: 'hyrox40-local-backup', version: 2, exportedAt: new Date(now()).toISOString(), sessions, metadata };
      },
      async importAll(backup) {
        if (!backup || backup.format !== 'hyrox40-local-backup' || ![1, 2].includes(backup.version) || !Array.isArray(backup.sessions)) {
          throw new Error('This backup file is not a supported HYROX backup.');
        }
        if (backup.sessions.some(s => !s || typeof s.id !== 'string' || !Array.isArray(s.segments))) throw new Error('The backup contains an invalid workout.');
        if (backup.version === 2 && (backup.metadata == null || typeof backup.metadata !== 'object' || Array.isArray(backup.metadata))) throw new Error('The backup metadata is invalid.');
        const database = await db(), tx = database.transaction([SESSION_STORE, META_STORE], 'readwrite'), done = transactionDone(tx);
        const sessionsStore = tx.objectStore(SESSION_STORE), metaStore = tx.objectStore(META_STORE);
        for (const session of backup.sessions) sessionsStore.put(clone(session));
        if (backup.version === 2) for (const key of META_KEYS) {
          if (Object.prototype.hasOwnProperty.call(backup.metadata, key)) metaStore.put({ key, value: clone(backup.metadata[key]), updatedAt: now() });
        }
        await done;
        return backup.sessions.length;
      },
      async requestPersistentStorage(storage = globalThis.navigator?.storage) {
        if (!storage?.persist) return false;
        try { return await storage.persist(); } catch (_) { return false; }
      },
      close() { dbPromise?.then(database => database.close()).catch(() => {}); dbPromise = null; },
    };
  }
  return { DB_NAME, createRepository, openDatabase, META_KEYS };
});
