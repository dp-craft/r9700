import { Download } from 'lucide-react';
import type * as React from 'react';
import { useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { useTranslation } from '@/i18n';

export function SidebarFooterContainer(): React.ReactElement {
  const t = useTranslation();
  const { canInstall, promptInstall } = usePwaInstall();

  const handleInstall = useCallback((): void => {
    void promptInstall();
  }, [promptInstall]);

  return (
    <div className="flex flex-col gap-2">
      {canInstall && (
        <Button onClick={handleInstall} variant="outline" className="w-full">
          <Download className="mr-2 h-4 w-4" />
          {t('common.installApp')}
        </Button>
      )}
    </div>
  );
}
