'use client';

const DB_NAME = 'be_images';
const STORE_NAME = 'images';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function key(courseId: string, index: number) {
  return `${courseId}__${index}`;
}

export async function loadImage(courseId: string, index: number): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key(courseId, index));
      req.onsuccess = () => resolve((req.result as string) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

export async function saveImage(courseId: string, index: number, dataUrl: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(dataUrl, key(courseId, index));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* silently ignore */ }
}

export async function loadAllImages(courseId: string, count: number): Promise<Record<number, string>> {
  const entries = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      loadImage(courseId, i).then(url => [i, url] as [number, string | null])
    )
  );
  const result: Record<number, string> = {};
  entries.forEach(([i, url]) => { if (url) result[i] = url; });
  return result;
}

export async function deleteImages(courseId: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      // IDBKeyRange to delete all keys starting with courseId__
      const range = IDBKeyRange.bound(`${courseId}__`, `${courseId}__\uffff`);
      const req = store.delete(range);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch { /* ignore */ }
}
