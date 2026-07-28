import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

export interface SystemPromptEditDialogLabels {
  readonly title: string;
  readonly save: string;
  readonly cancel: string;
  readonly placeholder: string;
}

export interface SystemPromptEditDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly value: string;
  readonly onValueChange: (text: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly labels: SystemPromptEditDialogLabels;
}

export function SystemPromptEditDialog(props: SystemPromptEditDialogProps): ReactNode {
  const { open, onOpenChange, value, onValueChange, onSave, onCancel, labels } = props;

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    onValueChange(e.target.value);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="system-prompt-edit-dialog"
        className="sm:max-w-lg"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <Textarea
          data-testid="system-prompt-edit-textarea"
          value={value}
          onChange={handleChange}
          placeholder={labels.placeholder}
          className="min-h-[200px] resize-y"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {labels.cancel}
          </Button>
          <Button type="button" onClick={onSave}>
            {labels.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
