import type { ReactElement } from 'react';
import { useState } from 'react';

import { useTranslation } from '@/i18n';

import { SystemPromptEditDialog } from '../components/SystemPromptEditDialog';
import { usePromptTesterStore } from '../stores/usePromptTesterStore';

interface InnerProps {
  readonly initialText: string;
  readonly editingPromptId: string;
}

function SystemPromptEditDialogInner({ initialText, editingPromptId }: InnerProps): ReactElement {
  const t = useTranslation();
  const editPrompt = usePromptTesterStore(s => s.editPrompt);
  const setEditingPrompt = usePromptTesterStore(s => s.setEditingPrompt);
  const [draft, setDraft] = useState(initialText);

  const handleOpenChange = (open: boolean): void => {
    if (!open) setEditingPrompt(null);
  };

  const handleSave = (): void => {
    editPrompt(editingPromptId, draft);
    setEditingPrompt(null);
  };

  const handleCancel = (): void => {
    setEditingPrompt(null);
  };

  return (
    <SystemPromptEditDialog
      open
      onOpenChange={handleOpenChange}
      value={draft}
      onValueChange={setDraft}
      onSave={handleSave}
      onCancel={handleCancel}
      labels={{
        title: t('lab.systemPromptEdit.title'),
        save: t('lab.systemPromptEdit.save'),
        cancel: t('lab.systemPromptEdit.cancel'),
        placeholder: t('lab.systemPromptEdit.placeholder'),
      }}
    />
  );
}

export function SystemPromptEditDialogContainer(): ReactElement | null {
  const editingPromptId = usePromptTesterStore(s => s.editingPromptId);
  const prompts = usePromptTesterStore(s => s.prompts);

  const entry = editingPromptId !== null ? prompts.find(p => p.id === editingPromptId) : undefined;

  if (editingPromptId === null || entry === undefined) return null;

  return (
    <SystemPromptEditDialogInner
      key={editingPromptId}
      initialText={entry.text}
      editingPromptId={editingPromptId}
    />
  );
}
