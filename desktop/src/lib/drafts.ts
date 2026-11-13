// One local draft, transactionally replaced. No network, raw input files or response data.
export interface Draft { text: string; at: number }
let pending: Promise<unknown> = Promise.resolve();
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('xml-wizard-local', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close another XML Wizard tab and retry.'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const request = action(tx.objectStore('drafts'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Local storage is unavailable.')); };
  });
}
export function writeDraft(draft: Draft): Promise<unknown> {
  // Serialize writes, including switches between projects.
  pending = pending.catch(() => {}).then(() => transaction('readwrite', (s) => s.put(draft, 'current')));
  return pending;
}
export async function readDraft(): Promise<Draft | undefined> {
  await pending.catch(() => {});
  return transaction('readonly', (s) => s.get('current'));
}
export async function deleteDraft() {
  await pending.catch(() => {});
  return transaction('readwrite', (s) => s.delete('current'));
}
