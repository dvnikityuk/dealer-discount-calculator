// Domain types for the dealer discount application

export type DealerType = "РФ" | "Заруб";

export type Quarter = 1 | 2 | 3 | 4;

/** Monthly fact values for one category (Сервис / Оборудование / Расход. мат.) */
export interface MonthlyFacts {
  /** 12 months indexed 0..11 (Апр..Мар — financial year starting in April) */
  months: (number | null)[];
}

export interface DealerData {
  id: string;
  name: string;
  type: DealerType;
  /** Annual plan: service / equipment / consumables */
  plan: {
    service: number;
    equipment: number;
    materials: number;
  };
  /** Facts per month for each category */
  facts: {
    service: MonthlyFacts;
    equipment: MonthlyFacts;
    materials: MonthlyFacts;
  };
  /** Service % scale (custom per dealer, default per scale) */
  servicePercent?: number | null;
  /** Per-dealer scale tables (extracted from XLSX sheet) */
  scales?: ScaleTable[];
}

export interface ScaleRow {
  component: string;
  values: (string | number)[]; // typically % strings like "6%"
  isTotal?: boolean;
}

export interface ScaleTable {
  title: string;
  /** Column headers (excluding the first "Компонент" column) */
  columns: string[];
  rows: ScaleRow[];
  /** Optional units label, e.g. "за квартал" / "за полугодие" */
  period?: string;
}

export interface AppState {
  quarter: Quarter;
  dealers: DealerData[];
  scales: ScaleTable[];
  /** ISO timestamp of last disk sync */
  lastSync: string | null;
}
