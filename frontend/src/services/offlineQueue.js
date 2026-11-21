const DB_NAME = 'rwa-offline-queue';
const DB_VERSION = 1;
const STORE_NAME = 'action-queue';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueAction(action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry = {
      ...action,
      status: 'pending',
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: action.maxRetries || 5,
    };
    const req = store.add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getPendingActions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('status');
    const req = index.getAll('pending');
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function markActionCompleted(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      const entry = req.result;
      if (entry) {
        entry.status = 'completed';
        entry.completedAt = Date.now();
        store.put(entry);
      }
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

export async function markActionFailed(id, error) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      const entry = req.result;
      if (entry) {
        entry.retryCount += 1;
        entry.lastError = error?.message || String(error);
        if (entry.retryCount >= entry.maxRetries) {
          entry.status = 'failed';
        }
        store.put(entry);
      }
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

export async function getQueueStats() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('status');
    const req = index.getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      const pending = items.filter((i) => i.status === 'pending').length;
      const completed = items.filter((i) => i.status === 'completed').length;
      const failed = items.filter((i) => i.status === 'failed').length;
      resolve({ pending, completed, failed, total: items.length });
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function flushQueue(executor) {
  const pending = await getPendingActions();
  const results = [];

  for (const action of pending) {
    try {
      await executor(action);
      await markActionCompleted(action.id);
      results.push({ id: action.id, status: 'completed' });
    } catch (err) {
      await markActionFailed(action.id, err);
      results.push({ id: action.id, status: 'failed', error: err.message });
    }
  }

  return results;
}

export async function clearCompletedActions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('status');
    const req = index.getAllKeys('completed');
    req.onsuccess = () => {
      const keys = req.result || [];
      keys.forEach((key) => store.delete(key));
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}
