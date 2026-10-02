#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Независимый аудит единого листа шкал: «ничего не потерялось?».

Сравнивает собранный docs/data_sample/scales.xlsx с исходным многовкладочным
docs/data_sample/legacy/scales_multisheet_2026.xlsx ЯЧЕЙКА ЗА ЯЧЕЙКОЙ:

  1. резервная копия побайтово равна оригиналу из git-истории;
  2. в новом файле ровно два листа: «Шкалы» (данные) и «Реестр» (справочник);
  3. на листе «Шкалы» 18 блоков-маркеров «### ДИЛЕР», порядок и имена совпадают
     с порядком вкладок исходника, скрытые вкладки помечены;
  4. для каждого блока: все значения, формулы (пересчитанные на новые строки),
     кэш-значения формул, форматы чисел, шрифты, заливки, границы, выравнивание,
     объединённые ячейки и высота строк перенесены 1:1, лишних ячеек нет;
  5. служебные «Лист1/Лист2/Лист3» в новый файл не переносились (по решению
     заказчика) и остались в резервной копии;
  6. лист «Реестр»: каждый адрес ячейки из колонки «Ячейка в «Шкалы»» существует
     и содержит ровно то значение, что записано в реестре.

Запуск:
    pip install openpyxl
    python3 tools/verify_scales.py            # полный аудит
    python3 tools/verify_scales.py --quiet    # только итог

Код возврата: 0 — всё сошлось, 1 — найдены расхождения.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
from pathlib import Path

try:
    import openpyxl
    from openpyxl.formula.translate import Translator
    from openpyxl.utils import get_column_letter
except ImportError:  # pragma: no cover
    sys.exit('Нужен openpyxl:  pip install openpyxl')

ROOT = Path(__file__).resolve().parent.parent
NEW = ROOT / 'docs' / 'data_sample' / 'scales.xlsx'
LEGACY = ROOT / 'docs' / 'data_sample' / 'legacy' / 'scales_multisheet_2026.xlsx'
GIT_PATH_ORIGINAL = 'docs/data_sample/scales.xlsx'      # как файл лежал до сборки
GIT_PATH_BACKUP = 'docs/data_sample/legacy/scales_multisheet_2026.xlsx'

SCALES_SHEET = 'Шкалы'
REGISTRY_SHEET = 'Реестр'
LEGACY_SHEET_RE = re.compile(r'^\s*лист\s*\d*\s*$', re.I)
DEALER_MARKER_RE = re.compile(r'^\s*#{2,}\s*ДИЛЕР', re.I)
SKIP_MARKER_RE = re.compile(r'^\s*#{2,}\s*(РЕЕСТР|АРХИВ|СЛУЖЕБ)', re.I)
VYRUCHKA_RE = re.compile(r'Выручка\s*202[3-6]', re.I)
SISTEMA_RE = re.compile(r'СИСТЕМА\s+РАСЧЕТА\s+СКИДКИ\s+ПО\s+ЗАПЧАСТЯМ', re.I)

problems: list[str] = []
notes: list[str] = []
checked = {'cells': 0, 'styles': 0, 'formulas': 0, 'cached': 0, 'merges': 0,
           'heights': 0, 'registry': 0}


def fail(msg: str):
    problems.append(msg)


def note(msg: str):
    notes.append(msg)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ─── 1. Резервная копия == оригинал из git ──────────────────────────────────
def check_backup_matches_git():
    if not LEGACY.exists():
        fail(f'нет резервной копии: {LEGACY}')
        return
    try:
        commits = subprocess.run(
            ['git', 'log', '--all', '--format=%H', '--', GIT_PATH_ORIGINAL],
            cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        note(f'git недоступен, сверка копии с историей пропущена ({exc})')
        return
    if not commits:
        note('в git-истории нет файла docs/data_sample/scales.xlsx — сверка пропущена')
        return
    sha = commits[-1]
    for path in (GIT_PATH_BACKUP, GIT_PATH_ORIGINAL):
        blob = subprocess.run(['git', 'show', f'{sha}:{path}'], cwd=ROOT,
                              capture_output=True)
        if blob.returncode == 0 and blob.stdout:
            git_hash = hashlib.sha256(blob.stdout).hexdigest()
            local_hash = sha256(LEGACY)
            if git_hash == local_hash:
                note(f'резервная копия побайтово равна оригиналу из git ({sha[:7]}:{path})')
            else:
                fail(f'резервная копия ОТЛИЧАЕТСЯ от оригинала в git ({sha[:7]}:{path})')
            return
    note('не удалось прочитать оригинал из git — сверка по хешу пропущена')


# ─── Сигнатура стиля ячейки (для сравнения оформления) ───────────────────────
def _color(x):
    if x is None:
        return None
    return (getattr(x, 'type', None), getattr(x, 'rgb', None), getattr(x, 'theme', None),
            round(getattr(x, 'tint', 0) or 0, 6), getattr(x, 'indexed', None))


def style_sig(cell):
    f, fill, b, al, p = cell.font, cell.fill, cell.border, cell.alignment, cell.protection
    sides = tuple((getattr(b, s).style, _color(getattr(b, s).color))
                  for s in ('left', 'right', 'top', 'bottom', 'diagonal'))
    return (
        cell.number_format,
        (f.name, f.sz, f.b, f.i, f.u, f.strike, f.vertAlign, _color(f.color)),
        (fill.fill_type, _color(fill.fgColor), _color(fill.bgColor)),
        sides,
        (al.horizontal, al.vertical, al.wrap_text, al.text_rotation, al.indent,
         al.shrink_to_fit),
        (p.locked, p.hidden),
    )


def value_equal(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(float(a) - float(b)) <= 1e-9 * max(1.0, abs(float(a)))
    return a == b


def nonempty(ws):
    """Непустые ячейки листа: {(row, col): cell}."""
    out = {}
    for row in ws.iter_rows():
        for cell in row:
            if cell.value is not None and not (isinstance(cell.value, str) and not cell.value.strip()):
                out[(cell.row, cell.column)] = cell
    return out


# ─── 2–3. Структура нового файла и блоки-маркеры ─────────────────────────────
def find_blocks(tgt):
    """Список блоков: (marker_row, marker_text, first_row, last_row)."""
    marks = []
    for r in range(1, tgt.max_row + 1):
        for c in range(1, min(4, tgt.max_column) + 1):
            v = tgt.cell(r, c).value
            if not isinstance(v, str):
                continue
            if DEALER_MARKER_RE.match(v):
                marks.append((r, v.strip(), 'dealer'))
            elif SKIP_MARKER_RE.match(v):
                marks.append((r, v.strip(), 'skip'))
            break
    blocks = []
    for i, (r, text, kind) in enumerate(marks):
        end = marks[i + 1][0] - 1 if i + 1 < len(marks) else tgt.max_row
        blocks.append({'marker_row': r, 'text': text, 'kind': kind,
                       'first': r + 1, 'last': end})
    return blocks


def block_info(tgt, block):
    """Имя дилера и тип по содержимому блока (независимо от текста маркера)."""
    header_row = None
    for r in range(block['first'], min(block['first'] + 8, block['last']) + 1):
        for c in range(1, tgt.max_column + 1):
            v = tgt.cell(r, c).value
            if isinstance(v, str) and VYRUCHKA_RE.search(v):
                header_row = r
                break
        if header_row:
            break
    if header_row is None:
        return None
    label_col, name = None, None
    for c in range(1, tgt.max_column + 1):
        v = tgt.cell(header_row + 1, c).value
        if isinstance(v, str) and v.strip():
            label_col, name = c, v.strip()
            break
    dtype = 'Заруб'
    if label_col:
        for r in range(block['first'], block['last'] + 1):
            v = tgt.cell(r, label_col).value
            if v and SISTEMA_RE.search(str(v)):
                dtype = 'РФ'
                break
    return {'header_row': header_row, 'label_col': label_col, 'name': name, 'type': dtype}


# ─── 4. Покадровое сравнение блока с исходной вкладкой ───────────────────────
def compare_block(src_ws, src_val_ws, tgt_ws, tgt_val_ws, row_shift, title):
    src_cells = nonempty(src_ws)
    tgt_cells = {}
    for (r, c), cell in nonempty(tgt_ws).items():
        if block_contains(r, row_shift, src_ws.max_row):
            tgt_cells[(r, c)] = cell

    # 4.1 значения / формулы / стили
    for (r, c), sc in src_cells.items():
        tr = r + row_shift
        tc = tgt_ws.cell(tr, c)
        checked['cells'] += 1
        sv, tv = sc.value, tc.value
        if isinstance(sv, str) and sv.startswith('='):
            checked['formulas'] += 1
            expected = Translator(sv, origin=sc.coordinate).translate_formula(tc.coordinate)
            if tv != expected:
                fail(f'{title}: формула {sc.coordinate} → {tc.coordinate}: '
                     f'ожидалось {expected!r}, получено {tv!r}')
            src_cached = src_val_ws.cell(r, c).value
            tgt_cached = tgt_val_ws.cell(tr, c).value
            checked['cached'] += 1
            if src_cached is not None and not value_equal(src_cached, tgt_cached):
                fail(f'{title}: кэш формулы {tc.coordinate}: было {src_cached!r}, '
                     f'стало {tgt_cached!r}')
        elif not value_equal(sv, tv):
            fail(f'{title}: значение {sc.coordinate} → {tc.coordinate}: '
                 f'было {sv!r}, стало {tv!r}')
        checked['styles'] += 1
        if sc.has_style or tc.has_style:
            s_sig, t_sig = style_sig(sc), style_sig(tc)
            if s_sig != t_sig:
                diff = [name for name, a, b in zip(
                    ('формат числа', 'шрифт', 'заливка', 'границы', 'выравнивание', 'защита'),
                    s_sig, t_sig) if a != b]
                fail(f'{title}: оформление {sc.coordinate} → {tc.coordinate} '
                     f'отличается ({", ".join(diff)})')
        tgt_cells.pop((tr, c), None)

    # 4.2 лишних ячеек в блоке быть не должно
    for (r, c), tc in sorted(tgt_cells.items()):
        fail(f'{title}: в блок попала ЛИШНЯЯ ячейка {tc.coordinate} = {tc.value!r}')

    # 4.3 объединённые ячейки
    src_merges = {str(m) for m in src_ws.merged_cells.ranges}
    tgt_merges = set()
    for m in tgt_ws.merged_cells.ranges:
        if block_contains(m.min_row, row_shift, src_ws.max_row) and \
                block_contains(m.max_row, row_shift, src_ws.max_row):
            shifted = f'{get_column_letter(m.min_col)}{m.min_row - row_shift}:' \
                      f'{get_column_letter(m.max_col)}{m.max_row - row_shift}'
            tgt_merges.add(shifted)
        checked['merges'] += 1
    missing, extra = src_merges - tgt_merges, tgt_merges - src_merges
    if missing:
        fail(f'{title}: потеряны объединённые ячейки {sorted(missing)}')
    if extra:
        fail(f'{title}: появились лишние объединённые ячейки {sorted(extra)}')

    # 4.4 высота строк
    for r, dim in src_ws.row_dimensions.items():
        if not dim.height:
            continue
        tgt_dim = tgt_ws.row_dimensions.get(r + row_shift)
        checked['heights'] += 1
        if tgt_dim is None or not tgt_dim.height or abs(tgt_dim.height - dim.height) > 0.01:
            fail(f'{title}: высота строки {r} ({dim.height}) не перенесена '
                 f'→ строка {r + row_shift} '
                 f'({tgt_dim.height if tgt_dim else None})')

    # 4.5 ширина колонок (берётся максимум по всем вкладкам, поэтому «не уже»)
    for letter, dim in src_ws.column_dimensions.items():
        if not dim.width:
            continue
        tgt_dim = tgt_ws.column_dimensions.get(letter)
        if tgt_dim is None or not tgt_dim.width or tgt_dim.width + 0.05 < dim.width:
            note(f'{title}: ширина колонки {letter} {dim.width} → '
                 f'{tgt_dim.width if tgt_dim else None} (на едином листе общая ширина)')


def block_contains(row, row_shift, src_max_row):
    return row_shift + 1 <= row <= row_shift + src_max_row


# ─── 6. Реестр ───────────────────────────────────────────────────────────────
def check_registry(reg_ws, tgt_ws, tgt_val_ws):
    header = [c.value for c in reg_ws[2]]
    try:
        col_target = header.index('Ячейка в «Шкалы»') + 1
        col_value = header.index('Значение') + 1
        col_dealer = header.index('Дилер') + 1
    except ValueError:
        fail('в листе «Реестр» нет ожидаемых колонок (Ячейка в «Шкалы», Значение, Дилер)')
        return
    per_dealer = {}
    for r in range(3, reg_ws.max_row + 1):
        target = reg_ws.cell(r, col_target).value
        value = reg_ws.cell(r, col_value).value
        dealer = reg_ws.cell(r, col_dealer).value
        if dealer:
            per_dealer[dealer] = per_dealer.get(dealer, 0) + 1
        if not isinstance(target, str) or not re.fullmatch(r'[A-Z]{1,3}\d+', target):
            continue
        checked['registry'] += 1
        cell = tgt_ws[target]
        raw = cell.value
        actual = tgt_val_ws[target].value if isinstance(raw, str) and raw.startswith('=') else raw
        if not value_equal(value, actual):
            fail(f'Реестр!A{r}: значение {value!r} не совпадает с «Шкалы»!{target} = {actual!r}')
    if len(per_dealer) < 18:
        fail(f'в реестре только {len(per_dealer)} дилеров (ожидалось 18)')
    note(f'реестр: {sum(per_dealer.values())} записей по {len(per_dealer)} дилерам, '
         f'сверено адресов: {checked["registry"]}')


def check_registry_completeness(reg_ws, tgt_ws, blocks_geometry):
    """
    Каждая непустая ячейка блока должна быть учтена в реестре: либо своей
    записью (колонка «Ячейка в «Шкалы»»), либо как подпись строки/граница тира
    той строки, у которой запись есть, либо как часть объединённой ячейки.
    """
    header = [c.value for c in reg_ws[2]]
    try:
        col_target = header.index('Ячейка в «Шкалы»') + 1
    except ValueError:
        fail('в реестре нет колонки «Ячейка в «Шкалы»»')
        return

    covered_cells, rows_with_records = set(), set()
    for r in range(3, reg_ws.max_row + 1):
        t = reg_ws.cell(r, col_target).value
        if isinstance(t, str) and re.fullmatch(r'[A-Z]{1,3}\d+', t):
            covered_cells.add(t)
            rows_with_records.add(int(re.sub(r'[A-Z]', '', t)))

    # ячейки объединённых диапазонов считаем покрытыми, если покрыт их якорь
    merge_owner = {}
    for m in tgt_ws.merged_cells.ranges:
        anchor = f'{get_column_letter(m.min_col)}{m.min_row}'
        for row in range(m.min_row, m.max_row + 1):
            for col in range(m.min_col, m.max_col + 1):
                merge_owner[(row, col)] = anchor

    accounted = missing = 0
    for geom in blocks_geometry:
        lc = geom['label_col']
        for r in range(geom['first'], geom['last'] + 1):
            for c in range(1, tgt_ws.max_column + 1):
                cell = tgt_ws.cell(r, c)
                if cell.value is None:
                    continue
                coord = cell.coordinate
                ok = coord in covered_cells
                if not ok and (r, c) in merge_owner:
                    ok = merge_owner[(r, c)] in covered_cells
                if not ok and r in rows_with_records and lc <= c <= lc + 2:
                    ok = True  # подпись строки / уточнение / граница тира
                if ok:
                    accounted += 1
                else:
                    missing += 1
                    fail(f'реестр не описывает ячейку «Шкалы»!{coord} = {str(cell.value)[:40]!r} '
                         f'(блок {geom["title"]})')
    note(f'полнота реестра: учтено {accounted} непустых ячеек блоков, не описано {missing}')


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--new', type=Path, default=NEW)
    ap.add_argument('--legacy', type=Path, default=LEGACY)
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    if not args.new.exists():
        sys.exit(f'нет файла {args.new} — сначала запустите tools/consolidate_scales.py')
    if not args.legacy.exists():
        sys.exit(f'нет резервной копии {args.legacy}')

    print('Аудит единого листа шкал')
    print('=' * 78)
    check_backup_matches_git()

    src_wb = openpyxl.load_workbook(args.legacy, data_only=False)
    src_val = openpyxl.load_workbook(args.legacy, data_only=True)
    new_wb = openpyxl.load_workbook(args.new, data_only=False)
    new_val = openpyxl.load_workbook(args.new, data_only=True)

    # 2. структура
    if new_wb.sheetnames != [SCALES_SHEET, REGISTRY_SHEET]:
        fail(f'ожидались листы {[SCALES_SHEET, REGISTRY_SHEET]}, получено {new_wb.sheetnames}')
    tgt_ws, tgt_val_ws = new_wb[SCALES_SHEET], new_val[SCALES_SHEET]

    # 3. блоки
    blocks = find_blocks(tgt_ws)
    dealer_blocks = [b for b in blocks if b['kind'] == 'dealer']
    src_dealer_sheets = [ws for ws in src_wb.worksheets if not LEGACY_SHEET_RE.match(ws.title)]
    src_service_sheets = [ws.title for ws in src_wb.worksheets if LEGACY_SHEET_RE.match(ws.title)]
    if len(dealer_blocks) != len(src_dealer_sheets):
        fail(f'блоков «### ДИЛЕР» {len(dealer_blocks)}, дилерских вкладок в исходнике '
             f'{len(src_dealer_sheets)}')

    blocks_geometry = []
    for i, (block, src_ws) in enumerate(zip(dealer_blocks, src_dealer_sheets), 1):
        title = f'блок {i} ({src_ws.title})'
        info = block_info(tgt_ws, block)
        if info is None:
            fail(f'{title}: в блоке не найдена шапка «Выручка …»')
            continue
        if info['name'] is None:
            fail(f'{title}: не найдено имя дилера')
            continue
        # имя и тип в маркере должны совпадать с содержимым блока
        for what, expected in (('имя', info['name']), ('тип', info['type'])):
            if expected not in block['text']:
                fail(f'{title}: в маркере нет {what} {expected!r}: {block["text"][:80]}')
        if src_ws.title not in block['text']:
            fail(f'{title}: в маркере нет имени исходной вкладки «{src_ws.title}»')
        if src_ws.sheet_state != 'visible' and 'скрыт' not in block['text'].lower():
            fail(f'{title}: исходная вкладка была скрыта, но в маркере нет пометки')
        # блок должен начинаться сразу за маркером и содержать все строки вкладки
        if block['first'] != block['marker_row'] + 1:
            fail(f'{title}: блок начинается не сразу за маркером')
        row_shift = block['marker_row']
        compare_block(src_ws, src_val[src_ws.title], tgt_ws, tgt_val_ws, row_shift, title)
        blocks_geometry.append({
            'title': src_ws.title, 'first': block['first'],
            'last': row_shift + src_ws.max_row, 'label_col': info['label_col'],
        })

    # 5. служебные листы
    for name in src_service_sheets:
        if name in new_wb.sheetnames:
            note(f'служебный лист «{name}» присутствует в новом файле')
        cells = len(nonempty(src_wb[name]))
        note(f'служебный лист «{name}» ({cells} непустых ячеек) в новый файл не переносился — '
             f'остался в резервной копии {args.legacy.name}')
    if len(new_wb.worksheets[0].merged_cells.ranges) != sum(
            len(ws.merged_cells.ranges) for ws in src_dealer_sheets):
        fail('число объединённых ячеек на листе «Шкалы» не равно сумме по вкладкам')

    # 6. реестр
    if REGISTRY_SHEET in new_wb.sheetnames:
        check_registry(new_wb[REGISTRY_SHEET], tgt_ws, tgt_val_ws)
        check_registry_completeness(new_wb[REGISTRY_SHEET], tgt_ws, blocks_geometry)
    else:
        fail('нет листа «Реестр»')

    print('\nПроверено:')
    for key, label in (('cells', 'ячеек (значение/формула)'), ('formulas', 'формул'),
                       ('cached', 'кэш-значений формул'), ('styles', 'ячеек (оформление)'),
                       ('merges', 'объединённых ячеек'), ('heights', 'высот строк'),
                       ('registry', 'адресов в реестре')):
        print(f'  {label:<28}: {checked[key]}')

    if notes and not args.quiet:
        print('\nЗаметки:')
        for n in notes:
            print(f'  • {n}')

    print()
    if problems:
        print(f'✗ НАЙДЕНО РАСХОЖДЕНИЙ: {len(problems)}')
        for p in problems[:60]:
            print(f'  - {p}')
        if len(problems) > 60:
            print(f'  … и ещё {len(problems) - 60}')
        return 1
    print('✓ Всё сошлось: единый лист содержит те же данные, что и 18 вкладок исходника.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
