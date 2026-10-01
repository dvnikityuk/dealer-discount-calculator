import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.ok(inlineScripts.length, 'docs/index.html should contain the calculator script');

// Load the calculator functions without running the page's DOM/bootstrap code.
let calculatorSource = inlineScripts.at(-1)[1];
const bootstrapStart = calculatorSource.indexOf(
  "document.getElementById('quarter-select').addEventListener",
);
assert.notEqual(bootstrapStart, -1, 'calculator bootstrap marker should exist');
calculatorSource = `${calculatorSource.slice(0, bootstrapStart)}

globalThis.__serviceDiscountTestApi = {
  calcServiceDiscountPct,
  getServiceDiscountPctNormalized,
  findTierColumn,
};`;

const context = vm.createContext({});
new vm.Script(calculatorSource, { filename: 'docs/index.html' }).runInContext(context);
const { calcServiceDiscountPct, getServiceDiscountPctNormalized, findTierColumn } =
  context.__serviceDiscountTestApi;

function makeForeignDealer({ title, columns, values, months }) {
  return {
    type: 'Заруб',
    facts: {
      service: { months },
      equipment: { months: Array(12).fill(null) },
      materials: { months: Array(12).fill(null) },
    },
    scales: [
      {
        title,
        columns,
        rows: [{ component: '% скидки', values }],
      },
    ],
  };
}

const yearOfMonthlyFacts = Array(12).fill(300);

test('NovaPak gets 30% from the service scale when accumulated service facts exceed 3,000 EUR', () => {
  const dealer = {
    name: 'НоваПак',
    type: 'РФ',
    facts: {
      service: { months: [12619, 24628, 18488, null, null, null, null, null, null, null, null, null] },
      equipment: { months: Array(12).fill(null) },
      materials: { months: Array(12).fill(null) },
    },
    scales: [
      {
        title: 'Оборудование — за квартал',
        columns: ['до 75', '75–114', '115+'],
        rows: [{ component: 'ИТОГО по МП', values: ['14%', '15%', '16%'] }],
      },
      {
        title: 'Сервис (ЗЧ) — расчёт по парку оборудования',
        columns: ['0–500', '501–1000', '1001–1800', '1801–2400', '2401–3000', 'от 3001'],
        rows: [{
          component: 'Скидка по сервису',
          values: ['0.19%', '0.21%', '0.23%', '0.25%', '0.27%', '0.3%'],
        }],
      },
    ],
  };

  assert.equal(getServiceDiscountPctNormalized(dealer, 1), 30);
});

test('six-month service scale uses only the selected half-year', () => {
  const dealer = makeForeignDealer({
    title: 'Сервис (ЗЧ) — абсолютные отгрузки за 6 месяцев',
    columns: ['0–1000', '1001–2500', '2501+'],
    values: ['5%', '10%', '15%'],
    months: yearOfMonthlyFacts,
  });

  // Q1/Q3 are interim; Q2/Q4 are the full corresponding half-year.
  assert.equal(calcServiceDiscountPct(dealer, 1), 5); // 900 €
  assert.equal(calcServiceDiscountPct(dealer, 2), 10); // 1,800 €, not the full-year 3,600 €
  assert.equal(calcServiceDiscountPct(dealer, 3), 5); // 900 €
  assert.equal(calcServiceDiscountPct(dealer, 4), 10); // 1,800 €, not the full-year 3,600 €
});

test('twelve-month service scale continues to use the financial-year total', () => {
  const dealer = makeForeignDealer({
    title: 'Сервис (ЗЧ) — абсолютные отгрузки за 12 месяцев',
    columns: ['0–2000', '2001+'],
    values: ['10%', '20%'],
    months: yearOfMonthlyFacts,
  });

  // Even at Q2, the twelve-month scale is compared with all 12 months.
  assert.equal(calcServiceDiscountPct(dealer, 2), 20);
  assert.equal(getServiceDiscountPctNormalized(dealer, 2), 20);
});

test('a fractional amount in a gap between integer tiers stays in the lower tier', () => {
  const columns = ['0–7000', '7001–19000', '19001+'];

  assert.equal(findTierColumn(columns, 7000.5), 0);
  assert.equal(findTierColumn(columns, 7001), 1);
  assert.equal(findTierColumn(columns, 20000), 2);
});
