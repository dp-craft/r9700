import { memo, type MemoExoticComponent, type ReactElement } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

import type { SettingsNavGroup } from './SettingsNav';

export interface SettingsMobileNavProps {
  readonly groups: readonly SettingsNavGroup[];
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
  readonly ariaLabel: string;
}

function SettingsMobileNavBase(props: SettingsMobileNavProps): ReactElement {
  const { groups, activeId, onSelect, ariaLabel } = props;

  const items = groups.flatMap(group => group.items);

  return (
    <div className="border-b border-border bg-card p-3 sm:hidden">
      <Select value={activeId} onValueChange={onSelect}>
        <SelectTrigger aria-label={ariaLabel} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4}>
          {items.map(item => (
            <SelectItem key={item.id} value={item.id}>
              {item.labelKey}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export const SettingsMobileNav: MemoExoticComponent<typeof SettingsMobileNavBase> =
  memo(SettingsMobileNavBase);
