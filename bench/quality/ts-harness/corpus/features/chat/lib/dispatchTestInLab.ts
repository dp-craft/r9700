import { TEST_IN_LAB_PAYLOAD_CAP } from '@/config';
import type { ChatMessage, ChatSession } from '@/db/idb';
import { usePromptTesterStore } from '@/features/prompt-tester';
import { useUIStore } from '@/stores/useUIStore';

import { buildTestInLabPayload, truncatePayload } from './buildTestInLabPayload';

export function dispatchTestInLab(
  session: ChatSession | null | undefined,
  message: ChatMessage
): void {
  const raw = buildTestInLabPayload(session, message);
  if (raw === null) return;
  const { payload } = truncatePayload(raw, TEST_IN_LAB_PAYLOAD_CAP);
  usePromptTesterStore.getState().openScratchTab(payload);
  useUIStore.getState().requestWorkspacePanel('prompt-lab', 'tester');
}
