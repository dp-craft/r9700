import { Plus } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';

export interface SkillsHeaderActionProps {
  readonly label: string;
  readonly ariaLabel: string;
  readonly onClick: () => void;
}

export function SkillsHeaderAction({
  label,
  ariaLabel,
  onClick,
}: SkillsHeaderActionProps): React.ReactElement {
  return (
    <Button variant="outline" size="sm" onClick={onClick} aria-label={ariaLabel}>
      <Plus className="mr-1 h-4 w-4" />
      {label}
    </Button>
  );
}
