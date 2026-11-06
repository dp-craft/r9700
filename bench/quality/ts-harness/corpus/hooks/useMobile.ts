import { useMediaQuery } from './useMediaQuery';

const MOBILE_QUERY = '(max-width: 767px)' as const;

export interface MobileViewportState {
  readonly isMobile: boolean;
}

export function useMobile(): MobileViewportState {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  return { isMobile };
}
