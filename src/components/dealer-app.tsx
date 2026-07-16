"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import type { AppState, Quarter } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Download, Cloud, Calculator, Building2, Scale, Database,
  ChartColumn,
} from "lucide-react";
import { SummaryTab } from "./summary-tab";
import { DealerTab } from "./dealer-tab";
import { ScalesTab } from "./scales-tab";
import { DataTab } from "./data-tab";
import { toast } from "sonner";
import {
  quarterlyFactsByCategory, quarterlyPlan,
} from "@/lib/calc";

interface Props {
  initialState: AppState;
}

// Google Drive folder URL provided by user (for dealer source files)
const DRIVE_FOLDER_URL = "https://drive.google.com/drive/u/0/folders/1DwdtnqNPK_Q28g3b4zMek5umGqqXU2Mz";

export function DealerApp({ initialState }: Props) {
  const [state, setState] = useState<AppState>(initialState);
  const [tab, setTab] = useState<"summary" | "dealer" | "scales" | "upload">("summary");
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mounted, setMounted] = useState(false);

  const factsInputRef = useRef<HTMLInputElement>(null);
  const plansInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setState(initialState); }, [initialState]);

  // ─── KPI calculations (memoised) ─────────────────────────────────────────
  const kpis = useMemo(() => {
    const q = state.quarter;
    const rfCount = state.dealers.filter((d) => d.type === "РФ").length;
    const foreignCount = state.dealers.filter((d) => d.type === "Заруб").length;

    let planTotal = 0;
    let factTotal = 0;
    let dealersWithFacts = 0;
    const execs: number[] = [];

    for (const d of state.dealers) {
      const plan = quarterlyPlan(d, q);
      const facts = quarterlyFactsByCategory(d, q);
      const factSum = (facts.service ?? 0) + (facts.equipment ?? 0) + (facts.materials ?? 0);
      const hasFact = facts.service !== null || facts.equipment !== null || facts.materials !== null;

      planTotal += plan;
      if (hasFact) {
        factTotal += factSum;
        dealersWithFacts++;
        if (plan > 0) execs.push((factSum / plan) * 100);
      }
    }

    const avgExec = execs.length > 0 ? execs.reduce((a, b) => a + b, 0) / execs.length : 0;
    return { rfCount, foreignCount, planTotal, factTotal, dealersWithFacts, avgExec };
  }, [state.dealers, state.quarter]);

  const quarterMonthRange = useMemo(() => {
    const ranges: Record<Quarter, string> = {
      1: "апр–июн",
      2: "июл–сен",
      3: "окт–дек",
      4: "янв–мар",
    };
    return ranges[state.quarter];
  }, [state.quarter]);

  // Half-year range for foreign dealers (Q1+Q2 = H1, Q3+Q4 = H2)
  const halfYearMonthRange = useMemo(() => {
    return state.quarter <= 2 ? "апр–сен" : "окт–мар";
  }, [state.quarter]);

  // ─── Action handlers ─────────────────────────────────────────────────────
  const handleQuarterChange = async (v: string) => {
    const q = Number(v) as Quarter;
    setState((s) => ({ ...s, quarter: q }));
    try {
      await fetch("/api/quarter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quarter: q }),
      });
    } catch (err) {
      console.error("Quarter change failed:", err);
      toast.error("Не удалось сменить квартал");
    }
  };

  const handleExcel = () => {
    window.location.href = `/api/excel?q=${state.quarter}`;
  };

  const handleDiskSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/drive/sync", { method: "POST", cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        // Drive-sync results
        const pulled = data.drive?.pulled ?? [];
        const skipped = data.drive?.skipped ?? [];
        const driveErr = data.drive?.error;
        let msg = `Синхронизировано. Дилеров: ${data.dealerCount}`;
        if (pulled.length > 0) {
          msg += `. Из Drive загружено: ${pulled.map((p: { name: string }) => p.name).join(", ")}`;
        }
        if (skipped.length > 0) {
          msg += `. Пропущено: ${skipped.length}`;
        }
        if (driveErr) {
          toast.warning(`Drive: ${driveErr}`);
        }
        toast.success(msg);
        window.location.reload();
      } else {
        toast.error("Ошибка синхронизации: " + (data.error ?? "unknown"));
      }
    } catch (err) {
      console.error("Disk sync failed:", err);
      toast.error("Сетевая ошибка при синхронизации");
    } finally {
      setSyncing(false);
    }
  };

  const handleUploadClick = (which: "facts" | "plans") => {
    if (which === "facts") factsInputRef.current?.click();
    else plansInputRef.current?.click();
  };

  const handleFileSelected = async (which: "facts" | "plans", file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append(which, file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Файл загружен: ${file.name}. Дилеров: ${data.dealerCount}`);
        window.location.reload();
      } else {
        toast.error("Ошибка загрузки: " + (data.error ?? "unknown"));
      }
    } catch (err) {
      console.error("Upload failed:", err);
      toast.error("Сетевая ошибка при загрузке");
    } finally {
      setUploading(false);
    }
  };

  const hiddenInputs = (
    <>
      <input
        ref={factsInputRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(e) => handleFileSelected("facts", e.target.files?.[0])}
      />
      <input
        ref={plansInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => handleFileSelected("plans", e.target.files?.[0])}
      />
    </>
  );

  return (
    <div className="min-h-screen flex flex-col bg-gray-50" suppressHydrationWarning>
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 shadow-sm print:hidden">
        <div className="w-full px-3 sm:px-4 lg:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Calculator className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Расчёт скидок дилеров</h1>
                <p className="text-sm text-gray-500">Условия работы ТПС 2026 ф.г. • КОМПО</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Select value={String(state.quarter)} onValueChange={handleQuarterChange}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 квартал</SelectItem>
                  <SelectItem value="2">2 квартал</SelectItem>
                  <SelectItem value="3">3 квартал</SelectItem>
                  <SelectItem value="4">4 квартал</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" onClick={handleExcel}>
                <Download className="size-4 mr-1.5" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleDiskSync()} disabled={syncing}>
                <Cloud className="size-4 mr-1.5" />
                {syncing ? "Синхр…" : "Диск"}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* ─── Main ──────────────────────────────────────────────────────── */}
      <main className="flex-1 w-full mx-auto px-3 sm:px-4 lg:px-6 py-4 lg:py-6 print:hidden">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full max-w-lg mb-6 grid-cols-4">
            <TabsTrigger value="summary" className="gap-1">
              <ChartColumn className="size-4" />
              <span className="hidden sm:inline">Сводная</span>
            </TabsTrigger>
            <TabsTrigger value="dealer" className="gap-1">
              <Building2 className="size-4" />
              <span className="hidden sm:inline">Дилер</span>
            </TabsTrigger>
            <TabsTrigger value="scales" className="gap-1">
              <Scale className="size-4" />
              <span className="hidden sm:inline">Шкалы</span>
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-1">
              <Database className="size-4" />
              <span className="hidden sm:inline">Данные</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-0">
            <SummaryTab
              dealers={state.dealers}
              quarter={state.quarter}
              kpis={kpis}
              quarterMonthRange={quarterMonthRange}
              halfYearMonthRange={halfYearMonthRange}
            />
          </TabsContent>

          <TabsContent value="dealer" className="mt-0">
            <DealerTab
              dealers={state.dealers}
              quarter={state.quarter}
              quarterMonthRange={quarterMonthRange}
            />
          </TabsContent>

          <TabsContent value="scales" className="mt-0">
            <ScalesTab
              scales={state.dealers.flatMap((d) => d.scales ?? []).filter((s, i, arr) =>
                arr.findIndex((x) => x.title === s.title) === i
              )}
              dealers={state.dealers}
              quarter={state.quarter}
            />
          </TabsContent>

          <TabsContent value="upload" className="mt-0">
            <DataTab
              dealers={state.dealers}
              syncing={syncing}
              uploading={uploading}
              lastSync={mounted ? state.lastSync : null}
              driveUrl={DRIVE_FOLDER_URL}
              onSync={async () => { await handleDiskSync(); }}
              onUploadPlans={() => handleUploadClick("plans")}
              onUploadFacts={() => handleUploadClick("facts")}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* ─── Footer ────────────────────────────────────────────────────── */}
      <footer className="mt-auto bg-white border-t border-gray-200 py-3 print:hidden">
        <div className="w-full px-3 sm:px-4 lg:px-6">
          <p className="text-center text-xs text-gray-400">
            Расчёт скидок дилеров • Условия работы ТПС 2026 ф.г. • КОМПО
          </p>
        </div>
      </footer>

      {hiddenInputs}
    </div>
  );
}
