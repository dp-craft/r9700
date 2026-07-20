import { useTranslation } from '@/i18n';

import { useCompareSplit } from '../hooks/useCompareSplit';
import { useResultsGridBody } from '../hooks/useResultsGridBody';
import { CompareStripContainer } from './CompareStripContainer';

export const ResultsGridContainer = (): React.ReactElement => {
  const t = useTranslation();
  const { body } = useResultsGridBody();
  const { ratio, onResizeStart } = useCompareSplit();

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div
        data-testid="results-body-region"
        className="relative overflow-auto min-h-0 grow-0 shrink"
        style={{ flexBasis: `${ratio * 100}%` }}
      >
        {body}
      </div>
      <button
        type="button"
        data-testid="strip-resize-handle"
        aria-label={t('lab.grid.resizeHandleAria')}
        onPointerDown={onResizeStart}
        className="h-1.5 shrink-0 cursor-row-resize bg-border hover:bg-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <div
        className="flex flex-col min-h-0 grow-0 shrink overflow-auto"
        style={{ flexBasis: `${(1 - ratio) * 100}%` }}
      >
        <CompareStripContainer />
      </div>
    </div>
  );
};
