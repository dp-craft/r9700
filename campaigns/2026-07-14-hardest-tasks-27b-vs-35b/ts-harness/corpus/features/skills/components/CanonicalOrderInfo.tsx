import { Info } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface CanonicalOrderInfoLabels {
  readonly buttonAriaLabel: string;
  readonly dialogTitle: string;
  readonly dialogDescription: string;
  readonly layersAriaLabel: string;
  readonly layerPersonaName: string;
  readonly layerPersonaDescription: string;
  readonly layerContextName: string;
  readonly layerContextDescription: string;
  readonly layerConstraintsName: string;
  readonly layerConstraintsDescription: string;
  readonly layerFormatName: string;
  readonly layerFormatDescription: string;
  readonly layerExamplesName: string;
  readonly layerExamplesDescription: string;
}

export interface CanonicalOrderInfoProps {
  readonly labels?: CanonicalOrderInfoLabels;
  readonly className?: string;
}

const DEFAULT_LABELS: CanonicalOrderInfoLabels = {
  buttonAriaLabel: 'Canonical layer order info',
  dialogTitle: 'Canonical Layer Order',
  dialogDescription: 'Skills ordered by layer produce more effective and consistent AI responses.',
  layersAriaLabel: 'Skill layer ordering',
  layerPersonaName: 'Persona',
  layerPersonaDescription: 'Who the AI should be',
  layerContextName: 'Context',
  layerContextDescription: 'Background and setup',
  layerConstraintsName: 'Constraints',
  layerConstraintsDescription: 'Rules and limitations',
  layerFormatName: 'Format',
  layerFormatDescription: 'Output structure',
  layerExamplesName: 'Examples',
  layerExamplesDescription: 'Demonstrations',
};

interface LayerDefinition {
  readonly position: number;
  readonly name: string;
  readonly description: string;
}

const buildLayerDefinitions = (l: CanonicalOrderInfoLabels): readonly LayerDefinition[] => [
  { position: 1, name: l.layerPersonaName, description: l.layerPersonaDescription },
  { position: 2, name: l.layerContextName, description: l.layerContextDescription },
  { position: 3, name: l.layerConstraintsName, description: l.layerConstraintsDescription },
  { position: 4, name: l.layerFormatName, description: l.layerFormatDescription },
  { position: 5, name: l.layerExamplesName, description: l.layerExamplesDescription },
];

export function CanonicalOrderInfo({
  labels = DEFAULT_LABELS,
  className,
}: CanonicalOrderInfoProps): React.ReactElement {
  const layerDefinitions = buildLayerDefinitions(labels);

  return (
    <Dialog>
      <div className={cn(className)}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={labels.buttonAriaLabel}
            className="h-8 w-8"
          >
            <Info className="h-4 w-4" />
            <span className="sr-only">{labels.buttonAriaLabel}</span>
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.dialogTitle}</DialogTitle>
          <DialogDescription>{labels.dialogDescription}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 pl-1" aria-label={labels.layersAriaLabel}>
          {layerDefinitions.map(layer => (
            <li key={layer.position} className="flex items-start gap-3">
              <span
                className="bg-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                aria-hidden="true"
              >
                {layer.position}
              </span>
              <div>
                <span className="font-semibold">{layer.name}</span>
                <span className="text-muted-foreground"> &mdash; {layer.description}</span>
              </div>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
