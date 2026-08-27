/**
 * IndexedDB Cache for Piper and XTTS Translated Subtitles & Audio
 */

const DB_NAME = 'piper8765Cache';
const DB_STORE = 'videos';

export interface CachedVideoRecord {
  segments: Array<{
    start: number;
    orig_duration: number;
    text: string;
    translated?: string;
    skipped?: boolean;
    failed?: boolean;
  }>;
  blobs: Array<Blob | null>;
  timestamp?: number;
}

export function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported in this environment'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) {
        req.result.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key: string): Promise<CachedVideoRecord | null> {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('idbGet error:', e);
    return null;
  }
}

export async function idbSet(key: string, value: CachedVideoRecord): Promise<void> {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('idbSet error:', e);
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('idbDelete error:', e);
  }
}

export async function idbListKeys(): Promise<string[]> {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('idbListKeys error:', e);
    return [];
  }
}

export async function idbClearAll(): Promise<void> {
  try {
    const keys = await idbListKeys();
    for (const k of keys) {
      await idbDelete(k);
    }
  } catch (e) {
    console.warn('idbClearAll error:', e);
  }
}
