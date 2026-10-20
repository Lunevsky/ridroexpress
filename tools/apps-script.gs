/**
 * Ridro — данные для сайта и учёт выплат. Скрипт живёт в таблице «ЧТУП «RidroExpress» (ИП «Ridro»)».
 *
 * Что делает:
 *  • Сайт: отдаёт список сотрудников, автобусов и отчёты со статусами (без банковских счетов и подписей).
 *  • Сдача отчёта на сайте: ник + номер счёта сверяются с «Базой сотрудников», отчёт сразу считается
 *    и попадает в «Выплаты». Google-форма тоже продолжает работать.
 *  • Выплаты: каждый новый отчёт из формы сразу считается и попадает в лист «Выплаты»
 *    (ЗП за рейсы, штраф за окраску, надбавка за тип автобуса, за пассажиров, возмещение — вручную).
 *    Админ ставит статус «Одобрен» / «Отклонён». Раз в неделю: меню Ridro → «Сформировать ведомость»
 *    → перевести деньги → «Отметить ведомость выплаченной».
 *
 * Установка / обновление (владельцем таблицы):
 *  1. Расширения → Apps Script → заменить весь код этим → сохранить.
 *  2. Выбрать функцию setupRidro → ▶ Выполнить → разрешить доступ (один раз). Обновить таблицу —
 *     появится меню Ridro → «Добавить пропущенные отчёты…» (с какой даты учитывать старые отчёты).
 *  3. Развернуть → Управление развертываниями → ✎ → Версия: «Новая версия» → Развернуть
 *     (адрес /exec для сайта не меняется).
 */
const STAFF_SHEET = 'База сотрудников';
const PAY_SHEET = 'Выплаты';
const LEDGER_SHEET = 'Ведомость';
const FLEET_SHEET = 'Активный ПС';
const FORM_ID = '1UQR-iV8ZK91ciFA7ByY0uuUupL4ntLjOiqT0cnGh-Wg'; // форма «Отчет ЧТУП «RidroExpress»»
const SITE = 'https://lunevsky.github.io/ridroexpress/';
const REPORTS_LIMIT = 300; // сколько последних отчётов отдавать сайту
const STATUSES = ['На проверке', 'Одобрен', 'Отклонён', 'Выплачен'];

// Столбцы листа сотрудников (A = 0). Столбец E (4) — банковский счёт — на сайт не отдаётся.
const STAFF_COLS = { nick: 0, vk: 1, position: 2, level: 3, hired: 5, warnings: 6, note: 7 };

// Вопросы формы (по началу текста вопроса).
const FIELDS = {
  nick: 'Никнейм',
  bank: 'Номер банковского счета',
  level: 'На каком уровне',
  bus: 'Выберите используемый',
  livery: 'Выберите окраску',
  route: 'Маршрут №',
  glonass: 'Использовалась система ГЛОНАСС',
  rounds: 'Количество кругорейсов',
  passengers: 'Количество пассажиров',
  proofRounds: 'Доказательства выполнения',
  proofPassengers: 'Доказательства перевозки',
  proofCosts: 'Доказательства (в виде',
};
const PUBLIC_FIELDS = ['nick', 'level', 'bus', 'livery', 'route', 'glonass', 'rounds', 'passengers'];

// Лист «Выплаты»: столбцы (1 = A)
const PAY_HEAD = ['Дата отчёта', 'Неделя', 'Никнейм', 'Счёт', 'Класс', 'Маршрут', 'Автобус', 'Окраска', 'ГЛОНАСС',
  'Круги', 'Пассажиры', 'ЗП за рейсы', 'Штраф окраски', 'За автобус', 'За пассажиров', 'Возмещение', 'Итого',
  'Статус', 'Комментарий', 'Статус изменён', 'Выплачено', 'Доказательства', 'Проверить', 'ID ответа',
  'Источник', 'ID маршрута'];
const C = {}; PAY_HEAD.forEach((h, i) => { C[h] = i + 1; });

/* =====================  Подсчёт ЗП (чистые функции)  ===================== */

const LEVELS = { trainee: 'III (стажёр)', driver: 'II (водитель)', chauffeur: 'I (шофёр)' };
const LIVERY_TEXT = { 0: 'Фирменный или уникальный', 5: 'В стилистике фирменной раскраски ИП (-5% от ЗП)', 15: 'Несоответствующий цветам ИП (ненормативный) (-15% от ЗП)' };

function normNum_(s) {
  return String(s).toUpperCase().replace(/Ё/g, 'Е').replace(/A/g, 'А').replace(/T/g, 'Т').replace(/M/g, 'М').replace(/K/g, 'К').replace(/L/g, 'Л');
}

function levelOf_(t) {
  const s = String(t).replace(/[IІ]/g, 'l');
  if (/стаж/i.test(s)) return 'trainee';
  if (/шоф/i.test(s)) return 'chauffeur';
  return /lll/.test(s) ? 'trainee' : /ll/.test(s) ? 'driver' : /l/.test(s) ? 'chauffeur' : /водит/i.test(s) ? 'driver' : null;
}

function liveryOf_(t) { return /15%/.test(t) ? 15 : /5%/.test(t) ? 5 : 0; }

function matchRoute_(routes, text) {
  const pref = /МУП/i.test(text) ? ['mup', 'troll', 'ridro', 'moonowl'] : ['ridro', 'moonowl', 'troll', 'mup'];
  const low = String(text).toLowerCase();
  const city = (r) => (r.city && low.indexOf(r.city.slice(0, 4).toLowerCase()) >= 0 ? 0 : 1);
  const toks = normNum_(text).split(/[^0-9А-Я]+/).filter((t) => t && t !== 'МУП');
  for (let i = 0; i < toks.length; i++) {
    const c = routes.filter((r) => normNum_(r.number) === toks[i] && r.salary);
    if (c.length) return c.sort((a, b) => pref.indexOf(a.group) - pref.indexOf(b.group) || city(a) - city(b))[0];
  }
  return null;
}

function textNorm_(s) {
  return String(s).toLowerCase().replace(/ё/g, 'е')
    .replace(/ikarus/g, 'икарус').replace(/vector/g, 'вектор').replace(/gazelle/g, 'газель')
    .replace(/(\d{3,})\/(\d{2})\b/g, (m, a, b) => a + ' ' + a.slice(0, -2) + b); // 32053/54 → 32053 32054
}

// Надбавка за тип автобуса: лучшая по совпадению категория из таблицы надбавок маршрута.
function busBonus_(route, bus) {
  if (!route || !route.busBonus || !route.busBonus.length || !bus) return { amount: 0, note: '' };
  if (/\[\s*Л-/i.test(bus)) return { amount: 0, note: '' }; // личный автобус — без надбавок (Устав, Прил. №1 п.1)
  const model = textNorm_(String(bus).replace(/^\s*\[[^\]]*\]\s*/, '').split('№')[0]).replace(/\.\d+/g, '');
  const nums = model.match(/\d{3,}/g) || [];
  const words = (model.match(/[a-zа-я]{3,}/g) || []).map((w) => w.slice(0, 5));
  const rest = /рест/.test(model);
  const restMatters = /3205[34]/.test(model); // «рест./дорест.» различают только ПАЗ-32053/32054
  let best = null, bestScore = 0, tie = false;
  route.busBonus.forEach((b) => {
    const t = textNorm_(b.type + ' ' + b.models);
    let sc = 0;
    nums.forEach((n) => { if (t.indexOf(n) >= 0) sc += 3; });
    words.forEach((w) => { if (t.indexOf(w) >= 0) sc += 1; });
    if (restMatters) { if (/дорест/.test(t)) sc += rest ? -5 : 2; else if (/рест/.test(t)) sc += rest ? 3 : -2; }
    if (sc > bestScore) { best = b; bestScore = sc; tie = false; } else if (sc === bestScore && sc > 0) tie = true;
  });
  if (!best) return { amount: 0, note: 'надбавка за автобус не определена' };
  return { amount: best.amount, type: best.type, note: tie ? 'проверьте надбавку за автобус' : '' };
}

// Полный расчёт одного отчёта. data — содержимое data/routes.json сайта.
function calcReport_(data, rep) {
  const notes = [];
  const route = (rep.routeId && data.routes.filter((r) => r.id === rep.routeId)[0]) || matchRoute_(data.routes, rep.route);
  const level = levelOf_(rep.level);
  const rounds = parseInt(String(rep.rounds).replace(/\D+/g, ''), 10) || 0;
  const pass = parseInt(String(rep.passengers).replace(/\D+/g, ''), 10) || 0;
  if (!route) notes.push('маршрут не распознан');
  if (!level) notes.push('класс не распознан');
  const base = route && level ? (route.salary[level] || 0) * rounds : 0;
  const penalty = Math.round(base * liveryOf_(rep.livery) / 100);
  const bb = busBonus_(route, rep.bus);
  if (bb.note) notes.push(bb.note);
  const group = route ? data.groups.filter((g) => g.id === route.group)[0] : null;
  const passengers = group && group.passengerBonus ? group.passengerBonus * pass : 0;
  if (route && pass && !(group && group.passengerBonus)) notes.push('надбавка за пассажиров не задана');
  return {
    route: route ? route.number + ' (' + (group ? group.short : route.group) + ', ' + route.from + ' → ' + route.to + ')' : String(rep.route),
    routeId: route ? route.id : '',
    level: level ? LEVELS[level] : String(rep.level),
    rounds: rounds, pass: pass, base: base, penalty: penalty, bus: bb.amount * rounds, passengers: passengers,
    total: base - penalty + bb.amount * rounds + passengers, notes: notes,
  };
}

/* =====================  Сайт  ===================== */

function doGet() {
  let json = cacheGet_('ridro');
  if (!json) {
    json = JSON.stringify({ updated: new Date().toISOString(), staff: readStaff_(), buses: buses_(), reports: publicReports_() });
    cachePut_('ridro', json, 300);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function cellLink_(rich, formula) {
  let url = '';
  if (rich) {
    url = rich.getLinkUrl() || '';
    if (!url) rich.getRuns().some((run) => (url = run.getLinkUrl() || '') !== '');
  }
  if (!url && formula) { const m = String(formula).match(/HYPERLINK\(\s*"([^"]+)"/i); if (m) url = m[1]; }
  return /^https?:\/\//i.test(url) ? url : '';
}

function readStaff_() {
  const range = SpreadsheetApp.getActive().getSheetByName(STAFF_SHEET).getDataRange();
  const rows = range.getDisplayValues();
  const rich = range.getRichTextValues();
  const formulas = range.getFormulas();
  const out = { total: String(rows[0][0] || '').trim(), edited: '', groups: [] };
  let group = null;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i].map((v) => String(v || '').trim());
    const first = r[0];
    const rest = r.slice(1).some(Boolean);
    if (!first && !rest) continue;
    if (first.indexOf('Последние правки') === 0) { out.edited = first.replace(/^Последние правки:\s*/, ''); continue; }
    if (first === 'Никнейм') { group = { title: r[2] || 'Администрация', members: [] }; out.groups.push(group); continue; }
    if (!rest) { group = { title: first, members: [] }; out.groups.push(group); continue; }
    if (!group) { group = { title: '', members: [] }; out.groups.push(group); }
    const m = {};
    Object.keys(STAFF_COLS).forEach((k) => { m[k] = r[STAFF_COLS[k]] || ''; });
    m.vkUrl = cellLink_(rich[i][STAFF_COLS.vk], formulas[i][STAFF_COLS.vk]);
    group.members.push(m);
  }
  return out;
}

function publicReports_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(PAY_SHEET);
  if (sh && sh.getLastRow() > 1) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, PAY_HEAD.length).getValues();
    const g = (r, h) => r[C[h] - 1];
    return v.filter((r) => g(r, 'Дата отчёта') instanceof Date)
      .sort((a, b) => g(b, 'Дата отчёта') - g(a, 'Дата отчёта'))
      .slice(0, REPORTS_LIMIT)
      .map((r) => ({
        date: g(r, 'Дата отчёта').toISOString(), nick: g(r, 'Никнейм'), level: g(r, 'Класс'), route: g(r, 'Маршрут'),
        routeId: g(r, 'ID маршрута'), bus: g(r, 'Автобус'), livery: g(r, 'Окраска'), glonass: g(r, 'ГЛОНАСС'),
        rounds: g(r, 'Круги'), passengers: g(r, 'Пассажиры'), status: g(r, 'Статус'), total: g(r, 'Итого'),
      }));
  }
  const pay = payIndex_();
  return formResponses_(REPORTS_LIMIT).map((x) => {
    const o = { date: x.date.toISOString() };
    PUBLIC_FIELDS.forEach((k) => { o[k] = x[k]; });
    const p = pay[x.id];
    if (p) { o.status = p.status; o.total = p.total; }
    return o;
  });
}

/* =====================  Сдача отчёта с сайта  ===================== */

function doPost(e) {
  let out;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    out = submitReport_(JSON.parse(e.postData.contents));
  } catch (err) {
    out = { ok: false, error: 'Ошибка сервера: ' + (err && err.message ? err.message : err) };
  } finally {
    try { lock.releaseLock(); } catch (x) { /* не взят */ }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Ник → { ник как в базе, счёт (только цифры) } из «Базы сотрудников» (столбец E — счёт)
function staffBanks_() {
  const rows = SpreadsheetApp.getActive().getSheetByName(STAFF_SHEET).getDataRange().getDisplayValues();
  const out = {};
  rows.forEach((r) => {
    const nick = String(r[0] || '').trim();
    if (/^[A-Za-z]+_[A-Za-z]+$/.test(nick)) out[nick.toLowerCase()] = { nick: nick, bank: String(r[4] || '').replace(/\D/g, '') };
  });
  return out;
}

function submitReport_(d) {
  const fail = (msg) => ({ ok: false, error: msg });
  const who = staffBanks_()[String(d.nick || '').trim().toLowerCase()];
  const bank = String(d.bank || '').replace(/\D/g, '');
  if (!who) return fail('Ник не найден в базе сотрудников. Пишите как в игре: Имя_Фамилия.');
  if (!who.bank) return fail('В базе сотрудников не указан ваш банковский счёт — обратитесь к администрации.');
  if (who.bank !== bank) return fail('Номер счёта не совпадает с базой сотрудников.');
  const rounds = parseInt(d.rounds, 10);
  const pass = parseInt(d.passengers, 10) || 0;
  if (!(rounds >= 1 && rounds <= 100)) return fail('Кругорейсов: от 1 до 100.');
  if (!(pass >= 0 && pass <= 1000)) return fail('Пассажиров: от 0 до 1000.');
  if (!LEVELS[d.level]) return fail('Выберите класс.');
  if (LIVERY_TEXT[d.livery] === undefined) return fail('Выберите окраску.');
  const proof = String(d.proofRounds || '').trim();
  if (proof.length < 8) return fail('Добавьте ссылки на скриншоты кругорейсов.');
  const data = siteRoutes_();
  const route = data.routes.filter((r) => r.id === d.routeId)[0];
  if (!route) return fail('Маршрут не найден.');

  // повторная отправка того же отчёта
  const sh = paySheet_();
  if (sh.getLastRow() > 1) {
    const from = Math.max(2, sh.getLastRow() - 300);
    const v = sh.getRange(from, 1, sh.getLastRow() - from + 1, PAY_HEAD.length).getValues();
    if (v.some((r) => String(r[C['Никнейм'] - 1]).toLowerCase() === who.nick.toLowerCase() && String(r[C['Доказательства'] - 1]).indexOf(proof) >= 0)) {
      return fail('Этот отчёт уже отправлен (те же ссылки на скриншоты).');
    }
  }

  const rep = {
    id: 'site-' + Utilities.getUuid(), date: new Date(), source: 'сайт',
    nick: who.nick, bank: bank, level: LEVELS[d.level], livery: LIVERY_TEXT[d.livery],
    routeId: route.id, route: route.number, bus: String(d.bus || '').slice(0, 200),
    glonass: d.glonass === 'Да' ? 'Да' : 'Нет', rounds: rounds, passengers: pass,
    proofRounds: proof.slice(0, 2000), proofPassengers: String(d.proofPassengers || '').trim().slice(0, 2000),
    proofCosts: String(d.proofCosts || '').trim().slice(0, 2000),
  };
  appendReports_([rep], 'На проверке');
  const c = calcReport_(data, rep);
  return { ok: true, total: c.total, notes: c.notes };
}

// Автобусы для выбора на сайте: лист «Активный ПС» (столбцы: гараж, код, модель, госномер)
function buses_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(FLEET_SHEET);
  if (!sh) return [];
  return sh.getDataRange().getDisplayValues()
    .filter((r) => /^[МСКЛMCKL]-\d+$/i.test(String(r[1]).trim()) && String(r[2]).trim())
    .map((r) => '[' + String(r[1]).trim() + '] ' + String(r[2]).trim() + (String(r[3]).trim() ? ' № ' + String(r[3]).trim() : ''));
}

/* =====================  Форма  ===================== */

function formFieldIds_(form) {
  const ids = {};
  form.getItems().forEach((it) => {
    const title = it.getTitle().trim();
    Object.keys(FIELDS).forEach((k) => { if (title.indexOf(FIELDS[k]) === 0) ids[k] = it.getId(); });
  });
  return ids;
}

function readResponse_(resp, ids) {
  const byId = {};
  resp.getItemResponses().forEach((ir) => { byId[ir.getItem().getId()] = ir.getResponse(); });
  const o = { id: resp.getId(), date: resp.getTimestamp() };
  Object.keys(ids).forEach((k) => { o[k] = String(byId[ids[k]] == null ? '' : byId[ids[k]]).trim(); });
  return o;
}

function formResponses_(limit) {
  const form = FormApp.openById(FORM_ID);
  const ids = formFieldIds_(form);
  let res = form.getResponses();
  if (limit) res = res.slice(-limit);
  return res.reverse().map((r) => readResponse_(r, ids));
}

/* =====================  Выплаты  ===================== */

function siteRoutes_() {
  let json = cacheGet_('routes');
  if (!json) {
    json = UrlFetchApp.fetch(SITE + 'data/routes.json?t=' + Date.now()).getContentText();
    cachePut_('routes', json, 3600);
  }
  return JSON.parse(json);
}

function weekLabel_(d) {
  const tz = Session.getScriptTimeZone();
  const mon = new Date(d.getTime());
  mon.setHours(0, 0, 0, 0);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const sun = new Date(mon.getTime() + 6 * 864e5);
  return Utilities.formatDate(mon, tz, 'dd.MM') + '–' + Utilities.formatDate(sun, tz, 'dd.MM.yyyy');
}

function paySheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(PAY_SHEET);
  if (sh) {
    if (sh.getRange(1, PAY_HEAD.length).getValue() !== PAY_HEAD[PAY_HEAD.length - 1]) {
      sh.getRange(1, 1, 1, PAY_HEAD.length).setValues([PAY_HEAD]).setFontWeight('bold').setBackground('#FFB424').setFontColor('#131313');
      sh.hideColumns(C['ID маршрута']);
    }
    return sh;
  }
  sh = ss.insertSheet(PAY_SHEET);
  sh.getRange(1, 1, 1, PAY_HEAD.length).setValues([PAY_HEAD]).setFontWeight('bold').setBackground('#FFB424').setFontColor('#131313');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build();
  sh.getRange(2, C['Статус'], 2000).setDataValidation(rule);
  sh.getRange(2, C['ЗП за рейсы'], 2000, 6).setNumberFormat('#,##0 ₽');
  sh.getRange(2, C['Дата отчёта'], 2000).setNumberFormat('dd.MM.yyyy HH:mm');
  sh.getRange(2, C['Статус изменён'], 2000, 2).setNumberFormat('dd.MM.yyyy HH:mm');
  const st = sh.getRange(2, C['Статус'], 2000);
  const color = (text, bg) => SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bg).setRanges([st]).build();
  sh.setConditionalFormatRules([color('Одобрен', '#C9F2B5'), color('Отклонён', '#F6C5C5'), color('Выплачен', '#DADADA'), color('На проверке', '#FFE7B0')]);
  sh.hideColumns(C['ID ответа']);
  sh.hideColumns(C['ID маршрута']);
  return sh;
}

function payIndex_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(PAY_SHEET);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, PAY_HEAD.length).getValues();
  v.forEach((r, i) => { if (r[C['ID ответа'] - 1]) out[r[C['ID ответа'] - 1]] = { row: i + 2, status: r[C['Статус'] - 1], total: r[C['Итого'] - 1] }; });
  return out;
}

function payRow_(rep, data, status) {
  const c = calcReport_(data, rep);
  const proofs = [rep.proofRounds, rep.proofPassengers, rep.proofCosts].filter((x) => x && x !== '-').join('\n');
  const row = [];
  row[C['Дата отчёта'] - 1] = rep.date;
  row[C['Неделя'] - 1] = weekLabel_(rep.date);
  row[C['Никнейм'] - 1] = rep.nick;
  row[C['Счёт'] - 1] = "'" + rep.bank; // как текст
  row[C['Класс'] - 1] = c.level;
  row[C['Маршрут'] - 1] = c.route;
  row[C['Автобус'] - 1] = rep.bus;
  row[C['Окраска'] - 1] = rep.livery;
  row[C['ГЛОНАСС'] - 1] = rep.glonass;
  row[C['Круги'] - 1] = c.rounds;
  row[C['Пассажиры'] - 1] = c.pass;
  row[C['ЗП за рейсы'] - 1] = c.base;
  row[C['Штраф окраски'] - 1] = c.penalty;
  row[C['За автобус'] - 1] = c.bus;
  row[C['За пассажиров'] - 1] = c.passengers;
  row[C['Возмещение'] - 1] = '';
  row[C['Итого'] - 1] = ''; // формула ставится после вставки
  row[C['Статус'] - 1] = status;
  row[C['Комментарий'] - 1] = '';
  row[C['Статус изменён'] - 1] = '';
  row[C['Выплачено'] - 1] = '';
  row[C['Доказательства'] - 1] = proofs;
  row[C['Проверить'] - 1] = c.notes.join('; ');
  row[C['ID ответа'] - 1] = rep.id;
  row[C['Источник'] - 1] = rep.source || 'форма';
  row[C['ID маршрута'] - 1] = c.routeId;
  return row;
}

function totalFormula_(r) {
  const col = (h) => String.fromCharCode(64 + C[h]) + r; // все нужные столбцы — в пределах A–Z
  return '=' + col('ЗП за рейсы') + '-' + col('Штраф окраски') + '+' + col('За автобус') + '+' + col('За пассажиров') + '+N(' + col('Возмещение') + ')';
}

function appendReports_(reps, status) {
  if (!reps.length) return 0;
  const sh = paySheet_();
  const data = siteRoutes_();
  const rows = reps.map((r) => payRow_(r, data, status));
  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, PAY_HEAD.length).setValues(rows);
  sh.getRange(start, C['Итого'], rows.length, 1).setFormulas(rows.map((_, i) => [totalFormula_(start + i)]));
  cacheDrop_('ridro');
  return rows.length;
}

// Триггер: новый ответ формы
function onReport(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const form = FormApp.openById(FORM_ID);
    const rep = readResponse_(e.response, formFieldIds_(form));
    if (!payIndex_()[rep.id]) appendReports_([rep], 'На проверке');
  } finally {
    lock.releaseLock();
  }
}

/* =====================  Меню и настройка  ===================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ridro')
    .addItem('Сформировать ведомость за неделю', 'buildLedger')
    .addItem('Отметить ведомость выплаченной', 'markLedgerPaid')
    .addSeparator()
    .addItem('Пересчитать выделенные строки', 'recalcSelected')
    .addItem('Добавить пропущенные отчёты…', 'importMissed')
    .addItem('Настроить (один раз)', 'setupRidro')
    .addToUi();
}

// Простой триггер: фиксируем время смены статуса
function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== PAY_SHEET || e.range.getRow() < 2) return;
  if (e.range.getColumn() <= C['Статус'] && e.range.getLastColumn() >= C['Статус']) {
    sh.getRange(e.range.getRow(), C['Статус изменён'], e.range.getNumRows(), 1).setValue(new Date());
  }
  cacheDrop_('ridro');
}

// Запускается из редактора Apps Script (▶). Окна таблицы отсюда недоступны —
// прошлые отчёты добавляются потом из таблицы: меню Ridro → «Добавить пропущенные отчёты…».
function setupRidro() {
  paySheet_();
  const has = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'onReport');
  if (!has) ScriptApp.newTrigger('onReport').forForm(FORM_ID).onFormSubmit().create();
  siteRoutes_(); // проверка доступа к сайту
  Logger.log('Готово: лист «' + PAY_SHEET + '» и триггер на новые отчёты. Обновите таблицу — появится меню Ridro.');
}

// Импорт ответов формы, которых нет в «Выплатах» (с указанной даты). Старые — сразу со статусом «Выплачен» по выбору.
function importMissed() {
  const ui = SpreadsheetApp.getUi();
  const a = ui.prompt('Добавить пропущенные отчёты', 'С какой даты (дд.мм.гггг)? Пусто — отменить.', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK || !a.getResponseText().trim()) return;
  const m = a.getResponseText().trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) { ui.alert('Формат даты: дд.мм.гггг'); return; }
  const from = new Date(+m[3], +m[2] - 1, +m[1]);
  const paid = ui.alert('Статус', 'Считать эти отчёты уже выплаченными?\n«Да» — статус «Выплачен», «Нет» — «На проверке».', ui.ButtonSet.YES_NO) === ui.Button.YES;
  const have = payIndex_();
  const reps = formResponses_(0).filter((r) => r.date >= from && !have[r.id]).reverse();
  const n = appendReports_(reps, paid ? 'Выплачен' : 'На проверке');
  ui.alert('Добавлено отчётов: ' + n);
}

function recalcSelected() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== PAY_SHEET) { SpreadsheetApp.getUi().alert('Откройте лист «' + PAY_SHEET + '» и выделите строки.'); return; }
  cacheDrop_('routes');
  const data = siteRoutes_();
  const range = sh.getActiveRange();
  for (let r = Math.max(2, range.getRow()); r <= range.getLastRow(); r++) {
    const v = sh.getRange(r, 1, 1, PAY_HEAD.length).getValues()[0];
    const rep = { route: v[C['Маршрут'] - 1], level: v[C['Класс'] - 1], rounds: v[C['Круги'] - 1], passengers: v[C['Пассажиры'] - 1], livery: v[C['Окраска'] - 1], bus: v[C['Автобус'] - 1] };
    const c = calcReport_(data, rep);
    sh.getRange(r, C['ЗП за рейсы'], 1, 4).setValues([[c.base, c.penalty, c.bus, c.passengers]]);
    sh.getRange(r, C['Маршрут']).setValue(c.route);
    sh.getRange(r, C['Проверить']).setValue(c.notes.join('; '));
  }
  cacheDrop_('ridro');
}

/* =====================  Ведомость  ===================== */

// Одобренные и не выплаченные отчёты по прошлое воскресенье включительно, сумма по сотруднику.
function buildLedger() {
  const ui = SpreadsheetApp.getUi();
  const tz = Session.getScriptTimeZone();
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() - ((end.getDay() + 6) % 7)); // понедельник этой недели, 00:00
  const a = ui.prompt('Ведомость', 'Включить отчёты до (не включая) даты, дд.мм.гггг.\nПусто — до ' + Utilities.formatDate(end, tz, 'dd.MM.yyyy') + ' (конец прошлой недели).', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  const m = a.getResponseText().trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const until = m ? new Date(+m[3], +m[2] - 1, +m[1]) : end;

  const sh = paySheet_();
  const n = sh.getLastRow() - 1;
  const v = n > 0 ? sh.getRange(2, 1, n, PAY_HEAD.length).getValues() : [];
  const by = {};
  v.forEach((r, i) => {
    if (r[C['Статус'] - 1] !== 'Одобрен' || r[C['Выплачено'] - 1] || !(r[C['Дата отчёта'] - 1] < until)) return;
    const nick = r[C['Никнейм'] - 1];
    const o = (by[nick] = by[nick] || { bank: r[C['Счёт'] - 1], reports: 0, rounds: 0, sum: 0, rows: [] });
    o.reports++; o.rounds += +r[C['Круги'] - 1] || 0; o.sum += +r[C['Итого'] - 1] || 0; o.rows.push(i + 2);
  });

  const ss = SpreadsheetApp.getActive();
  const led = ss.getSheetByName(LEDGER_SHEET) || ss.insertSheet(LEDGER_SHEET);
  led.clear();
  const nicks = Object.keys(by).sort();
  const total = nicks.reduce((s, k) => s + by[k].sum, 0);
  led.getRange(1, 1).setValue('Ведомость от ' + Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm') +
    ' · одобренные отчёты до ' + Utilities.formatDate(until, tz, 'dd.MM.yyyy') + ' · итого ' + total.toLocaleString('ru-RU') + ' ₽').setFontWeight('bold');
  led.getRange(2, 1, 1, 6).setValues([['Никнейм', 'Счёт', 'Отчётов', 'Кругов', 'К выплате', 'Строки в «Выплатах»']])
    .setFontWeight('bold').setBackground('#FFB424').setFontColor('#131313');
  if (nicks.length) {
    led.getRange(3, 1, nicks.length, 6).setValues(nicks.map((k) => [k, by[k].bank, by[k].reports, by[k].rounds, by[k].sum, by[k].rows.join(',')]));
    led.getRange(3, 2, nicks.length, 1).setNumberFormat('@');
    led.getRange(3, 5, nicks.length, 1).setNumberFormat('#,##0 ₽');
  }
  led.autoResizeColumns(1, 6);
  ss.setActiveSheet(led);
  ui.alert(nicks.length ? 'Ведомость готова: ' + nicks.length + ' чел., ' + total.toLocaleString('ru-RU') + ' ₽.\nПосле перевода — меню Ridro → «Отметить ведомость выплаченной».' : 'Нет одобренных невыплаченных отчётов за этот период.');
}

function markLedgerPaid() {
  const ui = SpreadsheetApp.getUi();
  const led = SpreadsheetApp.getActive().getSheetByName(LEDGER_SHEET);
  if (!led || led.getLastRow() < 3) { ui.alert('Сначала сформируйте ведомость.'); return; }
  const v = led.getRange(3, 1, led.getLastRow() - 2, 6).getValues();
  const rows = [];
  let sum = 0;
  v.forEach((r) => { sum += +r[4] || 0; String(r[5]).split(',').forEach((x) => { if (+x) rows.push(+x); }); });
  if (ui.alert('Выплата', 'Отметить выплаченными ' + rows.length + ' отчётов на ' + sum.toLocaleString('ru-RU') + ' ₽?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const sh = paySheet_();
  const now = new Date();
  rows.forEach((r) => {
    if (sh.getRange(r, C['Статус']).getValue() !== 'Одобрен') return; // за это время статус могли поменять
    sh.getRange(r, C['Статус']).setValue('Выплачен');
    sh.getRange(r, C['Статус изменён'], 1, 2).setValues([[now, now]]);
  });
  led.getRange(1, 1).setValue(led.getRange(1, 1).getValue() + ' · ВЫПЛАЧЕНО ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm'));
  cacheDrop_('ridro');
  ui.alert('Готово.');
}

/* =====================  Кэш (значения больше 100 КБ — частями)  ===================== */

function cachePut_(key, str, sec) {
  const parts = {};
  const size = 30000; // символов: кириллица ≈ 2 байта, лимит кэша — 100 КБ на значение
  const n = Math.ceil(str.length / size);
  for (let i = 0; i < n; i++) parts[key + '_' + i] = str.slice(i * size, (i + 1) * size);
  parts[key] = String(n);
  try { CacheService.getScriptCache().putAll(parts, sec); } catch (e) { /* без кэша — просто медленнее */ }
}

function cacheGet_(key) {
  const c = CacheService.getScriptCache();
  const n = +c.get(key);
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '_' + i);
  const got = c.getAll(keys);
  if (keys.some((k) => got[k] == null)) return null;
  return keys.map((k) => got[k]).join('');
}

function cacheDrop_(key) { CacheService.getScriptCache().remove(key); }
