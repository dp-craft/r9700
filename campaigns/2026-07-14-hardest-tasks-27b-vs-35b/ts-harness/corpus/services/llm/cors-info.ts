export const CORS_EXTENSION_NAME = 'Allow CORS: Access-Control-Allow-Origin';

export const CORS_EXTENSION_URL =
  'https://chromewebstore.google.com/detail/allow-cors-access-control/lhobafahddgcelffkeicbaginigeejlf';

export const CORS_SETUP_STEPS: readonly string[] = [
  'Install "Allow CORS" from the Chrome Web Store',
  'Pin the extension icon in your toolbar',
  'Click the grey "C" icon to enable (turns orange)',
  'Disable when not using AiChatney (security: disables same-origin policy globally)',
];

export const CORS_WARNING: string =
  'This provider may block direct browser requests (CORS). ' +
  'Options: use OpenRouter as a proxy, install a CORS browser extension, ' +
  'or set a custom base URL pointing to your own proxy.';

export const ANTHROPIC_BROWSER_HEADER = 'anthropic-dangerous-direct-browser-access';
export const ANTHROPIC_VERSION_HEADER_VALUE = '2023-06-01';
