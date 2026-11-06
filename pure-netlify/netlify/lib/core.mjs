// Спільна логіка: сховище (Netlify Blobs), авторизація, допоміжні функції
import { getStore as realGetStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import SEED from './seed.mjs';

const getStore = (...a) => (globalThis.__mockGetStore || realGetStore)(...a);
export const dataStore = () => getStore({ name: 'pure-data', consistency: 'strong' });
export const fileStore = () => getStore({ name: 'pure-uploads', consistency: 'strong' });

export async function load(key, def) {
  const v = await dataStore().get(key, { type: 'json' });
  return v ?? def;
}
export async function save(key, val) { await dataStore().setJSON(key, val); }

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
export const err = (msg, status = 400) => json({ error: msg }, status);

export const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
export const int = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(+v) ? Math.trunc(+v) : null));
export const nid = arr => arr.reduce((m, x) => Math.max(m, x.id), 0) + 1;
export const now = () => Date.now();

export function hashPass(p) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex');
}
export function checkPass(p, stored) {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(String(p), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const token = () => crypto.randomBytes(32).toString('hex');
export const fileName = ext => Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex') + ext;

// Перший запуск: заповнюємо сховище стартовими даними
let seeded = false;
export async function ensureSeed() {
  if (seeded) return;
  const s = await dataStore().get('settings', { type: 'json' });
  if (!s) {
    await save('settings', { ...SEED.settings, telegram_bot_token: '', telegram_chat_id: '' });
    await save('catalog', { categories: SEED.categories, services: SEED.services });
    await save('gallery', SEED.gallery);
    await save('masters', SEED.masters);
    await save('bookings', []);
    await save('sessions', {});
  }
  const users = await load('users', null);
  if (!users || !users.length) {
    const pass = process.env.ADMIN_PASSWORD;
    if (!pass) return; // без ADMIN_PASSWORD адміна не створюємо — перевіримо знову на наступному запиті
    await save('users', [{ id: 1, login: 'admin', pass: hashPass(pass), role: 'admin', name: 'Адміністратор', master_id: null, active: 1 }]);
  }
  seeded = true;
}

export function cookies(req) {
  const out = {};
  (req.headers.get('cookie') || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
export async function currentUser(req) {
  const t = cookies(req).sid;
  if (!t) return null;
  const sessions = await load('sessions', {});
  const s = sessions[t];
  if (!s || s.expires < now()) return null;
  const users = await load('users', []);
  const u = users.find(x => x.id === s.user_id && x.active);
  return u ? { ...u, token: t } : null;
}

export async function notifyTelegram(text) {
  const st = await load('settings', {});
  if (!st.telegram_bot_token || !st.telegram_chat_id) return;
  try {
    await fetch(`https://api.telegram.org/bot${st.telegram_bot_token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: st.telegram_chat_id, text, disable_web_page_preview: true })
    });
  } catch (e) { console.error('Telegram:', e.message); }
}
