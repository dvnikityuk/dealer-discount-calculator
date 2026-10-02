#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка файла шкал: много вкладок → ОДИН лист.

Исходник (по одной вкладке на дилера):
    docs/data_sample/legacy/scales_multisheet_2026.xlsx

Результат:
    docs/data_sample/scales.xlsx
      • лист «Шкалы»   — все дилеры друг под другом, каждый блок отделён
                         строкой-маркером  «### ДИЛЕР …»  (его читает калькулятор);
      • лист «Реестр»  — справочник: каждое значение шкал отдельной строкой
                         (дилер / таблица / компонент / тир / значение / адрес ячейки).
                         На расчёт не влияет, нужен для быстрой проверки и фильтрации.

Что переносится 1:1 (ничего не теряется):
    значения, формулы (ссылки пересчитываются на новые строки) и кэш-значения формул,
    форматы чисел, шрифты, заливки, границы, выравнивание, объединённые ячейки,
    высота строк, ширина колонок, группировка строк (сворачивание блока).

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
    from openpyxl.worksheet.hyperlink import Hyperlink
except ImportError:  # pragma: no cover
    sys.exit('Нужен openpyxl:  pip install openpyxl')

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / 'docs' / 'data_sample' / 'legacy' / 'scales_multisheet_2026.xlsx'
DEFAULT_OUT = ROOT / 'docs' / 'data_sample' / 'scales.xlsx'

SCALES_SHEET = 'Шкалы'
REGISTRY_SHEET = 'Реестр'

DEALER_MARKER = '### ДИЛЕР'
REGISTRY_MARKER = '### РЕЕСТР'

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
# 3. Лист «Реестр» — плоский справочник всех значений
# ═══════════════════════════════════════════════════════════════════════════
REGISTRY_HEADER = [
    '№', 'Дилер', 'Тип', 'Вкладка (была)', 'Раздел', 'Таблица', 'Период',
    'Строка / компонент', 'Подпись строки', 'Тир / показатель', 'Значение',
    'Скидка, %', 'Итоговая строка', 'Ячейка в «Шкалы»', 'Исходная ячейка', 'Примечание',
]
REGISTRY_WIDTHS = [5, 34, 7, 24, 12, 34, 22, 58, 26, 16, 14, 10, 9, 15, 15, 34]


def normalize_pct(value, number_format, mode):
    """
    Какое число показывать в колонке «Скидка, %» реестра:
      'as-is'          — значение уже в процентах (6 → 6);
      'service'        — правило калькулятора для шкал сервиса (0.19 → 19, 6 → 6);
      'percent-format' — по формату ячейки: '0%' → ×100, иначе пусто (шапка плана);
      'none'           — не процент (текст, суммы в евро).
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if mode == 'as-is':
        return round(value, 6)
    if mode == 'service':
        return round(value * 100 if value < 1 else value, 6)
    if mode == 'percent-format' and '%' in (number_format or ''):
        return round(value * 100, 6)
    return None


def registry_records_for_dealer(ws, wsv, info, row_shift):
    """
    Полный перечень непустых ячеек вкладки, разложенный по таблицам.
    Возвращает (список записей, множество покрытых координат (row, col)).
    """
    lc = info['label_col']
    hr = info['header_row']
    recs, covered = [], set()

    def target_coord(r, c):
        return f'{get_column_letter(c)}{r + row_shift}'

    def source_coord(r, c):
        return f'{info["sheet"]}!{get_column_letter(c)}{r}'

    def add(section, table, period, label, sub, tier, value, fmt, pct_mode, r, c,
            is_total=False, note=''):
        if r is not None and c is not None:
            covered.add((r, c))
        recs.append({
            'section': section, 'table': table, 'period': period, 'label': label,
            'sub': sub, 'tier': tier,
            'value': None if value is None or value == '' else value,
            'fmt': fmt, 'pct_mode': pct_mode, 'is_total': is_total, 'note': note,
            'target': target_coord(r, c) if r is not None else '',
            'source': source_coord(r, c) if r is not None else '',
            '_rc': (r, c),
        })

    # ── 3.1 Шапка плана (выручка / план / бонусы) ──────────────────────────
    # Каждая ячейка шапки — отдельная запись реестра (значение = текст ячейки),
    # чтобы любую запись можно было сверить с её ячейкой на листе «Шкалы».
    headers = {}
    for c in range(lc + 1, ws.max_column + 1):
        v = ws.cell(hr, c).value
        if isinstance(v, str) and v.strip():
            headers[c] = norm_space(v)
            add('План', 'Шапка плана', '', '(заголовок колонки)', None, headers[c],
                v, None, 'none', hr, c)
    if ws.cell(hr, lc).value is not None:
        add('План', 'Шапка плана', '', '(левый край шапки)', None, None,
            ws.cell(hr, lc).value, None, 'none', hr, lc)

    for r in range(hr + 1, min(hr + 4, ws.max_row) + 1):
        label = ws.cell(r, lc).value
        if label is None:
            continue
        label = norm_space(label)
        covered.add((r, lc))
        emitted = 0
        for c in range(lc + 1, ws.max_column + 1):
            vc = wsv.cell(r, c)
            if vc.value is None or (isinstance(vc.value, str) and not vc.value.strip()):
                continue
            fmt_cell = ws.cell(r, c)
            covered.add((r, c))
            is_text = isinstance(vc.value, str)
            recs.append({
                'section': 'План', 'table': 'План и бонусы', 'period': '',
                'label': label, 'sub': None,
                'tier': headers.get(c, 'подпись справа'),
                'value': vc.value, 'fmt': fmt_cell.number_format,
                'pct_mode': 'none' if is_text else 'percent-format',
                'is_total': bool(ITOGO_RE.search(label)),
                'note': '' if c in headers else 'подпись/примечание справа от плана',
                'target': target_coord(r, c), 'source': source_coord(r, c),
                '_rc': (r, c),
            })
            emitted += 1
        if not emitted:
            add('План', 'План и бонусы', '', label, None, None,
                ws.cell(r, lc).value, None, 'none', r, lc,
                note='в строке нет числовых значений')

    # ── 3.2 Таблицы шкал (оборудование / РМ) ───────────────────────────────
    for key, table_name, extra_stop in (
        ('equipment', 'Оборудование', re.compile(r'ОБЪЕМ\s+ЗАКУПОК\s+В\s+ТЫС', re.I)),
        ('materials', 'Расходные материалы', None),
    ):
        t = info[key]
        if not t['tiers']:
            continue
        period = t['period']
        if t['hdr']:
            covered.add((t['hdr'], lc))
            add('Шкала', table_name, period, '(заголовок раздела)', None, None,
                ws.cell(t['hdr'], lc).value, None, 'none', t['hdr'], lc)
        for tc_col, tier_label in t['tiers']:
            add('Шкала', table_name, period, '(шапка тиров)', None, tier_label,
                ws.cell(t['tier_row'], tc_col).value, None, 'none', t['tier_row'], tc_col,
                note='граница тира; значения под ней считаются по этому диапазону')
        for row in t['rows']:
            covered.add((row['row'], lc))
            if row['sub']:
                covered.add((row['row'], lc + 1))
            note = ''
            if extra_stop and extra_stop.search(row['label'].upper()):
                note = 'подзаголовок — калькулятор строку отфильтровывает'
            if row['empty']:
                note = (note + '; ' if note else '') + 'пустая строка (в расчёте не участвует)'
            emitted = 0
            for (c, value, fmt), (_tc, tier) in zip(row['values'], t['tiers']):
                if value is None or value == '':
                    continue
                covered.add((row['row'], c))
                emitted += 1
                recs.append({
                    'section': 'Шкала', 'table': table_name, 'period': period,
                    'label': row['label'], 'sub': row['sub'], 'tier': tier,
                    'value': value, 'fmt': fmt, 'pct_mode': 'as-is',
                    'is_total': row['is_total'], 'note': note,
                    'target': target_coord(row['row'], c),
                    'source': source_coord(row['row'], c),
                    '_rc': (row['row'], c),
                })
            if not emitted:
                add('Шкала', table_name, period, row['label'], row['sub'], None,
                    ws.cell(row['row'], lc).value, None, 'none', row['row'], lc,
                    note=note or 'значений по тирам нет')

    # ── 3.3 Сервис (ЗЧ) ────────────────────────────────────────────────────
    svc = info['service']
    if svc['hdr']:
        covered.add((svc['hdr'], lc))
        add('Шкала', svc['table'], svc['period'], '(заголовок раздела)', None, None,
            ws.cell(svc['hdr'], lc).value, None, 'none', svc['hdr'], lc)
    for row in svc['rows']:
        covered.add((row['row'], lc))
        for offset, what in ((1, 'от'), (2, 'до')):
            c = lc + offset
            if wsv.cell(row['row'], c).value is not None:
                covered.add((row['row'], c))
        c, value, fmt = row['pct_cell']
        if value is not None:
            covered.add((row['row'], c))
        recs.append({
            'section': 'Шкала', 'table': svc['table'], 'period': svc['period'],
            'label': row['label'], 'sub': None, 'tier': row['tier'],
            'value': value, 'fmt': fmt, 'pct_mode': 'service', 'is_total': True,
            'note': '' if row['used_by_calc'] else 'пусто — в расчёте не участвует',
            'target': target_coord(row['row'], c), 'source': source_coord(row['row'], c),
            '_rc': (row['row'], c),
        })
    # Прочие ЧИСЛОВЫЕ строки раздела сервиса (например, «без статуса партнера»):
    # в расчёте не участвуют, но в реестре должны быть. Длинные тексты и подписи
    # оставляем общему проходу ниже — это примечания, а не строки шкалы.
    if svc['hdr']:
        for r in range(svc['hdr'] + 1, ws.max_row + 1):
            if info['control']['hdr'] and r >= info['control']['hdr']:
                break
            label_raw = ws.cell(r, lc).value
            label = norm_space(label_raw) if label_raw is not None else ''
            if len(label) > 60:
                continue                      # примечание — уйдёт в общий проход
            if label and (r, lc) in covered:
                continue                      # строка уже описана (диапазоны/заголовок)
            sub_raw = ws.cell(r, lc + 1).value
            sub = norm_space(sub_raw) if isinstance(sub_raw, str) else None
            row_label = label or sub or ''
            for c in range(lc + 1, ws.max_column + 1):
                if (r, c) in covered:
                    continue
                vc = wsv.cell(r, c)
                if isinstance(vc.value, bool) or not isinstance(vc.value, (int, float)):
                    continue                  # тексты — в общий проход
                covered.add((r, c))
                recs.append({
                    'section': 'Шкала', 'table': svc['table'], 'period': svc['period'],
                    'label': row_label, 'sub': None,
                    'tier': sub if c > lc + 1 else '',
                    'value': vc.value, 'fmt': ws.cell(r, c).number_format,
                    'pct_mode': 'service', 'is_total': False,
                    'note': 'калькулятор эту строку не использует',
                    'target': target_coord(r, c), 'source': source_coord(r, c),
                    '_rc': (r, c),
                })
            if label:
                covered.add((r, lc))

    # ── 3.4 Система контроля (штрафы) — только РФ ──────────────────────────
    ctrl = info['control']
    if ctrl['hdr']:
        covered.add((ctrl['hdr'], lc))
        add('Контроль', 'Система контроля (штрафы)', 'квартал', '(заголовок раздела)', None, None,
            ws.cell(ctrl['hdr'], lc).value, None, 'none', ctrl['hdr'], lc)
        for row in ctrl['rows']:
            covered.add((row['row'], lc))
            if isinstance(row['sub'], str):
                covered.add((row['row'], lc + 1))
            c, value, fmt = row['value_cell']
            if value is not None:
                covered.add((row['row'], c))
            recs.append({
                'section': 'Контроль', 'table': 'Система контроля (штрафы)', 'period': 'квартал',
                'label': row['label'], 'sub': row['sub'], 'tier': row['sub'] or 'значение',
                'value': value, 'fmt': fmt, 'pct_mode': 'as-is', 'is_total': False,
                'note': 'калькулятор не рассчитывает, хранится для полноты',
                'target': target_coord(row['row'], c), 'source': source_coord(row['row'], c),
                '_rc': (row['row'], c),
            })

    # ── 3.5 Всё остальное (примечания, заголовки, непонятные ячейки) ────────
    for r in range(1, ws.max_row + 1):
        for c in range(1, ws.max_column + 1):
            if (r, c) in covered:
                continue
            vc = wsv.cell(r, c)
            if vc.value is None or (isinstance(vc.value, str) and not vc.value.strip()):
                continue
            covered.add((r, c))
            text = vc.value
            is_note = isinstance(text, str) and len(text) > 60
            recs.append({
                'section': 'Примечание' if is_note else 'Прочее',
                'table': 'Примечание' if is_note else 'Прочее',
                'period': '',
                'label': norm_space(ws.cell(r, lc).value) if c != lc and ws.cell(r, lc).value else '',
                'sub': None, 'tier': '',
                'value': text, 'fmt': ws.cell(r, c).number_format, 'pct_mode': 'none',
                'is_total': False,
                'note': 'текстовое примечание' if is_note else '',
                'target': target_coord(r, c), 'source': source_coord(r, c),
                '_rc': (r, c),
            })
    return recs, covered


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
    if dry_run:
        return

    out_wb = Workbook()
    tgt = out_wb.active
    tgt.title = SCALES_SHEET
    tgt.sheet_properties.outlinePr.summaryBelow = False  # маркер блока — над блоком
    tgt.sheet_view.showGridLines = True

    cached: dict[str, object] = {}
    blocks = []          # (info, marker_row, first_row, last_row)
    cursor = 1

    # ── Шапка-пояснение ────────────────────────────────────────────────────
    legend = [
        ('ШКАЛЫ СКИДОК ДИЛЕРОВ — условия работы ТПС 2026 финансового года', F_TITLE),
        ('Все дилеры — на одном листе. Каждый дилер это блок строк, над ним строка-маркер '
         '(ячейка A начинается с «### ДИЛЕР»).', F_HINT),
        ('Числа правьте прямо в блоках: формулы, форматы, объединённые ячейки и оформление '
         'сохранены. Строку-маркер не удаляйте — по ней калькулятор находит дилера.', F_HINT),
        ('Калькулятор читает только блоки с маркером «### ДИЛЕР». Лист «Реестр» — справочник '
         '(свод всех значений с адресами ячеек), на расчёт не влияет.', F_HINT),
        (f'Собрано автоматически из legacy/{source.name} '
         f'({len(wb_f.worksheets)} вкладок → 1 лист) • tools/consolidate_scales.py • '
         f'{dt.date.today().isoformat()}', F_HINT),
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

    # ── Блоки дилеров ──────────────────────────────────────────────────────
    registry = []
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
        cursor = last_row + 3             # два пустых строки-разделителя

        recs, _covered = registry_records_for_dealer(ws, wsv, info, row_shift)
        for rec in recs:
            rec['dealer'] = info['name']
            rec['dealer_type'] = info['type']
        registry.extend(recs)

    # ── Содержание (после того как известны строки блоков) ─────────────────
    for idx, ((info, marker_row, _first, _last), row) in enumerate(zip(blocks, range(toc_first, toc_last + 1)), 1):
        cell = tgt.cell(row, 1,
                        f'{idx} • {info["name"]} • {info["type"]} • вкладка «{info["sheet"]}»'
                        f' • блок в строке {marker_row}')
        cell.font = F_TOC
        cell.alignment = A_LEFT
        cell.fill = FILL_TOC
        cell.hyperlink = Hyperlink(ref=cell.coordinate, location=f"'{SCALES_SHEET}'!A{marker_row}",
                                   display=cell.value)
        tgt.row_dimensions[row].height = 15

    # ── Ширины колонок: максимум по всем вкладкам ──────────────────────────
    widths = collect_widths(sheets)
    tgt.column_dimensions['A'].width = 3.5
    for letter, width in widths.items():
        if letter == 'A':
            continue
        tgt.column_dimensions[letter].width = round(width, 1)

    # ── Печать: книжная ориентация не нужна, широкие блоки — в один лист ───
    tgt.page_setup.orientation = 'landscape'
    tgt.page_setup.fitToWidth = 1
    tgt.page_setup.fitToHeight = 0
    tgt.sheet_properties.pageSetUpPr.fitToPage = True
    tgt.print_title_rows = f'{toc_row}:{toc_row}'

    # ── Лист «Реестр» ──────────────────────────────────────────────────────
    reg = out_wb.create_sheet(REGISTRY_SHEET)
    note = (f'{REGISTRY_MARKER} • справочник: все значения шкал одним списком '
            f'({len(registry)} строк). Лист формируется автоматически '
            f'(tools/consolidate_scales.py) и в расчёте не участвует — '
            f'правьте шкалы на листе «{SCALES_SHEET}».')
    nc = reg.cell(1, 1, note)
    nc.font = F_HINT
    nc.alignment = A_LEFT
    reg.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(REGISTRY_HEADER))
    reg.row_dimensions[1].height = 28
    reg.cell(1, 1).alignment = Alignment(horizontal='left', vertical='center', wrap_text=True)

    for c, title in enumerate(REGISTRY_HEADER, 1):
        cell = reg.cell(2, c, title)
        cell.font = F_HDR
        cell.fill = FILL_HDR
        cell.border = B_ALL
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        reg.column_dimensions[get_column_letter(c)].width = REGISTRY_WIDTHS[c - 1]
    reg.row_dimensions[2].height = 30

    section_order = {'План': 0, 'Шкала': 1, 'Контроль': 2, 'Примечание': 3, 'Прочее': 4}
    dealer_order = {info['sheet']: i for i, info in enumerate(infos)}
    registry.sort(key=lambda r: (dealer_order.get(r['source'].split('!')[0], 99),
                                 section_order.get(r['section'], 9),
                                 r['_rc'][0], r['_rc'][1]))

    row = 3
    for n, rec in enumerate(registry, 1):
        pct = normalize_pct(rec['value'], rec['fmt'], rec['pct_mode'])
        values = [n, rec['dealer'], rec['dealer_type'], rec['source'].split('!')[0],
                  rec['section'], rec['table'], rec['period'], rec['label'], rec['sub'],
                  rec['tier'], rec['value'], pct, 'да' if rec['is_total'] else '',
                  rec['target'], rec['source'], rec['note']]
        for c, v in enumerate(values, 1):
            cell = reg.cell(row, c, v if v != '' else None)
            cell.border = B_ALL
            cell.alignment = A_WRAP if c in (8, 9, 16) else Alignment(vertical='top')
            if c == 12 and isinstance(v, (int, float)):
                cell.number_format = '0.##'
            elif c == 11 and isinstance(v, (int, float)):
                cell.number_format = rec['fmt'] if rec['fmt'] and rec['fmt'] != 'General' else '#,##0.####'
        row += 1

    reg.freeze_panes = 'E3'
    reg.auto_filter.ref = f'A2:{get_column_letter(len(REGISTRY_HEADER))}{row - 1}'
    reg.page_setup.orientation = 'landscape'
    reg.page_setup.fitToWidth = 1
    reg.sheet_properties.pageSetUpPr.fitToPage = True

    out_wb.calculation.fullCalcOnLoad = True  # Excel пересчитает формулы при открытии
    out.parent.mkdir(parents=True, exist_ok=True)
    out_wb.save(out)

    injected = inject_cached_values(out, SCALES_SHEET, cached)

    print(f'\nГотово: {out.relative_to(ROOT)}')
    print(f'  лист «{SCALES_SHEET}» : {len(blocks)} блоков дилеров, строк {tgt.max_row}, '
          f'колонок {tgt.max_column}')
    print(f'  лист «{REGISTRY_SHEET}»: {len(registry)} записей справочника')
    print(f'  формул перенесено    : {len(cached)} (кэш-значения восстановлены: {injected})')
    print(f'  объединённых ячеек   : {len(tgt.merged_cells.ranges)}')
    return {'blocks': blocks, 'registry': registry, 'cached': cached}


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
