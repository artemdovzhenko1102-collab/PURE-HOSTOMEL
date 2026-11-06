// Увесь API сайту PURE: /api/*
import {
  load, save, json, err, str, int, nid, now, hashPass, checkPass, token, fileName,
  ensureSeed, cookies, currentUser, notifyTelegram, fileStore
} from '../lib/core.mjs';

const PUBLIC_KEYS = ['salon_name', 'salon_sub', 'tagline', 'about', 'phone', 'address', 'hours', 'instagram', 'map_lat', 'map_lng'];
const STATUSES = ['new', 'accepted', 'done', 'cancelled'];
const IMG_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id - b.id;
const hits = new Map(), loginTries = new Map();
const limited = (map, key, max, win) => {
  const t = now(), arr = (map.get(key) || []).filter(x => t - x < win);
  arr.push(t); map.set(key, arr); return arr.length > max;
};

async function saveImage(file) {
  if (!file || typeof file === 'string' || !file.size) return null;
  const ext = IMG_EXT[file.type];
  if (!ext) throw new Error('Підтримуються JPG, PNG, WEBP');
  if (file.size > 5 * 1024 * 1024) throw new Error('Файл завеликий (макс. 5 МБ)');
  const name = fileName(ext);
  await fileStore().set(name, await file.arrayBuffer(), { metadata: { type: file.type } });
  return name;
}
async function removeImage(name) {
  if (name && !name.startsWith('seed-')) try { await fileStore().delete(name); } catch {}
}

export default async (req, context) => {
  try {
    await ensureSeed();
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
    const M = req.method;
    const seg = path.split('/').filter(Boolean);
    const id = int(seg[seg.length - 1]);
    const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'x';
    const isForm = (req.headers.get('content-type') || '').includes('multipart/form-data');
    const body = M === 'GET' || M === 'DELETE' ? {} : isForm ? await req.formData() : await req.json().catch(() => ({}));

    // ---------- public ----------
    if (path === '/public' && M === 'GET') {
      const [st, cat, gallery, masters] = await Promise.all([load('settings', {}), load('catalog', { categories: [], services: [] }), load('gallery', []), load('masters', [])]);
      const settings = {}; PUBLIC_KEYS.forEach(k => settings[k] = st[k] ?? '');
      const svcs = cat.services.filter(s => s.active).sort(bySort);
      return json({
        settings,
        categories: cat.categories.slice().sort(bySort).map(c => ({ ...c, services: svcs.filter(s => s.category_id === c.id) })).filter(c => c.services.length),
        gallery: gallery.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || b.id - a.id).map(({ id, file, caption, tag }) => ({ id, file, caption, tag })),
        masters: masters.filter(m => m.active).sort(bySort).map(({ id, name, title, photo }) => ({ id, name, title, photo }))
      }, 200, { 'Cache-Control': 'no-cache' });
    }

    if (path === '/bookings' && M === 'POST') {
      if (body.website) return json({ ok: true });
      if (limited(hits, ip, 6, 10 * 60e3)) return err('Забагато заявок. Спробуйте пізніше або зателефонуйте нам.', 429);
      const name = str(body.name, 80), phone = str(body.phone, 30), digits = phone.replace(/\D/g, '');
      if (name.length < 2) return err('Вкажіть ім’я');
      if (digits.length < 9 || digits.length > 13) return err('Вкажіть коректний номер телефону');
      const [cat, masters, bookings] = await Promise.all([load('catalog', { categories: [], services: [] }), load('masters', []), load('bookings', [])]);
      let service = str(body.service, 200), serviceId = int(body.service_id);
      const sv = serviceId && cat.services.find(s => s.id === serviceId);
      if (sv) service = (cat.categories.find(c => c.id === sv.category_id)?.name || '') + ': ' + sv.name; else serviceId = null;
      let masterId = int(body.master_id);
      const m = masterId && masters.find(x => x.id === masterId && x.active);
      if (!m) masterId = null;
      const b = {
        id: nid(bookings), created: now(), updated: now(), name, phone, service, service_id: serviceId, master_id: masterId,
        date: /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : '', time: /^\d{2}:\d{2}$/.test(body.time || '') ? body.time : '',
        comment: str(body.comment, 1000), status: 'new', note: '', handled_by: null
      };
      bookings.push(b);
      await save('bookings', bookings);
      await notifyTelegram(`🆕 Нова заявка №${b.id}\n👤 ${name}\n📞 ${phone}\n💅 ${service || '—'}\n👩 ${m ? m.name + ' (' + m.title + ')' : 'будь-який майстер'}\n📅 ${b.date || '—'} ${b.time}\n💬 ${b.comment || '—'}`);
      return json({ ok: true, id: b.id });
    }

    // ---------- auth ----------
    if (path === '/login' && M === 'POST') {
      const users = await load('users', []);
      if (!users.length) return err('Адміністратора ще не створено: додайте змінну ADMIN_PASSWORD у Netlify і зробіть Redeploy', 500);
      const t0 = (loginTries.get(ip) || []).filter(x => now() - x < 15 * 60e3);
      if (t0.length >= 10) return err('Забагато спроб. Зачекайте 15 хвилин.', 429);
      const u = users.find(x => x.login === str(body.login, 60).toLowerCase() && x.active);
      if (!u || !checkPass(body.password || '', u.pass)) { t0.push(now()); loginTries.set(ip, t0); return err('Невірний логін або пароль', 401); }
      const sessions = await load('sessions', {}), t = token(), days = 30;
      for (const k of Object.keys(sessions)) if (sessions[k].expires < now()) delete sessions[k];
      sessions[t] = { user_id: u.id, expires: now() + days * 864e5 };
      await save('sessions', sessions);
      return json({ ok: true, role: u.role }, 200, { 'Set-Cookie': `sid=${t}; HttpOnly; Secure; Path=/; Max-Age=${days * 86400}; SameSite=Lax` });
    }
    if (path === '/logout' && M === 'POST') {
      const t = cookies(req).sid;
      if (t) { const s = await load('sessions', {}); delete s[t]; await save('sessions', s); }
      return json({ ok: true }, 200, { 'Set-Cookie': 'sid=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax' });
    }

    const user = await currentUser(req);
    if (!user) return err('Потрібен вхід', 401);
    const A = user.role === 'admin';

    if (path === '/me') {
      const masters = await load('masters', []), m = masters.find(x => x.id === user.master_id);
      return json({ id: user.id, login: user.login, role: user.role, name: user.name, master_id: user.master_id, master: m ? { name: m.name, title: m.title } : null });
    }
    if (path === '/me/password' && M === 'POST') {
      const users = await load('users', []), u = users.find(x => x.id === user.id);
      if (!checkPass(body.old || '', u.pass)) return err('Поточний пароль невірний');
      if (String(body.new || '').length < 6) return err('Новий пароль — мінімум 6 символів');
      u.pass = hashPass(String(body.new)); await save('users', users);
      const s = await load('sessions', {});
      for (const k of Object.keys(s)) if (s[k].user_id === user.id && k !== user.token) delete s[k];
      await save('sessions', s);
      return json({ ok: true });
    }
    if (path === '/masters-list') return json((await load('masters', [])).slice().sort(bySort).map(({ id, name, title, active }) => ({ id, name, title, active })));

    // ---------- bookings ----------
    if (seg[0] === 'bookings') {
      const [bookings, masters, users] = await Promise.all([load('bookings', []), load('masters', []), load('users', [])]);
      const scope = b => A || !b.master_id || b.master_id === (user.master_id ?? -1);
      if (M === 'GET') {
        const st = STATUSES.includes(url.searchParams.get('status')) ? url.searchParams.get('status') : null;
        const q = str(url.searchParams.get('q'), 60).toLowerCase();
        const vis = bookings.filter(scope), counts = {};
        vis.forEach(b => counts[b.status] = (counts[b.status] || 0) + 1);
        const ord = { new: 0, accepted: 1 };
        const items = vis.filter(b => (!st || b.status === st) && (!q || `${b.name} ${b.phone} ${b.service}`.toLowerCase().includes(q)))
          .sort((a, b) => (ord[a.status] ?? 2) - (ord[b.status] ?? 2) || ((a.status === 'new' || a.status === 'accepted') ? String(a.date || '9').localeCompare(String(b.date || '9')) : 0) || b.created - a.created)
          .slice(0, 500)
          .map(b => { const m = masters.find(x => x.id === b.master_id), h = users.find(x => x.id === b.handled_by); return { ...b, master_name: m?.name, master_title: m?.title, handled_name: h ? (h.name || h.login) : null }; });
        return json({ items, counts });
      }
      const b = bookings.find(x => x.id === id);
      if (!b) return err('Заявку не знайдено', 404);
      if (M === 'DELETE') {
        if (!A) return err('Лише для адміністратора', 403);
        await save('bookings', bookings.filter(x => x !== b)); return json({ ok: true });
      }
      if (M === 'PATCH') {
        if (!A) {
          if (!user.master_id) return err('Ваш акаунт не прив’язаний до майстра. Зверніться до адміністратора.', 403);
          if (b.master_id && b.master_id !== user.master_id) return err('Це заявка іншого майстра', 403);
        }
        if (body.status !== undefined) {
          if (!STATUSES.includes(body.status)) return err('Невірний статус');
          b.status = body.status;
          if (!A && body.status === 'accepted' && !b.master_id) b.master_id = user.master_id;
          if (!A && body.status === 'new') b.master_id = null;
        }
        if (body.date !== undefined) b.date = /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : '';
        if (body.time !== undefined) b.time = /^\d{2}:\d{2}$/.test(body.time) ? body.time : '';
        if (body.note !== undefined) b.note = str(body.note, 1000);
        if (A) {
          if (body.master_id !== undefined) b.master_id = int(body.master_id);
          for (const k of ['name', 'phone', 'service', 'comment']) if (body[k] !== undefined) b[k] = str(body[k], k === 'comment' ? 1000 : 200);
        }
        b.updated = now(); b.handled_by = user.id;
        await save('bookings', bookings); return json({ ok: true });
      }
    }

    // ---------- admin ----------
    if (seg[0] !== 'admin') return err('Not found', 404);
    if (!A) return err('Лише для адміністратора', 403);
    const r = seg[1];

    if (r === 'settings') {
      const st = await load('settings', {});
      if (M === 'PUT') {
        for (const k of [...PUBLIC_KEYS, 'telegram_bot_token', 'telegram_chat_id']) if (body[k] !== undefined) st[k] = str(body[k], 2000);
        await save('settings', st); return json({ ok: true });
      }
      return json(st);
    }
    if (r === 'telegram-test' && M === 'POST') {
      const st = await load('settings', {});
      if (!st.telegram_bot_token || !st.telegram_chat_id) return err('Спочатку збережіть токен бота і chat id');
      try {
        const t = await fetch(`https://api.telegram.org/bot${st.telegram_bot_token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: st.telegram_chat_id, text: '✅ Тест: сповіщення про заявки з сайту PURE працюють' })
        }).then(x => x.json());
        if (!t.ok) return err('Telegram: ' + (t.description || 'помилка'));
        return json({ ok: true });
      } catch { return err('Не вдалося зв’язатися з Telegram', 500); }
    }

    if (r === 'categories' || r === 'services') {
      const cat = await load('catalog', { categories: [], services: [] });
      if (r === 'categories') {
        if (M === 'GET') return json(cat.categories.slice().sort(bySort).map(c => ({ ...c, services: cat.services.filter(s => s.category_id === c.id).sort(bySort) })));
        if (M === 'POST') {
          const c = { id: nid(cat.categories), name: str(body.name, 100) || 'Нова категорія', note: str(body.note, 200), has_top: body.has_top ? 1 : 0, sort: cat.categories.length };
          cat.categories.push(c); await save('catalog', cat); return json({ id: c.id });
        }
        const c = cat.categories.find(x => x.id === id);
        if (!c) return err('Не знайдено', 404);
        if (M === 'PUT') Object.assign(c, { name: str(body.name, 100), note: str(body.note, 200), has_top: body.has_top ? 1 : 0, sort: int(body.sort) ?? 0 });
        if (M === 'DELETE') { cat.categories = cat.categories.filter(x => x.id !== id); cat.services = cat.services.filter(s => s.category_id !== id); }
        await save('catalog', cat); return json({ ok: true });
      }
      if (M === 'POST') {
        const cid = int(body.category_id);
        if (!cat.categories.some(c => c.id === cid)) return err('Категорію не знайдено');
        const s = { id: nid(cat.services), category_id: cid, name: str(body.name, 200) || 'Нова послуга', price: str(body.price, 40), price_top: str(body.price_top, 40), sort: cat.services.filter(x => x.category_id === cid).length, active: 1 };
        cat.services.push(s); await save('catalog', cat); return json({ id: s.id });
      }
      const s = cat.services.find(x => x.id === id);
      if (!s) return err('Не знайдено', 404);
      if (M === 'PUT') Object.assign(s, { name: str(body.name, 200), price: str(body.price, 40), price_top: str(body.price_top, 40), sort: int(body.sort) ?? 0, active: body.active === false || body.active === 0 ? 0 : 1 });
      if (M === 'DELETE') cat.services = cat.services.filter(x => x.id !== id);
      await save('catalog', cat); return json({ ok: true });
    }

    if (r === 'gallery') {
      const gallery = await load('gallery', []);
      if (M === 'GET') return json(gallery.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || b.id - a.id));
      if (M === 'POST') {
        const files = body.getAll('photos').filter(f => f && typeof f !== 'string' && f.size);
        if (!files.length) return err('Оберіть фото (JPG, PNG або WEBP)');
        let min = Math.min(0, ...gallery.map(g => g.sort ?? 0)) - files.length;
        for (const f of files) {
          const name = await saveImage(f);
          gallery.push({ id: nid(gallery), file: name, caption: str(body.get('caption'), 200), tag: str(body.get('tag'), 40), sort: min++, created: now() });
        }
        await save('gallery', gallery); return json({ ok: true, count: files.length });
      }
      const g = gallery.find(x => x.id === id);
      if (!g) return err('Не знайдено', 404);
      if (M === 'PUT') Object.assign(g, { caption: str(body.caption, 200), tag: str(body.tag, 40), sort: int(body.sort) ?? 0 });
      if (M === 'DELETE') { await removeImage(g.file); await save('gallery', gallery.filter(x => x !== g)); return json({ ok: true }); }
      await save('gallery', gallery); return json({ ok: true });
    }

    if (r === 'masters') {
      const masters = await load('masters', []);
      if (M === 'GET') return json(masters.slice().sort(bySort));
      if (M === 'POST') {
        const m = { id: nid(masters), name: str(body.get('name'), 80) || 'Новий майстер', title: str(body.get('title'), 120), photo: (await saveImage(body.get('photo'))) || '', sort: masters.length, active: 1 };
        masters.push(m); await save('masters', masters); return json({ id: m.id });
      }
      const m = masters.find(x => x.id === id);
      if (!m) return err('Не знайдено', 404);
      if (M === 'DELETE') { await removeImage(m.photo); await save('masters', masters.filter(x => x !== m)); return json({ ok: true }); }
      if (M === 'PUT') {
        if (body.get('name') !== null) m.name = str(body.get('name'), 80);
        if (body.get('title') !== null) m.title = str(body.get('title'), 120);
        if (body.get('active') !== null) m.active = body.get('active') === '1' ? 1 : 0;
        const np = await saveImage(body.get('photo'));
        if (np) { await removeImage(m.photo); m.photo = np; }
        if (body.get('remove_photo') === '1') { await removeImage(m.photo); m.photo = ''; }
        await save('masters', masters); return json({ ok: true });
      }
    }

    if (r === 'users') {
      const [users, masters] = await Promise.all([load('users', []), load('masters', [])]);
      if (M === 'GET') return json(users.map(u => ({ id: u.id, login: u.login, role: u.role, name: u.name, master_id: u.master_id, active: u.active, master_name: masters.find(m => m.id === u.master_id)?.name })));
      if (M === 'POST') {
        const login = str(body.login, 40).toLowerCase();
        if (!/^[a-z0-9._-]{3,40}$/.test(login)) return err('Логін: 3–40 символів, латиниця, цифри, . _ -');
        if (String(body.password || '').length < 6) return err('Пароль — мінімум 6 символів');
        if (users.some(u => u.login === login)) return err('Такий логін вже існує');
        const role = body.role === 'admin' ? 'admin' : 'master';
        const u = { id: nid(users), login, pass: hashPass(String(body.password)), role, name: str(body.name, 80), master_id: role === 'master' ? int(body.master_id) : null, active: 1 };
        users.push(u); await save('users', users); return json({ id: u.id });
      }
      const u = users.find(x => x.id === id);
      if (!u) return err('Не знайдено', 404);
      const dropSessions = async () => { const s = await load('sessions', {}); for (const k of Object.keys(s)) if (s[k].user_id === u.id) delete s[k]; await save('sessions', s); };
      if (M === 'DELETE') {
        if (u.id === user.id) return err('Не можна видалити себе');
        await save('users', users.filter(x => x !== u)); await dropSessions(); return json({ ok: true });
      }
      if (M === 'PUT') {
        const role = body.role === 'admin' ? 'admin' : body.role === 'master' ? 'master' : u.role;
        const active = body.active === undefined ? u.active : (body.active ? 1 : 0);
        if (u.role === 'admin' && (role !== 'admin' || !active) && users.filter(x => x.role === 'admin' && x.active).length <= 1)
          return err('Має залишитися хоча б один активний адміністратор');
        if (body.password && String(body.password).length < 6) return err('Пароль — мінімум 6 символів');
        Object.assign(u, { role, active, name: str(body.name ?? u.name, 80), master_id: role === 'master' ? int(body.master_id ?? u.master_id) : null });
        if (body.password) u.pass = hashPass(String(body.password));
        await save('users', users);
        if (body.password || !active) await dropSessions();
        return json({ ok: true });
      }
    }
    return err('Not found', 404);
  } catch (e) {
    console.error(e);
    return err(e.message && /[А-Яа-яІіЇїЄє]/.test(e.message) ? e.message : 'Помилка сервера', 500);
  }
};

export const config = { path: '/api/*' };
