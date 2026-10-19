// Страница пассажиров: поиск и карточки маршрутов
(async () => {
  const { esc, money, load, groupOf } = Ridro;
  const [data, site] = await Promise.all([load("routes"), load("site")]);
  const routes = data.routes;
  const CITIES = ["Все", ...new Set(routes.map((r) => r.city))];
  const state = { q: "", city: "Все", group: "all" };

  // ---- статистика и тексты ----
  document.getElementById("st-routes").textContent = routes.length;
  document.getElementById("st-cities").textContent = CITIES.filter((c) => c !== "Все" && c !== "Межгород").length;
  const fares = routes.map((r) => r.fare).filter(Boolean);
  document.getElementById("fare-min").textContent = money(Math.min(...fares));
  document.getElementById("fare-max").textContent = money(Math.max(...fares));
  document.getElementById("p-rules").innerHTML = site.passengerRules.map((t) => `<li>${esc(t)}</li>`).join("");
  document.getElementById("tagline").textContent = site.org.tagline;
  document.getElementById("org-name").textContent = site.org.fullName;
  document.getElementById("org-director").textContent = site.org.director;
  document.getElementById("org-founders").textContent = site.org.founders.join(", ");
  document.getElementById("org-goal").textContent = site.org.goal;
  document.getElementById("org-founded").textContent = site.org.founded;
  document.getElementById("org-office").textContent = site.org.office;
  document.getElementById("org-depot").textContent = site.org.depot;
  document.getElementById("links").innerHTML = site.links
    .filter((l) => l.kind !== "staff" && l.kind !== "reports")
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>`).join("");

  // ---- фильтры ----
  const chip = (label, pressed, value) => `<button class="chip" data-value="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;
  const fCity = document.getElementById("f-city");
  const fGroup = document.getElementById("f-group");
  const renderChips = () => {
    fCity.innerHTML = CITIES.map((c) => chip(c, state.city === c, c)).join("");
    fGroup.innerHTML = chip("Все перевозчики", state.group === "all", "all") +
      data.groups.map((g) => chip(g.short, state.group === g.id, g.id)).join("");
  };
  fCity.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) { state.city = b.dataset.value; update(); } });
  fGroup.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) { state.group = b.dataset.value; update(); } });
  document.getElementById("q").addEventListener("input", (e) => { state.q = e.target.value.trim().toLowerCase(); update(); });

  const match = (r) => {
    if (state.city !== "Все" && r.city !== state.city) return false;
    if (state.group !== "all" && r.group !== state.group) return false;
    if (!state.q) return true;
    const hay = [r.number, r.from, r.to, ...r.stops].join(" ").toLowerCase();
    return state.q.split(/\s+/).every((w) => hay.includes(w));
  };

  // ---- карточки ----
  const grid = document.getElementById("grid");
  const card = (r) => {
    const thumb = r.map ? r.map.replace("assets/maps/", "assets/maps/thumb/") : "";
    return `<button class="card" data-id="${esc(r.id)}">
      ${thumb ? `<div class="thumb" style="background-image:url('${esc(thumb)}')"></div>` : `<div class="thumb empty">Карта скоро появится</div>`}
      <div class="body">
        <div class="top"><span class="num ${esc(r.group)}">${esc(r.number)}</span><span class="op">${esc(groupOf(data, r.group).short)} · ${esc(r.city)}</span></div>
        <div class="ends">${esc(r.from)}<span class="arrow">→</span>${esc(r.to)}</div>
        <div class="meta"><span>Проезд <b>${r.fare ? money(r.fare) : "уточняется"}</b></span><span>${r.stops.length} остановок</span></div>
      </div>
    </button>`;
  };
  function update() {
    renderChips();
    const list = routes.filter(match);
    document.getElementById("count").textContent = `Найдено: ${list.length}`;
    grid.innerHTML = list.length ? list.map(card).join("") : `<div class="empty-state">Ничего не нашлось. Попробуйте другой номер или остановку.</div>`;
  }
  grid.addEventListener("click", (e) => { const c = e.target.closest(".card"); if (c) location.hash = "route=" + c.dataset.id; });

  // ---- окно маршрута (ссылкой можно поделиться: #route=id) ----
  const dlg = document.getElementById("dlg");
  function openRoute(id) {
    const r = routes.find((x) => x.id === id);
    if (!r) return;
    const stops = r.stops.map((s, i) => `<li class="${i === 0 || i === r.stops.length - 1 ? "end" : ""}">${esc(s)}</li>`).join("");
    dlg.innerHTML = `
      <div class="dlg-head">
        <span class="num ${esc(r.group)}">${esc(r.number)}</span>
        <div><h3 id="dlg-title">${esc(r.from)} → ${esc(r.to)}</h3><span class="op">${esc(groupOf(data, r.group).name)}</span></div>
        <button class="btn btn-ghost btn-sm close" aria-label="Закрыть">✕</button>
      </div>
      <div class="dlg-body">
        <div class="dlg-map">${r.map ? `<a href="${esc(r.map)}" target="_blank" rel="noopener" title="Открыть карту в полном размере"><img src="${esc(r.map)}" alt="Схема маршрута ${esc(r.number)}"></a>` : `<div class="empty-state" style="margin:20px">Карта маршрута скоро появится</div>`}</div>
        <div class="dlg-info">
          <div class="facts">
            <div class="fact"><span>Проезд</span><b>${r.fare ? money(r.fare) : "уточняется"}</b></div>
            <div class="fact"><span>Город</span><b>${esc(r.city)}</b></div>
          </div>
          ${r.note ? `<p class="muted" style="margin:0">${esc(r.note)}</p>` : ""}
          <div><h3>Остановки</h3><ol class="stops">${stops}</ol></div>
        </div>
      </div>`;
    if (!dlg.open) dlg.showModal();
  }
  dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest(".close")) dlg.close(); });
  dlg.addEventListener("close", () => { if (location.hash.startsWith("#route=")) history.replaceState(null, "", location.pathname + location.search); });
  const fromHash = () => { const m = location.hash.match(/^#route=(.+)$/); if (m) openRoute(decodeURIComponent(m[1])); };
  window.addEventListener("hashchange", fromHash);

  update();
  fromHash();
})().catch((err) => {
  document.getElementById("grid").innerHTML = `<div class="empty-state">${Ridro.esc(err.message)}</div>`;
});
