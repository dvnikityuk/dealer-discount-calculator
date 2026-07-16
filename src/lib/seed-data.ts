import type { AppState, DealerData, ScaleTable } from "./types";

// Financial year starts in April: Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec, Jan, Feb, Mar
export const MONTH_LABELS = [
  "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек", "Янв", "Фев", "Мар",
] as const;

/** Helper to build monthly facts from a 12-element array. `null` means "no data". */
function mf(values: (number | null)[]): { months: (number | null)[] } {
  if (values.length !== 12) throw new Error(`Expected 12 months, got ${values.length}`);
  return { months: values };
}

/** Initial 18 dealers extracted from the source application. */
const initialDealers: DealerData[] = [
  {
    id: "novapak",
    name: "НоваПак",
    type: "РФ",
    plan: { service: 365_000, equipment: 787_000, materials: 660_000 },
    facts: {
      service:      mf([12619, 24628, 18488, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, 1435, 64423, null, null, null, null, null, null, null, null, null]),
      materials:    mf([71293, 74870, 113044, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 17.0,
  },
  {
    id: "ksp",
    name: "КСП",
    type: "РФ",
    plan: { service: 305_000, equipment: 999_000, materials: 800_000 },
    facts: {
      service:      mf([5683, 18745, 19978, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, 25178, 28036, null, null, null, null, null, null, null, null, null]),
      materials:    mf([36210, 63105, 67403, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 15.0,
  },
  {
    id: "bogatov",
    name: "Богатов ТД",
    type: "РФ",
    plan: { service: 100_000, equipment: 650_000, materials: 900_000 },
    facts: {
      service:      mf([14321, 16754, 15576, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      materials:    mf([80234, 84520, 85982, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 15.0,
  },
  {
    id: "kompо",
    name: "КОМПО Технолоджис",
    type: "РФ",
    plan: { service: 480_438, equipment: 2_020_594, materials: 1_641_880 },
    facts: {
      service:      mf([33874, 33700, 34068, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, 125_140, 190_275, null, null, null, null, null, null, null, null, null]),
      materials:    mf([170_011, 175_678, 191_343, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 19.0,
  },
  {
    id: "abs",
    name: "ABS",
    type: "Заруб",
    plan: { service: 75_000, equipment: 700_000, materials: 400_000 },
    facts: {
      service:      mf([1420, null, null, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([47129, 47129, 47128, null, null, null, null, null, null, null, null, null]),
      materials:    mf([50745, 50745, 50744, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 10.0,
  },
  {
    id: "deling",
    name: "Deling Food",
    type: "Заруб",
    plan: { service: 75_000, equipment: 250_000, materials: 315_000 },
    facts: {
      service:      mf([12455, 12455, 12456, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      materials:    mf([35124, 35124, 35125, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 15.0,
  },
  {
    id: "vitline",
    name: "VitLine",
    type: "Заруб",
    plan: { service: 100_000, equipment: 315_000, materials: 900_000 },
    facts: {
      service:      mf([7597, 7597, 7596, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([15_541, 15_540, 15_541, null, null, null, null, null, null, null, null, null]),
      materials:    mf([53_037, 53_036, 53_037, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 13.0,
  },
  {
    id: "universal",
    name: "Universal Meat",
    type: "Заруб",
    plan: { service: 50_000, equipment: 200_000, materials: 250_000 },
    facts: {
      service:      mf([12754, 12754, 12754, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      materials:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 15.0,
  },
  {
    id: "kna",
    name: "KNA",
    type: "Заруб",
    plan: { service: 50_000, equipment: 150_000, materials: 150_000 },
    facts: {
      service:      mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([1419, 1419, 1420, null, null, null, null, null, null, null, null, null]),
      materials:    mf([18_583, 18_583, 18_582, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: null,
  },
  {
    id: "lucky",
    name: "LUCKY & S CO",
    type: "Заруб",
    plan: { service: 50_000, equipment: 400_000, materials: 150_000 },
    facts: {
      service:      mf([2442, 2442, 2442, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([5847, 5847, 5847, null, null, null, null, null, null, null, null, null]),
      materials:    mf([6188, 6188, 6188, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 11.0,
  },
  {
    id: "seitliyev",
    name: "Сейитлиев",
    type: "Заруб",
    plan: { service: 50_000, equipment: 75_000, materials: 560_000 },
    facts: {
      service:      mf([1505, 1505, 1506, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      materials:    mf([32_386, 32_386, 32_387, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 10.0,
  },
  {
    id: "ingreda",
    name: "Ingreda",
    type: "Заруб",
    plan: { service: 0, equipment: 75_000, materials: 130_000 },
    facts: {
      service:      mf([194, 195, 194, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      materials:    mf([8653, 8653, 8653, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 10.0,
  },
  {
    id: "clipsomac",
    name: "CLIPSOMAC",
    type: "Заруб",
    plan: { service: 0, equipment: 0, materials: 338_375 },
    facts: {
      service:      mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      materials:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: null,
  },
  {
    id: "tida",
    name: "Tida Tech",
    type: "Заруб",
    plan: { service: 3_068, equipment: 3_578, materials: 66_004 },
    facts: {
      service:      mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      materials:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: null,
  },
  {
    id: "kabiri",
    name: "Кабири Хучанд",
    type: "Заруб",
    plan: { service: 0, equipment: 75_000, materials: 75_000 },
    facts: {
      service:      mf([174, 174, 175, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([7098, 7098, 7098, null, null, null, null, null, null, null, null, null]),
      materials:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 10.0,
  },
  {
    id: "ari",
    name: "Ari Makina",
    type: "Заруб",
    plan: { service: 0, equipment: 104_744, materials: 0 },
    facts: {
      service:      mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      materials:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: null,
  },
  {
    id: "flexo",
    name: "Flexo Food",
    type: "Заруб",
    plan: { service: 0, equipment: 75_000, materials: 75_000 },
    facts: {
      service:      mf([445, 445, 445, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      materials:    mf([1722, 1722, 1721, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: 10.0,
  },
  {
    id: "ginap",
    name: "ГИНАП",
    type: "Заруб",
    plan: { service: 25_000, equipment: 75_000, materials: 75_000 },
    facts: {
      service:      mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      equipment:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
      materials:    mf([null, null, null, null, null, null, null, null, null, null, null, null]),
    },
    servicePercent: null,
  },
];

/** Seven scale tables (extracted from the source app's Шкалы tab). */
const initialScales: ScaleTable[] = [
  {
    title: "Оборудование — за квартал",
    columns: ["до 75", "75–114", "115–149", "150–189", "190–224", "225+"],
    rows: [
      { component: "Базовое вознаграждение", values: ["6%", "6%", "6%", "6%", "6%", "6%"] },
      { component: "Сервисный центр", values: ["6%", "6%", "6%", "6%", "6%", "6%"] },
      { component: "Гарантийное обслуживание", values: ["1%", "1%", "1%", "1%", "1%", "1%"] },
      { component: "Складские остатки (ретро)", values: ["1%", "1%", "1%", "1%", "1%", "1%"] },
      { component: "Объём закупок Оборудование", values: ["0%", "1%", "2%", "3%", "4%", "5%"] },
      { component: "ИТОГО", values: ["14%", "15%", "16%", "17%", "18%", "19%"], isTotal: true },
    ],
  },
  {
    title: "Расходные материалы — за квартал",
    columns: ["до 75", "75–115", "115–150", "150–190", "190–225", "225+"],
    rows: [
      { component: "Складские остатки Расход. мат.", values: ["1%", "1%", "1%", "1%", "1%", "1%"] },
      { component: "Объём закупок Расход. мат.", values: ["0%", "1%", "2%", "3%", "4%", "5%"] },
      { component: "ИТОГО", values: ["1%", "2%", "3%", "4%", "5%", "6%"], isTotal: true },
    ],
  },
  {
    title: "Сервис (ЗЧ) — расчёт по парку оборудования",
    columns: ["до 75", "75–114", "115–149", "150–189", "190–224", "225+"],
    rows: [
      { component: "Базовое вознаграждение", values: ["6%", "6%", "6%", "6%", "6%", "6%"] },
      { component: "Сервис + гарантия", values: ["1%", "1%", "1%", "1%", "1%", "1%"] },
      { component: "Объём закупок", values: ["7%", "9%", "10%", "11%", "12%", "13%"] },
      { component: "ИТОГО", values: ["14%", "16%", "17%", "18%", "19%", "20%"], isTotal: true },
    ],
  },
  {
    title: "Система контроля (штрафы)",
    columns: ["до 24", "25–34", "35–44", "45–54", "55–64", "65+"],
    rows: [
      { component: "Объём закупок Расход. мат.", values: ["0%", "1%", "2%", "3%", "4%", "5%"] },
    ],
  },
  {
    title: "Оборудование — за полугодие",
    columns: ["до 75", "75–114", "115–149", "150–189", "190–224", "225+"],
    rows: [
      { component: "Базовое вознаграждение", values: ["6%", "6%", "6%", "6%", "6%", "6%"] },
      { component: "Сервисный центр", values: ["6%", "6%", "6%", "6%", "6%", "6%"] },
      { component: "Гарантийное обслуживание", values: ["1%", "1%", "1%", "1%", "1%", "1%"] },
      { component: "Складские остатки (ретро)", values: ["1%", "1%", "1%", "1%", "1%", "1%"] },
      { component: "Объём закупок Оборудование", values: ["0%", "1%", "2%", "3%", "4%", "5%"] },
      { component: "ИТОГО", values: ["14%", "15%", "16%", "17%", "18%", "19%"], isTotal: true },
    ],
  },
  {
    title: "Расходные материалы — за полугодие",
    columns: ["до 75", "75–115", "115–150", "150–190", "190–225", "225+"],
    rows: [
      { component: "Складские остатки Расход. мат.", values: ["1%", "1%", "1%", "1%", "1%", "1%"] },
      { component: "Объём закупок Расход. мат.", values: ["0%", "1%", "2%", "3%", "4%", "5%"] },
      { component: "ИТОГО", values: ["1%", "2%", "3%", "4%", "5%", "6%"], isTotal: true },
    ],
  },
  {
    title: "Сервис (ЗЧ) — абсолютные отгрузки за 12 месяцев",
    columns: ["до 75", "75–114", "115–149", "150–189", "190–224", "225+"],
    rows: [
      { component: "Базовое вознаграждение", values: ["6%", "6%", "6%", "6%", "6%", "6%"] },
      { component: "Сервис + гарантия", values: ["1%", "1%", "1%", "1%", "1%", "1%"] },
      { component: "Объём закупок", values: ["7%", "9%", "10%", "11%", "12%", "13%"] },
      { component: "ИТОГО", values: ["14%", "16%", "17%", "18%", "19%", "20%"], isTotal: true },
    ],
  },
];

export function buildInitialState(): AppState {
  return {
    quarter: 1,
    dealers: initialDealers,
    scales: initialScales,
    lastSync: null,
  };
}
