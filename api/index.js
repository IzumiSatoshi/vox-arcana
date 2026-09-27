import { createApiHandler } from '../api-handler.js';
const handle = createApiHandler({ hosted: true });
export default function handler(req, res) {
  // Vercel's wildcard rewrite supplies the original endpoint as `path`.
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api' || url.pathname === '/api/index') {
    const route = req.query?.path || url.searchParams.get('path');
    if (route) {
      url.searchParams.delete('path');
      const query = url.searchParams.toString();
      req.url = `/api/${Array.isArray(route) ? route.join('/') : route}${query ? '?' + query : ''}`;
    }
  }
  return handle(req, res);
}
