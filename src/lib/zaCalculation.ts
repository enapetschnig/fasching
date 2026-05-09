import { getNormalWorkingHours, isWorkingDay } from "./workingHours";

export interface TimeEntryForZa {
  datum: string;
  stunden: number | string;
  taetigkeit: string | null;
}

export interface ZaAdjustment {
  hours: number | string;
  reason?: string | null;
  created_at?: string;
  adjusted_by?: string | null;
}

export interface MonthKey {
  year: number;
  month: number; // 1-12
}

export interface MonthlyZa {
  year: number;
  month: number;
  earned: number;
  used: number;
  net: number;
  complete: boolean;
  missingDays: string[];
  monthOver: boolean;
}

export interface ZaBalance {
  bookedEarned: number;
  bookedUsed: number;
  bookedNet: number;
  adjustments: number;
  balance: number;
  currentMonth: MonthlyZa | null;
}

const ABSENCE_TAETIGKEITEN = ["Urlaub", "Krankenstand", "Weiterbildung", "Arztbesuch"];

export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseLocalDate(datum: string): Date {
  return new Date(datum + "T00:00:00");
}

export function getExpectedWorkdays(year: number, month: number, until: Date): string[] {
  const lastDay = new Date(year, month, 0);
  const endCheck = lastDay < until ? lastDay : until;
  const result: string[] = [];
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateObj = new Date(year, month - 1, d);
    if (dateObj > endCheck) break;
    if (isWorkingDay(dateObj)) {
      result.push(formatLocalDate(dateObj));
    }
  }
  return result;
}

export function computeMonthlyZa(
  entries: TimeEntryForZa[],
  year: number,
  month: number,
  today: Date = new Date()
): MonthlyZa {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0);
  const monthEnd = formatLocalDate(lastDay);

  const monthEntries = entries.filter((e) => e.datum >= monthStart && e.datum <= monthEnd);

  let used = 0;
  const byDay: Record<string, { total: number; hasAbsence: boolean }> = {};
  for (const e of monthEntries) {
    const h = Number(e.stunden);
    if (e.taetigkeit === "Zeitausgleich") {
      used += h;
      continue;
    }
    if (!byDay[e.datum]) byDay[e.datum] = { total: 0, hasAbsence: false };
    byDay[e.datum].total += h;
    if (ABSENCE_TAETIGKEITEN.includes(e.taetigkeit || "")) {
      byDay[e.datum].hasAbsence = true;
    }
  }

  const endCheck = new Date(today);
  endCheck.setHours(23, 59, 59, 999);
  const monthOver = lastDay <= endCheck;
  // Anzeige: ALLE MO-DO-Tage des Monats, die noch leer sind (nicht nur bis heute)
  const allExpectedWorkdays = getExpectedWorkdays(year, month, lastDay);
  const missingDays = allExpectedWorkdays.filter((d) => !byDay[d]);
  const complete = missingDays.length === 0 && monthOver;

  let earned = 0;
  for (const [datum, { total, hasAbsence }] of Object.entries(byDay)) {
    const date = parseLocalDate(datum);
    const target = getNormalWorkingHours(date);
    if (hasAbsence && total <= target + 0.01) continue;
    if (target === 0 && total > 0) earned += total;
    else if (target > 0) earned += total - target;
  }

  return {
    year,
    month,
    earned: Math.round(earned * 1000) / 1000,
    used: Math.round(used * 1000) / 1000,
    net: Math.round((earned - used) * 1000) / 1000,
    complete,
    missingDays,
    monthOver,
  };
}

export function getMonthsWithEntries(entries: TimeEntryForZa[]): MonthKey[] {
  const set = new Set<string>();
  for (const e of entries) {
    set.add(e.datum.substring(0, 7));
  }
  return Array.from(set)
    .sort()
    .map((s) => ({ year: parseInt(s.substring(0, 4)), month: parseInt(s.substring(5, 7)) }));
}

export function calculateZaBalance(
  entries: TimeEntryForZa[],
  adjustments: ZaAdjustment[] = [],
  today: Date = new Date()
): ZaBalance {
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  const months = getMonthsWithEntries(entries);

  let bookedEarned = 0;
  let bookedUsed = 0;
  let currentMonthZa: MonthlyZa | null = null;

  for (const mk of months) {
    const monthly = computeMonthlyZa(entries, mk.year, mk.month, today);
    const isCurrent = mk.year === currentYear && mk.month === currentMonth;
    if (isCurrent) {
      currentMonthZa = monthly;
      continue;
    }
    // Vergangene Monate: einrechnen, sobald sie zeitlich abgelaufen sind —
    // auch wenn einzelne Werktage noch nicht erfasst sind (Saldo basiert dann
    // auf den vorhandenen Buchungen, fehlende Tage werden separat angezeigt).
    if (monthly.monthOver) {
      bookedEarned += monthly.earned;
      bookedUsed += monthly.used;
    }
  }

  const adjustmentsSum = adjustments.reduce((s, a) => s + Number(a.hours), 0);
  const bookedNet = bookedEarned - bookedUsed;
  const balance = bookedNet + adjustmentsSum;

  return {
    bookedEarned: Math.round(bookedEarned * 1000) / 1000,
    bookedUsed: Math.round(bookedUsed * 1000) / 1000,
    bookedNet: Math.round(bookedNet * 1000) / 1000,
    adjustments: Math.round(adjustmentsSum * 1000) / 1000,
    balance: Math.round(balance * 1000) / 1000,
    currentMonth: currentMonthZa,
  };
}

export type ZaHistoryEntry =
  | {
      kind: "month_close";
      year: number;
      month: number;
      date: string;
      earned: number;
      used: number;
      net: number;
    }
  | {
      kind: "adjustment";
      date: string;
      hours: number;
      reason: string;
      adjustedBy: string | null;
    }
  | {
      kind: "za_taken";
      date: string;
      hours: number;
    };

export function generateZaHistory(
  entries: TimeEntryForZa[],
  adjustments: ZaAdjustment[] = [],
  today: Date = new Date()
): ZaHistoryEntry[] {
  const history: ZaHistoryEntry[] = [];

  const months = getMonthsWithEntries(entries);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  for (const mk of months) {
    const monthly = computeMonthlyZa(entries, mk.year, mk.month, today);
    const isCurrent = mk.year === currentYear && mk.month === currentMonth;
    if (!isCurrent && monthly.complete) {
      const lastDay = new Date(mk.year, mk.month, 0);
      history.push({
        kind: "month_close",
        year: mk.year,
        month: mk.month,
        date: formatLocalDate(lastDay),
        earned: monthly.earned,
        used: monthly.used,
        net: monthly.net,
      });
    }
  }

  for (const adj of adjustments) {
    history.push({
      kind: "adjustment",
      date: adj.created_at ? adj.created_at.substring(0, 10) : formatLocalDate(today),
      hours: Number(adj.hours),
      reason: adj.reason || "",
      adjustedBy: adj.adjusted_by || null,
    });
  }

  history.sort((a, b) => b.date.localeCompare(a.date));
  return history;
}
