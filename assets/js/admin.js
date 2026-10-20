// Админка: редактирование data/*.json и карт через GitHub API.
// Права выдаёт GitHub: писать могут только соавторы репозитория (совладельцы).
(() => {
  const { esc, store, toast } = Ridro;

  // Репозиторий сайта. На *.github.io определяется по адресу, иначе берётся отсюда.
  const CONFIG = { owner: "Lunevsky", repo: "ridroexpress", branch: "main" };
  const R = { ...CONFIG };
  if (location.hostname.endsWith(".github.io")) {
    R.owner = location.hostname.split(".")[0];
    R.repo = location.pathname.split("/").filter(Boolean)[0] || `${R.owner}.github.io`;
  }
  const $ = (id) => document.getElementById(id);
  $("repo-owner").textContent = R.owner;
  $("repo-name").textContent = R.repo;

  // ---------- GitHub API ----------
  let token = "";
  async function api(path, opts = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      const err = new Error((await res.json().catch(() => ({}))).message || res.statusText);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const bytesToB64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const textToB64 = (t) => bytesToB64(new TextEncoder().encode(t));
  const b64ToText = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
  const contentsUrl = (path) => `/repos/${R.owner}/${R.repo}/contents/${path}`;

  async function readFile(path) {
    const f = await api(`${contentsUrl(path)}?ref=${R.branch}`);
    return { sha: f.sha, data: JSON.parse(b64ToText(f.content)) };
  }
  async function shaOf(path) {
    try { return (await api(`${contentsUrl(path)}?ref=${R.branch}`)).sha; }
    catch (e) { if (e.status === 404) return undefined; throw e; }
  }
  async function writeFile(path, b64, message, sha) {
    const r = await api(contentsUrl(path), { method: "PUT", body: JSON.stringify({ message, content: b64, sha, branch: R.branch }) });
    return r.content.sha;
  }

  // ---------- состояние ----------
  const docs = { routes: null, site: null, manual: null };
  const dirty = { routes: false, site: false };
  let current = null;
  let user = null;
  const markDirty = (k) => { dirty[k] = true; $("dirty").hidden = false; };
  window.addEventListener("beforeunload", (e) => { if (dirty.routes || dirty.site) e.preventDefault(); });

  // ---------- вход ----------
  async function login(t, remember) {
    token = t;
    user = await api("/user");
    const repo = await api(`/repos/${R.owner}/${R.repo}`);
    if (!repo.permissions?.push) throw new Error("У этого аккаунта нет прав на изменение сайта. Попросите добавить вас в соавторы репозитория.");
    [docs.routes, docs.site, docs.manual] = await Promise.all([readFile("data/routes.json"), readFile("data/site.json"), readFile("data/manual.json")]);
    if (remember) store.set("ridro-gh-token", t);
    try { sessionStorage.setItem("ridro-gh-token", t); } catch {}
    $("who").textContent = `Вы: ${user.login}`;
    $("logout").hidden = false;
    $("login-view").hidden = true;
    $("app-view").hidden = false;
    renderList();
    selectRoute(docs.routes.data.routes[0]?.id);
    renderContent();
  }
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-error").textContent = "";
    try { await login($("token").value.trim(), $("remember").checked); }
    catch (err) { $("login-error").textContent = err.status === 401 ? "Токен недействителен или истёк." : err.message; }
  });
  $("logout").addEventListener("click", () => {
    store.del("ridro-gh-token");
    try { sessionStorage.removeItem("ridro-gh-token"); } catch {}
    location.reload();
  });
  let saved = null;
  try { saved = sessionStorage.getItem("ridro-gh-token"); } catch {}
  saved = saved || store.get("ridro-gh-token");
  if (saved) login(saved, false).catch(() => { $("login-error").textContent = "Сохранённый токен не подошёл — войдите заново."; });

  // ---------- вкладки ----------
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    $("tab-routes").hidden = b.dataset.tab !== "routes";
    $("tab-content").hidden = b.dataset.tab !== "content";
  });

  // ---------- сохранение ----------
  $("save").addEventListener("click", async () => {
    if (!dirty.routes && !dirty.site) return toast("Нечего сохранять");
    const btn = $("save");
    btn.disabled = true;
    btn.textContent = "Сохраняю…";
    try {
      if (dirty.routes) {
        docs.manual.sha = await writeFile("data/manual.json", textToB64(JSON.stringify(docs.manual.data, null, 2) + "\n"), `Ручные данные маршрутов (${user.login})`, docs.manual.sha);
        docs.routes.data.updated = new Date().toISOString().slice(0, 10);
        docs.routes.sha = await writeFile("data/routes.json", textToB64(JSON.stringify(docs.routes.data, null, 2) + "\n"), `Маршруты обновлены (${user.login})`, docs.routes.sha);
        dirty.routes = false;
      }
      if (dirty.site) {
        docs.site.sha = await writeFile("data/site.json", textToB64(JSON.stringify(docs.site.data, null, 2) + "\n"), `Тексты сайта обновлены (${user.login})`, docs.site.sha);
        dirty.site = false;
      }
      $("dirty").hidden = true;
      toast("Сохранено. Сайт обновится через ~1 минуту");
    } catch (err) {
      alert(err.status === 409 || err.status === 422
        ? "Файл уже изменил другой совладелец. Скопируйте свои правки, обновите страницу и повторите."
        : "Не удалось сохранить: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Сохранить на сайт";
    }
  });

  // ---------- ручной слой (data/manual.json) ----------
  // Маршруты из документов на диске: руками правятся только город, конечные и примечание.
  // Маршруты, которых нет в документах («extra»), правятся целиком.
  const MANUAL_FIELDS = ["city", "from", "to", "note"];
  const extras = () => docs.manual.data.extra;
  const isExtra = (r) => extras().some((e) => e.id === r.id);
  function syncManual(r) {
    if (isExtra(r)) {
      const i = extras().findIndex((e) => e.id === r.id);
      extras()[i] = { ...JSON.parse(JSON.stringify(r)), _after: extras()[i]._after ?? null };
    } else {
      const o = (docs.manual.data.routes[r.id] = docs.manual.data.routes[r.id] || {});
      MANUAL_FIELDS.forEach((k) => { if (r[k]) o[k] = r[k]; else delete o[k]; });
    }
  }

  // ---------- маршруты: список ----------
  const routes = () => docs.routes.data.routes;
  const groups = () => docs.routes.data.groups;
  $("list-q").addEventListener("input", renderList);
  function renderList() {
    const q = $("list-q").value.trim().toLowerCase();
    $("route-items").innerHTML = groups().map((g) => {
      const items = routes().filter((r) => r.group === g.id && (!q || `${r.number} ${r.from} ${r.to}`.toLowerCase().includes(q)));
      if (!items.length) return "";
      return `<div class="grp">${esc(g.short)}</div>` + items.map((r) =>
        `<button class="item ${r.id === current ? "active" : ""}" data-id="${esc(r.id)}"><span class="num ${esc(r.group)}">${esc(r.number || "?")}</span>${esc(r.from)} → ${esc(r.to)}</button>`).join("");
    }).join("");
  }
  $("route-items").addEventListener("click", (e) => { const b = e.target.closest(".item"); if (b) selectRoute(b.dataset.id); });
  $("add-route").addEventListener("click", () => {
    const r = {
      id: `ridro-${Date.now().toString(36)}`, group: "ridro", number: "", city: "", from: "Новый маршрут", to: "",
      stops: [], fare: null, salary: { trainee: null, driver: null, chauffeur: null }, screenshots: [],
      sign: { name: "", line1: "", line2: "" }, binds: [], busBonus: [], map: "", note: "",
    };
    routes().push(r);
    extras().push({ ...JSON.parse(JSON.stringify(r)), _after: null });
    markDirty("routes");
    selectRoute(r.id);
  });

  // ---------- маршруты: форма ----------
  const lines = (arr) => esc((arr || []).join("\n"));
  const num = (v) => (v == null ? "" : v);
  function selectRoute(id) {
    current = id;
    renderList();
    const r = routes().find((x) => x.id === id);
    const f = $("route-form");
    if (!r) { f.innerHTML = `<p class="muted">Выберите маршрут слева.</p>`; return; }
    const cities = [...new Set(routes().map((x) => x.city).filter(Boolean))];
    if (!isExtra(r)) return driveForm(f, r, cities);
    f.innerHTML = `
      <div class="form-block">
        <h3>Основное</h3>
        <div class="form-cols">
          <label class="field">Номер<input class="input" name="number" value="${esc(r.number)}"></label>
          <label class="field">Перевозчик<select class="input" name="group">${groups().map((g) => `<option value="${g.id}" ${g.id === r.group ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>
          <label class="field">Город<input class="input" name="city" value="${esc(r.city)}" list="cities"><datalist id="cities">${cities.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
          <label class="field">Проезд, ₽<input class="input" name="fare" type="number" min="0" value="${num(r.fare)}"></label>
        </div>
        <div class="form-cols">
          <label class="field">Откуда<input class="input" name="from" value="${esc(r.from)}"></label>
          <label class="field">Куда<input class="input" name="to" value="${esc(r.to)}"></label>
        </div>
        <label class="field">Остановки <span class="hint">по одной на строку, по порядку</span><textarea class="input" name="stops" rows="6">${lines(r.stops)}</textarea></label>
        <label class="field">Примечание <span class="hint">видно пассажирам</span><textarea class="input" name="note" rows="2">${esc(r.note)}</textarea></label>
      </div>
      <div class="form-block">
        <h3>Карта</h3>
        ${r.map ? `<img class="map-preview" id="map-preview" src="${esc(r.map)}" alt="">` : `<p class="muted" id="map-empty">Карта не загружена.</p><img class="map-preview" id="map-preview" hidden alt="">`}
        <label class="field">Загрузить новую карту <span class="hint">PNG/JPG — сожмётся автоматически и сразу загрузится на сайт</span><input class="input" type="file" accept="image/*" id="map-file"></label>
      </div>
      <div class="form-block">
        <h3>Зарплата за рейс, ₽</h3>
        <div class="form-cols">
          <label class="field">Стажёр<input class="input" name="salary.trainee" type="number" min="0" value="${num(r.salary?.trainee)}"></label>
          <label class="field">Водитель<input class="input" name="salary.driver" type="number" min="0" value="${num(r.salary?.driver)}"></label>
          <label class="field">Шофёр<input class="input" name="salary.chauffeur" type="number" min="0" value="${num(r.salary?.chauffeur)}"></label>
        </div>
      </div>
      <div class="form-block">
        <h3>Для водителя</h3>
        <label class="field">Скриншоты <span class="hint">точки по порядку, по одной на строку</span><textarea class="input" name="screenshots" rows="4">${lines(r.screenshots)}</textarea></label>
        <div class="form-cols">
          <label class="field">Табличка: название<input class="input" name="sign.name" value="${esc(r.sign?.name)}"></label>
          <label class="field">Табличка: 2-я строка<input class="input" name="sign.line2" value="${esc(r.sign?.line2)}"></label>
        </div>
        <label class="field">Табличка: 1-я строка<textarea class="input" name="sign.line1" rows="2" style="font-family:var(--mono)">${esc(r.sign?.line1)}</textarea></label>
        <label class="field">Бинды при остановке <span class="hint">по одному на строку</span><textarea class="input" name="binds" rows="3" style="font-family:var(--mono)">${lines(r.binds)}</textarea></label>
        <div class="field">Надбавка за тип автобуса (за кругорейс)
          <div id="bonus-rows" class="form-grid"></div>
          <button type="button" class="btn btn-sm" id="add-bonus" style="justify-self:start">+ Строка</button>
        </div>
      </div>
      <div class="form-actions">
        <span class="hint">ID: ${esc(r.id)}</span>
        <button type="button" class="btn btn-danger btn-sm" id="del-route">Удалить маршрут</button>
      </div>`;
    renderBonus(r);

    f.oninput = (e) => {
      const el = e.target;
      if (!el.name) return;
      setField(r, el.name, el.value, el.type);
      syncManual(r);
      markDirty("routes");
      if (["number", "from", "to", "group"].includes(el.name)) renderList();
    };
    $("del-route").onclick = () => {
      if (!confirm(`Удалить маршрут ${r.number} (${r.from} → ${r.to})?`)) return;
      docs.routes.data.routes = routes().filter((x) => x !== r);
      docs.manual.data.extra = extras().filter((e) => e.id !== r.id);
      markDirty("routes");
      selectRoute(routes()[0]?.id);
    };
    $("add-bonus").onclick = () => { r.busBonus = r.busBonus || []; r.busBonus.push({ type: "", models: "", amount: 0 }); syncManual(r); markDirty("routes"); renderBonus(r); };
    $("map-file").onchange = (e) => uploadMap(r, e.target.files[0]);
  }

  function driveForm(f, r, cities) {
    const s = r.salary || {};
    f.innerHTML = `
      <div class="notice" style="margin-bottom:18px">Этот маршрут берётся из документов на Google Диске: номер, проезд, ЗП, остановки, табличка, бинды, скриншоты, надбавки и карта.
        Меняйте их в документе — сайт обновится сам в течение ~30 минут. Здесь правится только то, чего в документах нет.</div>
      <div class="form-block">
        <h3>Маршрут ${esc(r.number)} · ${esc(groups().find((g) => g.id === r.group)?.name || r.group)}</h3>
        <div class="form-cols">
          <label class="field">Город<input class="input" name="city" value="${esc(r.city)}" list="cities"><datalist id="cities">${cities.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
          <label class="field">Откуда<input class="input" name="from" value="${esc(r.from)}"></label>
          <label class="field">Куда<input class="input" name="to" value="${esc(r.to)}"></label>
        </div>
        <label class="field">Примечание <span class="hint">видно пассажирам</span><textarea class="input" name="note" rows="2">${esc(r.note)}</textarea></label>
      </div>
      <div class="form-block">
        <h3>С диска (только просмотр)</h3>
        <dl class="kv">
          <dt>Проезд</dt><dd>${r.fare ?? "—"} ₽</dd>
          <dt>ЗП III / II / I</dt><dd>${s.trainee ?? "—"} / ${s.driver ?? "—"} / ${s.chauffeur ?? "—"} ₽</dd>
          <dt>Остановки</dt><dd>${esc(r.stops.join(", "))}</dd>
          <dt>Скриншоты</dt><dd>${esc(r.screenshots.join(" → "))}</dd>
        </dl>
        ${r.map ? `<img class="map-preview" src="${esc(r.map)}" alt="">` : ""}
      </div>
      <div class="form-actions"><span class="hint">ID: ${esc(r.id)}</span></div>`;
    f.oninput = (e) => {
      if (!MANUAL_FIELDS.includes(e.target.name)) return;
      r[e.target.name] = e.target.value;
      syncManual(r);
      markDirty("routes");
      renderList();
    };
  }

  const ARRAY_FIELDS = ["stops", "screenshots", "binds"];
  function setField(r, name, value, type) {
    if (ARRAY_FIELDS.includes(name)) { r[name] = value.split("\n").map((s) => s.trim()).filter(Boolean); return; }
    const v = type === "number" ? (value === "" ? null : Number(value)) : value;
    const [a, b] = name.split(".");
    if (b) { r[a] = r[a] || {}; r[a][b] = v; } else r[a] = v;
  }

  function renderBonus(r) {
    $("bonus-rows").innerHTML = (r.busBonus || []).map((b, i) => `
      <div class="bonus-row" data-i="${i}">
        <input class="input" data-k="type" placeholder="Тип" value="${esc(b.type)}">
        <input class="input" data-k="models" placeholder="Модели" value="${esc(b.models)}">
        <input class="input" data-k="amount" type="number" min="0" placeholder="₽" value="${num(b.amount)}">
        <button type="button" class="btn btn-ghost btn-sm" data-del aria-label="Удалить строку">✕</button>
      </div>`).join("") || `<span class="hint">Нет надбавок</span>`;
    $("bonus-rows").oninput = (e) => {
      const row = e.target.closest(".bonus-row");
      if (!row || !e.target.dataset.k) return;
      e.stopPropagation();
      const k = e.target.dataset.k;
      r.busBonus[row.dataset.i][k] = k === "amount" ? Number(e.target.value) : e.target.value;
      syncManual(r);
      markDirty("routes");
    };
    $("bonus-rows").onclick = (e) => {
      if (!e.target.closest("[data-del]")) return;
      r.busBonus.splice(e.target.closest(".bonus-row").dataset.i, 1);
      syncManual(r);
      markDirty("routes");
      renderBonus(r);
    };
  }

  // ---------- загрузка карты ----------
  async function toJpegB64(file, max, quality) {
    const img = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", quality));
    return bytesToB64(new Uint8Array(await blob.arrayBuffer()));
  }
  async function uploadMap(r, file) {
    if (!file) return;
    const input = $("map-file");
    input.disabled = true;
    toast("Загружаю карту…");
    try {
      const full = `assets/maps/${r.id}.jpg`;
      const thumb = `assets/maps/thumb/${r.id}.jpg`;
      const [b64Full, b64Thumb, shaFull, shaThumb] = await Promise.all([
        toJpegB64(file, 1920, 0.82), toJpegB64(file, 640, 0.72), shaOf(full), shaOf(thumb),
      ]);
      await writeFile(full, b64Full, `Карта маршрута ${r.number} (${user.login})`, shaFull);
      await writeFile(thumb, b64Thumb, `Превью карты маршрута ${r.number} (${user.login})`, shaThumb);
      if (r.map !== full) { r.map = full; syncManual(r); markDirty("routes"); }
      const prev = $("map-preview");
      prev.src = URL.createObjectURL(file);
      prev.hidden = false;
      $("map-empty")?.remove();
      toast(dirty.routes ? "Карта загружена. Нажмите «Сохранить на сайт»" : "Карта загружена");
    } catch (err) {
      alert("Не удалось загрузить карту: " + err.message);
    } finally {
      input.disabled = false;
      input.value = "";
    }
  }

  // ---------- тексты сайта: универсальный редактор ----------
  const LABELS = {
    org: "Организация", name: "Название", fullName: "Полное название", server: "Сервер", tagline: "Слоган",
    founded: "Дата основания", founders: "Учредители", director: "Директор", office: "Офис", depot: "Автопарк", goal: "Цель компании",
    links: "Ссылки", title: "Заголовок", url: "Адрес ссылки", kind: "Тип (vk, job, map; staff — только для сотрудников; reports — кнопка «Отчёты»)",
    passengerRules: "Правила для пассажиров", ranks: "Должности", text: "Текст", tripRules: "Правила рейса",
    penalties: "Наказания", rule: "Нарушение", penalty: "Наказание", purchaseBonus: "Надбавка за покупку автобуса",
    range: "Диапазон цены", amount: "Сумма, ₽", purchaseBonusNote: "Пояснение к надбавке", liveries: "Фирменные раскраски",
    colors: "Цвета (HEX)", binds: "Общие бинды", section: "Раздел", items: "Строки", pivo: "ПИВО — шаги",
    sheetApi: "Адрес данных таблицы (Apps Script, …/exec) — для списка сотрудников и отчётов",
  };
  const blankLike = (v) => Array.isArray(v) ? [] : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).map((k) => [k, blankLike(v[k])])) : typeof v === "number" ? 0 : "";
  const getAt = (obj, path) => path.reduce((o, k) => o[k], obj);

  function field(value, path) {
    const p = esc(JSON.stringify(path));
    if (Array.isArray(value)) {
      return `<div class="jf-arr">${value.map((v, i) => `<div class="jf-item"><div>${field(v, [...path, i])}</div><button type="button" class="btn btn-ghost btn-sm" data-del='${p}' data-i="${i}" aria-label="Удалить">✕</button></div>`).join("")}
        <button type="button" class="btn btn-sm" data-add='${p}' style="justify-self:start">+ Добавить</button></div>`;
    }
    if (value && typeof value === "object") {
      return `<div class="jf-obj">${Object.entries(value).map(([k, v]) => {
        const label = LABELS[k] || k;
        return v && typeof v === "object"
          ? `<div><div class="jf-title">${esc(label)}</div>${field(v, [...path, k])}</div>`
          : `<label class="field">${esc(label)}${field(v, [...path, k])}</label>`;
      }).join("")}</div>`;
    }
    if (typeof value === "number") return `<input class="input" type="number" data-path='${p}' value="${value}">`;
    const s = String(value ?? "");
    return s.length > 70
      ? `<textarea class="input" data-path='${p}' rows="3">${esc(s)}</textarea>`
      : `<input class="input" data-path='${p}' value="${esc(s)}">`;
  }
  function renderContent() {
    const box = $("content-form");
    box.innerHTML = field(docs.site.data, []);
    box.oninput = (e) => {
      if (!e.target.dataset.path) return;
      const path = JSON.parse(e.target.dataset.path);
      const parent = getAt(docs.site.data, path.slice(0, -1));
      parent[path.at(-1)] = e.target.type === "number" ? Number(e.target.value) : e.target.value;
      markDirty("site");
    };
    box.onclick = (e) => {
      const add = e.target.closest("[data-add]");
      const del = e.target.closest("[data-del]");
      if (!add && !del) return;
      const arr = getAt(docs.site.data, JSON.parse((add || del).dataset.add || (add || del).dataset.del));
      if (add) arr.push(arr.length ? blankLike(arr[0]) : "");
      else if (confirm("Удалить этот элемент?")) arr.splice(Number(del.dataset.i), 1);
      else return;
      markDirty("site");
      renderContent();
    };
  }
})();
