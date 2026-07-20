import type { ChangeEvent, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type { PromptPickerTab } from '../types';

export interface PromptPickerDialogLabels {
  readonly title: string;
  readonly tabSkills: string;
  readonly tabPackages: string;
  readonly tabHistory: string;
  readonly tabBlank: string;
  readonly confirmBlank: string;
  readonly blankPlaceholder: string;
  readonly blankTextareaLabel: string;
}

export interface PromptPickerDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly activeTab: PromptPickerTab;
  readonly onTabChange: (tab: PromptPickerTab) => void;
  readonly skillsSlot: ReactNode;
  readonly packagesSlot: ReactNode;
  readonly historySlot: ReactNode;
  readonly onConfirmBlank: () => void;
  readonly customPromptValue: string;
  readonly onCustomPromptChange: (value: string) => void;
  readonly labels: PromptPickerDialogLabels;
  readonly className?: string;
}

export function PromptPickerDialog(props: PromptPickerDialogProps): ReactNode {
  const {
    open,
    onOpenChange,
    activeTab,
    onTabChange,
    skillsSlot,
    packagesSlot,
    historySlot,
    onConfirmBlank,
    customPromptValue,
    onCustomPromptChange,
    labels,
    className,
  } = props;

  const VALID_TABS: readonly PromptPickerTab[] = ['skills', 'packages', 'history', 'blank'];
  const isTab = (v: string): v is PromptPickerTab => (VALID_TABS as readonly string[]).includes(v);
  const handleTabChange = (value: string): void => {
    if (isTab(value)) onTabChange(value);
  };
  const handleCustomPromptChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    onCustomPromptChange(e.target.value);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="prompt-picker-dialog"
        className={cn('sm:max-w-lg', className)}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full">
            <TabsTrigger value="skills" className="flex-1">
              {labels.tabSkills}
            </TabsTrigger>
            <TabsTrigger value="packages" className="flex-1">
              {labels.tabPackages}
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1">
              {labels.tabHistory}
            </TabsTrigger>
            <TabsTrigger value="blank" className="flex-1">
              {labels.tabBlank}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="skills">{skillsSlot}</TabsContent>
          <TabsContent value="packages">{packagesSlot}</TabsContent>
          <TabsContent value="history">{historySlot}</TabsContent>
          <TabsContent value="blank">
            <div className="flex flex-col gap-4 py-2">
              <Textarea
                data-testid="custom-prompt-textarea"
                value={customPromptValue}
                onChange={handleCustomPromptChange}
                placeholder={labels.blankTextareaLabel}
                aria-label={labels.blankTextareaLabel}
                className="min-h-32 resize-none"
              />
              <div className="flex justify-end">
                <Button type="button" onClick={onConfirmBlank}>
                  {labels.confirmBlank}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
