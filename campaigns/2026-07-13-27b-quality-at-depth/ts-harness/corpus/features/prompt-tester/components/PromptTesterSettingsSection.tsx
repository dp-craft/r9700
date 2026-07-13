import type React from 'react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { ParallelismMode } from '@/domain/run-controls';

export type LabFlagViewModel = {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
};

export type PromptTesterSettingsSectionProps = {
  readonly parallelismMode: ParallelismMode;
  readonly onModeChange: (m: ParallelismMode) => void;
  readonly flags: readonly LabFlagViewModel[];
  readonly onToggleFlag: (key: string) => void;
  readonly labels: {
    readonly sameModel: string;
    readonly everything: string;
    readonly heading: string;
    readonly help: string;
  };
  readonly evalModelSlot?: React.ReactNode;
};

const MODE_SELECT_ID = 'lab-settings-parallelism-mode';

const handleValueChange =
  (onModeChange: (m: ParallelismMode) => void) =>
    (value: string): void => {
      onModeChange(value as ParallelismMode);
    };

const handleToggle =
  (onToggleFlag: (key: string) => void, key: string): (() => void) =>
    (): void =>
      onToggleFlag(key);

const FlagRow = ({
  flag,
  onToggleFlag,
}: {
  readonly flag: LabFlagViewModel;
  readonly onToggleFlag: (key: string) => void;
}): React.ReactElement => {
  const switchId = `lab-flag-${flag.key}`;
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={switchId} className="text-sm font-medium">
          {flag.name}
        </Label>
        <p id={`${switchId}-description`} className="text-muted-foreground text-sm">
          {flag.description}
        </p>
      </div>
      <Switch
        id={switchId}
        checked={flag.enabled}
        onCheckedChange={handleToggle(onToggleFlag, flag.key)}
        aria-label={flag.name}
        aria-describedby={`${switchId}-description`}
      />
    </div>
  );
};

export const PromptTesterSettingsSection = ({
  parallelismMode,
  onModeChange,
  flags,
  onToggleFlag,
  labels,
  evalModelSlot,
}: PromptTesterSettingsSectionProps): React.ReactElement => (
  <section className="flex flex-col gap-4" aria-label={labels.heading}>
    <h3 className="text-sm font-medium text-foreground">{labels.heading}</h3>

    <div className="flex flex-col gap-1">
      <Label htmlFor={MODE_SELECT_ID}>{labels.help}</Label>
      <Select value={parallelismMode} onValueChange={handleValueChange(onModeChange)}>
        <SelectTrigger id={MODE_SELECT_ID}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4}>
          <SelectItem value="same-model">{labels.sameModel}</SelectItem>
          <SelectItem value="everything">{labels.everything}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div className="flex flex-col gap-4">
      {flags.map(flag => (
        <FlagRow key={flag.key} flag={flag} onToggleFlag={onToggleFlag} />
      ))}
    </div>

    {evalModelSlot}
  </section>
);
