"use client";

import { useState } from "react";
import type { DealerData } from "@/lib/types";
import { MONTH_LABELS, fmt, sumYear } from "@/lib/calc";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface Props {
  dealer: DealerData | null;
  onClose: () => void;
  onSave: (data: {
    name: string;
    type: "РФ" | "Заруб";
    plan: { service: number; equipment: number; materials: number };
    facts: {
      service: (number | null)[];
      equipment: (number | null)[];
      materials: (number | null)[];
    };
    servicePercent: number | null;
  }) => Promise<void>;
}

function num(s: string): number | null {
  const t = s.trim();
  if (t === "" || t === "—" || t === "нет данных") return null;
  const n = Number(t.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function DealerEditDialog({ dealer, onClose, onSave }: Props) {
  const isNew = !dealer;
  const [name, setName] = useState(dealer?.name ?? "");
  const [type, setType] = useState<"РФ" | "Заруб">(dealer?.type ?? "РФ");
  const [planService, setPlanService] = useState(dealer?.plan.service?.toString() ?? "0");
  const [planEquipment, setPlanEquipment] = useState(dealer?.plan.equipment?.toString() ?? "0");
  const [planMaterials, setPlanMaterials] = useState(dealer?.plan.materials?.toString() ?? "0");
  const [servicePct, setServicePct] = useState(
    dealer?.servicePercent !== undefined && dealer.servicePercent !== null
      ? dealer.servicePercent.toString()
      : "",
  );

  // Monthly facts — flat array of 12 strings per category
  const initMonths = (m: (number | null)[] | undefined) =>
    Array.from({ length: 12 }, (_, i) => (m && m[i] !== null ? String(m[i]) : ""));
  const [serviceMonths, setServiceMonths] = useState<string[]>(() => initMonths(dealer?.facts.service.months));
  const [equipmentMonths, setEquipmentMonths] = useState<string[]>(() => initMonths(dealer?.facts.equipment.months));
  const [materialsMonths, setMaterialsMonths] = useState<string[]>(() => initMonths(dealer?.facts.materials.months));

  // NOTE: parent must pass a `key` so the dialog remounts when `dealer` changes — this
  // guarantees the useState initializers above run fresh and we don't need a useEffect.

  const handleSave = async () => {
    await onSave({
      name: name.trim() || "Без названия",
      type,
      plan: {
        service: Number(planService) || 0,
        equipment: Number(planEquipment) || 0,
        materials: Number(planMaterials) || 0,
      },
      facts: {
        service: serviceMonths.map(num),
        equipment: equipmentMonths.map(num),
        materials: materialsMonths.map(num),
      },
      servicePercent: servicePct.trim() === "" ? null : Number(servicePct),
    });
  };

  const setMonth = (
    arr: string[], setArr: (v: string[]) => void, i: number, v: string,
  ) => {
    const next = [...arr];
    next[i] = v;
    setArr(next);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Новый дилер" : `Редактировать — ${dealer!.name}`}</DialogTitle>
          <DialogDescription>
            Укажите план на год и фактические помесячные отгрузки. Пустое поле = нет данных.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 py-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label>Название</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Тип</Label>
            <Select value={type} onValueChange={(v) => setType(v as "РФ" | "Заруб")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="РФ">РФ</SelectItem>
                <SelectItem value="Заруб">Заруб</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>План Сервис (год)</Label>
            <Input inputMode="numeric" value={planService} onChange={(e) => setPlanService(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>План Оборуд. (год)</Label>
            <Input inputMode="numeric" value={planEquipment} onChange={(e) => setPlanEquipment(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>План Расход. мат. (год)</Label>
            <Input inputMode="numeric" value={planMaterials} onChange={(e) => setPlanMaterials(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Сервис % (для скидки)</Label>
            <Input inputMode="decimal" placeholder="напр. 14.0" value={servicePct} onChange={(e) => setServicePct(e.target.value)} />
          </div>
        </div>

        {/* Monthly facts table */}
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card">Кат.</TableHead>
                {MONTH_LABELS.map((m) => <TableHead key={m} className="text-center min-w-[80px]">{m}</TableHead>)}
                <TableHead className="text-center">Год</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {([
                { label: "Сервис", arr: serviceMonths, set: setServiceMonths },
                { label: "Оборудование", arr: equipmentMonths, set: setEquipmentMonths },
                { label: "Расход. мат.", arr: materialsMonths, set: setMaterialsMonths },
              ] as const).map(({ label, arr, set }) => {
                const year = sumYear(arr.map(num));
                return (
                  <TableRow key={label}>
                    <TableCell className="sticky left-0 bg-card font-medium">{label}</TableCell>
                    {arr.map((v, i) => (
                      <TableCell key={i} className="p-1">
                        <Input
                          className="h-8 text-center text-xs"
                          inputMode="numeric"
                          value={v}
                          onChange={(e) => setMonth(arr, set, i, e.target.value)}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-center font-semibold">{fmt(year)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave}>Сохранить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
