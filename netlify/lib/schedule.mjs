// Графіки майстрів і розрахунок вільних слотів (час — Київ)
export const DEFAULT_SCHEDULE = () => ({
  step: 60,          // тривалість одного запису, хв
  horizon: 30,       // на скільки днів наперед можна записатися
  week: {            // 1 = понеділок … 7 = неділя
    1: { on: true, from: '09:00', to: '19:00' }, 2: { on: true, from: '09:00', to: '19:00' },
    3: { on: true, from: '09:00', to: '19:00' }, 4: { on: true, from: '09:00', to: '19:00' },
    5: { on: true, from: '09:00', to: '19:00' }, 6: { on: true, from: '10:00', to: '17:00' },
    7: { on: false, from: '10:00', to: '17:00' }
  },
  overrides: {}      // { 'YYYY-MM-DD': { on: false } | { on: true, from, to } }
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
export const toTime = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

export function kyivNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
const dow = date => { const d = new Date(date + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };

// перевірка й нормалізація графіка, який прийшов з адмінки
export function cleanSchedule(s) {
  const out = DEFAULT_SCHEDULE();
  if (!s || typeof s !== 'object') return out;
  if ([15, 20, 30, 45, 60, 75, 90, 120, 150, 180].includes(+s.step)) out.step = +s.step;
  if (+s.horizon >= 1 && +s.horizon <= 120) out.horizon = Math.trunc(+s.horizon);
  for (let d = 1; d <= 7; d++) {
    const w = s.week?.[d];
    if (w && TIME.test(w.from) && TIME.test(w.to) && toMin(w.to) > toMin(w.from)) out.week[d] = { on: !!w.on, from: w.from, to: w.to };
    else if (w) out.week[d].on = !!w.on;
  }
  const today = kyivNow().date;
  for (const [date, o] of Object.entries(s.overrides || {})) {
    if (!DATE.test(date) || date < addDays(today, -1)) continue; // минулі винятки прибираємо
    if (o && o.on === false) out.overrides[date] = { on: false };
    else if (o && TIME.test(o.from) && TIME.test(o.to) && toMin(o.to) > toMin(o.from)) out.overrides[date] = { on: true, from: o.from, to: o.to };
  }
  return out;
}

export function dayHours(sch, date) {
  const o = sch.overrides?.[date];
  if (o) return o.on === false ? null : o;
  const w = sch.week?.[dow(date)];
  return w && w.on ? w : null;
}

const LEAD_MIN = 60; // на сьогодні — не раніше ніж за годину

// вільні слоти одного майстра на дату
export function masterSlots(sch, date, busyTimes, now = kyivNow()) {
  if (date < now.date || date > addDays(now.date, sch.horizon)) return [];
  const h = dayHours(sch, date);
  if (!h) return [];
  const out = [], from = toMin(h.from), to = toMin(h.to), busy = new Set(busyTimes);
  for (let m = from; m + sch.step <= to; m += sch.step) {
    if (date === now.date && m < now.min + LEAD_MIN) continue;
    const t = toTime(m);
    if (!busy.has(t)) out.push(t);
  }
  return out;
}

const ACTIVE = b => b.status === 'new' || b.status === 'accepted';

/**
 * Вільні слоти на період.
 * masterId = число → слоти конкретного майстра;
 * masterId = null → «будь-який майстер»: час вільний, якщо є хоча б один вільний майстер
 * (з урахуванням заявок без майстра на цей час).
 */
export function freeSlots({ masters, schedules, bookings, masterId, from, days }) {
  const now = kyivNow();
  const start = from && from > now.date ? from : now.date;
  const list = masterId ? masters.filter(m => m.id === masterId && m.active) : masters.filter(m => m.active);
  const busyOf = (mid, date) => bookings.filter(b => ACTIVE(b) && b.master_id === mid && b.date === date && b.time).map(b => b.time);
  const result = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    let times;
    if (masterId) {
      times = list.length ? masterSlots(schedules[list[0].id] || DEFAULT_SCHEDULE(), date, busyOf(list[0].id, date), now) : [];
    } else {
      const count = {};
      for (const m of list) for (const t of masterSlots(schedules[m.id] || DEFAULT_SCHEDULE(), date, busyOf(m.id, date), now)) count[t] = (count[t] || 0) + 1;
      bookings.filter(b => ACTIVE(b) && !b.master_id && b.date === date && b.time).forEach(b => { if (count[b.time]) count[b.time]--; });
      times = Object.keys(count).filter(t => count[t] > 0).sort();
    }
    result.push({ date, times });
  }
  return result;
}

export function isFree(ctx, date, time) {
  const day = freeSlots({ ...ctx, from: date, days: 1 })[0];
  return !!day && day.date === date && day.times.includes(time);
}
