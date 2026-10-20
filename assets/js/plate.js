// Маршрутная табличка — как в игре MTA Province.
// Буквы — картинки шрифта игры (assets/plate_font/<индекс>.png); ширины символов и правила переноса —
// как в игре, по генератору RISX Nano (nano.risx.app/plate). Используется с согласия RISX и разработчиков игры.
const RidroPlate = (() => {
  const CHARS = [" ", "!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":", ";", "<", "=", ">", "?", "@", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "[", "\\", "]", "^", "_", "`", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "{", "|", "}", "~", "NaN", "А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "Й", "К", "Л", "М", "Н", "О", "П", "Р", "С", "Т", "У", "Ф", "Х", "Ц", "Ч", "Ш", "Щ", "Ъ", "Ы", "Ь", "Э", "Ю", "Я", "а", "б", "в", "г", "д", "е", "ж", "з", "и", "й", "к", "л", "м", "н", "о", "п", "р", "с", "т", "у", "ф", "х", "ц", "ч", "ш", "щ", "ъ", "ы", "ь", "э", "ю", "я"];
  const WIDTHS = [12, 16, 24, 64, 37, 51, 48, 16, 24, 24, 39, 48, 15, 13, 15, 30, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 15, 15, 49, 48, 49, 34, 63, 37, 37, 37, 37, 30, 30, 37, 37, 16, 33, 37, 28, 48, 37, 37, 36, 39, 36, 37, 30, 37, 37, 46, 36, 33, 37, 27, 30, 27, 48, 42, 28, 27, 27, 27, 27, 27, 18, 27, 27, 13, 13, 28, 13, 42, 27, 27, 27, 27, 25, 27, 18, 27, 27, 36, 27, 27, 25, 25, 13, 25, 42, 24, 37, 37, 37, 28, 42, 30, 58, 36, 37, 37, 37, 39, 48, 37, 37, 37, 36, 37, 30, 33, 49, 36, 42, 37, 54, 57, 42, 51, 36, 37, 58, 37, 27, 27, 27, 24, 27, 27, 45, 27, 27, 27, 28, 28, 36, 27, 27, 27, 27, 27, 24, 27, 40, 27, 30, 27, 42, 43, 28, 39, 27, 27, 42, 27];
  const NAN = CHARS.indexOf("NaN"); // заглушка для символов, которых нет в шрифте
  const SPACE = { index: 0, width: 12 };
  const FONT = "assets/plate_font/";

  // Номер и «Проезд … руб.»: строка целиком, неизвестные символы — заглушкой
  function plain(s) {
    const r = [];
    for (const ch of s) {
      const i = CHARS.indexOf(ch);
      r.push({ index: i !== -1 ? i : NAN, width: WIDTHS[i !== -1 ? i : NAN] });
    }
    return r;
  }

  // Строки 1 и 2: слова по пробелам; символы, которых нет в шрифте, пропускаются
  function words(s) {
    const r = [];
    let l = 0;
    for (const ch of s) {
      if (r.length === l) r.push([]);
      const i = CHARS.indexOf(ch);
      if (i === 0 && r[l].length > 0) { l++; continue; }
      if (i !== 0 && i !== -1 && i !== NAN) r[l].push({ index: i, width: WIDTHS[i] });
    }
    if (r.length > 0 && r[r.length - 1].length === 0) r.pop();
    return r;
  }

  // Перенос по ширине строки таблички (454 px для одной буквы-слова, 453 px для остальных)
  function wrap(ws) {
    const items = [], widths = [];
    const put = (line, list) => {
      if (items.length === line) items.push([]);
      if (widths.length === line) widths.push(0);
      for (const g of list) { items[line].push(g.index); widths[line] += g.width; }
    };
    let line = 0;
    for (let n = 0; n < ws.length; n++) {
      let s = 0;
      const first = n;
      while (n < ws.length) {
        const a = ws[n].reduce((x, g) => x + g.width, 0);
        const gap = s > 0 ? 12 : 0;
        if ((s + gap + a <= 454 && ws[n].length === 1) || (s + gap + a <= 453 && ws[n].length > 1) || n === first) {
          if (s > 0) { put(line, [SPACE]); s += 12; }
          put(line, ws[n]);
          s += a;
          n++;
        } else { n--; break; }
      }
      line++;
    }
    return items;
  }

  function lines(text) {
    const w = words(text);
    return w.length === 0 && text.length > 0 ? wrap([[SPACE]]) : wrap(w);
  }

  const imgs = (list, h) => list.map((i) => `<img src="${FONT}${i}.png" style="height:${h}px" alt="">`).join("");
  const row = (list, h) => `<div class="pl-row" style="height:${h}px">${imgs(list, h)}</div>`;

  // Табличка 767×250 (как в игре), масштабируется под ширину root
  function render(root, v) {
    const title = plain(v.title || "").map((g) => g.index);
    const fare = plain(`Проезд ${v.fare || ""} руб.`).map((g) => g.index);
    root.innerHTML = `<div class="pl-fixed"><div class="pl-inner">
      <div class="pl-box" style="left:152px;top:8px;bottom:0">${row(title, 192)}</div>
      <div class="pl-box" style="left:114.5px;top:223px;bottom:27px">${row(fare, 32)}</div>
      <div class="pl-box" style="left:534.5px;top:4px;bottom:0">
        ${lines(v.line1 || "").map((l) => row(l, 64)).join("")}
        ${row([13], 64)}
        ${lines(v.line2 || "").map((l) => row(l, 64)).join("")}
      </div></div></div>`;
    fit(root);
  }

  function fit(root) {
    const fixed = root.querySelector(".pl-fixed");
    if (!fixed) return;
    const k = root.clientWidth / 767;
    fixed.style.transform = `scale(${k})`;
    root.style.height = `${250 * k}px`;
  }

  // Символы, которых нет в шрифте игры (не отобразятся в строках 1–2)
  const missing = (s) => [...new Set([...s].filter((ch) => ch !== " " && CHARS.indexOf(ch) === -1))];

  return { render, fit, missing };
})();
