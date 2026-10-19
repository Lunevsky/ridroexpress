// Общие функции для всех страниц
const Ridro = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n == null ? "—" : n.toLocaleString("ru-RU") + " ₽");

  async function load(name) {
    const res = await fetch(`data/${name}.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Не удалось загрузить ${name}.json`);
    return res.json();
  }

  function toast(text) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.append(el);
    }
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 1600);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast("Скопировано");
  }

  // Кнопки копирования: <button data-copy="текст">
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (b) copy(b.dataset.copy);
    const burger = e.target.closest(".burger");
    if (burger) {
      const nav = document.querySelector(".nav");
      nav.classList.toggle("open");
      burger.setAttribute("aria-expanded", nav.classList.contains("open"));
    }
  });

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  const groupOf = (data, id) => data.groups.find((g) => g.id === id) || { short: id, name: id };

  return { esc, money, load, toast, copy, store, groupOf };
})();
