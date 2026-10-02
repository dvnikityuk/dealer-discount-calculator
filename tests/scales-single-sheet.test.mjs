import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);

const SCALES_SINGLE = new URL('../docs/data_sample/scales.xlsx', import.meta.url);
const SCALES_LEGACY = new URL('../docs/data_sample/legacy/scales_multisheet_2026.xlsx', import.meta.url);
const PLAN = new URL('../docs/data_sample/plan.xlsx', import.meta.url);
const FACTS = new URL('../docs/data_sample/fact.csv', import.meta.url);

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

globalThis.__calcTestApi = { parseDataSampleFiles, splitDealerBlocks, markerDealerName };`;
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

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Значения приходят из vm-контекста (другой realm), поэтому перед сравнением
// приводим их к обычным массивам/объектам текущего контекста.
const plain = (v) => JSON.parse(JSON.stringify(v));
const pctOf = (v) => {
  const n = Number(String(v).replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

test('единый лист «Шкалы» даёт калькулятору ровно то же состояние, что и 18 вкладок', { skip }, () => {
  assert.ok(existsSync(SCALES_LEGACY), 'нужна резервная копия исходного файла');
  const api = loadCalculator();

  const single = parseState(api, SCALES_SINGLE);
  const legacy = parseState(api, SCALES_LEGACY);

  assert.equal(single.stats.scalesFormat, 'single-sheet', 'новый файл должен читаться как единый лист');
  assert.equal(legacy.stats.scalesFormat, 'multi-sheet', 'старый формат продолжает поддерживаться');
  assert.equal(single.stats.scalesBroken, 0, 'все блоки единого листа должны разбираться');
  assert.equal(single.stats.scalesBlocks, legacy.stats.scalesBlocks, 'число разобранных блоков');
  assert.equal(single.state.dealers.length, 18);

  // Полное совпадение состояния: дилеры, планы, факты и все шкалы.
  assert.deepEqual(
    JSON.parse(JSON.stringify(single.state)),
    JSON.parse(JSON.stringify(legacy.state)),
    'состояние из единого листа должно байт-в-байт совпадать с состоянием из 18 вкладок',
  );
});

test('у всех 18 дилеров есть три шкалы, включая скрытые вкладки-дилеры', { skip }, () => {
  const api = loadCalculator();
  const { state } = parseState(api, SCALES_SINGLE);

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
  // они обязаны остаться в едином листе и участвовать в расчёте.
  for (const name of ['CLIPSOMAC, Алжир', 'Tida Tech, Таиланд', 'Ari Makina, Турция']) {
    const dealer = byName[norm(name)];
    assert.ok(dealer, `дилер ${name} потерялся`);
    assert.match(dealer.scales[2].title, /за 6 месяцев/,
      `${name}: шкала сервиса за 6 месяцев`);
  }
});

test('значения шкал в едином листе совпадают с исходными вкладками (контрольные точки)', { skip }, () => {
  const api = loadCalculator();
  const { state } = parseState(api, SCALES_SINGLE);
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

test('строки-маркеры: 18 блоков «### ДИЛЕР» и справочный лист помечен «### РЕЕСТР»', { skip }, () => {
  const api = loadCalculator();
  const wb = XLSX.read(buf(SCALES_SINGLE), { type: 'array' });
  assert.deepEqual(plain(wb.SheetNames), ['Шкалы', 'Реестр']);

  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Шкалы'], { header: 1, defval: null });
  const blocks = api.splitDealerBlocks(rows);
  const dealerBlocks = blocks.filter((b) => b.kind === 'dealer');
  assert.equal(dealerBlocks.length, 18, 'блоков дилеров на листе «Шкалы»');
  assert.ok(dealerBlocks.every((b) => b.marker && /^###\s*ДИЛЕР/i.test(b.marker)));
  // Имя в маркере = имя в блоке (по нему сопоставление с plan.xlsx).
  const { state } = parseState(api, SCALES_SINGLE);
  const markerNames = dealerBlocks.map((b) => norm(api.markerDealerName(b.marker)));
  for (const dealer of state.dealers) {
    assert.ok(markerNames.includes(norm(dealer.name)),
      `в маркерах нет имени ${dealer.name}`);
  }

  const regRows = XLSX.utils.sheet_to_json(wb.Sheets['Реестр'], { header: 1, defval: null });
  assert.match(String(regRows[0][0]), /^###\s*РЕЕСТР/i, 'лист «Реестр» должен быть помечен');
  assert.equal(api.splitDealerBlocks(regRows).filter((b) => b.kind === 'dealer').length, 0,
    'справочный лист не должен разбираться как дилеры');
});

test('реестр описывает все значения шкал, которые читает калькулятор', { skip }, () => {
  const api = loadCalculator();
  const { state } = parseState(api, SCALES_SINGLE);

  const wb = XLSX.read(buf(SCALES_SINGLE), { type: 'array' });
  // Строка 1 листа «Реестр» — маркер «### РЕЕСТР», заголовки таблицы — строка 2.
  const registry = XLSX.utils.sheet_to_json(wb.Sheets['Реестр'], { range: 1, defval: null });
  assert.ok(registry.length > 1000, `в реестре должно быть много строк, есть ${registry.length}`);

  const tableKey = (title) => {
    if (/^Оборудование/i.test(title)) return 'Оборудование';
    if (/^Расходные материалы/i.test(title)) return 'Расходные материалы';
    if (/^Сервис \(ЗЧ\)/i.test(title)) return 'Сервис (ЗЧ)';
    return title;
  };
  // Индекс «полный ключ» — для таблиц оборудования/РМ: имя строки в реестре такое
  // же, как в файле. Для шкал сервиса калькулятор подставляет своё имя строки
  // («Скидка по сервису»), поэтому там сопоставляем по дилеру, таблице и тиру.
  const fullIndex = new Map();
  const tierIndex = new Map();
  for (const row of registry) {
    const dealer = norm(row['Дилер']);
    const table = tableKey(norm(row['Таблица']));
    const tier = norm(row['Тир / показатель']);
    fullIndex.set([dealer, table, norm(row['Строка / компонент']), tier].join('::'), row);
    if (table === 'Сервис (ЗЧ)' && tier) {
      const shortKey = [dealer, table, tier].join('::');
      assert.ok(!tierIndex.has(shortKey), `реестр: неоднозначный тир ${shortKey}`);
      tierIndex.set(shortKey, row);
    }
  }

  let compared = 0;
  for (const dealer of state.dealers) {
    for (const scale of dealer.scales) {
      const key = tableKey(scale.title);
      const isService = key === 'Сервис (ЗЧ)';
      for (const row of scale.rows) {
        scale.columns.forEach((tier, i) => {
          const value = row.values[i];
          if (!value) return;
          const rec = isService
            ? tierIndex.get([norm(dealer.name), key, norm(tier)].join('::'))
            : fullIndex.get([norm(dealer.name), key, norm(row.component), norm(tier)].join('::'));
          assert.ok(rec,
            `реестр: нет записи ${dealer.name} / ${key} / ${row.component} / ${tier}`);
          assert.equal(Number(rec['Скидка, %']), pctOf(value),
            `реестр: ${dealer.name} / ${key} / ${row.component} / ${tier}`);
          assert.ok(rec['Ячейка в «Шкалы»'], 'у записи реестра должен быть адрес ячейки');
          if (isService) {
            assert.match(norm(rec['Строка / компонент']), /диапазон отношения|отгрузки в диапазоне/,
              `${dealer.name}: строка шкалы сервиса в реестре`);
          }
          compared++;
        });
      }
    }
  }
  assert.ok(compared > 700, `сверено слишком мало значений реестра: ${compared}`);
});
