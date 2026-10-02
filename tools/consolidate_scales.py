#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка файла шкал: 21 вкладка → один файл с тремя листами.

Исходник (по одной вкладке на дилера):
    docs/data_sample/legacy/scales_multisheet_2026.xlsx

Результат — docs/data_sample/scales.xlsx:
    • лист «Шкалы»   — ПЛОСКАЯ ТАБЛИЦА: одна строка = одно значение
                       (дилер / раздел / категория / показатель / тир / значение).
                       Это единственный лист, который читает калькулятор, и
                       единственный, который нужно править. Без объединённых
                       ячеек и пустых строк — из него в один клик строится
                       сводная таблица (Вставка → Сводная таблица).
    • лист «Витрина» — те же данные глазами: выбор дилера из списка, его план,
                       три шкалы и сравнение всех дилеров по строке ИТОГО.
                       Всё считается формулами INDEX/MATCH из листа «Шкалы»,
                       поэтому витрина всегда актуальна. На расчёт не влияет.
    • лист «Блоки»   — исходные вкладки друг под другом (над каждой строка-маркер
                       «### ДИЛЕР …») со всеми формулами и оформлением 1:1.
                       Нужен для сверки с оригиналом; калькулятор разбирает его,
                       только если листа «Шкалы» в файле не окажется.

Значения скидок хранятся числами-долями с форматом «0%» (в ячейке 0.14, на
экране 14%), поэтому сводная таблица может их суммировать и усреднять.

Служебные скрытые листы «Лист1/Лист2/Лист3» (архив 2025 г.) в новый файл не
переносятся — они остаются в резервной копии legacy/scales_multisheet_2026.xlsx.
Скрытые дилеры (CLIPSOMAC, Tida Tech, Ari Makina) переносятся обязательно: они
есть в plan.xlsx и участвуют в расчёте.

Запуск:
    pip install openpyxl
    python3 tools/consolidate_scales.py                 # собрать scales.xlsx
    python3 tools/consolidate_scales.py --dry-run       # показать план, не писать
    python3 tools/consolidate_scales.py --source X --out Y

Проверка результата (отдельный, независимый аудит):
    python3 tools/verify_scales.py
"""

from __future__ import annotations

import argparse
import datetime as dt
import math
import re
import sys
import zipfile
from copy import copy
from pathlib import Path

try:
    import openpyxl
    from openpyxl.formula.translate import Translator
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.workbook import Workbook
    from openpyxl.worksheet.cell_range import CellRange
    from openpyxl.worksheet.datavalidation import DataValidation
    from openpyxl.worksheet.hyperlink import Hyperlink
except ImportError:  # pragma: no cover
    sys.exit('Нужен openpyxl:  pip install openpyxl')

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / 'docs' / 'data_sample' / 'legacy' / 'scales_multisheet_2026.xlsx'
DEFAULT_OUT = ROOT / 'docs' / 'data_sample' / 'scales.xlsx'

FLAT_SHEET = 'Шкалы'         # плоская таблица — источник данных для калькулятора
SHOWCASE_SHEET = 'Витрина'   # те же данные глазами: формулы INDEX/MATCH из «Шкалы»
BLOCKS_SHEET = 'Блоки'       # исходные вкладки друг под другом (сверка с оригиналом)

DEALER_MARKER = '### ДИЛЕР'
SHOWCASE_MARKER = '### ВИТРИНА'

# Листы, которые исторически не являются дилерами («Лист1», «Лист2», «Лист3»).
LEGACY_SHEET_RE = re.compile(r'^\s*лист\s*\d*\s*$', re.I)

# ─── Регулярки распознавания разметки (те же, что в docs/index.html) ──────────
VYRUCHKA_RE = re.compile(r'Выручка\s*202[3-6]', re.I)
SISTEMA_RE = re.compile(r'СИСТЕМА\s+РАСЧЕТА\s+СКИДКИ\s+ПО\s+ЗАПЧАСТЯМ', re.I)
# ВАЖНО: сравнение регистрозависимое — как в калькуляторе. Иначе строка раздела
# «ОБОРУДОВАНИЕ» (капсом) у зарубежных дилеров принималась бы за строку плана.
PLAN_LABELS_EXACT = {'Сервис', 'Оборудование', 'Расходные материалы', 'Запасные части'}
CONTROL_RE = re.compile(r'Система\s+контроля\s+квартального', re.I)
RANGE_RU_RE = re.compile(r'диапазон\s+отношения', re.I)
SHIPMENT_RE = re.compile(r'отгрузки\s+в\s+диапазоне', re.I)
ITOGO_RE = re.compile(r'итого|всего', re.I)

# ─── Оформление служебных строк ──────────────────────────────────────────────
F_TITLE = Font(bold=True, size=14, color='FF1F2937')
F_HINT = Font(size=10, color='FF475569')
F_MARK = Font(bold=True, size=11, color='FFFFFFFF')
F_TOC = Font(size=10, color='FF1F4E79', underline='single')
F_TOC_TITLE = Font(bold=True, size=11, color='FF1F4E79')
F_HDR = Font(bold=True, size=10, color='FFFFFFFF')
FILL_MARK = PatternFill('solid', fgColor='FF1F4E79')
FILL_HDR = PatternFill('solid', fgColor='FF1F4E79')
FILL_TOC = PatternFill('solid', fgColor='FFF2F7FC')
A_LEFT = Alignment(horizontal='left', vertical='center')
A_WRAP = Alignment(vertical='top', wrap_text=True)
THIN = Side(style='thin', color='FFB4C6E7')
B_ALL = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
A_HDR = Alignment(horizontal='center', vertical='center', wrap_text=True)
A_TOP = Alignment(vertical='top')
A_CENTER = Alignment(horizontal='center', vertical='center')
F_HDR_KEY = Font(bold=True, size=9, color='FF94A3B8')
FILL_HDR_KEY = PatternFill('solid', fgColor='FF475569')
F_KEY = Font(size=9, color='FF94A3B8')
F_VALUE = Font(size=10, color='FF0F172A')
F_BODY = Font(size=10, color='FF1F2937')
F_LABEL = Font(bold=True, size=10, color='FF475569')
F_SELECTED = Font(bold=True, size=11, color='FF1F4E79')
FILL_SELECTED = PatternFill('solid', fgColor='FFFFF7E6')
F_SECTION = Font(bold=True, size=11, color='FF1F4E79')
FILL_SECTION = PatternFill('solid', fgColor='FFDDEBF7')
F_TOTAL = Font(bold=True, size=10, color='FF1F4E79')
FILL_TOTAL = PatternFill('solid', fgColor='FFF2F7FC')
FILL_STRIPE = PatternFill('solid', fgColor='FFFAFBFD')
F_HDR_CELL = Font(bold=True, size=10, color='FFFFFFFF')


def norm_space(value) -> str:
    return re.sub(r'\s+', ' ', str(value)).strip()


# ═══════════════════════════════════════════════════════════════════════════
# 1. Разбор исходной вкладки дилера
# ═══════════════════════════════════════════════════════════════════════════
def dealer_sheets(wb):
    """Вкладки дилеров в исходном порядке (служебные «ЛистN» пропускаем)."""
    out, skipped = [], []
    for ws in wb.worksheets:
        (skipped if LEGACY_SHEET_RE.match(ws.title) else out).append(ws)
    return out, skipped


def find_header_row(ws):
    """Строка с «Выручка 2024/2025» — ищем в первых 8 строках, как калькулятор."""
    for r in range(1, min(8, ws.max_row) + 1):
        for c in range(1, ws.max_column + 1):
            v = ws.cell(r, c).value
            if isinstance(v, str) and VYRUCHKA_RE.search(v):
                return r
    return None


def find_label_col(ws, header_row):
    """Колонка подписей = колонка имени дилера (строка под шапкой)."""
    r = header_row + 1
    if r > ws.max_row:
        return None, None
    for c in range(1, ws.max_column + 1):
        v = ws.cell(r, c).value
        if isinstance(v, str) and v.strip():
            name = v.strip()
            if re.match(r'^(сервис|оборудование|расходные\s*материалы|запасные\s*части|выручка)',
                        name, re.I):
                return None, None
            return c, name
    return None, None


def detect_dealer_type(ws, label_col):
    for r in range(1, ws.max_row + 1):
        v = ws.cell(r, label_col).value
        if v and SISTEMA_RE.search(str(v)):
            return 'РФ'
    return 'Заруб'


def find_section_row(ws, label_col, keywords, start=1):
    for r in range(start, ws.max_row + 1):
        v = ws.cell(r, label_col).value
        if v is None:
            continue
        s = norm_space(v)
        if s in PLAN_LABELS_EXACT:
            continue
        low = s.lower()
        if any(kw.lower() in low for kw in keywords):
            return r
    return None


def find_tier_cell(ws, label_col, header_row, tier_regexes):
    """Строка/колонка первого тира (как findTierRowAndCol в калькуляторе)."""
    for r in range(header_row, min(header_row + 3, ws.max_row) + 1):
        for c in range(label_col + 2, min(label_col + 5, ws.max_column) + 1):
            v = ws.cell(r, c).value
            if v is None:
                continue
            sv = str(v)
            if any(rx.search(sv) for rx in tier_regexes):
                return r, c
    return None, None


def tier_labels(ws, tier_row, tier_col):
    out = []
    for c in range(tier_col, min(tier_col + 10, ws.max_column + 1)):
        v = ws.cell(tier_row, c).value
        if v is None or str(v).strip() == '':
            break
        out.append((c, norm_space(v)))
    return out


def table_data_rows(ws, wsv, label_col, tier_row, tier_col, tiers, stop_regexes, max_rows):
    """Строки таблицы шкалы: подпись, подпись-уточнение (колонка D) и значения по тирам."""
    rows = []
    for r in range(tier_row + 1, min(tier_row + max_rows, ws.max_row) + 1):
        label = ws.cell(r, label_col).value
        if label is None or norm_space(label) == '':
            continue
        up = norm_space(label).upper()
        if any(rx.search(up) for rx in stop_regexes):
            break
        values = []
        for c, _t in tiers:
            cell = wsv.cell(r, c)
            values.append((c, cell.value, cell.number_format))
        sub = ws.cell(r, label_col + 1).value
        sub = norm_space(sub) if isinstance(sub, str) else None
        rows.append({
            'row': r,
            'label': norm_space(label),
            'sub': sub,
            'values': values,
            'is_total': bool(ITOGO_RE.search(norm_space(label))),
            'empty': all(v is None or v == '' for _c, v, _f in values),
        })
    return rows


def service_range_rows(ws, wsv, label_col, header_row, row_regex):
    """Строки «диапазон отношения» (РФ) / «отгрузки в диапазоне» (Заруб)."""
    out = []
    for r in range(header_row, ws.max_row + 1):
        label = ws.cell(r, label_col).value
        if not label or not row_regex.search(str(label)):
            continue
        from_v = wsv.cell(r, label_col + 1).value
        to_v = wsv.cell(r, label_col + 2).value
        pct_cell = wsv.cell(r, label_col + 3)
        from_n = float(from_v) if isinstance(from_v, (int, float)) else 0.0
        to_n = float(to_v) if isinstance(to_v, (int, float)) else 0.0
        tier = f'{int(from_n)}+' if not to_n else f'{int(from_n)}–{int(to_n)}'
        out.append({
            'row': r,
            'label': norm_space(label),
            'tier': tier,
            'from': from_v,
            'to': to_v,
            'pct_cell': (label_col + 3, pct_cell.value, pct_cell.number_format),
            'used_by_calc': pct_cell.value is not None,
        })
    return out


def control_rows(ws, wsv, label_col):
    """«Система контроля» — штрафы (есть только у РФ; калькулятор её не считает)."""
    hdr = find_section_row(ws, label_col, ['Система контроля квартального'])
    if hdr is None:
        return None, []
    out = []
    blanks = 0
    for r in range(hdr + 1, ws.max_row + 1):
        label = ws.cell(r, label_col).value
        if label is None or norm_space(label) == '':
            blanks += 1
            if blanks >= 2:
                break
            continue
        blanks = 0
        sub = ws.cell(r, label_col + 1).value
        val_cell = wsv.cell(r, label_col + 2)
        if val_cell.value is None and sub is None:
            continue
        out.append({
            'row': r,
            'label': norm_space(label),
            'sub': norm_space(sub) if isinstance(sub, str) else sub,
            'value_cell': (label_col + 2, val_cell.value, val_cell.number_format),
        })
    return hdr, out


def parse_dealer_sheet(ws, wsv):
    """Полное описание вкладки дилера: метаданные + все таблицы."""
    header_row = find_header_row(ws)
    if header_row is None:
        return None
    label_col, name = find_label_col(ws, header_row)
    if label_col is None:
        return None
    dtype = detect_dealer_type(ws, label_col)

    eq_hdr = find_section_row(ws, label_col, ['ОБЪЕМ закупок оборудования', 'ОБОРУДОВАНИЕ'])
    eq_tier_row, eq_tier_col = (find_tier_cell(ws, label_col, eq_hdr, [re.compile(r'до\s*75', re.I)])
                                if eq_hdr else (None, None))
    eq_tiers = tier_labels(ws, eq_tier_row, eq_tier_col) if eq_tier_row else []
    eq_rows = table_data_rows(
        ws, wsv, label_col, eq_tier_row, eq_tier_col, eq_tiers,
        [re.compile(r'РАСХОДНЫЕ\s+МАТЕРИАЛЫ', re.I), re.compile(r'СИСТЕМА\s+РАСЧЕТА', re.I),
         re.compile(r'ЗАПЧАСТИ', re.I)], 13) if eq_tier_row else []

    mat_hdr = find_section_row(ws, label_col, ['ОБЪЕМ закупок РМ', 'РАСХОДНЫЕ МАТЕРИАЛЫ'])
    mat_tier_row, mat_tier_col = (
        find_tier_cell(ws, label_col, mat_hdr,
                       [re.compile(r'до\s*75', re.I), re.compile(r'до\s*24', re.I)])
        if mat_hdr else (None, None))
    mat_tiers = tier_labels(ws, mat_tier_row, mat_tier_col) if mat_tier_row else []
    mat_rows = table_data_rows(
        ws, wsv, label_col, mat_tier_row, mat_tier_col, mat_tiers,
        [re.compile(r'СИСТЕМА\s+РАСЧЕТА', re.I), re.compile(r'ЗАПЧАСТИ', re.I)], 9
    ) if mat_tier_row else []

    if dtype == 'РФ':
        svc_hdr = find_section_row(ws, label_col, ['СИСТЕМА РАСЧЕТА СКИДКИ ПО ЗАПЧАСТЯМ'])
        svc_rows = service_range_rows(ws, wsv, label_col, svc_hdr, RANGE_RU_RE) if svc_hdr else []
        svc_period = 'расчёт по парку оборудования'
        svc_table = 'Сервис (ЗЧ) — по парку оборудования'
    else:
        svc_hdr = find_section_row(ws, label_col, ['ЗАПЧАСТИ'])
        svc_rows = service_range_rows(ws, wsv, label_col, svc_hdr, SHIPMENT_RE) if svc_hdr else []
        hdr_text = norm_space(ws.cell(svc_hdr, label_col).value) if svc_hdr else ''
        svc_period = '6 месяцев' if re.search(r'6\s*месяц', hdr_text) else '12 месяцев'
        svc_table = f'Сервис (ЗЧ) — отгрузки за {svc_period}'

    ctrl_hdr, ctrl_rows = control_rows(ws, wsv, label_col)

    return {
        'sheet': ws.title,
        'name': name,
        'type': dtype,
        'visible': ws.sheet_state == 'visible',
        'header_row': header_row,
        'label_col': label_col,
        'max_row': ws.max_row,
        'max_col': ws.max_column,
        'dims': ws.dimensions,
        'equipment': {
            'hdr': eq_hdr, 'tier_row': eq_tier_row, 'tier_col': eq_tier_col,
            'tiers': eq_tiers, 'rows': eq_rows,
            'period': 'за квартал' if dtype == 'РФ' else 'за полугодие',
        },
        'materials': {
            'hdr': mat_hdr, 'tier_row': mat_tier_row, 'tier_col': mat_tier_col,
            'tiers': mat_tiers, 'rows': mat_rows,
            'period': 'за квартал',
        },
        'service': {'hdr': svc_hdr, 'rows': svc_rows, 'period': svc_period, 'table': svc_table},
        'control': {'hdr': ctrl_hdr, 'rows': ctrl_rows},
    }


# ═══════════════════════════════════════════════════════════════════════════
# 2. Перенос блока на единый лист (значения + формулы + стили + объединения)
# ═══════════════════════════════════════════════════════════════════════════
def copy_block(src_ws, src_val_ws, tgt_ws, row_shift, cached):
    """Копирует вкладку целиком со сдвигом по строкам. Колонки не сдвигаются."""
    max_r, max_c = src_ws.max_row, src_ws.max_column
    for r in range(1, max_r + 1):
        tr = r + row_shift
        src_dim = src_ws.row_dimensions.get(r)
        tgt_dim = tgt_ws.row_dimensions[tr]
        if src_dim is not None and src_dim.height:
            tgt_dim.height = src_dim.height
        tgt_dim.outlineLevel = 1  # блок можно свернуть/развернуть кнопкой слева
        for c in range(1, max_c + 1):
            sc = src_ws.cell(r, c)
            if sc.value is None and not sc.has_style:
                continue
            tc = tgt_ws.cell(tr, c)
            value = sc.value
            if isinstance(value, str) and value.startswith('='):
                tc.value = Translator(value, origin=sc.coordinate).translate_formula(tc.coordinate)
                cached_value = src_val_ws.cell(r, c).value
                if cached_value is not None:
                    cached[tc.coordinate] = cached_value
            else:
                tc.value = value
            if sc.has_style:
                tc.font = copy(sc.font)
                tc.fill = copy(sc.fill)
                tc.border = copy(sc.border)
                tc.alignment = copy(sc.alignment)
                tc.protection = copy(sc.protection)
                tc.number_format = sc.number_format
    # Объединённые ячейки — после записи значений (иначе openpyxl не даст писать).
    for rng in src_ws.merged_cells.ranges:
        shifted = CellRange(min_col=rng.min_col, max_col=rng.max_col,
                            min_row=rng.min_row + row_shift, max_row=rng.max_row + row_shift)
        tgt_ws.merge_cells(str(shifted))
    return max_r


def collect_widths(sheets):
    widths = {}
    for ws in sheets:
        for letter, dim in ws.column_dimensions.items():
            if not dim.width:
                continue
            lo = dim.min or openpyxl.utils.column_index_from_string(letter)
            hi = dim.max or lo
            for c in range(lo, hi + 1):
                key = get_column_letter(c)
                widths[key] = max(widths.get(key, 0), dim.width)
    return widths


# ═══════════════════════════════════════════════════════════════════════════
# 3. Плоская таблица: одна строка = одно значение
# ═══════════════════════════════════════════════════════════════════════════
# Колонки листа «Шкалы» (A..P) — человеческие, колонки Q..U — служебные ключи
# для INDEX/MATCH на листе «Витрина». Ключи считаются формулами, поэтому правка
# имени дилера или добавление строки не ломает витрину.
#
#   A Дилер              имя дилера (как в plan.xlsx)
#   B Тип                РФ | Заруб
#   C Раздел             Шкала | План
#   D Категория          Оборудование | Расходные материалы | Сервис (ЗЧ)
#                        (для плана — строка шапки: Сервис, Оборудование, …)
#   E Таблица            заголовок таблицы ровно как его видит калькулятор
#   F Показатель         подпись строки шкалы (для плана — подпись колонки)
#   G № строки           порядок строки в своей таблице (1…)
#   H Итог               «да» для строк ИТОГО
#   I Тир                подпись колонки-тира («до 75», «0–500»)
#   J № тира             порядок тира (1…), для плана — номер колонки шапки
#   K Тир от             нижняя граница диапазона (сервис)
#   L Тир до             верхняя граница диапазона (сервис)
#   M Значение           число: скидка долей (0.14 = 14%), суммы в евро как есть
#   N Единица            % | EUR
#   O Вкладка (была)     вкладка исходного файла
#   P Ячейка в исходнике адрес ячейки в этой вкладке

FLAT_HEADER = [
    'Дилер', 'Тип', 'Раздел', 'Категория', 'Таблица', 'Показатель',
    '№ строки', 'Итог', 'Тир', '№ тира', 'Тир от', 'Тир до',
    'Значение', 'Единица', 'Вкладка (была)', 'Ячейка в исходнике',
]
FLAT_WIDTHS = [34, 7, 9, 22, 44, 54, 9, 7, 14, 8, 9, 9, 11, 9, 15, 17]
FLAT_KEYS_HEADER = ['Ключ: строка', 'Ключ: тир', 'Ключ: значение',
                    'Ключ: порядок строки', 'Ключ: итог', 'Ключ: колонка плана']
FMT_PCT = '0%'
FMT_NUM = '#,##0.##'

# Сколько строк/тиров помещается на витрину (максимум по всем дилерам исходника).
SC_PLAN_ROWS, SC_PLAN_COLS = 5, 6
SC_EQ_ROWS, SC_EQ_COLS = 9, 6
SC_MAT_ROWS, SC_MAT_COLS = 4, 6
SC_SVC_COLS = 12


def js_trim(value) -> str:
    """String(v).trim() из калькулятора — подписи должны совпадать байт-в-байт."""
    return str(value).strip()


def js_num(value):
    """parsePctJS из калькулятора: число из ячейки или None."""
    if value is None or isinstance(value, bool) or value == '':
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace('%', '').replace(',', '.').strip()
    if s in ('', '—'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def to_fraction(value, number_format):
    """
    Значение шкалы → доля (0.14 = 14%), чтобы сводная таблица могла считать.

    В исходнике оборудование и расходные материалы хранятся уже в процентах
    (число 6 при формате General), а сервис — долей (0.19 при формате '0%').
    Правило то же, что в калькуляторе: формат с '%' → значение уже доля.
    """
    n = js_num(value)
    if n is None:
        return None
    return round(n if '%' in (number_format or '') else n / 100.0, 10)


def unit_of(number_format) -> str:
    fmt = number_format or ''
    if '%' in fmt:
        return '%'
    if '€' in fmt or 'EUR' in fmt.upper() or '$' in fmt:
        return 'EUR'
    return 'число'


def js_scale_titles(info):
    """
    Заголовки таблиц ровно такие, какие выдаёт калькулятор.

    Это важно: по словам «6 месяцев» в заголовке сервиса калькулятор берёт
    полугодие вместо финансового года, а по слову «Оборудование» находит таблицу.
    """
    period = 'за квартал' if info['type'] == 'РФ' else 'за полугодие'
    svc = ('Сервис (ЗЧ) — расчёт по парку оборудования' if info['type'] == 'РФ'
           else f'Сервис (ЗЧ) — абсолютные отгрузки за {info["service"]["period"]}')
    return {
        'equipment': f'Оборудование — {period}',
        'materials': f'Расходные материалы — {period}',
        'service': svc,
    }


def flat_records_for_dealer(ws, wsv, info):
    """
    Плоские записи одного дилера: план/бонусы + три шкалы.

    Подписи, порядок строк и набор значений — ровно те, которые оставляет
    калькулятор (docs/index.html): пустые строки и подзаголовок «ОБЪЕМ ЗАКУПОК
    В ТЫС…» в плоскую таблицу не попадают, иначе разбор плоского листа и разбор
    вкладок дали бы разные результаты.
    """
    lc, hr = info['label_col'], info['header_row']
    recs = []

    def add(**kw):
        rec = {
            'dealer': info['name'], 'type': info['type'], 'sheet': info['sheet'],
            'section': '', 'category': '', 'table': '', 'indicator': '', 'row_no': 0,
            'is_total': False, 'tier': '', 'tier_no': 0, 'tier_from': None,
            'tier_to': None, 'value': None, 'unit': '', 'fmt': None, 'cell': '',
        }
        rec.update(kw)
        recs.append(rec)

    # ── План и бонусы (шапка «Выручка … / План … / Прирост / Бонус») ────────
    headers = {}
    for c in range(lc + 1, ws.max_column + 1):
        v = ws.cell(hr, c).value
        if isinstance(v, str) and v.strip():
            headers[c] = (len(headers) + 1, js_trim(v))
    for r in range(hr + 1, min(hr + 4, ws.max_row) + 1):
        label_raw = ws.cell(r, lc).value
        if label_raw is None or not js_trim(label_raw):
            continue
        category = 'Итого по дилеру' if r == hr + 1 else js_trim(label_raw)
        for c, (col_no, hdr) in headers.items():
            n = js_num(wsv.cell(r, c).value)
            if n is None:
                continue                      # текстовые примечания не переносим
            fmt = ws.cell(r, c).number_format
            add(section='План', category=category, table='План и бонусы',
                indicator=hdr, row_no=r - hr, tier='', tier_no=col_no,
                value=n, unit=unit_of(fmt),
                fmt=fmt if fmt and fmt != 'General' else FMT_NUM,
                cell=f'{get_column_letter(c)}{r}')

    # ── Шкалы: оборудование и расходные материалы ──────────────────────────
    titles = js_scale_titles(info)
    for key, category, drop_re in (
        ('equipment', 'Оборудование', re.compile(r'ОБЪЕМ\s+ЗАКУПОК\s+В\s+ТЫС', re.I)),
        ('materials', 'Расходные материалы', None),
    ):
        t = info[key]
        if not t['tiers']:
            continue
        row_no = 0
        for row in t['rows']:
            label = js_trim(ws.cell(row['row'], lc).value)
            if drop_re and drop_re.search(label.upper()):
                continue                      # подзаголовок — калькулятор его фильтрует
            if not any(js_num(v) is not None for _c, v, _f in row['values']):
                continue                      # пустая строка — калькулятор её пропускает
            row_no += 1
            for tier_no, ((c, value, fmt), (_tc, tier)) in enumerate(
                    zip(row['values'], t['tiers']), 1):
                frac = to_fraction(value, fmt)
                if frac is None:
                    continue
                add(section='Шкала', category=category, table=titles[key],
                    indicator=label, row_no=row_no,
                    is_total=bool(ITOGO_RE.search(label)),
                    tier=tier, tier_no=tier_no, value=frac, unit='%', fmt=FMT_PCT,
                    cell=f'{get_column_letter(c)}{row["row"]}')

    # ── Шкала сервиса: каждая строка исходника — это один тир (диапазон) ────
    svc = info['service']
    tier_no = 0
    for row in svc['rows']:
        c, value, fmt = row['pct_cell']
        frac = to_fraction(value, fmt)
        if frac is None:
            continue                          # JS: if (pct === null) continue
        tier_no += 1
        from_n = js_num(row['from']) or 0.0
        to_n = js_num(row['to']) or 0.0
        tier = (f'{math.floor(from_n)}+' if not to_n
                else f'{math.floor(from_n)}–{math.floor(to_n)}')
        add(section='Шкала', category='Сервис (ЗЧ)', table=titles['service'],
            indicator='Скидка по сервису', row_no=1, is_total=True,
            tier=tier, tier_no=tier_no,
            tier_from=row['from'] if isinstance(row['from'], (int, float)) else None,
            tier_to=row['to'] if isinstance(row['to'], (int, float)) else None,
            value=frac, unit='%', fmt=FMT_PCT,
            cell=f'{get_column_letter(c)}{row["row"]}')
    return recs


def rec_keys(rec):
    """Служебные ключи записи (колонки Q..U) — по ним витрина ищет значения."""
    d, s, c = rec['dealer'], rec['section'], rec['category']
    return {
        'row': f'{d}|{s}|{c}|{rec["row_no"]}',
        'tier': f'{d}|{s}|{c}|{rec["tier_no"]}',
        'value': f'{d}|{s}|{c}|{rec["row_no"]}|{rec["tier_no"]}',
        'order': f'{d}|{s}|{rec["row_no"]}',
        'total': f'{d}|{s}|{c}|{rec["tier_no"]}' if rec['is_total'] else '',
        # Подписи колонок шапки плана ищем без категории: в строке «Итого по
        # дилеру» заполнены не все колонки (бонус и скидка есть только у категорий).
        'plancol': f'{d}|{rec["tier_no"]}' if s == 'План' else '',
    }


def build_flat_sheet(out_wb, records):
    """Лист «Шкалы»: плоская таблица (источник данных для калькулятора)."""
    ws = out_wb.active
    ws.title = FLAT_SHEET
    ws.sheet_view.showGridLines = True

    ncol = len(FLAT_HEADER)
    for c, title in enumerate(FLAT_HEADER, 1):
        cell = ws.cell(1, c, title)
        cell.font = F_HDR
        cell.fill = FILL_HDR
        cell.border = B_ALL
        cell.alignment = A_HDR
        ws.column_dimensions[get_column_letter(c)].width = FLAT_WIDTHS[c - 1]
    key_first = ncol + 1
    for i, title in enumerate(FLAT_KEYS_HEADER):
        c = key_first + i
        cell = ws.cell(1, c, title)
        cell.font = F_HDR_KEY
        cell.fill = FILL_HDR_KEY
        cell.border = B_ALL
        cell.alignment = A_HDR
        ws.column_dimensions[get_column_letter(c)].width = 42
    ws.row_dimensions[1].height = 30

    cached: dict[str, object] = {}
    row = 2
    for rec in records:
        keys = rec_keys(rec)
        values = [
            rec['dealer'], rec['type'], rec['section'], rec['category'], rec['table'],
            rec['indicator'], rec['row_no'], 'да' if rec['is_total'] else None,
            rec['tier'] or None, rec['tier_no'], rec['tier_from'], rec['tier_to'],
            rec['value'], rec['unit'], rec['sheet'], rec['cell'],
        ]
        for c, v in enumerate(values, 1):
            cell = ws.cell(row, c, v)
            cell.alignment = A_TOP
            if c == 13 and isinstance(v, (int, float)):
                cell.number_format = rec['fmt'] or FMT_NUM
                cell.font = F_VALUE
            elif c in (7, 8, 10, 11, 12, 14):
                cell.alignment = A_CENTER
        # Служебные ключи — формулы, чтобы правки в таблице не ломали витрину.
        f = row
        formulas = [
            (f'=A{f}&"|"&C{f}&"|"&D{f}&"|"&G{f}', keys['row']),
            (f'=A{f}&"|"&C{f}&"|"&D{f}&"|"&J{f}', keys['tier']),
            (f'=A{f}&"|"&C{f}&"|"&D{f}&"|"&G{f}&"|"&J{f}', keys['value']),
            (f'=A{f}&"|"&C{f}&"|"&G{f}', keys['order']),
            (f'=IF(H{f}="да",A{f}&"|"&C{f}&"|"&D{f}&"|"&J{f},"")', keys['total']),
            (f'=IF(C{f}="План",A{f}&"|"&J{f},"")', keys['plancol']),
        ]
        for i, (formula, value) in enumerate(formulas):
            cell = ws.cell(row, key_first + i, formula)
            cell.font = F_KEY
            cell.alignment = A_TOP
            cached[cell.coordinate] = value
        row += 1

    last = row - 1
    ws.freeze_panes = 'B2'
    ws.auto_filter.ref = f'A1:{get_column_letter(ncol)}{last}'
    # Служебные ключи сворачиваем в группу: не мешают ни глазам, ни сводной.
    ws.column_dimensions.group(get_column_letter(key_first),
                               get_column_letter(key_first + len(FLAT_KEYS_HEADER) - 1),
                               outline_level=1, hidden=True)
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = '1:1'
    return cached, last


# ═══════════════════════════════════════════════════════════════════════════
# 3б. Витрина: кросс-таблица на формулах (INDEX/MATCH из плоской таблицы)
# ═══════════════════════════════════════════════════════════════════════════
class Showcase:
    """Пишет лист «Витрина» и сразу знает, что должна показать каждая формула."""

    def __init__(self, ws, records, dealers):
        self.ws = ws
        self.dealers = dealers            # имена дилеров в порядке следования
        self.cached: dict[str, object] = {}
        self.by_value, self.by_row, self.by_tier = {}, {}, {}
        self.by_order, self.by_total, self.type_of = {}, {}, {}
        self.by_plancol = {}
        for rec in records:
            k = rec_keys(rec)
            if k['plancol']:
                self.by_plancol.setdefault(k['plancol'], rec)
            self.by_value.setdefault(k['value'], rec)
            self.by_row.setdefault(k['row'], rec)
            self.by_tier.setdefault(k['tier'], rec)
            self.by_order.setdefault(k['order'], rec)
            if rec['is_total'] and k['total']:
                self.by_total.setdefault(k['total'], rec)
            self.type_of.setdefault(rec['dealer'], rec['type'])
        self.sel = '$B$4'                 # ячейка с выбранным дилером

    def put(self, coord, formula, value, fmt=None, font=None, fill=None, align=None):
        """Формула + её кэш-значение (чтобы числа было видно до пересчёта)."""
        cell = self.ws[coord]
        cell.value = formula
        if fmt:
            cell.number_format = fmt
        cell.font = font or F_BODY
        if fill:
            cell.fill = fill
        cell.alignment = align or A_CENTER
        cell.border = B_ALL
        self.cached[coord] = '' if value is None else value
        return cell

    @staticmethod
    def lookup(index, key, field):
        rec = index.get(key)
        return rec[field] if rec else None

    def table(self, top, section, category, rows, cols, label_header):
        """Таблица «показатели × тиры» для выбранного дилера. top — строка шапки."""
        FS = f"'{FLAT_SHEET}'"
        ws = self.ws
        d0 = self.dealers[0]
        label_col = 'I'

        head = ws.cell(top, 1, label_header)
        head.font, head.fill, head.border, head.alignment = F_HDR_CELL, FILL_HDR, B_ALL, A_LEFT
        for j in range(1, cols + 1):
            if section == 'План':
                # Подписи колонок шапки плана — по ключу «дилер|номер колонки»:
                # в строке «Итого по дилеру» бонус и скидка могут быть пустыми.
                formula = (f'=IFERROR(INDEX({FS}!$F:$F,MATCH({self.sel}&"|"&{j},'
                           f'{FS}!$V:$V,0)),"")')
                value = self.lookup(self.by_plancol, f'{d0}|{j}', 'indicator')
            else:
                formula = (f'=IFERROR(INDEX({FS}!${label_col}:${label_col},'
                           f'MATCH({self.sel}&"|"&"{section}"&"|"&"{category}"&"|"&{j},'
                           f'{FS}!$R:$R,0)),"")')
                value = self.lookup(self.by_tier, f'{d0}|{section}|{category}|{j}', 'tier')
            self.put(f'{get_column_letter(1 + j)}{top}', formula, value,
                     font=F_HDR_CELL, fill=FILL_HDR)

        for k in range(1, rows + 1):
            r = top + k
            if section == 'План':
                label_formula = (f'=IFERROR(INDEX({FS}!$D:$D,MATCH({self.sel}&"|"&'
                                 f'"План"&"|"&{k},{FS}!$T:$T,0)),"")')
                label_value = self.lookup(self.by_order, f'{d0}|План|{k}', 'category')
            else:
                label_formula = (f'=IFERROR(INDEX({FS}!$F:$F,MATCH({self.sel}&"|"&'
                                 f'"Шкала"&"|"&"{category}"&"|"&{k},{FS}!$Q:$Q,0)),"")')
                label_value = self.lookup(self.by_row, f'{d0}|Шкала|{category}|{k}',
                                          'indicator')
            lc = ws.cell(r, 1, label_formula)
            lc.font, lc.alignment, lc.border = F_BODY, A_LEFT, B_ALL
            self.cached[lc.coordinate] = label_value or ''
            for j in range(1, cols + 1):
                if section == 'План':
                    key_expr = f'{self.sel}&"|"&"План"&"|"&$A{r}&"|"&{k}&"|"&{j}'
                    rec = self.by_value.get(f'{d0}|План|{label_value}|{k}|{j}')
                else:
                    key_expr = f'{self.sel}&"|"&"Шкала"&"|"&"{category}"&"|"&{k}&"|"&{j}'
                    rec = self.by_value.get(f'{d0}|Шкала|{category}|{k}|{j}')
                is_total = bool(rec and rec['is_total'])
                self.put(f'{get_column_letter(1 + j)}{r}',
                         f'=IFERROR(INDEX({FS}!$M:$M,MATCH({key_expr},{FS}!$S:$S,0)),"")',
                         rec['value'] if rec else None,
                         fmt=(rec['fmt'] or FMT_NUM) if (section == 'План' and rec) else FMT_PCT,
                         font=F_TOTAL if is_total else F_BODY,
                         fill=FILL_TOTAL if is_total else None)
        return top + rows + 1


def build_showcase_sheet(out_wb, records, dealers):
    """Лист «Витрина»: выбор дилера → план и три шкалы + сравнение дилеров."""
    ws = out_wb.create_sheet(SHOWCASE_SHEET)
    sc = Showcase(ws, records, dealers)
    d0 = dealers[0]
    ncol = 14
    FS = f"'{FLAT_SHEET}'"

    def section_title(row, text):
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=ncol)
        c = ws.cell(row, 1, text)
        c.font, c.fill, c.alignment = F_SECTION, FILL_SECTION, A_LEFT
        ws.row_dimensions[row].height = 18

    def label(coord, text):
        c = ws[coord]
        c.value = text
        c.font = F_LABEL
        c.alignment = Alignment(horizontal='right', vertical='center')

    # ── шапка и выбор дилера ───────────────────────────────────────────────
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncol)
    m = ws.cell(1, 1, f'{SHOWCASE_MARKER} • здесь всё считается формулами из листа '
                      f'«{FLAT_SHEET}». Править нужно там — витрина обновится сама. '
                      f'Лист справочный: калькулятор его не читает.')
    m.font, m.fill, m.alignment = F_MARK, FILL_MARK, A_LEFT
    ws.row_dimensions[1].height = 20

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncol)
    h = ws.cell(2, 1, 'Выберите дилера в ячейке B4 — ниже появятся его план и бонусы, '
                      'шкала оборудования, расходных материалов и сервиса. '
                      'В конце листа — сравнение всех дилеров по строке ИТОГО.')
    h.font, h.alignment = F_HINT, A_LEFT

    label('A4', 'Дилер:')
    ws.merge_cells('B4:D4')
    sel = ws.cell(4, 2, d0)
    sel.font, sel.fill, sel.border, sel.alignment = F_SELECTED, FILL_SELECTED, B_ALL, A_LEFT
    label('E4', 'Тип:')
    sc.put('F4', f'=IFERROR(INDEX({FS}!$B:$B,MATCH({sc.sel},{FS}!$A:$A,0)),"")',
           sc.type_of.get(d0, ''), font=F_SELECTED, fill=FILL_SELECTED, align=A_LEFT)
    label('G4', 'Отчётность:')
    sc.put('H4', '=IF($F$4="РФ","за квартал","за полугодие")',
           'за квартал' if sc.type_of.get(d0) == 'РФ' else 'за полугодие',
           font=F_SELECTED, fill=FILL_SELECTED, align=A_LEFT)
    label('I4', 'Сервис (ЗЧ):')
    ws.merge_cells('J4:N4')
    sc.put('J4', f'=IFERROR(INDEX({FS}!$E:$E,MATCH({sc.sel}&"|"&"Шкала"&"|"&'
                 f'"Сервис (ЗЧ)"&"|"&1&"|"&1,{FS}!$S:$S,0)),"")',
           sc.lookup(sc.by_value, f'{d0}|Шкала|Сервис (ЗЧ)|1|1', 'table'),
           font=F_SELECTED, fill=FILL_SELECTED, align=A_LEFT)
    ws.row_dimensions[4].height = 20

    # ── план и три шкалы выбранного дилера ─────────────────────────────────
    section_title(6, 'ПЛАН И БОНУСЫ')
    sc.table(7, 'План', 'Итого по дилеру', SC_PLAN_ROWS, SC_PLAN_COLS, 'Категория')
    section_title(14, 'ОБОРУДОВАНИЕ — шкала скидок')
    sc.table(15, 'Шкала', 'Оборудование', SC_EQ_ROWS, SC_EQ_COLS, 'Показатель')
    section_title(26, 'РАСХОДНЫЕ МАТЕРИАЛЫ — шкала скидок')
    sc.table(27, 'Шкала', 'Расходные материалы', SC_MAT_ROWS, SC_MAT_COLS, 'Показатель')
    section_title(33, 'СЕРВИС (ЗЧ) — шкала скидок')
    sc.table(34, 'Шкала', 'Сервис (ЗЧ)', 1, SC_SVC_COLS, 'Показатель')

    # ── сравнение всех дилеров по строке ИТОГО (оборудование) ──────────────
    section_title(37, 'СРАВНЕНИЕ ДИЛЕРОВ — строка ИТОГО по оборудованию')
    top = 38
    head = ws.cell(top, 1, 'Дилер')
    head.font, head.fill, head.border, head.alignment = F_HDR_CELL, FILL_HDR, B_ALL, A_LEFT
    for j in range(1, SC_EQ_COLS + 1):
        sc.put(f'{get_column_letter(1 + j)}{top}', f'={get_column_letter(1 + j)}15',
               sc.lookup(sc.by_tier, f'{d0}|Шкала|Оборудование|{j}', 'tier'),
               font=F_HDR_CELL, fill=FILL_HDR)
    type_col = 2 + SC_EQ_COLS
    th = ws.cell(top, type_col, 'Тип')
    th.font, th.fill, th.border, th.alignment = F_HDR_CELL, FILL_HDR, B_ALL, A_CENTER

    list_first = top + 1
    for i, dealer in enumerate(dealers):
        r = list_first + i
        name = ws.cell(r, 1, f'=$W${4 + i}')
        name.font, name.alignment, name.border = F_BODY, A_LEFT, B_ALL
        sc.cached[name.coordinate] = dealer
        for j in range(1, SC_EQ_COLS + 1):
            rec = sc.by_total.get(f'{dealer}|Шкала|Оборудование|{j}')
            sc.put(f'{get_column_letter(1 + j)}{r}',
                   f'=IFERROR(INDEX({FS}!$M:$M,MATCH($A{r}&"|"&"Шкала"&"|"&'
                   f'"Оборудование"&"|"&{j},{FS}!$U:$U,0)),"")',
                   rec['value'] if rec else None, fmt=FMT_PCT, font=F_TOTAL)
        tcell = ws.cell(r, type_col, f'=IFERROR(INDEX({FS}!$B:$B,'
                                     f'MATCH($A{r},{FS}!$A:$A,0)),"")')
        tcell.font, tcell.alignment, tcell.border = F_BODY, A_CENTER, B_ALL
        sc.cached[tcell.coordinate] = sc.type_of.get(dealer, '')
        if i % 2 == 1:
            for c in range(1, type_col + 1):
                ws.cell(r, c).fill = FILL_STRIPE
    list_last = list_first + len(dealers) - 1

    # ── служебный список дилеров (источник выпадающего списка в B4) ─────────
    ws.cell(3, 23, 'Список дилеров — служебный: источник выпадающего списка в B4, '
                   'пересобирается скриптом').font = F_HINT
    for i, dealer in enumerate(dealers):
        ws.cell(4 + i, 23, dealer).font = F_KEY
    ws.column_dimensions['W'].width = 34
    ws.column_dimensions.group('V', 'X', outline_level=1, hidden=True)

    dv = DataValidation(type='list', formula1=f'=$W$4:$W${4 + len(dealers) - 1}',
                        allow_blank=False, showDropDown=False)
    dv.errorTitle = 'Нет такого дилера'
    dv.error = 'Выберите дилера из списка (ячейка B4).'
    ws.add_data_validation(dv)
    dv.add(ws['B4'])

    # ── ширины и печать ───────────────────────────────────────────────────
    ws.column_dimensions['A'].width = 52
    for c in range(2, ncol + 1):
        ws.column_dimensions[get_column_letter(c)].width = 13
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = '4:4'
    return sc.cached, (list_first, list_last)


# ═══════════════════════════════════════════════════════════════════════════
# 4. Кэш-значения формул (openpyxl не умеет писать формулу и значение сразу)
# ═══════════════════════════════════════════════════════════════════════════
CELL_RE = re.compile(rb'<c\b[^>]*?(?:/>|>.*?</c>)', re.S)
REF_RE = re.compile(rb'\br="([A-Z]+[0-9]+)"')
EMPTY_V_RE = re.compile(rb'<v\s*/>|<v>\s*</v>')
V_RE = re.compile(rb'<v>.*?</v>', re.S)


def _xml_escape(value) -> bytes:
    return (str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .encode('utf-8'))


def inject_cached_values(path: Path, sheet_title: str, cached: dict) -> int:
    """Дописывает <v>…</v> (кэш формулы) в XML листа — иначе SheetJS увидит пустоту."""
    if not cached:
        return 0
    with zipfile.ZipFile(path) as zin:
        parts = {n: zin.read(n) for n in zin.namelist()}

    wb_xml = parts['xl/workbook.xml'].decode('utf-8')
    rels_xml = parts['xl/_rels/workbook.xml.rels'].decode('utf-8')
    rid = None
    for m in re.finditer(r'<sheet\b[^>]*>', wb_xml):
        tag = m.group(0)
        name_m = re.search(r'name="([^"]*)"', tag)
        rid_m = re.search(r'r:id="([^"]*)"', tag)
        if name_m and rid_m and name_m.group(1).replace('&amp;', '&') == sheet_title:
            rid = rid_m.group(1)
    if rid is None:
        raise RuntimeError(f'не найден лист {sheet_title!r} в workbook.xml')
    target = None
    for m in re.finditer(r'<Relationship\b[^>]*>', rels_xml):
        tag = m.group(0)
        if f'Id="{rid}"' in tag:
            target = re.search(r'Target="([^"]*)"', tag).group(1)
    if target is None:
        raise RuntimeError(f'не найден r:id {rid} в workbook.xml.rels')
    part_name = 'xl/' + target.lstrip('/').replace('xl/', '', 1) if target.startswith('/xl/') \
        else ('xl/' + target if not target.startswith('xl/') else target)

    xml = parts[part_name]
    injected = 0

    def repl(m):
        nonlocal injected
        cell = m.group(0)
        if b'<f' not in cell:
            return cell
        ref = REF_RE.search(cell)
        if not ref:
            return cell
        coord = ref.group(1).decode()
        if coord not in cached:
            return cell
        value = cached[coord]
        if isinstance(value, bool):
            payload, attr = b'1' if value else b'0', b' t="b"'
        elif isinstance(value, (int, float)):
            payload = repr(float(value)).encode() if isinstance(value, float) else str(value).encode()
            attr = b''
        else:
            payload, attr = _xml_escape(value), b' t="str"'
        if attr and b't="' not in cell:
            cell = re.sub(rb'^<c\b', lambda mm: mm.group(0) + attr, cell, count=1)
        new_v = b'<v>' + payload + b'</v>'
        if EMPTY_V_RE.search(cell):
            # openpyxl пишет пустой <v /> — заменяем его, а не добавляем второй
            cell = EMPTY_V_RE.sub(lambda _m: new_v, cell, count=1)
        elif V_RE.search(cell):
            cell = V_RE.sub(lambda _m: new_v, cell, count=1)
        elif cell.endswith(b'/>'):
            cell = cell[:-2] + b'>' + new_v + b'</c>'
        else:
            cell = cell[:-4] + new_v + b'</c>'
        injected += 1
        return cell

    parts[part_name] = CELL_RE.sub(repl, xml)
    tmp = path.with_suffix('.tmp.xlsx')
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, data in parts.items():
            zout.writestr(name, data)
    tmp.replace(path)
    return injected


# ═══════════════════════════════════════════════════════════════════════════
# 5. Сборка
# ═══════════════════════════════════════════════════════════════════════════
def build(source: Path, out: Path, dry_run: bool = False):
    if not source.exists():
        sys.exit(f'Нет исходного файла: {source}')
    wb_f = openpyxl.load_workbook(source, data_only=False)  # формулы + стили
    wb_v = openpyxl.load_workbook(source, data_only=True)   # кэш-значения формул

    sheets, skipped = dealer_sheets(wb_f)
    infos = []
    for ws in sheets:
        info = parse_dealer_sheet(ws, wb_v[ws.title])
        if info is None:
            print(f'  ! {ws.title}: не найдена шапка «Выручка …» — пропускаю', file=sys.stderr)
            continue
        infos.append(info)

    print(f'Исходник: {source.name}')
    print(f'  вкладок всего      : {len(wb_f.worksheets)}')
    print(f'  дилерских блоков   : {len(infos)}')
    print(f'  служебных (ЛистN)  : {len(skipped)} → остаются в {source.name}')
    for i, info in enumerate(infos, 1):
        flag = '' if info['visible'] else ' [скрытая вкладка]'
        print(f'    {i:2d}. {info["name"]:<44} {info["type"]:<5} '
              f'вкладка «{info["sheet"]}»{flag}')

    # ── Плоская таблица: все значения всех дилеров одним списком ───────────
    dealers = [info['name'] for info in infos]
    records = []
    for info in infos:
        records.extend(flat_records_for_dealer(wb_f[info['sheet']], wb_v[info['sheet']], info))
    n_scale = sum(1 for r in records if r['section'] == 'Шкала')
    n_plan = len(records) - n_scale
    print(f'  плоских записей    : {len(records)} (шкалы {n_scale}, план и бонусы {n_plan})')
    if dry_run:
        return

    out_wb = Workbook()
    flat_cached, flat_last = build_flat_sheet(out_wb, records)
    show_cached, (cmp_first, cmp_last) = build_showcase_sheet(out_wb, records, dealers)

    # ── Лист «Блоки»: исходные вкладки друг под другом ─────────────────────
    tgt = out_wb.create_sheet(BLOCKS_SHEET)
    tgt.sheet_properties.outlinePr.summaryBelow = False  # маркер блока — над блоком
    tgt.sheet_view.showGridLines = True

    cached: dict[str, object] = {}
    blocks = []          # (info, marker_row, first_row, last_row)
    cursor = 1

    legend = [
        ('БЛОКИ ДИЛЕРОВ — копия исходных вкладок, для сверки с оригиналом', F_TITLE),
        ('Каждый дилер — блок строк, над ним строка-маркер (ячейка A начинается с '
         '«### ДИЛЕР»). Строки блока сгруппированы: сворачиваются кнопкой слева.', F_HINT),
        (f'Править шкалы нужно на листе «{FLAT_SHEET}» (плоская таблица) — именно её читает '
         f'калькулятор. Лист «{SHOWCASE_SHEET}» показывает те же данные глазами.', F_HINT),
        (f'Этот лист калькулятор разбирает только как запасной вариант — если листа '
         f'«{FLAT_SHEET}» в файле не окажется. Формулы, форматы, объединённые ячейки и '
         f'оформление перенесены из исходника 1:1.', F_HINT),
        (f'Собрано автоматически из legacy/{source.name} '
         f'({len(wb_f.worksheets)} вкладок → {len(infos)} блоков) • '
         f'tools/consolidate_scales.py • {dt.date.today().isoformat()}', F_HINT),
    ]
    for text, font in legend:
        cell = tgt.cell(cursor, 1, text)
        cell.font = font
        cell.alignment = A_LEFT
        cursor += 1
    cursor += 1

    toc_row = cursor
    cell = tgt.cell(toc_row, 1, 'СОДЕРЖАНИЕ — клик по строке переносит к блоку дилера')
    cell.font = F_TOC_TITLE
    cell.alignment = A_LEFT
    cursor += 1
    toc_first = cursor
    cursor += len(infos)          # резервируем строки под содержание
    toc_last = cursor - 1
    cursor += 2                   # пустой разделитель

    for i, info in enumerate(infos, 1):
        ws = wb_f[info['sheet']]
        wsv = wb_v[info['sheet']]
        marker_row = cursor
        period = 'отчётность за квартал' if info['type'] == 'РФ' else 'отчётность за полугодие'
        text = (f'{DEALER_MARKER} {i}/{len(infos)} • {info["name"]} • {info["type"]} '
                f'({period}) • вкладка «{info["sheet"]}»'
                f'{"" if info["visible"] else " • в исходном файле была скрыта"}'
                f' • исходные строки 1–{info["max_row"]} ({info["dims"]})')
        for c in range(1, max(info['max_col'], 8) + 1):
            mc = tgt.cell(marker_row, c)
            mc.fill = FILL_MARK
            if c == 1:
                mc.value = text
                mc.font = F_MARK
                mc.alignment = A_LEFT
        tgt.row_dimensions[marker_row].height = 20

        row_shift = marker_row            # строка 1 исходника → marker_row + 1
        first_row = marker_row + 1
        copied = copy_block(ws, wsv, tgt, row_shift, cached)
        last_row = marker_row + copied
        blocks.append((info, marker_row, first_row, last_row))
        cursor = last_row + 3             # две пустые строки-разделителя

    # ── Содержание (после того как известны строки блоков) ─────────────────
    for idx, ((info, marker_row, _first, _last), row) in enumerate(
            zip(blocks, range(toc_first, toc_last + 1)), 1):
        cell = tgt.cell(row, 1,
                        f'{idx} • {info["name"]} • {info["type"]} • вкладка «{info["sheet"]}»'
                        f' • блок в строке {marker_row}')
        cell.font = F_TOC
        cell.alignment = A_LEFT
        cell.fill = FILL_TOC
        cell.hyperlink = Hyperlink(ref=cell.coordinate, location=f"'{BLOCKS_SHEET}'!A{marker_row}",
                                   display=cell.value)
        tgt.row_dimensions[row].height = 15

    # ── Ширины колонок: максимум по всем вкладкам ──────────────────────────
    widths = collect_widths(sheets)
    tgt.column_dimensions['A'].width = 3.5
    for letter, width in widths.items():
        if letter == 'A':
            continue
        tgt.column_dimensions[letter].width = round(width, 1)

    tgt.page_setup.orientation = 'landscape'
    tgt.page_setup.fitToWidth = 1
    tgt.page_setup.fitToHeight = 0
    tgt.sheet_properties.pageSetUpPr.fitToPage = True
    tgt.print_title_rows = f'{toc_row}:{toc_row}'

    out_wb.calculation.fullCalcOnLoad = True  # Excel пересчитает формулы при открытии
    out.parent.mkdir(parents=True, exist_ok=True)
    out_wb.save(out)

    # openpyxl не умеет писать формулу вместе со значением — дописываем кэш в XML,
    # иначе SheetJS (и любой читатель без пересчёта) увидит пустые ячейки.
    inj_flat = inject_cached_values(out, FLAT_SHEET, flat_cached)
    inj_show = inject_cached_values(out, SHOWCASE_SHEET, show_cached)
    inj_blocks = inject_cached_values(out, BLOCKS_SHEET, cached)

    print(f'\nГотово: {out.relative_to(ROOT)}')
    print(f'  лист «{FLAT_SHEET}»    : плоская таблица, {len(records)} записей '
          f'({len(dealers)} дилеров), строк {flat_last}')
    print(f'  лист «{SHOWCASE_SHEET}»  : формул {len(show_cached)} '
          f'(кэш-значения: {inj_show}), сравнение дилеров в строках {cmp_first}–{cmp_last}')
    print(f'  лист «{BLOCKS_SHEET}»    : {len(blocks)} блоков дилеров, строк {tgt.max_row}, '
          f'колонок {tgt.max_column}')
    print(f'  формул в блоках      : {len(cached)} (кэш-значения восстановлены: {inj_blocks})')
    print(f'  ключей в плоской     : {len(flat_cached)} (кэш-значения: {inj_flat})')
    print(f'  объединённых ячеек   : {len(tgt.merged_cells.ranges)}')
    return {'blocks': blocks, 'records': records, 'cached': cached,
            'flat_cached': flat_cached, 'showcase_cached': show_cached,
            'dealers': dealers, 'flat_last': flat_last}



def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--dry-run', action='store_true', help='показать план, файл не писать')
    args = ap.parse_args()
    build(args.source, args.out, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
