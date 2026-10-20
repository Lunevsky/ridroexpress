// Справочник сотрудника
(async () => {
  const { esc, money, load, store, groupOf } = Ridro;
  const [data, site, binds] = await Promise.all([load("routes"), load("site"), load("binds")]);
  const routes = data.routes;
  const $ = (id) => document.getElementById(id);

  // ссылка на Google-форму отчёта (тип reports, редактируется в админке) — для кнопки «Открыть в форме»
  const reports = site.links.find((l) => l.kind === "reports");

  // ---- клавиша для биндов (запоминается в браузере) ----
  // Клавиша для биндов: поля стоят рядом с биндами (раздел «Бинды» и каждый маршрут), значение общее.
  let bindKey = store.get("ridro-bind-key") || "";
  const KEY_RE = /^bind\s+(\|КНОПКА\||\[Клавиша\]|\[КНОПКА\[|Клавиша)\s*/i;
  const bindText = (b) => {
    const key = bindKey.trim() || "|КНОПКА|";
    return KEY_RE.test(b) ? b.replace(KEY_RE, `bind ${key} `) : `bind ${key} ${b}`;
  };
  const bindRow = (b) => { const t = bindText(b); return `<div class="copy-row"><code data-bind="${esc(b)}">${esc(t)}</code><button class="btn btn-sm copy" data-copy="${esc(t)}">Копировать</button></div>`; };
  const keyField = () => `<label class="field bind-key-field">Клавиша для биндов<input class="input bind-key" placeholder="например, num_1" value="${esc(bindKey)}"></label>`;
  // смена клавиши — только тексты биндов, без перерисовки (открытые маршруты не сворачиваются)
  document.addEventListener("input", (e) => {
    if (!e.target.classList.contains("bind-key")) return;
    bindKey = e.target.value;
    store.set("ridro-bind-key", bindKey.trim());
    document.querySelectorAll(".bind-key").forEach((x) => { if (x !== e.target) x.value = bindKey; });
    document.querySelectorAll("code[data-bind]").forEach((c) => {
      const t = bindText(c.dataset.bind);
      c.textContent = t;
      c.nextElementSibling.dataset.copy = t;
    });
  });
  document.querySelectorAll(".bind-key").forEach((x) => { x.value = bindKey; });
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
        ${r.binds.length ? `<div><h3>Бинд при остановке</h3>${keyField()}<div class="binds-of">${r.binds.map(bindRow).join("")}</div></div>` : ""}
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
    $("binds").innerHTML = binds.map((s) => `<div class="panel" style="margin-bottom:12px"><h3>${esc(s.section)}</h3>${s.items.map(bindRow).join("")}</div>`).join("");
  }

  // ---- калькулятор ЗП и отчёт: несколько строк «маршрут + автобус» ----
  // Поля формы отчёта (Google Forms). Если форму пересоздадут — обновить entry-номера.
  const FORM = { nick: "entry.1120337211", level: "entry.1038580193", livery: "entry.1523770638", route: "entry.239657998", rounds: "entry.819958531", passengers: "entry.1820939701" };
  const LEVEL_TEXT = { chauffeur: "Водитель l-класса", driver: "Водитель ll-класса", trainee: "Водитель lll-класса" };
  const LIVERY_TEXT = { 0: "Фирменный или уникальный", 5: "В стилистике фирменной раскраски ИП (-5% от ЗП)", 15: "Несоответствующий цветам ИП (ненормативный) (-15% от ЗП)" };
  const LIVERY_SHORT = { 0: "Фирменный или уникальный", 5: "В стилистике (−5%)", 15: "Ненормативный (−15%)" };
  const MAX_ROWS = 10;
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

  // Надбавка за тип автобуса — та же оценка, что в скрипте таблицы (tools/apps-script.gs, busBonus_)
  const textNorm = (s) => String(s).toLowerCase().replace(/ё/g, "е").replace(/ikarus/g, "икарус").replace(/vector/g, "вектор")
    .replace(/gazelle/g, "газель").replace(/(\d{3,})\/(\d{2})\b/g, (m, a, b) => a + " " + a.slice(0, -2) + b);
  function guessBonus(r, bus) {
    if (!r || !bus || !(r.busBonus || []).length || /\[\s*Л-/i.test(bus)) return 0;
    const model = textNorm(bus.replace(/^\s*\[[^\]]*\]\s*/, "").split("№")[0]).replace(/\.\d+/g, "");
    const nums = model.match(/\d{3,}/g) || [];
    const words = (model.match(/[a-zа-я]{3,}/g) || []).map((w) => w.slice(0, 5));
    const rest = /рест/.test(model), restMatters = /3205[34]/.test(model);
    let best = null, bestScore = 0;
    r.busBonus.forEach((b) => {
      const t = textNorm(b.type + " " + b.models);
      let sc = 0;
      nums.forEach((n) => { if (t.includes(n)) sc += 3; });
      words.forEach((w) => { if (t.includes(w)) sc += 1; });
      if (restMatters) { if (/дорест/.test(t)) sc += rest ? -5 : 2; else if (/рест/.test(t)) sc += rest ? 3 : -2; }
      if (sc > bestScore) { best = b; bestScore = sc; }
    });
    return best ? best.amount : 0;
  }

  const routeOptions = (sel) => data.groups.map((g) => `<optgroup label="${esc(g.name)}">${routes.filter((r) => r.group === g.id && r.salary)
    .map((r) => `<option value="${esc(r.id)}" ${r.id === sel ? "selected" : ""}>${esc(r.number)} · ${esc(r.from)} → ${esc(r.to)}</option>`).join("")}</optgroup>`).join("");
  const firstRoute = routes.find((r) => r.salary).id;
  let busList = [];
  const newRow = (prev) => ({ routeId: prev?.routeId || firstRoute, rounds: 1, pass: 0, bus: prev?.bus || store.get("ridro-bus") || "", livery: prev?.livery || 0, bonus: 0, bonusAuto: true });
  const rows = [newRow()];
  const autoBonus = (row) => { if (row.bonusAuto) row.bonus = guessBonus(routes.find((x) => x.id === row.routeId), row.bus); };

  function renderRows() {
    $("c-rows").innerHTML = rows.map((row, i) => {
      const r = routes.find((x) => x.id === row.routeId);
      const busOpts = [`<option value="">— выберите автобус —</option>`, ...busList.map((b) => `<option ${b === row.bus ? "selected" : ""}>${esc(b)}</option>`)];
      if (row.bus && !busList.includes(row.bus)) busOpts.push(`<option selected>${esc(row.bus)}</option>`);
      return `<div class="trip" data-i="${i}">
        <div class="trip-head"><b>${rows.length > 1 ? `Строка ${i + 1}` : "Рейсы"}</b>${rows.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm" data-del>✕ Убрать</button>` : ""}</div>
        <div class="calc-grid">
          <label class="field">Маршрут<select class="input" data-k="routeId">${routeOptions(row.routeId)}</select></label>
          <label class="field">Кругорейсы<input class="input" data-k="rounds" type="number" min="1" max="100" value="${row.rounds}"></label>
          <label class="field">Пассажиры<input class="input" data-k="pass" type="number" min="0" value="${row.pass}"></label>
          <label class="field">Автобус<select class="input" data-k="bus">${busOpts.join("")}</select></label>
          <label class="field">Окраска автобуса<select class="input" data-k="livery">${[0, 5, 15].map((v) => `<option value="${v}" ${+row.livery === v ? "selected" : ""}>${LIVERY_SHORT[v]}</option>`).join("")}</select></label>
          <label class="field">Надбавка за тип автобуса<select class="input" data-k="bonus"><option value="0">Без надбавки</option>${
            (r.busBonus || []).map((b) => `<option value="${b.amount}" ${+row.bonus === b.amount ? "selected" : ""}>${esc(b.type)} (+${money(b.amount)})</option>`).join("")}</select></label>
        </div></div>`;
    }).join("");
    $("c-add").hidden = rows.length >= MAX_ROWS;
    renderCalc();
  }

  function renderCalc() {
    const level = $("c-level").value;
    let total = 0;
    const facts = rows.map((row, i) => {
      const r = routes.find((x) => x.id === row.routeId);
      const rounds = Math.max(0, +row.rounds || 0), pass = Math.max(0, +row.pass || 0);
      const c = calc(r, level, rounds, pass, +row.livery, +row.bonus);
      total += c.total;
      const parts = [`рейсы ${money(c.base)}`];
      if (c.penalty) parts.push(`окраска −${money(c.penalty)}`);
      if (c.bus) parts.push(`автобус +${money(c.bus)}`);
      parts.push(c.bonus ? `пасс. +${money(c.passengers)}` : "пасс. — не указано");
      return `<div class="fact"><span>${rows.length > 1 ? `${i + 1}. ` : ""}№${esc(r.number)} · ${rounds} × ${money(r.salary[level])}</span><b>${money(c.total)}</b><small class="hint" style="display:block;margin:4px 0 0">${parts.join(" · ")}</small></div>`;
    });
    $("c-out").innerHTML = facts.join("") + `<div class="fact total"><span>Итого примерно${rows.length > 1 ? ` (${rows.length} стр.)` : ""}</span><b>${money(total)}</b></div>`;

    // запасной путь — Google-форма (только для одной строки)
    const nick = $("c-nick").value.trim();
    store.set("ridro-nick", nick);
    const row = rows[0], r = routes.find((x) => x.id === row.routeId);
    const q = new URLSearchParams({ usp: "pp_url" });
    if (nick) q.set(FORM.nick, nick);
    q.set(FORM.level, LEVEL_TEXT[level]);
    q.set(FORM.livery, LIVERY_TEXT[row.livery]);
    q.set(FORM.route, isMup(r) ? `${r.number} (МУП)` : r.number);
    q.set(FORM.rounds, row.rounds);
    q.set(FORM.passengers, row.pass);
    const send = $("c-send");
    if (reports) send.href = reports.url.replace(/\/viewform.*$/, "/viewform") + "?" + q;
    send.hidden = !reports || rows.length > 1;
  }

  $("c-rows").addEventListener("change", (e) => {
    const k = e.target.dataset.k, row = rows[e.target.closest(".trip")?.dataset.i];
    if (!k || !row || k === "rounds" || k === "pass") return; // числа — через input, без перерисовки
    row[k] = e.target.value;
    if (k === "bonus") row.bonusAuto = false;
    if (k === "routeId" || k === "bus") { row.bonusAuto = true; autoBonus(row); }
    if (k === "bus") store.set("ridro-bus", row.bus);
    renderRows();
  });
  $("c-rows").addEventListener("input", (e) => {
    const k = e.target.dataset.k, row = rows[e.target.closest(".trip")?.dataset.i];
    if (k === "rounds" || k === "pass") { row[k] = e.target.value; renderCalc(); }
  });
  $("c-rows").addEventListener("click", (e) => {
    if (!e.target.closest("[data-del]")) return;
    rows.splice(+e.target.closest(".trip").dataset.i, 1);
    renderRows();
  });
  $("c-add").addEventListener("click", () => {
    const row = newRow(rows[rows.length - 1]);
    autoBonus(row);
    rows.push(row);
    renderRows();
  });
  ["c-level", "c-nick"].forEach((id) => $(id).addEventListener("input", renderCalc));
  renderRows();

  // ---- сотрудники: из таблицы через Apps Script (tools/apps-script.gs) ----
  // ссылка ВК из ячейки таблицы: только vk.com / vk.ru, http → https
  const vkLink = (x) => {
    const u = String(x.vkUrl || "").replace(/^http:/i, "https:");
    return /^https:\/\/(m\.)?vk\.(com|ru)\//i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(x.vk || "ВК")}</a>` : esc(x.vk);
  };
  let staffData = null;
  function renderStaff() {
    const q = $("staff-q").value.trim().toLowerCase();
    $("staff").innerHTML = staffData.groups.map((g) => {
      const m = g.members.filter((x) => !q || `${x.nick} ${x.vk}`.toLowerCase().includes(q));
      if (!m.length) return "";
      return `<div class="panel" style="margin-bottom:12px"><h3>${esc(g.title)} <span class="badge">${m.length}</span></h3><div class="table-wrap"><table>
        <thead><tr><th>Никнейм</th><th>ВКонтакте</th><th>Должность</th><th>Уровень ЗП</th><th>Принят</th><th>Выговоры</th><th>Примечание</th></tr></thead><tbody>${
        m.map((x) => `<tr><td><b>${esc(x.nick)}</b></td><td>${vkLink(x)}</td><td>${esc(x.position)}</td><td>${esc(x.level)}</td><td>${esc(x.hired)}</td><td>${esc(x.warnings)}</td><td style="white-space:normal">${esc(x.note)}</td></tr>`).join("")
      }</tbody></table></div></div>`;
    }).join("") || `<div class="notice">Никого не найдено.</div>`;
  }
  $("staff-q").addEventListener("input", () => staffData && renderStaff());

  async function loadSheet() {
    const fail = (text) => { $("staff").innerHTML = `<div class="notice">${text}</div>`; };
    if (!site.sheetApi) { $("r-form").hidden = true; return fail("Скоро здесь появятся данные из таблицы сотрудников."); }
    try {
      const j = await (await fetch(site.sheetApi)).json();
      staffData = j.staff;
      fillNicks(staffData);
      fillBuses(await load("buses").catch(() => j.buses || [])); // варианты — как в Google-форме (отчёт уходит туда)
      const total = staffData.groups.reduce((n, g) => n + g.members.length, 0);
      $("staff-note").textContent = `Всего: ${total}` + (staffData.edited ? ` · последние правки таблицы: ${staffData.edited}` : "");
      renderStaff();
    } catch {
      fail("Не удалось загрузить данные таблицы. Попробуйте обновить страницу позже.");
    }
  }
  loadSheet();

  // ---- сдача отчёта на сайте → таблица «Выплаты» (Apps Script doPost) ----
  // Ник — из списка сотрудников. Счёт хранится только на этом устройстве (на сайт счета не выкладываются).
  const banks = () => { try { return JSON.parse(store.get("ridro-banks") || "{}"); } catch { return {}; } };
  function fillNicks(staff) {
    const keep = $("c-nick").value || store.get("ridro-nick") || "";
    const nicks = [...new Set(staff.groups.flatMap((g) => g.members.map((m) => m.nick)).filter((n) => /^[A-Za-z]+_[A-Za-z]+$/.test(n)))]
      .sort((a, b) => a.localeCompare(b));
    $("c-nick").innerHTML = `<option value="">— выберите себя —</option>` +
      nicks.map((n) => `<option ${n === keep ? "selected" : ""}>${esc(n)}</option>`).join("");
    fillBank();
  }
  function fillBank() {
    const b = banks()[$("c-nick").value];
    if (b) $("r-bank").value = b;
  }
  $("c-nick").addEventListener("change", () => { $("r-bank").value = ""; fillBank(); });
  $("r-bank").addEventListener("input", () => {
    const digits = $("r-bank").value.replace(/\D/g, "");
    const nick = Object.keys(banks()).find((n) => banks()[n] === digits);
    if (nick && nick !== $("c-nick").value) { $("c-nick").value = nick; renderCalc(); }
  });

  function fillBuses(list) {
    busList = list;
    rows.forEach(autoBonus);
    renderRows();
  }
  $("r-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("r-result");
    const say = (text, ok) => { out.textContent = text; out.className = "report-result " + (ok ? "ok" : "bad"); };
    const noBus = rows.findIndex((r) => !r.bus);
    if (noBus >= 0) return say(rows.length > 1 ? `Строка ${noBus + 1}: выберите автобус.` : "Выберите автобус.", false);
    const body = {
      nick: $("c-nick").value.trim(), bank: $("r-bank").value.trim(), level: $("c-level").value, glonass: $("r-glonass").value,
      proofRounds: $("r-proof-rounds").value, proofPassengers: $("r-proof-pass").value, proofCosts: $("r-proof-costs").value,
      items: rows.map((r) => ({ routeId: r.routeId, rounds: +r.rounds, passengers: +r.pass, livery: +r.livery, bus: r.bus })),
    };
    if (rows.length === 1) Object.assign(body, body.items[0]); // старый формат — для прежней версии скрипта таблицы
    const btn = $("r-submit");
    btn.disabled = true;
    btn.textContent = "Отправляю…";
    try {
      // text/plain — «простой» запрос без предварительного CORS-запроса
      const res = await (await fetch(site.sheetApi, { method: "POST", body: JSON.stringify(body) })).json();
      if (!res.ok) return say(res.error || "Отчёт не принят.", false);
      say(`Отчёт принят и отправлен на проверку${res.lines > 1 ? ` (${res.lines} строки)` : ""}. Расчёт: ${money(res.total)}.` +
        (res.notes?.length ? ` Администрация проверит: ${res.notes.join("; ")}.` : ""), true);
      const saved = banks();
      if ($("r-remember").checked) saved[body.nick] = body.bank.replace(/\D/g, ""); else delete saved[body.nick];
      store.set("ridro-banks", JSON.stringify(saved));
      ["r-proof-rounds", "r-proof-pass", "r-proof-costs"].forEach((id) => { $(id).value = ""; });
      $("r-ok").checked = false;
      loadSheet();
    } catch {
      say("Не удалось отправить. Проверьте интернет и попробуйте ещё раз — или отправьте через Google-форму.", false);
    } finally {
      btn.disabled = false;
      btn.textContent = "Отправить отчёт";
    }
  });

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
