import type { ReactElement } from 'react';

import { DetailPanelContainer } from './DetailPanelContainer';
import { ResultsGridContainer } from './ResultsGridContainer';

export const RightColumnContainer = (): ReactElement => (
  <div className="flex h-full min-h-0 flex-col">
    <ResultsGridContainer />
    <DetailPanelContainer />
  </div>
);
