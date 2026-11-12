import type { ChatMessage } from './idb';
import { getDb, promisifyRequest, transactionComplete } from './idb';

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
  const db = await getDb();
  const tx = db.transaction('messages', 'readonly');
  const idx = tx.objectStore('messages').index('sessionId_createdAt');
  const range = IDBKeyRange.bound([sessionId, -Infinity], [sessionId, +Infinity]);
  return promisifyRequest<ChatMessage[]>(idx.getAll(range));
}

export async function deleteMessagesBySession(sessionId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('messages', 'readwrite');
  const store = tx.objectStore('messages');
  const idx = store.index('sessionId_createdAt');
  const range = IDBKeyRange.bound([sessionId, -Infinity], [sessionId, +Infinity]);
  const messages = await promisifyRequest<ChatMessage[]>(idx.getAll(range));
  for (const msg of messages) {
    store.delete(msg.id);
  }
  await transactionComplete(tx);
}

export async function putMessage(message: ChatMessage): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['messages', 'sessions'], 'readwrite');
  tx.objectStore('messages').put(message);
  const sessReq = tx.objectStore('sessions').get(message.sessionId);
  await promisifyRequest(sessReq);
  if (sessReq.result) {
    sessReq.result.updatedAt = message.createdAt;
    tx.objectStore('sessions').put(sessReq.result);
  }
  await transactionComplete(tx);
}
