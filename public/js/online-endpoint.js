export function duelEndpoint(config, pageURL) {
  const page = new URL(pageURL);
  let endpoint = config?.url;
  if (!endpoint && ['localhost', '127.0.0.1'].includes(page.hostname)) endpoint = `ws://${page.hostname}:8788/duel`;
  if (!endpoint) return null;
  const url = new URL(endpoint, page);
  if (endpoint.startsWith('/')) url.protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!['ws:', 'wss:'].includes(url.protocol) || (page.protocol === 'https:' && url.protocol !== 'wss:') || url.username || url.password) {
    throw new Error('A secure duel server URL is required.');
  }
  return url.href;
}
