export const isElectron = (): boolean =>
  window.electronAPI !== undefined && window.electronAPI !== null;

export const getProxyBaseUrl = (): string | null => {
  const api = window.electronAPI;
  if (api === undefined || api === null) {
    return null;
  }
  return `http://127.0.0.1:${api.proxyPort}`;
};
