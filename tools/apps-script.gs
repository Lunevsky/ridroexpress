/**
 * Ridro — данные для сайта и учёт выплат. Скрипт живёт в таблице «ЧТУП «RidroExpress» (ИП «Ridro»)».
 *
 * Что делает:
 *  • Сайт: отдаёт список сотрудников, автобусов и отчёты со статусами (без банковских счетов и подписей).
 *  • Сдача отчёта на сайте: ник + номер счёта сверяются с «Базой сотрудников», отчёт строками
 *    (по строке на маршрут) добавляется в лист ответов Google-формы — рядом с анкетами — и в «Выплаты».
 *  • Выплаты: каждый новый отчёт из формы сразу считается и попадает в лист «Выплаты»
 *    (ЗП за рейсы, штраф за окраску, надбавка за тип автобуса, за пассажиров, возмещение — вручную).
 *    Админ ставит статус «Одобрен» / «Отклонён». Раз в неделю: меню Ridro → «Сформировать ведомость»
 *    → перевести деньги → «Отметить ведомость выплаченной».
 *
 * Установка / обновление (владельцем таблицы):
 *  1. Расширения → Apps Script → заменить весь код этим → сохранить.
 *  2. Выбрать функцию setupRidro → ▶ Выполнить → разрешить доступ. Создаст/перестроит листы «Выплаты»
 *     (старый лист другой структуры сохранится копией, строки перенесутся) и «Сводка». Обновить таблицу —
 *     появится меню Ridro → «Добавить пропущенные отчёты…» (с какой даты учитывать старые отчёты).
 *  3. Развернуть → Управление развертываниями → ✎ → Версия: «Новая версия» → Развернуть
 *     (адрес /exec для сайта не меняется).
 */
const STAFF_SHEET = 'База сотрудников';
const PAY_SHEET = 'Выплаты';
const LEDGER_SHEET = 'Ведомость';
const SUMMARY_SHEET = 'Сводка';
const FLEET_SHEET = /^Активный\s*П\s*\/?\s*С/i; // «Активный П/С» или «Активный ПС»
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
  signature: 'Подпись',
};
const PUBLIC_FIELDS = ['nick', 'level', 'bus', 'livery', 'route', 'glonass', 'rounds', 'passengers'];

// Лист «Выплаты»: столбцы в порядке расчёта (1 = A). Суммы — формулами (FORMULA_COLS).
const PAY_HEAD = ['Дата отчёта', 'Неделя', 'Никнейм', 'Класс',
  'Перевозчик', 'Маршрут', 'Автобус', 'Окраска', 'ГЛОНАСС',
  'Круги', 'Ставка за круг', 'ЗП за рейсы',
  'Штраф окраски, %', 'Штраф окраски',
  'Тип автобуса', 'Надбавка за круг', 'За автобус',
  'Пассажиры', 'Ставка за пассажира', 'За пассажиров',
  'Возмещение', 'Итого', 'Расчёт',
  'Статус', 'Комментарий', 'Проверить', 'Статус изменён', 'Выплачено',
  'Счёт', 'Доказательства', 'Источник', 'ID маршрута', 'ID ответа'];
const FORMULA_COLS = ['ЗП за рейсы', 'Штраф окраски', 'За автобус', 'За пассажиров', 'Итого', 'Расчёт'];
const MONEY_COLS = ['Ставка за круг', 'ЗП за рейсы', 'Штраф окраски', 'Надбавка за круг', 'За автобус',
  'Ставка за пассажира', 'За пассажиров', 'Возмещение', 'Итого'];
const C = {}; PAY_HEAD.forEach((h, i) => { C[h] = i + 1; });

/* =====================  Подсчёт ЗП (чистые функции)  ===================== */

const LEVELS = { trainee: 'III (стажёр)', driver: 'II (водитель)', chauffeur: 'I (шофёр)' };
const LEVEL_FORM = { trainee: 'Водитель lll-класса', driver: 'Водитель ll-класса', chauffeur: 'Водитель l-класса' }; // варианты в форме (латинская l)
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
  const passRate = group && group.passengerBonus ? group.passengerBonus : 0;
  const passengers = passRate * pass;
  if (route && pass && !(group && group.passengerBonus)) notes.push('надбавка за пассажиров не задана');
  return {
    route: route ? route.number + ' (' + (group ? group.short : route.group) + ', ' + route.from + ' → ' + route.to + ')' : String(rep.route),
    routeId: route ? route.id : '',
    carrier: group ? group.short : '',
    rate: route && level ? route.salary[level] || 0 : 0, liveryPct: liveryOf_(rep.livery),
    busType: bb.type || (bb.amount ? '' : '—'), busPer: bb.amount, passRate: passRate,
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
  // читаем только лист текущей структуры: при другом порядке столбцов на сайт мог бы попасть не тот столбец (например, счёт)
  if (sh && sh.getLastRow() > 1 && payHeaderOk_(sh)) {
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
  const pay = sh && payHeaderOk_(sh) ? payIndex_() : {};
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

// Отчёт с сайта: общие поля (ник, счёт, класс, ГЛОНАСС, доказательства) + строки items
// (маршрут, круги, пассажиры, автобус, окраска). Каждая строка — отдельная запись в «Выплатах».
function submitReport_(d) {
  const fail = (msg) => ({ ok: false, error: msg });
  const who = staffBanks_()[String(d.nick || '').trim().toLowerCase()];
  const bank = String(d.bank || '').replace(/\D/g, '');
  if (!who) return fail('Ник не найден в базе сотрудников. Пишите как в игре: Имя_Фамилия.');
  if (!who.bank) return fail('В базе сотрудников не указан ваш банковский счёт — обратитесь к администрации.');
  if (who.bank !== bank) return fail('Номер счёта не совпадает с базой сотрудников.');
  if (!LEVELS[d.level]) return fail('Выберите класс.');
  const proof = String(d.proofRounds || '').trim();
  if (proof.length < 8) return fail('Добавьте ссылки на скриншоты кругорейсов.');

  const items = Array.isArray(d.items) && d.items.length ? d.items : [d]; // старый формат — одна строка
  if (items.length > 10) return fail('Не больше 10 строк в одном отчёте.');
  const data = siteRoutes_();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const bad = (m) => fail(items.length > 1 ? 'Строка ' + (i + 1) + ': ' + m : m.charAt(0).toUpperCase() + m.slice(1));
    const rounds = parseInt(it.rounds, 10);
    const pass = parseInt(it.passengers, 10) || 0;
    if (!data.routes.some((r) => r.id === it.routeId)) return bad('маршрут не найден.');
    if (!(rounds >= 1 && rounds <= 100)) return bad('кругорейсов — от 1 до 100.');
    if (!(pass >= 0 && pass <= 1000)) return bad('пассажиров — от 0 до 1000.');
    if (LIVERY_TEXT[it.livery] === undefined) return bad('выберите окраску.');
    if (!String(it.bus || '').trim()) return bad('выберите автобус.');
  }

  // повторная отправка того же отчёта
  const sh = paySheet_();
  if (sh.getLastRow() > 1) {
    const from = Math.max(2, sh.getLastRow() - 300);
    const v = sh.getRange(from, 1, sh.getLastRow() - from + 1, PAY_HEAD.length).getValues();
    if (v.some((r) => String(r[C['Никнейм'] - 1]).toLowerCase() === who.nick.toLowerCase() && String(r[C['Доказательства'] - 1]).indexOf(proof) >= 0)) {
      return fail('Этот отчёт уже отправлен (те же ссылки на скриншоты).');
    }
  }

  const group = Utilities.getUuid();
  const now = new Date();
  const reps = items.map((it, i) => {
    const route = data.routes.filter((r) => r.id === it.routeId)[0];
    return {
      id: 'site-' + group + '#' + (i + 1), date: now, source: 'сайт',
      comment: items.length > 1 ? 'Отчёт с сайта: строка ' + (i + 1) + ' из ' + items.length : 'Отчёт с сайта',
      nick: who.nick, bank: bank, level: LEVELS[d.level], levelForm: LEVEL_FORM[d.level], livery: LIVERY_TEXT[it.livery],
      routeId: route.id, route: route.number,
      formRoute: route.number + (route.group === 'mup' || route.group === 'troll' ? ' (МУП, ' + route.city + ')' : ''),
      bus: String(it.bus).slice(0, 200), glonass: d.glonass === 'Да' ? 'Да' : 'Нет',
      rounds: parseInt(it.rounds, 10), passengers: parseInt(it.passengers, 10) || 0,
      proofRounds: proof.slice(0, 2000), proofPassengers: String(d.proofPassengers || '').trim().slice(0, 2000),
      proofCosts: String(d.proofCosts || '').trim().slice(0, 2000),
    };
  });
  appendReports_(reps, 'На проверке');
  let sheetError = '';
  try { appendToFormSheet_(reps); } catch (e) { sheetError = String(e && e.message ? e.message : e); }
  let total = 0;
  const notes = [];
  reps.forEach((rep, i) => {
    const c = calcReport_(data, rep);
    total += c.total;
    c.notes.forEach((x) => notes.push(reps.length > 1 ? 'строка ' + (i + 1) + ': ' + x : x));
  });
  if (sheetError) notes.push('не записан в таблицу анкет (' + sheetError + ')');
  return { ok: true, total: total, lines: reps.length, notes: notes };
}

// Лист, куда форма складывает ответы (та же таблица, что у анкет).
function formSheet_() {
  const form = FormApp.openById(FORM_ID);
  if (form.getDestinationType() !== FormApp.DestinationType.SPREADSHEET) throw new Error('у формы не подключена таблица ответов');
  const sheets = SpreadsheetApp.openById(form.getDestinationId()).getSheets();
  const sh = sheets.filter((x) => String(x.getFormUrl() || '').indexOf(FORM_ID) >= 0)[0] || sheets.filter((x) => x.getFormUrl())[0];
  if (!sh) throw new Error('не найден лист ответов формы');
  return sh;
}

// Отчёт с сайта — строками в лист ответов формы, по заголовкам столбцов (вопросам формы).
// Форма при этом не заполняется: строки просто добавляются в таблицу рядом с анкетами.
function appendToFormSheet_(reps) {
  if (!reps.length) return;
  const sh = formSheet_();
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  const keyOf = head.map((h) => Object.keys(FIELDS).filter((k) => h.indexOf(FIELDS[k]) === 0)[0] || '');
  const rows = reps.map((rep) => {
    const v = {
      nick: rep.nick, bank: rep.bank, level: rep.levelForm, bus: rep.bus, livery: rep.livery, route: rep.formRoute,
      glonass: rep.glonass, rounds: rep.rounds, passengers: rep.passengers, proofRounds: rep.proofRounds,
      proofPassengers: rep.proofPassengers || '-', proofCosts: rep.proofCosts || '-', signature: rep.nick + ' (с сайта)',
    };
    return head.map((h, i) => (/^(отметка времени|timestamp)/i.test(h) ? rep.date : keyOf[i] ? v[keyOf[i]] : ''));
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
}

// Автобусы для выбора на сайте: лист «Активный ПС» (столбцы: гараж, код, модель, госномер)
function buses_() {
  const sh = SpreadsheetApp.getActive().getSheets().filter((x) => FLEET_SHEET.test(x.getName().trim()))[0];
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

function payHeaderOk_(sh) {
  const head = sh.getRange(1, 1, 1, PAY_HEAD.length).getValues()[0].map((h) => String(h).trim());
  return PAY_HEAD.every((h, i) => head[i] === h);
}

// Лист «Выплаты». Старую структуру переносит: старый лист переименовывается (копия), строки пересчитываются в новый.
function paySheet_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(PAY_SHEET);
  if (sh && payHeaderOk_(sh)) return sh;
  if (sh) return migratePay_(ss, sh);
  return createPaySheet_(ss);
}

function createPaySheet_(ss) {
  const sh = ss.insertSheet(PAY_SHEET, 0);
  sh.getRange(1, 1, 1, PAY_HEAD.length).setValues([PAY_HEAD]).setFontWeight('bold').setBackground('#FFB424').setFontColor('#131313').setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);
  const rows = 3000;
  sh.getRange(2, C['Статус'], rows).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
  MONEY_COLS.forEach((h) => sh.getRange(2, C[h], rows).setNumberFormat('#,##0 ₽'));
  sh.getRange(2, C['Штраф окраски, %'], rows).setNumberFormat('0"%"');
  [C['Дата отчёта'], C['Статус изменён'], C['Выплачено']].forEach((c) => sh.getRange(2, c, rows).setNumberFormat('dd.MM.yyyy HH:mm'));
  sh.getRange(2, C['Итого'], rows).setFontWeight('bold');
  sh.getRange(2, C['Доказательства'], rows).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  const st = sh.getRange(2, C['Статус'], rows);
  const color = (text, bg) => SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bg).setRanges([st]).build();
  sh.setConditionalFormatRules([color('Одобрен', '#C9F2B5'), color('Отклонён', '#F6C5C5'), color('Выплачен', '#DADADA'), color('На проверке', '#FFE7B0')]);
  const widths = { 'Дата отчёта': 130, 'Неделя': 120, 'Никнейм': 150, 'Класс': 100, 'Перевозчик': 110, 'Маршрут': 280, 'Автобус': 240,
    'Окраска': 200, 'Тип автобуса': 220, 'Расчёт': 420, 'Комментарий': 200, 'Проверить': 200, 'Доказательства': 220 };
  Object.keys(widths).forEach((h) => sh.setColumnWidth(C[h], widths[h]));
  sh.setRowHeight(1, 42);
  sh.hideColumns(C['ID маршрута']);
  sh.hideColumns(C['ID ответа']);
  return sh;
}

function migratePay_(ss, old) {
  const lastCol = old.getLastColumn();
  const lastRow = old.getLastRow();
  const head = old.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim());
  const rows = lastRow > 1 ? old.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  old.setName(PAY_SHEET + ' (старый ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH.mm') + ')');
  const sh = createPaySheet_(ss);
  const get = (r, h) => { const i = head.indexOf(h); return i >= 0 ? r[i] : ''; };
  const reps = rows.filter((r) => get(r, 'Дата отчёта') instanceof Date).map((r) => ({
    date: get(r, 'Дата отчёта'), nick: get(r, 'Никнейм'), bank: String(get(r, 'Счёт')).replace(/^'/, ''),
    level: get(r, 'Класс'), route: get(r, 'Маршрут'), routeId: get(r, 'ID маршрута'), bus: get(r, 'Автобус'),
    livery: get(r, 'Окраска'), glonass: get(r, 'ГЛОНАСС'), rounds: get(r, 'Круги'), passengers: get(r, 'Пассажиры'),
    proofRounds: get(r, 'Доказательства'), id: get(r, 'ID ответа'), source: get(r, 'Источник') || 'форма', comment: get(r, 'Комментарий'),
    status: get(r, 'Статус') || 'На проверке', changed: get(r, 'Статус изменён'), paid: get(r, 'Выплачено'), reimburse: get(r, 'Возмещение'),
  }));
  if (reps.length) writePayRows_(sh, reps, siteRoutes_(), 'На проверке');
  return sh;
}

function colLetter_(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Формулы строки: суммы считаются от кругов, ставок и процента — правка любой из них пересчитывает итог.
function rowFormulas_(r) {
  const c = (h) => colLetter_(C[h]) + r;
  const t = (h) => 'TEXT(' + c(h) + ',"#,##0")';
  return {
    'ЗП за рейсы': '=' + c('Круги') + '*' + c('Ставка за круг'),
    'Штраф окраски': '=ROUND(' + c('ЗП за рейсы') + '*' + c('Штраф окраски, %') + '/100)',
    'За автобус': '=' + c('Круги') + '*' + c('Надбавка за круг'),
    'За пассажиров': '=' + c('Пассажиры') + '*' + c('Ставка за пассажира'),
    'Итого': '=' + c('ЗП за рейсы') + '-' + c('Штраф окраски') + '+' + c('За автобус') + '+' + c('За пассажиров') + '+N(' + c('Возмещение') + ')',
    'Расчёт': '=' + c('Круги') + '&" кр. × "&' + t('Ставка за круг') + '&" = "&' + t('ЗП за рейсы') +
      '&IF(' + c('Штраф окраски') + '>0," − окраска "&' + c('Штраф окраски, %') + '&"% ("&' + t('Штраф окраски') + '&")","")' +
      '&IF(' + c('За автобус') + '>0," + автобус "&' + c('Круги') + '&" × "&' + t('Надбавка за круг') + ',"")' +
      '&IF(' + c('За пассажиров') + '>0," + пасс. "&' + c('Пассажиры') + '&" × "&' + t('Ставка за пассажира') + ',"")' +
      '&IF(N(' + c('Возмещение') + ')>0," + возмещение "&' + t('Возмещение') + ',"")' +
      '&" = "&' + t('Итого') + '&" ₽"',
  };
}

function payRow_(rep, data, status) {
  const c = calcReport_(data, rep);
  const proofs = [rep.proofRounds, rep.proofPassengers, rep.proofCosts].filter((x) => x && x !== '-').join('\n');
  const v = {
    'Дата отчёта': rep.date, 'Неделя': weekLabel_(rep.date), 'Никнейм': rep.nick, 'Класс': c.level,
    'Перевозчик': c.carrier, 'Маршрут': c.route, 'Автобус': rep.bus, 'Окраска': rep.livery, 'ГЛОНАСС': rep.glonass,
    'Круги': c.rounds, 'Ставка за круг': c.rate, 'Штраф окраски, %': c.liveryPct,
    'Тип автобуса': c.busType, 'Надбавка за круг': c.busPer, 'Пассажиры': c.pass, 'Ставка за пассажира': c.passRate,
    'Возмещение': rep.reimburse || '', 'Статус': rep.status || status, 'Комментарий': rep.comment || '', 'Проверить': c.notes.join('; '),
    'Статус изменён': rep.changed || '', 'Выплачено': rep.paid || '', 'Счёт': "'" + String(rep.bank || ''), 'Доказательства': proofs,
    'Источник': rep.source || 'форма', 'ID маршрута': c.routeId, 'ID ответа': rep.id || '',
  };
  return PAY_HEAD.map((h) => (v[h] === undefined ? '' : v[h]));
}

function writePayRows_(sh, reps, data, status) {
  const rows = reps.map((r) => payRow_(r, data, status));
  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, PAY_HEAD.length).setValues(rows);
  FORMULA_COLS.forEach((h) => sh.getRange(start, C[h], rows.length, 1).setFormulas(rows.map((_, i) => [rowFormulas_(start + i)[h]])));
  return rows.length;
}

function appendReports_(reps, status) {
  if (!reps.length) return 0;
  const n = writePayRows_(paySheet_(), reps, siteRoutes_(), status);
  cacheDrop_('ridro');
  return n;
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
    .addItem('Пересобрать сводку', 'rebuildSummary')
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
  buildSummary_();
  const has = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'onReport');
  if (!has) ScriptApp.newTrigger('onReport').forForm(FORM_ID).onFormSubmit().create();
  siteRoutes_(); // проверка доступа к сайту
  Logger.log('Готово: листы «' + PAY_SHEET + '», «' + SUMMARY_SHEET + '» и триггер на новые отчёты. Обновите таблицу — появится меню Ridro.');
}

function rebuildSummary() { buildSummary_(); }

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
    const g = (h) => v[C[h] - 1];
    if (!g('Дата отчёта')) continue;
    // маршрут: если в ячейке «Маршрут» написали другой номер — берём его, иначе прежний ID
    const typed = matchRoute_(data.routes, g('Маршрут'));
    const keepId = typed && String(g('Маршрут')).indexOf(' (') < 0 ? '' : g('ID маршрута');
    const c = calcReport_(data, { route: g('Маршрут'), routeId: keepId, level: g('Класс'), rounds: g('Круги'), passengers: g('Пассажиры'), livery: g('Окраска'), bus: g('Автобус') });
    const set = (h, val) => sh.getRange(r, C[h]).setValue(val);
    set('Перевозчик', c.carrier); set('Маршрут', c.route); set('ID маршрута', c.routeId); set('Класс', c.level);
    set('Ставка за круг', c.rate); set('Штраф окраски, %', c.liveryPct); set('Тип автобуса', c.busType);
    set('Надбавка за круг', c.busPer); set('Ставка за пассажира', c.passRate); set('Проверить', c.notes.join('; '));
    const f = rowFormulas_(r);
    FORMULA_COLS.forEach((h) => sh.getRange(r, C[h]).setFormula(f[h]));
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

/* =====================  Сводка (формулы, обновляется сама)  ===================== */

function buildSummary_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SUMMARY_SHEET) || ss.insertSheet(SUMMARY_SHEET, 1);
  sh.clear();
  const L = (h) => colLetter_(C[h]);
  const src = "'" + PAY_SHEET + "'!A2:" + colLetter_(PAY_HEAD.length);
  const notRejected = L('Статус') + " <> 'Отклонён'";
  const blocks = [
    { at: 'A', title: 'По сотрудникам (без отклонённых)', width: 4,
      q: 'select ' + L('Никнейм') + ', count(' + L('Дата отчёта') + '), sum(' + L('Круги') + '), sum(' + L('Итого') + ') where ' + L('Никнейм') + ' is not null and ' + notRejected +
        ' group by ' + L('Никнейм') + ' order by sum(' + L('Итого') + ') desc label ' + L('Никнейм') + " 'Сотрудник', count(" + L('Дата отчёта') + ") 'Строк', sum(" + L('Круги') + ") 'Кругов', sum(" + L('Итого') + ") 'Начислено'" },
    { at: 'F', title: 'Сотрудники × статус, ₽', width: 5,
      q: 'select ' + L('Никнейм') + ', sum(' + L('Итого') + ') where ' + L('Никнейм') + ' is not null group by ' + L('Никнейм') + ' pivot ' + L('Статус') + ' label ' + L('Никнейм') + " 'Сотрудник'" },
    { at: 'L', title: 'По неделям (без отклонённых)', width: 4,
      q: 'select ' + L('Неделя') + ', count(' + L('Дата отчёта') + '), sum(' + L('Круги') + '), sum(' + L('Итого') + ') where ' + L('Неделя') + ' is not null and ' + notRejected +
        ' group by ' + L('Неделя') + ' label ' + L('Неделя') + " 'Неделя', count(" + L('Дата отчёта') + ") 'Строк', sum(" + L('Круги') + ") 'Кругов', sum(" + L('Итого') + ") 'Начислено'" },
    { at: 'Q', title: 'По маршрутам (без отклонённых)', width: 5,
      q: 'select ' + L('Маршрут') + ', count(' + L('Дата отчёта') + '), sum(' + L('Круги') + '), sum(' + L('Пассажиры') + '), sum(' + L('Итого') + ') where ' + L('Маршрут') + ' is not null and ' + notRejected +
        ' group by ' + L('Маршрут') + ' order by sum(' + L('Итого') + ') desc label ' + L('Маршрут') + " 'Маршрут', count(" + L('Дата отчёта') + ") 'Строк', sum(" + L('Круги') + ") 'Кругов', sum(" + L('Пассажиры') + ") 'Пассажиров', sum(" + L('Итого') + ") 'Начислено'" },
  ];
  sh.getRange('A1').setValue('Сводка по листу «' + PAY_SHEET + '» — обновляется сама').setFontWeight('bold').setFontSize(12);
  blocks.forEach((b) => {
    sh.getRange(b.at + '2').setValue(b.title).setFontWeight('bold').setFontColor('#B07A00');
    sh.getRange(b.at + '3').setFormula('=IFERROR(QUERY(' + src + ',"' + b.q + '",0),"нет данных")');
  });
  sh.getRange('B4:E').setNumberFormat('#,##0');
  sh.getRange('D4:D').setNumberFormat('#,##0 ₽');
  sh.getRange('G4:J').setNumberFormat('#,##0 ₽');
  sh.getRange('O4:O').setNumberFormat('#,##0 ₽');
  sh.getRange('U4:U').setNumberFormat('#,##0 ₽');
  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(6, 160);
  sh.setColumnWidth(12, 150);
  sh.setColumnWidth(17, 300);
  sh.setFrozenRows(3);
  return sh;
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
