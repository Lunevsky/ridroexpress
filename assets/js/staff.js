// Справочник сотрудника
(async () => {
  const { esc, money, load, store, groupOf } = Ridro;
  const [data, site] = await Promise.all([load("routes"), load("site")]);
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
          <dt>ЗП (С / В / Ш)</dt><dd>${salaryLine(r.salary)}</dd>
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
  $("salary-note").textContent = "Без учёта надбавки за пассажиров. Должности: С — стажёр, В — водитель, Ш — шофёр.";
  $("salary-table").innerHTML = `<thead><tr><th>№</th><th>Маршрут</th><th class="r">Стажёр</th><th class="r">Водитель</th><th class="r">Шофёр</th></tr></thead><tbody>` +
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
    $("binds").innerHTML = site.binds.map((s) => `<div class="panel" style="margin-bottom:12px"><h3>${esc(s.section)}</h3>${s.items.map((b) => copyRow(bindText(b))).join("")}</div>`).join("");
  }

  // ---- ПИВО ----
  $("pivo").innerHTML = site.pivo.map((p) => `<div class="step"><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></div>`).join("");
  $("pivo-faq").innerHTML = site.pivoFaq.map((f) => `<details class="acc"><summary><b>${esc(f.q)}</b></summary><div class="acc-body"><p style="margin:0">${esc(f.a)}</p></div></details>`).join("");

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
