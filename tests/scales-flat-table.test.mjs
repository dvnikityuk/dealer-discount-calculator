import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);

const SCALES = new URL('../docs/data_sample/scales.xlsx', import.meta.url);
const SCALES_LEGACY = new URL('../docs/data_sample/legacy/scales_multisheet_2026.xlsx', import.meta.url);
const PLAN = new URL('../docs/data_sample/plan.xlsx', import.meta.url);
const FACTS = new URL('../docs/data_sample/fact.csv', import.meta.url);

const FLAT_SHEET = 'Шкалы';
const SHOWCASE_SHEET = 'Витрина';
const BLOCKS_SHEET = 'Блоки';

const FLAT_HEADER = [
  'Дилер', 'Тип', 'Раздел', 'Категория', 'Таблица', 'Показатель',
  '№ строки', 'Итог', 'Тир', '№ тира', 'Тир от', 'Тир до',
  'Значение', 'Единица', 'Вкладка (была)', 'Ячейка в исходнике',
];

// ─── SheetJS: та же библиотека, что и в браузере (docs/index.html тянет её с CDN) ──
// В проекте она лежит в node_modules (зависимость `xlsx`); если пакета нет —
// тесты пропускаются, а не падают: путь до него можно задать XLSX_PACKAGE.
function loadSheetJS() {
  const candidates = [process.env.XLSX_PACKAGE, 'xlsx'].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (mod && typeof mod.read === 'function') return mod;
      if (mod && mod.default && typeof mod.default.read === 'function') return mod.default;
    } catch {
      /* пробуем следующий */
    }
  }
  return null;
}

const XLSX = loadSheetJS();
const skip = XLSX
  ? false
  : 'нужен SheetJS: npm i xlsx (или XLSX_PACKAGE=/path/to/xlsx) — без него файл не прочитать';

// ─── Достаём парсер калькулятора из docs/index.html (без DOM-бутстрапа) ──────
function loadCalculator() {
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
  const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(inlineScripts.length, 'docs/index.html should contain the calculator script');
  let source = inlineScripts.at(-1)[1];
  const bootstrapStart = source.indexOf(
    "document.getElementById('quarter-select').addEventListener",
  );
  assert.notEqual(bootstrapStart, -1, 'calculator bootstrap marker should exist');
  source = `${source.slice(0, bootstrapStart)}

globalThis.__calcTestApi = {
  parseDataSampleFiles, splitDealerBlocks, markerDealerName,
  findFlatHeader, parseFlatScalesSheet, flatPct,
};`;
  const context = vm.createContext({ XLSX, console });
  new vm.Script(source, { filename: 'docs/index.html' }).runInContext(context);
  return context.__calcTestApi;
}

const buf = (url) => new Uint8Array(readFileSync(url));

function parseState(api, scalesUrl) {
  const stats = {};
  const state = api.parseDataSampleFiles(buf(PLAN), readFileSync(FACTS, 'utf8'), buf(scalesUrl), stats);
  return { state, stats };
}

/** То же, но файл шкал собираем на лету из выбранных листов (проверка запасных форматов). */
function parseStateFromSheets(api, wb, names) {
  const part = { SheetNames: names, Sheets: {} };
  for (const name of names) {
    assert.ok(wb.Sheets[name], `в файле нет листа «${name}»`);
    part.Sheets[name] = wb.Sheets[name];
  }
  const buffer = XLSX.write(part, { type: 'array', bookType: 'xlsx' });
  const stats = {};
  const state = api.parseDataSampleFiles(buf(PLAN), readFileSync(FACTS, 'utf8'), buffer, stats);
  return { state, stats };
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Значения приходят из vm-контекста (другой realm), поэтому перед сравнением
// приводим их к обычным массивам/объектам текущего контекста.
const plain = (v) => JSON.parse(JSON.stringify(v));
const pctOf = (v) => {
  const n = Number(String(v).replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Плоская таблица листа «Шкалы» как массив объектов (заголовки — строка 1). */
function readFlatTable(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[FLAT_SHEET], { header: 1, defval: null });
  assert.deepEqual(plain(rows[0].slice(0, FLAT_HEADER.length)), FLAT_HEADER,
    'заголовки плоской таблицы');
  return XLSX.utils.sheet_to_json(wb.Sheets[FLAT_SHEET], { defval: null });
}

test('плоская таблица даёт калькулятору ровно то же состояние, что и 18 вкладок', { skip }, () => {
  assert.ok(existsSync(SCALES_LEGACY), 'нужна резервная копия исходного файла');
  const api = loadCalculator();

  const flat = parseState(api, SCALES);
  const legacy = parseState(api, SCALES_LEGACY);

  assert.equal(flat.stats.scalesFormat, 'flat', 'новый файл должен читаться как плоская таблица');
  assert.equal(legacy.stats.scalesFormat, 'multi-sheet', 'старый формат продолжает поддерживаться');
  assert.equal(flat.stats.scalesBroken, 0, 'в плоской таблице нечего «не разбирать»');
  assert.equal(flat.stats.scalesDealers, 18, 'дилеров в плоской таблице');
  assert.equal(flat.stats.scalesBlocks, 18, 'дилеров со шкалами');
  assert.ok(flat.stats.scalesValues > 800,
    `значений шкал в плоской таблице: ${flat.stats.scalesValues}`);
  assert.equal(flat.state.dealers.length, 18);

  // Полное совпадение состояния: дилеры, планы, факты и все шкалы.
  assert.deepEqual(
    plain(flat.state),
    plain(legacy.state),
    'состояние из плоской таблицы должно байт-в-байт совпадать с состоянием из 18 вкладок',
  );
});

test('у всех 18 дилеров есть три шкалы, включая скрытые вкладки-дилеры', { skip }, () => {
  const api = loadCalculator();
  const { state } = parseState(api, SCALES);

  assert.equal(state.dealers.length, 18);
  for (const dealer of state.dealers) {
    assert.equal(dealer.scales.length, 3, `${dealer.name}: ожидалось 3 шкалы`);
    const titles = dealer.scales.map((s) => s.title).join(' | ');
    assert.match(titles, /Оборудование — за (квартал|полугодие)/, dealer.name);
    assert.match(titles, /Расходные материалы — за (квартал|полугодие)/, dealer.name);
    assert.match(titles, /Сервис \(ЗЧ\)/, dealer.name);
    // Период зашит в заголовок шкалы: РФ — квартал, Заруб — полугодие.
    assert.equal(dealer.scales[0].title.endsWith(dealer.type === 'РФ' ? 'за квартал' : 'за полугодие'),
      true, `${dealer.name}: период шкалы оборудования (${dealer.scales[0].title})`);
  }

  const byName = Object.fromEntries(state.dealers.map((d) => [norm(d.name), d]));
  // Скрытые вкладки исходника (CLIPSOMAC, Tida Tech, Ari Makina) есть в plan.xlsx —
  // они обязаны остаться в плоской таблице и участвовать в расчёте.
  for (const name of ['CLIPSOMAC, Алжир', 'Tida Tech, Таиланд', 'Ari Makina, Турция']) {
    const dealer = byName[norm(name)];
    assert.ok(dealer, `дилер ${name} потерялся`);
    assert.match(dealer.scales[2].title, /за 6 месяцев/,
      `${name}: шкала сервиса за 6 месяцев`);
  }
});

test('значения шкал совпадают с исходными вкладками (контрольные точки)', { skip }, () => {
  const api = loadCalculator();
  const { state } = parseState(api, SCALES);
  const byName = Object.fromEntries(state.dealers.map((d) => [norm(d.name), d]));

  // РФ: «ИТОГО по МП» — формула SUM в исходнике, значит кэш формулы перенесён.
  const kt = byName[norm('КОМПО Технолоджис')];
  const ktEq = kt.scales.find((s) => s.title.startsWith('Оборудование'));
  assert.deepEqual(plain(ktEq.columns), ['до 75', '75-114', '115-149', '150-189', '190-224', '225 и более']);
  const ktTotal = ktEq.rows.find((r) => r.isTotal);
  assert.equal(norm(ktTotal.component), 'ИТОГО по МП:');
  assert.deepEqual(plain(ktTotal.values), ['14%', '15%', '16%', '17%', '18%', '19%']);

  // РФ: сервис по парку оборудования, 0.19 → 19%, последний тир «от 3001» → 30%.
  const npSvc = byName[norm('НоваПак')].scales.find((s) => s.title.startsWith('Сервис'));
  assert.deepEqual(plain(npSvc.columns), ['0–500', '501–1000', '1001–1800', '1801–2400', '2401–3000', '3001+']);
  assert.deepEqual(plain(npSvc.rows[0].values), ['19%', '21%', '23%', '25%', '27%', '30%']);

  // Заруб: 12-месячная шкала сервиса (0.1 → 10%) и оборудование за полугодие.
  const abs_ = byName[norm('ASIAN BUSINESS SOLUTIONS, Узбекистан')];
  const absSvc = abs_.scales.find((s) => s.title.startsWith('Сервис'));
  assert.match(absSvc.title, /за 12 месяцев/);
  assert.equal(absSvc.columns.length, 12);
  assert.equal(absSvc.rows[0].values[0], '10%');
  assert.equal(absSvc.rows[0].values.at(-1), '22%');
  const absEq = abs_.scales.find((s) => s.title.startsWith('Оборудование'));
  assert.deepEqual(plain(absEq.rows.map((r) => norm(r.component))), [
    'Базовое вознаграждение за Дилерский договор',
    'Наличие сервисного центра и гарантийное обслуживание',
    'Объем закупок МП',
    'ИТОГО',
  ]);
  assert.deepEqual(plain(absEq.rows.at(-1).values), ['14%', '16%', '17%', '18%', '19%', '20%']);

  // KNA: индивидуальная шкала оборудования (в первом тире 0%, а не 6%).
  const knaEq = byName[norm('КОМПО North America Inc')].scales.find((s) => s.title.startsWith('Оборудование'));
  assert.deepEqual(plain(knaEq.rows.find((r) => norm(r.component) === 'Объем закупок МП').values),
    ['0%', '9%', '10%', '11%', '12%', '13%']);
  assert.deepEqual(plain(knaEq.rows.at(-1).values), ['7%', '16%', '17%', '18%', '19%', '20%']);
});

test('лист «Шкалы» — плоская таблица под сводную: строка на значение, без объединений', { skip }, () => {
  const wb = XLSX.read(buf(SCALES), { type: 'array', cellFormula: true, cellNF: true });
  assert.deepEqual(plain(wb.SheetNames), [FLAT_SHEET, SHOWCASE_SHEET, BLOCKS_SHEET],
    'в файле три листа: плоская таблица, витрина и блоки');

  const ws = wb.Sheets[FLAT_SHEET];
  // Сводная таблица не строится из листа с объединёнными ячейками — их быть не должно.
  assert.ok(!ws['!merges'] || ws['!merges'].length === 0, 'в плоской таблице нет объединённых ячеек');
  assert.ok(!ws['!rows'] || ws['!rows'].every((r) => !r || !r.hidden),
    'в плоской таблице нет скрытых строк');

  const records = readFlatTable(wb);
  assert.ok(records.length > 1000, `записей в плоской таблице: ${records.length}`);

  const sections = new Set();
  const categories = new Set();
  const keys = new Set();
  let scaleValues = 0;
  let planValues = 0;
  for (const rec of records) {
    const dealer = norm(rec['Дилер']);
    const section = norm(rec['Раздел']);
    const category = norm(rec['Категория']);
    const indicator = norm(rec['Показатель']);
    const value = rec['Значение'];
    const where = `${dealer} / ${section} / ${category} / ${indicator}`;

    assert.ok(dealer, 'у каждой записи есть дилер');
    assert.ok(section === 'Шкала' || section === 'План', `раздел записи: ${where}`);
    assert.ok(indicator, `у записи пустой показатель: ${where}`);
    assert.equal(typeof value, 'number', `значение должно быть числом (не текстом): ${where}`);
    assert.ok(Number.isFinite(value), `значение конечно: ${where}`);

    // Ключ значения уникален — иначе INDEX/MATCH на витрине вернёт не то число.
    const key = [dealer, section, category, rec['№ строки'], rec['№ тира']].join('|');
    assert.ok(!keys.has(key), `повтор ключа значения: ${key}`);
    keys.add(key);

    if (section === 'Шкала') {
      scaleValues++;
      categories.add(category);
      assert.ok(norm(rec['Таблица']), `пустой заголовок таблицы: ${where}`);
      assert.ok(norm(rec['Тир']), `пустой тир: ${where}`);
      assert.equal(norm(rec['Единица']), '%', `единица значения шкалы: ${where}`);
      assert.ok(norm(rec['Вкладка (была)']) && norm(rec['Ячейка в исходнике']),
        `нет ссылки на исходную ячейку: ${where}`);
      // Скидка хранится долей с форматом «0%»: 0.14 = 14%.
      assert.ok(value >= 0 && value <= 1, `значение шкалы долей (0..1): ${where} = ${value}`);
    } else {
      planValues++;
      assert.ok(['%', 'EUR', 'число'].includes(norm(rec['Единица'])),
        `единица планового значения: ${where}`);
    }
  }
  assert.ok(scaleValues > 800, `значений шкал: ${scaleValues}`);
  assert.ok(planValues > 250, `плановых значений: ${planValues}`);
  assert.deepEqual(plain([...categories].sort()),
    ['Оборудование', 'Расходные материалы', 'Сервис (ЗЧ)'],
    'категории шкал');
  assert.equal(new Set(records.map((r) => norm(r['Дилер']))).size, 18, 'дилеров в таблице');

  // Сервис: диапазоны описаны числами, чтобы сводная могла их группировать.
  const svc = records.filter((r) => norm(r['Раздел']) === 'Шкала' && norm(r['Категория']) === 'Сервис (ЗЧ)');
  assert.ok(svc.length > 150, `строк шкалы сервиса: ${svc.length}`);
  for (const rec of svc) {
    assert.equal(typeof rec['Тир от'], 'number', `«Тир от» у сервиса: ${norm(rec['Дилер'])}`);
    assert.ok(rec['Тир до'] === null || typeof rec['Тир до'] === 'number',
      `«Тир до» у сервиса: ${norm(rec['Дилер'])}`);
    assert.equal(norm(rec['Показатель']), 'Скидка по сервису');
    assert.equal(norm(rec['Итог']), 'да');
  }
});

test('каждое значение, которое считает калькулятор, есть в плоской таблице', { skip }, () => {
  const api = loadCalculator();
  const { state } = parseState(api, SCALES);
  const wb = XLSX.read(buf(SCALES), { type: 'array' });
  const records = readFlatTable(wb);

  const categoryOf = (title) => {
    if (/^Оборудование/i.test(title)) return 'Оборудование';
    if (/^Расходные материалы/i.test(title)) return 'Расходные материалы';
    if (/^Сервис \(ЗЧ\)/i.test(title)) return 'Сервис (ЗЧ)';
    return title;
  };
  const index = new Map();
  for (const rec of records) {
    if (norm(rec['Раздел']) !== 'Шкала') continue;
    const key = [norm(rec['Дилер']), norm(rec['Категория']), norm(rec['Показатель']),
      norm(rec['Тир'])].join('::');
    assert.ok(!index.has(key), `неоднозначная запись в плоской таблице: ${key}`);
    index.set(key, rec);
  }

  let compared = 0;
  for (const dealer of state.dealers) {
    for (const scale of dealer.scales) {
      const category = categoryOf(scale.title);
      for (const row of scale.rows) {
        scale.columns.forEach((tier, i) => {
          const value = row.values[i];
          if (!value) return;
          const key = [norm(dealer.name), category, norm(row.component), norm(tier)].join('::');
          const rec = index.get(key);
          assert.ok(rec, `в плоской таблице нет записи ${key}`);
          // В таблице скидка лежит долей (0.14), калькулятор показывает проценты (14%).
          assert.equal(Math.round(rec['Значение'] * 100 * 1e6) / 1e6, pctOf(value),
            `значение ${key}: в таблице ${rec['Значение']}, у калькулятора ${value}`);
          assert.ok(norm(rec['Ячейка в исходнике']), `нет адреса исходной ячейки: ${key}`);
          compared++;
        });
      }
    }
  }
  assert.ok(compared > 800, `сверено слишком мало значений: ${compared}`);
});

test('лист «Блоки» — запасной формат: без плоской таблицы состояние то же', { skip }, () => {
  const api = loadCalculator();
  const wb = XLSX.read(buf(SCALES), { type: 'array', cellFormula: true });
  const { state, stats } = parseStateFromSheets(api, wb, [BLOCKS_SHEET]);
  const legacy = parseState(api, SCALES_LEGACY);

  assert.equal(stats.scalesFormat, 'single-sheet', 'блоки читаются как единый лист с маркерами');
  assert.equal(stats.scalesBlocks, 18, 'блоков дилеров');
  assert.equal(stats.scalesBroken, 0, 'все блоки разобраны');
  assert.deepEqual(plain(state), plain(legacy.state),
    'состояние из листа «Блоки» должно совпадать с состоянием из 18 вкладок');

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[BLOCKS_SHEET], { header: 1, defval: null });
  const blocks = api.splitDealerBlocks(rows);
  const dealerBlocks = blocks.filter((b) => b.kind === 'dealer');
  assert.equal(dealerBlocks.length, 18, 'блоков «### ДИЛЕР» на листе «Блоки»');
  const markerNames = dealerBlocks.map((b) => norm(api.markerDealerName(b.marker)));
  for (const dealer of state.dealers) {
    assert.ok(markerNames.includes(norm(dealer.name)), `в маркерах нет имени ${dealer.name}`);
  }
});

test('лист «Витрина» справочный: калькулятор его не читает', { skip }, () => {
  const api = loadCalculator();
  const wb = XLSX.read(buf(SCALES), { type: 'array', cellFormula: true });

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHOWCASE_SHEET], { header: 1, defval: null });
  assert.match(String(rows[0][0]), /^###\s*ВИТРИНА/i, 'витрина помечена строкой-маркером');
  const blocks = api.splitDealerBlocks(rows);
  assert.equal(blocks.filter((b) => b.kind === 'dealer').length, 0,
    'на витрине нет блоков дилеров');
  assert.ok(blocks.every((b) => b.kind === 'skip'), 'блок витрины помечен как пропускаемый');

  // Если оставить одну витрину — шкал нет, но приложение не падает.
  const { state, stats } = parseStateFromSheets(api, wb, [SHOWCASE_SHEET]);
  assert.equal(stats.scalesBlocks, 0, 'с витрины нечего брать');
  assert.equal(state.dealers.filter((d) => d.scales && d.scales.length).length, 0);
});

test('витрина показывает те же числа, что и плоская таблица', { skip }, () => {
  const wb = XLSX.read(buf(SCALES), { type: 'array', cellFormula: true });
  const records = readFlatTable(wb);
  const sc = wb.Sheets[SHOWCASE_SHEET];
  const cell = (coord) => (sc[coord] ? sc[coord].v : undefined);

  const dealer = norm(cell('B4'));
  assert.ok(dealer, 'в B4 выбран дилер');
  // Каждая формула витрины смотрит в плоскую таблицу.
  for (const coord of ['F4', 'J4', 'B8', 'B16', 'G16', 'B29', 'B35', 'G35', 'B39', 'G39']) {
    assert.ok(sc[coord] && typeof sc[coord].f === 'string',
      `${coord}: на витрине должна быть формула`);
    assert.match(sc[coord].f, /'Шкалы'!/, `${coord}: формула должна брать данные из «Шкалы»`);
  }

  const valueOf = (category, indicator, tier) => {
    const rec = records.find((r) => norm(r['Раздел']) === 'Шкала'
      && norm(r['Дилер']) === dealer
      && norm(r['Категория']) === category
      && norm(r['Показатель']) === indicator
      && norm(r['Тир']) === tier);
    return rec ? rec['Значение'] : undefined;
  };

  // Оборудование: строка 16 (первый показатель) и все шесть тиров.
  const eqRows = records.filter((r) => norm(r['Раздел']) === 'Шкала'
    && norm(r['Дилер']) === dealer && norm(r['Категория']) === 'Оборудование'
    && Number(r['№ строки']) === 1);
  assert.ok(eqRows.length >= 6, 'у первого показателя оборудования шесть тиров');
  for (const rec of eqRows) {
    const coord = `${String.fromCharCode(65 + Number(rec['№ тира']))}16`;
    assert.equal(norm(cell('A16')), norm(rec['Показатель']), 'A16 — первый показатель');
    assert.equal(cell(coord), rec['Значение'], `${coord}: значение оборудования`);
    assert.equal(norm(cell(`${String.fromCharCode(65 + Number(rec['№ тира']))}15`)),
      norm(rec['Тир']), 'подпись тира в шапке');
  }

  // Сервис и строка ИТОГО оборудования.
  const svcTiers = records.filter((r) => norm(r['Раздел']) === 'Шкала'
    && norm(r['Дилер']) === dealer && norm(r['Категория']) === 'Сервис (ЗЧ)');
  for (const rec of svcTiers.slice(0, 6)) {
    const coord = `${String.fromCharCode(65 + Number(rec['№ тира']))}35`;
    assert.equal(cell(coord), rec['Значение'], `${coord}: значение сервиса`);
  }
  const totals = records.filter((r) => norm(r['Раздел']) === 'Шкала'
    && norm(r['Дилер']) === dealer && norm(r['Категория']) === 'Оборудование'
    && norm(r['Итог']) === 'да');
  assert.ok(totals.length >= 6, 'у оборудования есть строка ИТОГО');
  for (const rec of totals.slice(0, 6)) {
    const coord = `${String.fromCharCode(65 + Number(rec['№ тира']))}39`;
    assert.equal(cell(coord), rec['Значение'], `${coord}: ИТОГО в сравнении дилеров`);
  }
  assert.equal(norm(cell('A39')), dealer, 'первая строка сравнения — выбранный дилер');

  // План: шапка и первая строка.
  const planHeader = records.find((r) => norm(r['Раздел']) === 'План'
    && norm(r['Дилер']) === dealer && Number(r['№ строки']) === 1 && Number(r['№ тира']) === 1);
  assert.ok(planHeader, 'в плоской таблице есть план выбранного дилера');
  assert.equal(norm(cell('B7')), norm(planHeader['Показатель']), 'B7 — подпись первой колонки плана');
  assert.equal(cell('B8'), planHeader['Значение'], 'B8 — значение плана');
  assert.equal(valueOf('Оборудование', norm(cell('A16')), norm(cell('B15'))), cell('B16'),
    'значение витрины совпадает с плоской таблицей');
});

test('плоскую таблицу можно собрать вручную — парсер не привязан к нашему файлу', { skip }, () => {
  const api = loadCalculator();
  // Нарочно: другой набор колонок (без «Вкладка»/«Ячейка»), текст вместо числа
  // во второй строке сервиса и процент, записанный уже в процентах (16, а не 0.16).
  const rows = [
    ['Дилер', 'Тип', 'Раздел', 'Категория', 'Таблица', 'Показатель', '№ строки',
      'Итог', 'Тир', '№ тира', 'Тир от', 'Тир до', 'Значение', 'Единица'],
    ['Тестовый Дилер', 'РФ', 'План', 'Итого по дилеру', 'План и бонусы', 'Выручка 2024',
      1, null, null, 1, null, null, 1000, 'EUR'],
    ['Тестовый Дилер', 'РФ', 'Шкала', 'Оборудование', 'Оборудование — за квартал',
      'Базовое вознаграждение', 1, null, 'до 75', 1, null, null, 0.06, '%'],
    ['Тестовый Дилер', 'РФ', 'Шкала', 'Оборудование', 'Оборудование — за квартал',
      'Базовое вознаграждение', 1, null, '75 и более', 2, null, null, 0.08, '%'],
    ['Тестовый Дилер', 'РФ', 'Шкала', 'Оборудование', 'Оборудование — за квартал',
      'ИТОГО', 2, 'да', 'до 75', 1, null, null, 0.14, '%'],
    ['Тестовый Дилер', 'РФ', 'Шкала', 'Оборудование', 'Оборудование — за квартал',
      'ИТОГО', 2, 'да', '75 и более', 2, null, null, 16, '%'],
    ['Тестовый Дилер', 'РФ', 'Шкала', 'Сервис (ЗЧ)', 'Сервис (ЗЧ) — расчёт по парку оборудования',
      'Скидка по сервису', 1, 'да', '0–500', 1, 0, 500, 0.19, '%'],
    ['Тестовый Дилер', 'РФ', 'Шкала', 'Сервис (ЗЧ)', 'Сервис (ЗЧ) — расчёт по парку оборудования',
      'Скидка по сервису', 1, 'да', '501+', 2, 501, null, '21%', '%'],
  ];

  // Нормализация значений: доля, проценты и текст «21%» дают одно и то же.
  assert.equal(api.flatPct(0.16), 16);
  assert.equal(api.flatPct(16), 16);
  assert.equal(api.flatPct('21%'), 21);
  assert.equal(api.flatPct(0.06 * 1), 6, 'шум двоичной арифметики не должен портить процент');

  const header = api.findFlatHeader(rows);
  assert.ok(header, 'заголовки плоской таблицы найдены');
  assert.equal(header.headerRow, 0);

  const parsed = api.parseFlatScalesSheet(rows, header);
  assert.equal(parsed.dealers.length, 1, 'один дилер');
  assert.equal(parsed.values, 6, 'плановая строка в значения шкал не попала');
  const [dealer] = plain(parsed.dealers);
  assert.equal(dealer.dealerName, 'Тестовый Дилер');
  assert.equal(dealer.dealerType, 'РФ');
  assert.equal(dealer.scales.length, 2, 'оборудование и сервис');

  const [eq, svc] = dealer.scales;
  assert.equal(eq.title, 'Оборудование — за квартал');
  assert.deepEqual(eq.columns, ['до 75', '75 и более']);
  assert.deepEqual(eq.rows.map((r) => r.component), ['Базовое вознаграждение', 'ИТОГО']);
  assert.deepEqual(eq.rows[0].values, ['6%', '8%']);
  assert.deepEqual(eq.rows[1].values, ['14%', '16%'], 'процент, записанный процентами');
  assert.equal(eq.rows[1].isTotal, true);
  assert.equal(eq.rows[0].isTotal, false);
  assert.match(svc.title, /Сервис \(ЗЧ\)/);
  assert.deepEqual(svc.rows[0].values, ['19%', '21%'], 'текст «21%» разобрался как 21%');

  // Тот же разбор через общий вход: формат определён как плоская таблица.
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const buffer = XLSX.write({ SheetNames: [FLAT_SHEET], Sheets: { [FLAT_SHEET]: ws } },
    { type: 'array', bookType: 'xlsx' });
  const stats = {};
  api.parseDataSampleFiles(buf(PLAN), readFileSync(FACTS, 'utf8'), buffer, stats);
  assert.equal(stats.scalesFormat, 'flat');
  assert.equal(stats.scalesDealers, 1);
  assert.equal(stats.scalesValues, 6);
  assert.equal(stats.scalesBroken, 0);
});
