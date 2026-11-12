import type React from 'react';

import { CompareStrip } from '../components/CompareStrip';
import { useCompareStrip } from '../hooks/useCompareStrip';

export const CompareStripContainer = (): React.ReactNode => {
  const props = useCompareStrip();
  return <CompareStrip {...props} />;
};
