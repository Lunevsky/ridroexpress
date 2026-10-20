// Справочник сотрудника
(async () => {
  const { esc, money, load, store, groupOf } = Ridro;
  const [data, site, binds] = await Promise.all([load("routes"), load("site"), load("binds")]);
  const routes = data.routes;
  const $ = (id) => document.getElementById(id);

  // ---- кнопка «Отчёты» (ссылка редактируется в админке, тип reports) ----
  const reports = site.links.find((l) => l.kind === "reports");
  if (reports) Object.assign($("reports-link"), { href: reports.url, hidden: false });

  // ---- клавиша для биндов (запоминается в браузере) ----
  const keyInput = $("key");
  keyInput.value = store.get("ridro-bind-key") || "";
  const KEY_RE = /^bind\s+(\|КНОПКА\||\[Клавиша\]|\[КНОПКА\[|Клавиша)\s*/i;
  const bindText = (b) => {
    const key = keyInput.value.trim() || "|КНОПКА|";
    return KEY_RE.test(b) ? b.replace(KEY_RE, `bind ${key} `) : `bind ${key} ${b}`;
  };
  const copyRow = (text) => `<div class="copy-row"><code>${esc(text)}</code><button class="btn btn-sm copy" data-copy="${esc(text)}">Копировать</button></div>`;

  // ---- маршруты ----
  const st = { q: "", group: "all" };
  const salaryLine = (s) => !s ? "уточняется"
    : s.trainee === s.driver && s.driver === s.chauffeur ? `${money(s.driver)} (любая должность)`
    : `${money(s.trainee)} / ${money(s.driver)} / ${money(s.chauffeur)}`;

  function routeBlock(r) {
    const sign = r.sign || {};
    const bonusRows = (r.busBonus || []).map((b) => `<tr><td>${esc(b.type)}</td><td style="white-space:normal">${esc(b.models)}</td><td class="r">${money(b.amount)}</td></tr>`).join("");
    return `<details class="acc" data-id="${esc(r.id)}">
      <summary><span class="num ${esc(r.group)}">${esc(r.number)}</span><span><b>${esc(r.from)} → ${esc(r.to)}</b><br><span class="op">${esc(groupOf(data, r.group).short)} · ${esc(r.city)}</span></span></summary>
      <div class="acc-body">
        <dl class="kv">
          <dt>Проезд</dt><dd>${r.fare ? money(r.fare) : '<span class="badge warn">уточняется</span>'}</dd>
          <dt>ЗП (III / II / I класс)</dt><dd>${salaryLine(r.salary)}</dd>
          <dt>Скриншоты</dt><dd>${r.screenshots.length ? `${r.screenshots.length}: ${esc(r.screenshots.join(" → "))}` : '<span class="badge warn">уточняется</span>'}</dd>
          <dt>Остановки</dt><dd>${esc(r.stops.join(", "))}</dd>
          ${r.note ? `<dt>Примечание</dt><dd>${esc(r.note)}</dd>` : ""}
          ${r.map ? `<dt>Карта</dt><dd><a href="${esc(r.map)}" target="_blank" rel="noopener">Открыть схему ↗</a></dd>` : ""}
        </dl>
        ${sign.name || sign.line1 ? `<div><h3>Табличка</h3>
          <dl class="kv"><dt>Название</dt><dd>${esc(sign.name)}</dd><dt>2-я строка</dt><dd>${esc(sign.line2)}</dd></dl>
          <p class="muted" style="margin:8px 0 6px">1-я строка:</p>${copyRow(sign.line1)}</div>` : ""}
        ${r.binds.length ? `<div><h3>Бинд при остановке</h3><div class="binds-of">${r.binds.map((b) => copyRow(bindText(b))).join("")}</div></div>` : ""}
        ${bonusRows ? `<div><h3>Надбавка за тип автобуса (за кругорейс)</h3><div class="table-wrap"><table><thead><tr><th>Тип</th><th>Модели</th><th class="r">Надбавка</th></tr></thead><tbody>${bonusRows}</tbody></table></div></div>` : ""}
      </div>
    </details>`;
  }
  const rg = $("rg");
  const renderRoutes = () => {
    rg.innerHTML = [`<button class="chip" data-v="all" aria-pressed="${st.group === "all"}">Все</button>`,
      ...data.groups.map((g) => `<button class="chip" data-v="${g.id}" aria-pressed="${st.group === g.id}">${esc(g.short)}</button>`)].join("");
    const list = routes.filter((r) => (st.group === "all" || r.group === st.group) &&
      (!st.q || [r.number, r.from, r.to, ...r.stops].join(" ").toLowerCase().includes(st.q)));
    $("route-list").innerHTML = list.map(routeBlock).join("") || `<div class="empty-state">Ничего не найдено</div>`;
  };
  rg.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) { st.group = b.dataset.v; renderRoutes(); } });
  $("rq").addEventListener("input", (e) => { st.q = e.target.value.trim().toLowerCase(); renderRoutes(); });
  keyInput.addEventListener("input", () => { store.set("ridro-bind-key", keyInput.value.trim()); renderRoutes(); renderBinds(); });

  // ---- зарплата ----
  $("salary-note").textContent = "Без учёта надбавки за пассажиров. III класс — стажёр, II класс — водитель, I класс — шофёр.";
  $("salary-table").innerHTML = `<thead><tr><th>№</th><th>Маршрут</th><th class="r">III класс</th><th class="r">II класс</th><th class="r">I класс</th></tr></thead><tbody>` +
    data.groups.map((g) => {
      const rows = routes.filter((r) => r.group === g.id).map((r) => {
        const s = r.salary || {};
        return `<tr><td><span class="num ${esc(r.group)}" style="height:28px;min-width:40px;font-size:.9rem">${esc(r.number)}</span></td><td style="white-space:normal;min-width:170px">${esc(r.from)} → ${esc(r.to)}</td><td class="r">${money(s.trainee)}</td><td class="r">${money(s.driver)}</td><td class="r">${money(s.chauffeur)}</td></tr>`;
      }).join("");
      const pb = g.passengerBonus ? ` · за пассажира +${money(g.passengerBonus)}` : "";
      return `<tr class="group-row"><td colspan="5">${esc(g.name)}${pb}</td></tr>${rows}`;
    }).join("") + `</tbody>`;

  // ---- надбавки за покупку ----
  $("pb-note").textContent = site.purchaseBonusNote;
  $("pb-table").innerHTML = `<thead><tr><th>Цена автобуса</th><th class="r">За кругорейс</th></tr></thead><tbody>` +
    site.purchaseBonus.map((b) => `<tr><td>${esc(b.range)}</td><td class="r">${money(b.amount)}</td></tr>`).join("") + `</tbody>`;

  // ---- должности, правила, наказания ----
  $("ranks").innerHTML = site.ranks.map((r) => `<div class="step"><h3>${esc(r.title)}</h3><p>${esc(r.text)}</p></div>`).join("");
  $("rules").innerHTML = site.tripRules.map((t) => `<li>${esc(t)}</li>`).join("");
  $("penalties").innerHTML = `<thead><tr><th>Нарушение</th><th>Наказание</th></tr></thead><tbody>` +
    site.penalties.map((p) => `<tr><td style="white-space:normal">${esc(p.rule)}</td><td style="white-space:normal">${esc(p.penalty)}</td></tr>`).join("") + `</tbody>`;

  // ---- раскраска ----
  const textOn = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140 ? "#000" : "#fff"; };
  $("liveries").innerHTML = site.liveries.map((l) => `<div class="panel"><h3>${esc(l.name)}</h3><div class="swatches">${
    l.colors.map((c) => `<button class="swatch" style="background:${esc(c)};color:${textOn(c)}" data-copy="${esc(c)}" title="Скопировать ${esc(c)}">${esc(c)}</button>`).join("")}</div></div>`).join("");

  // ---- бинды ----
  function renderBinds() {
    $("binds").innerHTML = binds.map((s) => `<div class="panel" style="margin-bottom:12px"><h3>${esc(s.section)}</h3>${s.items.map((b) => copyRow(bindText(b))).join("")}</div>`).join("");
  }

  // ---- калькулятор ЗП ----
  // Поля формы отчёта (Google Forms). Если форму пересоздадут — обновить entry-номера.
  const FORM = { nick: "entry.1120337211", level: "entry.1038580193", livery: "entry.1523770638", route: "entry.239657998", rounds: "entry.819958531", passengers: "entry.1820939701" };
  const LEVEL_TEXT = { chauffeur: "Водитель l-класса", driver: "Водитель ll-класса", trainee: "Водитель lll-класса" };
  const LIVERY_TEXT = { 0: "Фирменный или уникальный", 5: "В стилистике фирменной раскраски ИП (-5% от ЗП)", 15: "Несоответствующий цветам ИП (ненормативный) (-15% от ЗП)" };
  const isMup = (r) => r.group === "mup" || r.group === "troll";

  // Устав, Прил. №1 п.3.1–3.2: штраф за окраску — от ЗП за рейсы
  function calc(r, level, rounds, pass, liveryPct, busAmount) {
    const base = (r.salary?.[level] || 0) * rounds;
    const penalty = Math.round(base * liveryPct / 100);
    const bus = busAmount * rounds;
    const bonus = groupOf(data, r.group).passengerBonus;
    const passengers = (bonus || 0) * pass;
    return { base, penalty, bus, passengers, bonus, total: base - penalty + bus + passengers };
  }

  const cRoute = $("c-route");
  cRoute.innerHTML = data.groups.map((g) => `<optgroup label="${esc(g.name)}">${routes.filter((r) => r.group === g.id && r.salary)
    .map((r) => `<option value="${esc(r.id)}">${esc(r.number)} · ${esc(r.from)} → ${esc(r.to)}</option>`).join("")}</optgroup>`).join("");
  $("c-nick").value = store.get("ridro-nick") || "";
  const fillBus = () => {
    const r = routes.find((x) => x.id === cRoute.value);
    $("c-bus").innerHTML = `<option value="0">Без надбавки</option>` +
      (r.busBonus || []).map((b) => `<option value="${b.amount}">${esc(b.type)} (+${money(b.amount)})</option>`).join("");
  };
  function renderCalc() {
    const r = routes.find((x) => x.id === cRoute.value);
    const level = $("c-level").value;
    const rounds = Math.max(0, +$("c-rounds").value || 0);
    const pass = Math.max(0, +$("c-pass").value || 0);
    const liveryPct = +$("c-livery").value;
    const c = calc(r, level, rounds, pass, liveryPct, +$("c-bus").value);
    $("c-out").innerHTML = `
      <div class="fact"><span>За рейсы (${rounds} × ${money(r.salary[level])})</span><b>${money(c.base)}</b></div>
      ${liveryPct ? `<div class="fact minus"><span>Окраска −${liveryPct}%</span><b>−${money(c.penalty)}</b></div>` : ""}
      ${c.bus ? `<div class="fact"><span>Надбавка за автобус</span><b>+${money(c.bus)}</b></div>` : ""}
      <div class="fact"><span>Пассажиры${c.bonus ? ` (${pass} × ${money(c.bonus)})` : ""}</span><b>${c.bonus ? "+" + money(c.passengers) : "не указано"}</b></div>
      <div class="fact total"><span>Итого примерно</span><b>${money(c.total)}</b></div>`;
    const nick = $("c-nick").value.trim();
    store.set("ridro-nick", nick);
    const q = new URLSearchParams({ usp: "pp_url" });
    if (nick) q.set(FORM.nick, nick);
    q.set(FORM.level, LEVEL_TEXT[level]);
    q.set(FORM.livery, LIVERY_TEXT[liveryPct]);
    q.set(FORM.route, isMup(r) ? `${r.number} (МУП)` : r.number);
    q.set(FORM.rounds, rounds);
    q.set(FORM.passengers, pass);
    const send = $("c-send");
    if (reports) send.href = reports.url.replace(/\/viewform.*$/, "/viewform") + "?" + q;
    send.hidden = !reports;
  }
  cRoute.addEventListener("change", () => { fillBus(); renderCalc(); });
  ["c-level", "c-rounds", "c-pass", "c-livery", "c-bus", "c-nick"].forEach((id) => $(id).addEventListener("input", renderCalc));
  fillBus();
  renderCalc();

  // ---- отчёты и сотрудники: из таблицы через Apps Script (tools/apps-script.gs) ----
  const norm = (s) => String(s).toUpperCase().replace(/Ё/g, "Е").replace(/A/g, "А").replace(/T/g, "Т").replace(/M/g, "М").replace(/K/g, "К").replace(/L/g, "Л");
  function matchRoute(text) {
    const pref = /МУП/i.test(text) ? ["mup", "troll", "ridro", "moonowl"] : ["ridro", "moonowl", "troll", "mup"];
    for (const tok of norm(text).split(/[^0-9А-Я]+/).filter((t) => t && t !== "МУП")) {
      const c = routes.filter((r) => norm(r.number) === tok && r.salary);
      // одинаковые номера (145 Жуковский / Невский) различаем по городу в тексте
      const city = (r) => (r.city && text.toLowerCase().includes(r.city.slice(0, 4).toLowerCase()) ? 0 : 1);
      if (c.length) return c.sort((a, b) => pref.indexOf(a.group) - pref.indexOf(b.group) || city(a) - city(b))[0];
    }
    return null;
  }
  const levelOf = (t) => {
    const s = String(t).replace(/[IІ]/g, "l");
    return /lll/.test(s) ? "trainee" : /ll/.test(s) ? "driver" : /l/.test(s) ? "chauffeur" : null;
  };
  const liveryOf = (t) => (/15%/.test(t) ? 15 : /5%/.test(t) ? 5 : 0);
  const levelShort = { chauffeur: "I", driver: "II", trainee: "III" };

  let reportsList = [];
  let shown = 50;
  function renderReports() {
    const q = $("rep-q").value.trim().toLowerCase();
    const list = reportsList.filter((r) => !q || `${r.nick} ${r.route}`.toLowerCase().includes(q));
    if (!list.length) { $("reports").innerHTML = `<div class="notice">Отчётов не найдено.</div>`; return; }
    const rows = list.slice(0, shown).map((r) => {
      const route = matchRoute(r.route);
      const level = levelOf(r.level);
      const zp = route && level ? calc(route, level, parseInt(r.rounds, 10) || 0, parseInt(r.passengers, 10) || 0, liveryOf(r.livery), 0).total : null;
      const d = new Date(r.date);
      return `<tr><td>${d.toLocaleDateString("ru-RU")} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</td>
        <td>${esc(r.nick)}</td><td>${level ? levelShort[level] : esc(r.level)}</td>
        <td>${route ? `<span class="num ${esc(route.group)}" style="height:26px;min-width:38px;font-size:.85rem">${esc(route.number)}</span>` : esc(r.route)}</td>
        <td style="white-space:normal;min-width:160px">${esc(r.bus)}</td><td class="r">${esc(r.rounds)}</td><td class="r">${esc(r.passengers)}</td>
        <td>${esc(r.glonass)}</td><td class="r">${zp == null ? "—" : "≈ " + money(zp)}</td></tr>`;
    }).join("");
    $("reports").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Ник</th><th>Класс</th><th>Маршрут</th><th>Автобус</th><th class="r">Круги</th><th class="r">Пасс.</th><th>ГЛОНАСС</th><th class="r">ЗП</th></tr></thead><tbody>${rows}</tbody></table></div>` +
      (list.length > shown ? `<button class="btn btn-ghost more" id="rep-more">Показать ещё (${list.length - shown})</button>` : "");
  }
  $("reports").addEventListener("click", (e) => { if (e.target.id === "rep-more") { shown += 50; renderReports(); } });
  $("rep-q").addEventListener("input", () => { shown = 50; renderReports(); });

  let staffData = null;
  function renderStaff() {
    const q = $("staff-q").value.trim().toLowerCase();
    $("staff").innerHTML = staffData.groups.map((g) => {
      const m = g.members.filter((x) => !q || `${x.nick} ${x.vk}`.toLowerCase().includes(q));
      if (!m.length) return "";
      return `<div class="panel" style="margin-bottom:12px"><h3>${esc(g.title)} <span class="badge">${m.length}</span></h3><div class="table-wrap"><table>
        <thead><tr><th>Никнейм</th><th>ВКонтакте</th><th>Должность</th><th>Уровень ЗП</th><th>Принят</th><th>Выговоры</th><th>Примечание</th></tr></thead><tbody>${
        m.map((x) => `<tr><td><b>${esc(x.nick)}</b></td><td>${esc(x.vk)}</td><td>${esc(x.position)}</td><td>${esc(x.level)}</td><td>${esc(x.hired)}</td><td>${esc(x.warnings)}</td><td style="white-space:normal">${esc(x.note)}</td></tr>`).join("")
      }</tbody></table></div></div>`;
    }).join("") || `<div class="notice">Никого не найдено.</div>`;
  }
  $("staff-q").addEventListener("input", () => staffData && renderStaff());

  async function loadSheet() {
    const fail = (text) => { $("reports").innerHTML = $("staff").innerHTML = `<div class="notice">${text}</div>`; };
    if (!site.sheetApi) return fail("Скоро здесь появятся данные из таблицы сотрудников.");
    try {
      const j = await (await fetch(site.sheetApi)).json();
      staffData = j.staff;
      reportsList = j.reports || [];
      const total = staffData.groups.reduce((n, g) => n + g.members.length, 0);
      $("staff-note").textContent = `Всего: ${total}` + (staffData.edited ? ` · последние правки таблицы: ${staffData.edited}` : "");
      renderStaff();
      renderReports();
    } catch {
      fail("Не удалось загрузить данные таблицы. Попробуйте обновить страницу позже.");
    }
  }
  loadSheet();

  // ---- устав (с Google Диска, tools/sync_drive.py) ----
  fetch("data/ustav.html", { cache: "no-cache" }).then((r) => r.text()).then((h) => { $("ustav").innerHTML = h; });

  renderRoutes();
  renderBinds();
  // контент дорисован — переходим к якорю из ссылки
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();

  // ---- подсветка пункта меню ----
  const links = [...document.querySelectorAll("#side a")];
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id));
    });
  }, { rootMargin: "-30% 0px -60% 0px" });
  document.querySelectorAll("main section").forEach((s) => obs.observe(s));
})().catch((err) => {
  document.getElementById("route-list").innerHTML = `<div class="empty-state">${Ridro.esc(err.message)}</div>`;
});
