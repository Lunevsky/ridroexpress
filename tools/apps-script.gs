/**
 * Ridro — данные для сайта из таблицы «ЧТУП «RidroExpress» (ИП «Ridro»)» и формы отчётов.
 * Отдаёт ТОЛЬКО перечисленные ниже поля. Банковские счета и подписи на сайт не попадают.
 *
 * Установка (один раз, владельцем таблицы):
 *  1. Открыть таблицу → Расширения → Apps Script. Удалить всё в редакторе, вставить этот код, сохранить.
 *  2. Развернуть → Новое развертывание → «Выбрать тип» → Веб-приложение.
 *     Выполнять от имени: «Я». У кого есть доступ: «Все». Развернуть → разрешить доступ.
 *  3. Скопировать URL веб-приложения (заканчивается на /exec) и вставить в админке сайта:
 *     «Тексты и правила» → «Адрес данных таблицы». Сохранить на сайт.
 * После правки кода: Развернуть → Управление развертываниями → ✎ → Версия: «Новая версия».
 */
const STAFF_SHEET = 'База сотрудников';
const FORM_ID = '1UQR-iV8ZK91ciFA7ByY0uuUupL4ntLjOiqT0cnGh-Wg'; // форма «Отчет ЧТУП «RidroExpress»»
const REPORTS_LIMIT = 300; // сколько последних отчётов отдавать
const CACHE_SECONDS = 300;

// Столбцы листа сотрудников (A = 0). Столбец E (4) — банковский счёт — не отдаётся.
const STAFF_COLS = { nick: 0, vk: 1, position: 2, level: 3, hired: 5, warnings: 6, note: 7 };

// Вопросы формы, которые попадают на сайт (по началу текста вопроса).
const REPORT_FIELDS = {
  nick: 'Никнейм',
  level: 'На каком уровне',
  bus: 'Выберите используемый',
  livery: 'Выберите окраску',
  route: 'Маршрут №',
  glonass: 'Использовалась система ГЛОНАСС',
  rounds: 'Количество кругорейсов',
  passengers: 'Количество пассажиров',
};

function doGet() {
  const cache = CacheService.getScriptCache();
  let json = cache.get('ridro');
  if (!json) {
    json = JSON.stringify({ updated: new Date().toISOString(), staff: readStaff_(), reports: readReports_() });
    if (json.length < 90000) cache.put('ridro', json, CACHE_SECONDS);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function readStaff_() {
  const rows = SpreadsheetApp.getActive().getSheetByName(STAFF_SHEET).getDataRange().getDisplayValues();
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
    group.members.push(m);
  }
  return out;
}

function readReports_() {
  const form = FormApp.openById(FORM_ID);
  const ids = {};
  form.getItems().forEach((it) => {
    const title = it.getTitle().trim();
    Object.keys(REPORT_FIELDS).forEach((k) => { if (title.indexOf(REPORT_FIELDS[k]) === 0) ids[k] = it.getId(); });
  });
  return form.getResponses().slice(-REPORTS_LIMIT).reverse().map((resp) => {
    const byId = {};
    resp.getItemResponses().forEach((ir) => { byId[ir.getItem().getId()] = ir.getResponse(); });
    const o = { date: resp.getTimestamp().toISOString() };
    Object.keys(ids).forEach((k) => { o[k] = String(byId[ids[k]] == null ? '' : byId[ids[k]]); });
    return o;
  });
}
