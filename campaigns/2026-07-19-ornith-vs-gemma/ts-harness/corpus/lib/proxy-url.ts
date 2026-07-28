import { getProxyBaseUrl, isElectron } from '@/lib/platform';

export const getProxyUrl = (originalUrl: string): string => {
  if (!isElectron()) {
    return originalUrl;
  }
  const baseUrl = getProxyBaseUrl();
  if (baseUrl === null) {
    return originalUrl;
  }
  return `${baseUrl}/proxy?target=${encodeURIComponent(originalUrl)}`;
};
