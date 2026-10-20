"""Синхронизация сайта с Google Диском ЧТУП «RidroExpress».

Скачивает публичные документы (маршруты, зарплаты, бинды, устав), разбирает их и пишет:
  data/routes.json  — маршруты (диск + ручной слой data/manual.json)
  data/binds.json   — общие бинды
  data/ustav.html   — текст устава
  assets/maps/      — карты маршрутов из документов (+ превью thumb/)
  assets/ustav/     — картинки устава
Файл перезаписывается только если содержимое изменилось.

Запуск: python tools/sync_drive.py   (из корня сайта; нужны python-docx и Pillow)
"""
import html
import io
import json
import re
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

import docx
from docx.oxml.ns import qn
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

DOCS = {  # id Google-документов (папка «ООО «Ridro» публ.»)
    "ridro": "16dklAbv-IF6-OVXQEH7Tv-U3vs0Ry_m24m-Tg5daESw",
    "moonowl": "1CdAKWwEXOwF-3UnwcsUC2LNnZy8ogglciI9hZ16yoDI",
    "mup": "1HoqL-63a5o2scHJMR4HtV31nnJ0PjzmJg1Lltyal0r0",
    "troll": "1bLe9KlE4Ts-3pnaORcmBNiW4p30rTPobGOK9FaMSh08",
    "binds": "1OEEFbvSwIBK7dAY-4Dq5agJhuYjG0mEQRnppKM_jtKY",
    "ustav": "1Tl43hFAl-uSDqUYsmMcSOxZpigBTs76I2UVJcjWuRTs",
}
SALARY_FILE = "1bsUeDeO7DewRA901brsubZbWw6DoeccF"  # «Заработные платы по маршрутам.docx» (обычный файл)
REPORT_FORM = "1FAIpQLScDqdO9v4hG6FA9UHzmkP3jUDYJCJ_fnA0hL_5ljy0zSOm4Yg"  # публичная форма «Отчет …»

HEAD = re.compile(r"^Маршрут\s*(?:№\s*)?(\S{1,4})$")
SPLIT = re.compile(r"(?=Маршрут\s*№\s*\S{1,4}$)")
TRANSLIT = str.maketrans({"Л": "L", "А": "A", "к": "k", "Т": "T", "М": "M", "т": "t"})


# ---------------- загрузка ----------------
def download(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception as e:  # сеть Google иногда отвечает 5xx
            if i == tries - 1:
                raise RuntimeError(f"{url}: {e}")
            time.sleep(5 * (i + 1))


def gdoc(doc_id):
    return docx.Document(io.BytesIO(download(f"https://docs.google.com/document/d/{doc_id}/export?format=docx")))


def write_if_changed(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        data = data.encode("utf8")
    if path.exists() and path.read_bytes() == data:
        return False
    path.write_bytes(data)
    print("  обновлён", path.relative_to(ROOT))
    return True


# ---------------- разбор документа на токены ----------------
def tokens(document):
    """Поток ('h', номер) / ('t', строка) / ('i', байты картинки) в порядке документа."""
    out = []
    for p in document.paragraphs:
        buf = []

        def flush():
            for ln in "".join(buf).split("\n"):
                for part in SPLIT.split(ln):
                    part = part.strip()
                    if part:
                        m = HEAD.match(part)
                        out.append(("h", m.group(1)) if m else ("t", part))
            buf.clear()

        for el in p._p.iter():
            tag = el.tag.split("}")[-1]
            if tag == "t":
                buf.append(el.text or "")
            elif tag in ("br", "cr"):
                buf.append("\n")
            elif tag == "blip":
                flush()
                rid = el.get(qn("r:embed"))
                if rid in document.part.related_parts:
                    out.append(("i", document.part.related_parts[rid].blob))
        flush()
    return out


def sections(toks):
    """Разделы маршрутов: строки и картинки. Картинка, стоящая сразу перед заголовком
    (без текста между ними), относится к следующему маршруту."""
    heads = [k for k, t in enumerate(toks) if t[0] == "h"]
    secs = {k: {"num": toks[k][1], "lines": [], "images": []} for k in heads}
    for k, t in enumerate(toks):
        prev = max([h for h in heads if h < k], default=None)
        if prev is None:
            continue
        if t[0] == "t":
            secs[prev]["lines"].append(t[1])
        elif t[0] == "i":
            nxt = min([h for h in heads if h > k], default=None)
            text_before = any(x[0] == "t" for x in toks[prev + 1:k])
            text_after = nxt is not None and any(x[0] == "t" for x in toks[k + 1:nxt])
            target = nxt if (nxt is not None and not text_after and text_before) else prev
            secs[target]["images"].append(t[1])
    return [secs[k] for k in heads]


ABBR = {"ГИБДД"}


def nice(s):
    """«ЗАВОД ЖБК» → «Завод ЖБК»: слова капсом от 5 букв (кроме аббревиатур) — с заглавной."""
    return re.sub(r"[А-ЯЁA-Z]{5,}", lambda m: m.group(0) if m.group(0) in ABBR else m.group(0).capitalize(), s.strip(" .;"))


def money(s):
    m = re.search(r"(\d+)[.\s](\d{3})", s)
    return int(m.group(1) + m.group(2)) if m else None


def parse_section(sec):
    r = {"num": sec["num"], "binds": [], "salary": [], "bonus": [], "images": sec["images"]}
    L = sec["lines"]
    for i, ln in enumerate(L):
        low = ln.lower().lstrip("• ")
        if low.startswith("название маршрута"):
            r["signName"] = ln.split("-", 1)[1].strip()
        elif low.startswith("1-ая строка"):
            r["signLine1"] = (ln.split(" - ", 1)[1] if " - " in ln else ln).strip()
        elif low.startswith("2-ая строка"):
            r["signLine2"] = ln.split(" - ", 1)[1] if " - " in ln else ln
        elif low.startswith("стоимость проезда"):
            digits = re.sub(r"\D", "", ln.split("-", 1)[1])
            r["fare"] = int(digits) if digits else None
        elif low.startswith("цвет"):
            r["color"] = ln.split(":", 1)[1].strip()
        elif low.lstrip("* ").startswith("bind"):
            r["binds"].append(ln.lstrip("* ").strip())
        elif "скриншот" in low and ln.rstrip().endswith(":") and i + 1 < len(L):
            r["screens"] = L[i + 1]
        elif re.match(r"^(стаж|водит|шоф)", low) or "в независимости от должности" in low:
            r["salary"].append(ln)
        elif low.startswith("-"):
            if ln.rstrip().endswith("-") and i + 1 < len(L):
                ln = ln.rstrip() + " " + L[i + 1]
            m = re.match(r"(.+?)\s*\((.+)\)\s*-\s*(\d+)\s*рубл", ln.lstrip("-* ").strip())
            if m:
                r["bonus"].append({"type": m.group(1).strip(), "models": m.group(2).strip(), "amount": int(m.group(3))})
    return r


def salary_of(lines):
    vals = [money(x) for x in lines]
    if not vals:
        return None
    if len(vals) == 1:
        return {"trainee": vals[0], "driver": vals[0], "chauffeur": vals[0]}
    return {"trainee": vals[0], "driver": vals[1], "chauffeur": vals[2]}


def stops_of(bind):
    t = re.split(r"\)\s*:|Маршрут\s*№?\s*\S+:", bind, maxsplit=1)[-1].split("=", 1)[-1]
    m = re.match(r"\s*(.+?)\s+[—-]\s+(.+?)\s*;?\s*ч/з\s+(.+)$", t)
    if m:  # «А — Б; ч/з x, y» → [А, x, y, Б]
        return [nice(m.group(1))] + [nice(x) for x in m.group(3).split(",") if x.strip(" .")] + [nice(m.group(2))]
    return [x.strip(" .;") for x in t.split(",") if x.strip(" .")]


def screens_of(s):
    if not s:
        return []
    t = re.split(r"\s-\s|:\s", s, maxsplit=1)[-1]
    return [p.strip(" .") for p in re.split(r",\s*|\s-\s", t) if p.strip(" .")]


def bind_route(b):
    m = re.search(r"Маршрут\s*№?\s*([0-9A-Za-zА-Яа-я]+)", b)
    return m.group(1) if m else None


# ---------------- зарплаты из таблицы ----------------
def salary_table():
    d = docx.Document(io.BytesIO(download(f"https://drive.google.com/uc?export=download&id={SALARY_FILE}")))
    groups = ["ridro", "mup", "moonowl"]  # порядок таблиц в документе
    out = {}
    for g, t in zip(groups, d.tables):
        for row in t.rows[1:]:
            cells = [c.text.strip() for c in row.cells]
            m = re.match(r"№?\s*(\S+?)\s*(?:\((.+?)\))?$", cells[0])
            if not m:
                continue
            vals = [money(c) for c in cells[1:4]]
            if None in vals:
                continue
            out[(g, m.group(1), (m.group(2) or "").rstrip("."))] = dict(zip(["trainee", "driver", "chauffeur"], vals))
    return out


# ---------------- карты ----------------
def save_map(rid, blob):
    im = Image.open(io.BytesIO(blob)).convert("RGB")
    changed = False
    for size, q, path in ((1920, 82, ROOT / f"assets/maps/{rid}.jpg"), (640, 72, ROOT / f"assets/maps/thumb/{rid}.jpg")):
        x = im.copy()
        x.thumbnail((size, size))
        b = io.BytesIO()
        x.save(b, "JPEG", quality=q, optimize=True, progressive=size > 640)
        changed |= write_if_changed(path, b.getvalue())
    return changed


# ---------------- маршруты ----------------
def build_routes(manual):
    sal = salary_table()
    ids = manual.get("ids", {})
    over = manual.get("routes", {})
    routes, used_salary = [], set()
    moonowl_nums = set()
    parsed = {}
    for g in ("moonowl", "ridro", "mup", "troll"):  # MoonOwl первым: его маршруты в документе Ridro пропускаем
        secs = [parse_section(s) for s in sections(tokens(gdoc(DOCS[g])))]
        parsed[g] = [s for s in secs if s.get("fare") is not None and not (g == "ridro" and s["num"] in moonowl_nums)]
        if g == "moonowl":
            moonowl_nums = {s["num"] for s in parsed[g]}

    for g in ("ridro", "moonowl", "mup", "troll"):
        secs, seen = parsed[g], {}
        for s in secs:
            seen[s["num"]] = seen.get(s["num"], 0) + 1
            key = f"{g}/{s['num']}/{seen[s['num']]}"
            rid = ids.get(key) or f"{g}-{s['num'].translate(TRANSLIT)}" + ("" if seen[s["num"]] == 1 else f"-{seen[s['num']]}")
            own_binds = [b for b in s["binds"] if bind_route(b) in (None, s["num"])]
            stops = stops_of(own_binds[0]) if own_binds else []
            r = {
                "id": rid, "group": g, "number": s["num"], "city": "",
                "from": stops[0] if stops else "", "to": stops[-1] if stops else "",
                "stops": stops, "fare": s["fare"], "salary": salary_of(s["salary"]),
                "screenshots": screens_of(s.get("screens")),
                "sign": {"name": s.get("signName", ""), "line1": s.get("signLine1", ""), "line2": s.get("signLine2", "")},
                "binds": own_binds, "busBonus": s["bonus"], "map": "", "note": "",
                "_otherBinds": [b for b in s["binds"] if b not in own_binds],
            }
            if s.get("color"):
                r["note"] = f"Цвет таблички: {s['color']}"
            if s["images"]:
                save_map(rid, s["images"][0])
                r["map"] = f"assets/maps/{rid}.jpg"
            routes.append(r)

    # ручные маршруты, которых нет в документах
    for extra in manual.get("extra", []):
        after = extra.get("_after")
        r = {k: v for k, v in extra.items() if k != "_after"}
        idx = next((i + 1 for i, x in enumerate(routes) if x["id"] == after), len(routes))
        routes.insert(idx, r)

    # бинды чужого номера внутри раздела (напр. №30 в разделе №330) → маршруту с этим номером
    for r in routes:
        for b in r.pop("_otherBinds", []):
            t = next((x for x in routes if x["group"] == r["group"] and x["number"] == bind_route(b)), None)
            if t is not None and b not in t["binds"]:
                t["binds"].append(b)

    # ручной слой: город, конечные, примечание (то, чего нет на диске)
    for r in routes:
        for k, v in over.get(r["id"], {}).items():
            r[k] = v

    # зарплата из «Заработные платы по маршрутам» важнее, чем в описании маршрута
    qual = manual.get("salaryQualifiers", {})
    for (g, num, q), v in sal.items():
        rid = qual.get(f"{g}/{num}/{q}") if q else None
        target = next((r for r in routes if r["id"] == rid), None) if rid else \
            next((r for r in routes if r["group"] == g and r["number"].upper() == num.upper()), None)
        if target is not None:
            target["salary"] = v
            used_salary.add((g, num, q))
    for k in set(sal) - used_salary:
        print("  ! зарплата без маршрута:", k)
    return routes


# ---------------- бинды ----------------
def build_binds():
    d = gdoc(DOCS["binds"])
    secs, cur = [], None
    for t in (ln.strip() for p in d.paragraphs for ln in p.text.split("\n")):
        if not t or set(t) <= {"_"}:
            continue
        i = t.find("bind ")
        head, bind = (t[:i].strip(), t[i:].strip()) if i >= 0 else (t, "")
        if head:
            name = head.strip("!: ").strip()
            if not name.lower().startswith("бинды чтуп"):
                cur = {"section": name, "items": []}
                secs.append(cur)
        if bind and cur is not None:
            cur["items"].append(re.sub(r"\s+", " ", bind))
    return [s for s in secs if s["items"]]


# ---------------- устав ----------------
def run_html(run):
    t = html.escape(run.text).replace("\n", "<br>")
    if not t.strip():
        return t
    if run.bold:
        t = f"<b>{t}</b>"
    if run.italic:
        t = f"<i>{t}</i>"
    if run.underline:
        t = f"<u>{t}</u>"
    return t


def build_ustav():
    d = gdoc(DOCS["ustav"])
    parts, n = [], 0
    for p in d.paragraphs:
        body = "".join(run_html(r) for r in p.runs).strip()
        body = re.sub(r"(?:<br>\s*){2,}", "<br>", body)
        body = re.sub(r"^((?:<[biu]>)*)(?:<br>|\s)+", r"\1", body)  # пустые строки в начале абзаца
        for blip in p._p.iter(qn("a:blip")):
            rid = blip.get(qn("r:embed"))
            if rid in d.part.related_parts:
                n += 1
                im = Image.open(io.BytesIO(d.part.related_parts[rid].blob)).convert("RGB")
                im.thumbnail((1600, 1600))
                b = io.BytesIO()
                im.save(b, "JPEG", quality=82, optimize=True)
                write_if_changed(ROOT / f"assets/ustav/{n}.jpg", b.getvalue())
                parts.append(f'<p><img src="assets/ustav/{n}.jpg" alt="" loading="lazy"></p>')
        text = re.sub(r"<[^>]+>", "", body).strip()
        if not text or set(text) <= {"_", " "} or text in ("Вкладка 1", "Оглавление"):
            continue
        style = (p.style.name or "").lower()
        if style.startswith("heading") or style == "title" or re.match(r"^(Глава|Приложение|Статья)\s", text):
            tag = "h3" if style == "title" or text.startswith(("Глава", "Приложение")) else "h4"
            parts.append(f"<{tag}>{html.escape(text)}</{tag}>")
        elif p.style.name and "List" in p.style.name:
            parts.append(f"<li>{body}</li>")
        else:
            parts.append(f"<p>{body}</p>")
    # оглавление со ссылками на Google-документ не нужно — пропускаем строки, ведущие на главы до первой главы с текстом
    out = "\n".join(parts)
    out = re.sub(r"(?:<li>.*?</li>\n?)+", lambda m: f"<ul>\n{m.group(0)}</ul>\n", out)
    return out + "\n"


# ---------------- автобусы (список из формы отчёта) ----------------
def build_buses():
    page = download(f"https://docs.google.com/forms/d/e/{REPORT_FORM}/viewform").decode("utf8")
    m = re.search(r"FB_PUBLIC_LOAD_DATA_\s*=\s*(.*?);\s*</script>", page, re.S)
    if not m:
        raise RuntimeError("в форме не найден FB_PUBLIC_LOAD_DATA_")
    items = json.loads(m.group(1))[1][1]
    q = next(i for i in items if str(i[1]).startswith("Выберите используемый"))
    return [re.sub(r"\s+", " ", o[0]).strip() for o in q[4][0][1] if o[0].strip()]


# ---------------- запуск ----------------
def main():
    manual = json.loads((DATA / "manual.json").read_text(encoding="utf8"))
    print("Маршруты…")
    routes = build_routes(manual)
    old = json.loads((DATA / "routes.json").read_text(encoding="utf8")) if (DATA / "routes.json").exists() else {}
    doc = {"updated": old.get("updated", ""), "groups": manual["groups"], "routes": routes}
    if {k: v for k, v in doc.items() if k != "updated"} != {k: v for k, v in old.items() if k != "updated"}:
        doc["updated"] = date.today().isoformat()
    write_if_changed(DATA / "routes.json", json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    print("Бинды…")
    write_if_changed(DATA / "binds.json", json.dumps(build_binds(), ensure_ascii=False, indent=2) + "\n")
    print("Автобусы…")
    write_if_changed(DATA / "buses.json", json.dumps(build_buses(), ensure_ascii=False, indent=2) + "\n")
    print("Устав…")
    write_if_changed(DATA / "ustav.html", build_ustav())
    print("Готово:", len(routes), "маршрутов")


if __name__ == "__main__":
    sys.exit(main())
