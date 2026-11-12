import type { ChatSession } from './idb';
import { getDb, promisifyRequest, transactionComplete } from './idb';

export async function getAllSessions(): Promise<ChatSession[]> {
  const db = await getDb();
  const tx = db.transaction('sessions', 'readonly');
  const idx = tx.objectStore('sessions').index('updatedAt');
  const all = await promisifyRequest<ChatSession[]>(idx.getAll());
  return all.reverse();
}

export async function putSession(session: ChatSession): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('sessions', 'readwrite');
  tx.objectStore('sessions').put(session);
  await transactionComplete(tx);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['sessions', 'messages'], 'readwrite');
  tx.objectStore('sessions').delete(sessionId);
  const range = IDBKeyRange.bound([sessionId, -Infinity], [sessionId, +Infinity]);
  const req = tx.objectStore('messages').index('sessionId_createdAt').openCursor(range);
  await new Promise<void>((resolve, reject) => {
    req.onsuccess = (): void => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = (): void => reject(req.error);
  });
  await transactionComplete(tx);
}
