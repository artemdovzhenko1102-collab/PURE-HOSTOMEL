// Віддає фото, завантажені через адмінку (зберігаються в Netlify Blobs).
// Стартові фото seed-*.jpg лежать у public/uploads і віддаються як звичайні файли.
import { fileStore } from '../lib/core.mjs';

export default async (req) => {
  const name = decodeURIComponent(new URL(req.url).pathname.split('/').pop() || '');
  if (!/^[\w.-]+$/.test(name)) return new Response('Not found', { status: 404 });
  const res = await fileStore().getWithMetadata(name, { type: 'arrayBuffer' });
  if (!res) return new Response('Not found', { status: 404 });
  return new Response(res.data, {
    headers: { 'Content-Type': res.metadata?.type || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' }
  });
};

export const config = { path: '/uploads/*', preferStatic: true };
