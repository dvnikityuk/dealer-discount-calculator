"use client";

import type { DealerData } from "@/lib/types";
import { fmt, sumYear } from "@/lib/calc";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, FileSpreadsheet, FileText, HardDrive, ExternalLink, Cloud, CheckCircle2, Clock } from "lucide-react";
import { useEffect, useState } from "react";

interface Props {
  dealers: DealerData[];
  onSync: () => Promise<void>;
  onUploadPlans: () => void;
  onUploadFacts: () => void;
  syncing: boolean;
  uploading: boolean;
  lastSync: string | null;
  driveUrl: string;
}

export function DataTab({ dealers, onSync, onUploadPlans, onUploadFacts, syncing, uploading, lastSync, driveUrl }: Props) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  return (
    <div className="space-y-6">
      {/* ─── Status cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <Cloud className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">Google Drive — источник</h3>
                <p className="text-xs text-gray-500 mt-1 mb-3">
                  Исходные файлы (XLSX с планами и шкалами + CSV с фактами) хранятся в Google Drive.
                  Откройте папку, чтобы скачать последние версии файлов.
                </p>
                <a href={driveUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">
                    <ExternalLink className="size-4 mr-1.5" /> Открыть папку Drive
                  </Button>
                </a>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">
                <HardDrive className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">Локальный диск — кэш</h3>
                <p className="text-xs text-gray-500 mt-1 mb-3">
                  После загрузки файлов они сохраняются в <code className="px-1 py-0.5 bg-gray-100 rounded">data/uploads/</code> и
                  автоматически парсятся. Кнопка «Синхронизировать» перечитывает файлы с диска.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="default" size="sm" onClick={() => void onSync()} disabled={syncing}
                    className="bg-emerald-600 hover:bg-emerald-700">
                    {syncing ? <RefreshCw className="size-4 mr-1.5 animate-spin" /> : <RefreshCw className="size-4 mr-1.5" />}
                    {syncing ? "Синхронизация..." : "Синхронизировать"}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Upload buttons ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-semibold text-base">Загрузка файлов</CardTitle>
          <CardDescription>Загрузите новые версии файлов XLSX и CSV. После загрузки данные автоматически пересчитываются.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={onUploadPlans} disabled={uploading}>
              <FileSpreadsheet className="size-4 mr-1.5" />
              {uploading ? "Загрузка..." : "Загрузить XLSX (планы + шкалы)"}
            </Button>
            <Button variant="outline" size="sm" onClick={onUploadFacts} disabled={uploading}>
              <FileText className="size-4 mr-1.5" />
              {uploading ? "Загрузка..." : "Загрузить CSV (факты)"}
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
            {mounted && lastSync ? (
              <>
                <CheckCircle2 className="size-4 text-emerald-500" />
                Последняя синхр.: {new Date(lastSync).toLocaleString("ru-RU")}
              </>
            ) : (
              <>
                <Clock className="size-4 text-gray-400" />
                Синхронизация ещё не выполнялась
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Plans table ───────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="font-semibold text-base">Годовой план по дилерам</CardTitle>
          <CardDescription>Плановые показатели на финансовый год по каждой категории</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full overflow-auto thin-scroll" style={{ maxHeight: "60vh" }}>
            <style>{`
              .thin-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
              .thin-scroll::-webkit-scrollbar-track { background: #f1f5f9; }
              .thin-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
              .thin-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
              .thin-scroll * { scrollbar-width: thin; scrollbar-color: #cbd5e1 #f1f5f9; }
            `}</style>
            <div style={{ minWidth: "760px" }}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="min-w-[160px] text-xs whitespace-nowrap">Дилер</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Тип</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">План Сервис (год)</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">План Оборуд. (год)</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">План Расход. мат. (год)</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">Итого план</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">В мес.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dealers.map((d) => {
                    const total = d.plan.service + d.plan.equipment + d.plan.materials;
                    return (
                      <TableRow key={d.id} className="hover:bg-gray-50/60">
                        <TableCell className="font-medium text-xs text-gray-900 whitespace-nowrap">{d.name}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {d.type === "РФ" ? (
                            <Badge variant="default" className="text-[10px] px-1.5 py-0">РФ</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Заруб</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">{fmt(d.plan.service)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">{fmt(d.plan.equipment)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">{fmt(d.plan.materials)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-semibold whitespace-nowrap">{fmt(total)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-gray-600 whitespace-nowrap">{fmt(Math.round(total / 12))}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Facts presence table ──────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="font-semibold text-base">Наличие фактических данных</CardTitle>
          <CardDescription>Суммарные фактические отгрузки за 12 месяцев финансового года</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full overflow-auto thin-scroll" style={{ maxHeight: "60vh" }}>
            <div style={{ minWidth: "880px" }}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="min-w-[160px] text-xs whitespace-nowrap">Дилер</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Тип</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">План Сервис</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">План Оборуд.</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">План Расход. мат.</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">Факт Сервис</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">Факт Оборуд.</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">Факт Расход. мат.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dealers.map((d) => {
                    const svcTotal = sumYear(d.facts.service.months);
                    const eqTotal = sumYear(d.facts.equipment.months);
                    const matTotal = sumYear(d.facts.materials.months);
                    return (
                      <TableRow key={d.id} className="hover:bg-gray-50/60">
                        <TableCell className="font-medium text-xs text-gray-900 whitespace-nowrap">{d.name}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {d.type === "РФ" ? (
                            <Badge variant="default" className="text-[10px] px-1.5 py-0">РФ</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Заруб</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">{fmt(d.plan.service)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">{fmt(d.plan.equipment)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">{fmt(d.plan.materials)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">{fmt(svcTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">{fmt(eqTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">{fmt(matTotal)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
