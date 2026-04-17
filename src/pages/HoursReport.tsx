import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { useBreakValidation } from "@/hooks/useBreakValidation";
import { Download, FileSpreadsheet, Building2, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { format, isSameDay, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import * as XLSX from "xlsx-js-style";
import { cn } from "@/lib/utils";
import ProjectHoursReport from "@/components/ProjectHoursReport";
import { PageHeader } from "@/components/PageHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { calculateSuggestedStartTime, calculateWorkTimeRange, getNormalWorkingHours, timeToMinutes, isWorkingDay, DAILY_WORK_HOURS, calculateHoursFromTimes, LUNCH_BREAK_START, LUNCH_BREAK_END, LUNCH_BREAK_MINUTES, BREAKFAST_BREAK_START, BREAKFAST_BREAK_END } from "@/lib/workingHours";

interface TimeEntry {
  id: string;
  datum: string;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  pause_start?: string;
  pause_end?: string;
  stunden: number;
  location_type: string;
  project_id: string | null;
  user_id: string;
  taetigkeit: string;
  week_type?: string | null;
  disturbance_id?: string | null;
  has_breakfast_break?: boolean;
  has_lunch_break?: boolean;
}

interface Profile {
  vorname: string;
  nachname: string;
}

interface Project {
  id: string;
  name: string;
  adresse?: string;
  plz?: string;
}

interface DisturbanceOption {
  id: string;
  datum: string;
  kunde_name: string;
  status: string;
}

interface HoursBreakdown {
  arbeitsstunden: number;
  urlaub: number;
  krankenstand: number;
  weiterbildung: number;
  arztbesuch: number;
  zeitausgleich: number;
  gesamtsumme: number;
}

interface ReportMetrics {
  totalHours: number;
  totalOvertime: number;
  breakdown: HoursBreakdown;
}

interface EditableTimeEntry {
  id: string;
  datum: string;
  stunden: string;
  taetigkeit: string;
  location_type: string;
  project_id: string | null;
  start_time: string;
  end_time: string;
  pause_start: string;
  pause_end: string;
  disturbanceIds: string[];
  has_breakfast_break: boolean;
  has_lunch_break: boolean;
  breakfast_start: string;
  breakfast_end: string;
  lunch_start: string;
  lunch_end: string;
}

interface EmployeeBalances {
  zaEarned: number;
  zaAdjustments: number;
  zaUsed: number;
  zaBalance: number;
  vacationGranted: number;
  vacationUsed: number;
  vacationBalance: number;
  monthComplete: boolean;
  missingDays: number;
}

const monthNames = [
  "Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];

const monthNamesShort = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const absenceTypes = ["Urlaub", "Krankenstand", "Weiterbildung", "Arztbesuch", "Zeitausgleich"] as const;
const summaryRows: Array<{ key: keyof HoursBreakdown; label: string }> = [
  { key: "arbeitsstunden", label: "Summe Arbeitsstunden" },
  { key: "urlaub", label: "Summe Urlaub" },
  { key: "krankenstand", label: "Summe Krankenstand" },
  { key: "weiterbildung", label: "Summe Weiterbildung" },
  { key: "arztbesuch", label: "Summe Arztbesuch" },
  { key: "zeitausgleich", label: "Summe Zeitausgleich" },
  { key: "gesamtsumme", label: "Gesamtsumme" },
];

const createEmptyBreakdown = (): HoursBreakdown => ({
  arbeitsstunden: 0,
  urlaub: 0,
  krankenstand: 0,
  weiterbildung: 0,
  arztbesuch: 0,
  zeitausgleich: 0,
  gesamtsumme: 0,
});

const isAbsenceType = (taetigkeit?: string | null): taetigkeit is typeof absenceTypes[number] =>
  !!taetigkeit && absenceTypes.includes(taetigkeit as (typeof absenceTypes)[number]);

const getBreakdownKeyForEntry = (entry: TimeEntry): keyof Omit<HoursBreakdown, "gesamtsumme"> => {
  switch (entry.taetigkeit) {
    case "Urlaub":
      return "urlaub";
    case "Krankenstand":
      return "krankenstand";
    case "Weiterbildung":
      return "weiterbildung";
    case "Arztbesuch":
      return "arztbesuch";
    case "Zeitausgleich":
      return "zeitausgleich";
    default:
      return "arbeitsstunden";
  }
};

const finalizeBreakdown = (breakdown: HoursBreakdown): HoursBreakdown => ({
  ...breakdown,
  gesamtsumme:
    breakdown.arbeitsstunden +
    breakdown.urlaub +
    breakdown.krankenstand +
    breakdown.weiterbildung +
    breakdown.arztbesuch +
    breakdown.zeitausgleich,
});

const createReportMetrics = (entries: TimeEntry[]): ReportMetrics => {
  const actualBreakdown = entries.reduce((acc, entry) => {
    const key = getBreakdownKeyForEntry(entry);
    acc[key] += Number(entry.stunden) || 0;
    return acc;
  }, createEmptyBreakdown());

  const noOvertimeBreakdown = Object.values(
    entries.reduce<Record<string, { date: Date; entries: TimeEntry[] }>>((acc, entry) => {
      if (!acc[entry.datum]) {
        acc[entry.datum] = { date: parseISO(entry.datum), entries: [] };
      }
      acc[entry.datum].entries.push(entry);
      return acc;
    }, {})
  ).reduce((acc, dayGroup) => {
    const normalHours = getNormalWorkingHours(dayGroup.date);
    if (normalHours <= 0) return acc;

    const firstAbsence = dayGroup.entries.find((entry) => isAbsenceType(entry.taetigkeit));
    if (firstAbsence) {
      const key = getBreakdownKeyForEntry(firstAbsence);
      acc[key] += normalHours;
    } else {
      acc.arbeitsstunden += normalHours;
    }

    return acc;
  }, createEmptyBreakdown());

  const totalHours = entries.reduce((sum, entry) => sum + Number(entry.stunden || 0), 0);
  const totalOvertime = entries.reduce((sum, entry) => {
    const entryDate = parseISO(entry.datum);
    return sum + Math.max(0, Number(entry.stunden || 0) - getNormalWorkingHours(entryDate));
  }, 0);

  return {
    totalHours,
    totalOvertime,
    breakdown: {
      ...finalizeBreakdown(actualBreakdown),
      ohneUeberstunden: undefined,
    } as HoursBreakdown,
  };
};

const parseHoursInput = (value: string): number => Number(value.replace(",", "."));

export default function HoursReport() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "projekte" ? "projekte" : "mitarbeiter";
  const initialProjectId = searchParams.get("projectId") || undefined;
  const [activeTab, setActiveTab] = useState<"mitarbeiter" | "projekte">(initialTab);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [disturbances, setDisturbances] = useState<DisturbanceOption[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingEntry, setEditingEntry] = useState<EditableTimeEntry | null>(null);

  // Break validation for admin edit dialog
  const { breakfastTaken: editBreakfastTaken, lunchTaken: editLunchTaken } = useBreakValidation(
    selectedUserId || null,
    editingEntry?.datum || null,
    editingEntry ? [editingEntry.id] : []
  );
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<TimeEntry | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingEntry, setIsDeletingEntry] = useState(false);
  const [employeeBalances, setEmployeeBalances] = useState<EmployeeBalances | null>(null);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  const fetchEmployeeBalances = async (userId: string) => {
    try {
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDate = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;

      // Monats-Einträge UND alle Einträge (für Gesamt-ZA-Saldo)
      const [{ data: monthEntries }, { data: allEntries }, { data: zaAdj }, { data: vacAdj }] = await Promise.all([
        supabase.from("time_entries").select("datum, stunden, taetigkeit").eq("user_id", userId).gte("datum", startDate).lte("datum", endDate),
        supabase.from("time_entries").select("datum, stunden, taetigkeit").eq("user_id", userId),
        supabase.from("za_adjustments").select("hours").eq("user_id", userId),
        supabase.from("vacation_adjustments").select("days").eq("user_id", userId),
      ]);

      // MONAT: Über-/Minus nur wenn alle erwarteten MO-DO-Tage eingetragen sind
      let zaUsedMonth = 0;

      const byDayMonth: Record<string, { total: number; hasAbsence: boolean }> = {};
      (monthEntries || []).forEach((e) => {
        if (e.taetigkeit === "Zeitausgleich") {
          zaUsedMonth += Number(e.stunden);
          return;
        }
        if (!byDayMonth[e.datum]) byDayMonth[e.datum] = { total: 0, hasAbsence: false };
        byDayMonth[e.datum].total += Number(e.stunden);
        if (["Urlaub", "Krankenstand", "Weiterbildung", "Arztbesuch"].includes(e.taetigkeit || "")) {
          byDayMonth[e.datum].hasAbsence = true;
        }
      });

      // Erwartete MO-DO-Tage bis heute (laufender Monat) oder Monatsende (vergangener Monat)
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const lastDayOfMonth = new Date(year, month, 0);
      const endCheck = lastDayOfMonth < today ? lastDayOfMonth : today;
      const expectedWorkdays: string[] = [];
      for (let d = 1; d <= lastDayOfMonth.getDate(); d++) {
        const dateObj = new Date(year, month - 1, d);
        if (dateObj > endCheck) break;
        if (isWorkingDay(dateObj)) {
          expectedWorkdays.push(dateObj.toISOString().split("T")[0]);
        }
      }
      const missingDays = expectedWorkdays.filter((d) => !byDayMonth[d]).length;
      const monthComplete = missingDays === 0;

      // Über-/Minus nur berechnen wenn Monat vollständig
      let zaEarnedMonth = 0;
      if (monthComplete) {
        Object.entries(byDayMonth).forEach(([datum, { total, hasAbsence }]) => {
          const date = new Date(datum + "T00:00:00");
          const target = getNormalWorkingHours(date);
          if (hasAbsence && total <= target + 0.01) return;
          if (target === 0 && total > 0) zaEarnedMonth += total;
          else if (target > 0) zaEarnedMonth += total - target;
        });
      }

      // GESAMT: ZA-Saldo (all-time, konsistent mit MyHours/Admin)
      let zaEarnedTotal = 0;
      let zaUsedTotal = 0;
      const vacationDatesTotal = new Set<string>();
      const byDayTotal: Record<string, { total: number; hasAbsence: boolean }> = {};
      (allEntries || []).forEach((e) => {
        if (e.taetigkeit === "Zeitausgleich") {
          zaUsedTotal += Number(e.stunden);
          return;
        }
        if (!byDayTotal[e.datum]) byDayTotal[e.datum] = { total: 0, hasAbsence: false };
        byDayTotal[e.datum].total += Number(e.stunden);
        if (["Urlaub", "Krankenstand", "Weiterbildung", "Arztbesuch"].includes(e.taetigkeit || "")) {
          byDayTotal[e.datum].hasAbsence = true;
          if (e.taetigkeit === "Urlaub") vacationDatesTotal.add(e.datum);
        }
      });
      Object.entries(byDayTotal).forEach(([datum, { total, hasAbsence }]) => {
        const date = new Date(datum + "T00:00:00");
        const target = getNormalWorkingHours(date);
        if (hasAbsence && total <= target + 0.01) return;
        if (target === 0 && total > 0) zaEarnedTotal += total;
        else if (target > 0) zaEarnedTotal += total - target;
      });

      const zaAdjustments = (zaAdj || []).reduce((sum, a) => sum + Number(a.hours), 0);
      const vacationGranted = (vacAdj || []).reduce((sum, a) => sum + Number(a.days), 0);

      setEmployeeBalances({
        zaEarned: Math.round(zaEarnedMonth * 1000) / 1000, // Monat (nur wenn komplett)
        zaAdjustments,
        zaUsed: zaUsedMonth, // Monat
        zaBalance: Math.round((zaEarnedTotal + zaAdjustments - zaUsedTotal) * 1000) / 1000, // GESAMT all-time
        vacationGranted,
        vacationUsed: vacationDatesTotal.size,
        vacationBalance: vacationGranted - vacationDatesTotal.size,
        monthComplete,
        missingDays,
      });
    } catch (err) {
      console.error("Error fetching employee balances:", err);
    }
  };

  useEffect(() => {
    checkAdminStatus();
    fetchProfiles();
    fetchProjects();
    fetchDisturbances();
  }, []);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab === "mitarbeiter" || requestedTab === "projekte") {
      setActiveTab(requestedTab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (selectedUserId) {
      fetchTimeEntries();
      fetchEmployeeBalances(selectedUserId);
    }
  }, [month, year, selectedUserId]);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    const admin = data?.role === "administrator";
    setIsAdmin(admin);

    if (!admin) {
      setSelectedUserId(user.id);
    } else {
      const employeeParam = searchParams.get("employee");
      if (employeeParam) {
        setSelectedUserId(employeeParam);
      }
    }
  };

  const fetchProfiles = async () => {
    const { data } = await supabase.from("profiles").select("id, vorname, nachname");
    if (data) {
      const profileMap: Record<string, Profile> = {};
      data.forEach((p) => {
        profileMap[p.id] = { vorname: p.vorname, nachname: p.nachname };
      });
      setProfiles(profileMap);
    }
  };

  const fetchProjects = async () => {
    const { data } = await supabase.from("projects").select("id, name, adresse, plz");
    if (data) {
      const projectMap: Record<string, Project> = {};
      data.forEach((p) => {
        projectMap[p.id] = p;
      });
      setProjects(projectMap);
    }
  };

  const fetchDisturbances = async () => {
    const { data } = await supabase
      .from("disturbances")
      .select("id, datum, kunde_name, status")
      .order("datum", { ascending: false })
      .limit(100);

    if (data) {
      setDisturbances(data);
    }
  };

  const fetchTimeEntries = async () => {
    setLoading(true);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const { data, error } = await supabase
      .from("time_entries")
      .select("*, disturbances(kunde_name)")
      .eq("user_id", selectedUserId)
      .gte("datum", format(startDate, "yyyy-MM-dd"))
      .lte("datum", format(endDate, "yyyy-MM-dd"))
      .order("datum")
      .order("start_time");

    if (error) {
      toast({ title: "Fehler beim Laden", description: error.message, variant: "destructive" });
    } else {
      setTimeEntries(data || []);
    }
    setLoading(false);
  };

  const getDisturbanceLabel = (disturbance: DisturbanceOption) => {
    const formattedDate = format(new Date(disturbance.datum), "dd.MM.yyyy", { locale: de });
    return `${formattedDate} • ${disturbance.kunde_name}`;
  };

  const getEmployeeDisplayName = (userId: string) => {
    const profile = profiles[userId];
    return profile ? `${profile.vorname} ${profile.nachname}`.trim() : "Unbekannter Mitarbeiter";
  };

  const openEditDialog = async (entry: TimeEntry) => {
    const legacyDisturbanceIds = entry.disturbance_id ? [entry.disturbance_id] : [];
    const { data, error } = await supabase
      .from("time_entry_disturbances")
      .select("disturbance_id")
      .eq("time_entry_id", entry.id);

    if (error) {
      toast({
        title: "Arbeitsberichte konnten nicht geladen werden",
        description: error.message,
        variant: "destructive",
      });
    }

    const disturbanceIds = Array.from(
      new Set([...(data?.map((item) => item.disturbance_id) ?? []), ...legacyDisturbanceIds])
    );

    // Find the latest end_time of sibling entries on the same day (excluding this entry)
    const siblingEntries = timeEntries.filter(
      (e) => e.datum === entry.datum && e.id !== entry.id && e.user_id === entry.user_id
    );
    const lastEndTime = siblingEntries.length > 0
      ? siblingEntries.reduce((latest, e) => {
          const endTime = e.end_time?.substring(0, 5) || "00:00";
          return endTime > latest ? endTime : latest;
        }, "00:00")
      : null;

    const suggestedStart = calculateSuggestedStartTime(new Date(entry.datum), lastEndTime, 0);

    setEditingEntry({
      id: entry.id,
      datum: entry.datum,
      stunden: String(Number(entry.stunden || 0)),
      taetigkeit: entry.taetigkeit || "",
      location_type: entry.location_type || "baustelle",
      project_id: entry.project_id,
      start_time: entry.start_time?.substring(0, 8) || suggestedStart,
      end_time: entry.end_time?.substring(0, 8) || "",
      pause_start: entry.pause_start?.substring(0, 5) || "",
      pause_end: entry.pause_end?.substring(0, 5) || "",
      disturbanceIds,
      has_breakfast_break: entry.has_breakfast_break || false,
      has_lunch_break: entry.has_lunch_break || false,
      breakfast_start: BREAKFAST_BREAK_START,
      breakfast_end: BREAKFAST_BREAK_END,
      lunch_start: entry.pause_start?.substring(0, 5) || LUNCH_BREAK_START,
      lunch_end: entry.pause_end?.substring(0, 5) || LUNCH_BREAK_END,
    });
    setIsEditDialogOpen(true);
  };

  const closeEditDialog = (open: boolean) => {
    setIsEditDialogOpen(open);
    if (!open) {
      setEditingEntry(null);
      setIsSavingEdit(false);
    }
  };

  const openDeleteDialog = (entry: TimeEntry) => {
    setEntryToDelete(entry);
    setIsDeleteDialogOpen(true);
  };

  const closeDeleteDialog = (open: boolean) => {
    if (!open && isDeletingEntry) return;
    setIsDeleteDialogOpen(open);
    if (!open) {
      setEntryToDelete(null);
      setIsDeletingEntry(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingEntry || !selectedUserId || isSavingEdit) return;

    const isAbsence = isAbsenceType(editingEntry.taetigkeit);

    // Stunden direkt aus Von-Bis berechnen (nicht aus Eingabefeld)
    let hours: number;
    if (isAbsence) {
      hours = parseHoursInput(editingEntry.stunden);
    } else {
      const startMin = timeToMinutes(editingEntry.start_time);
      const endMin = timeToMinutes(editingEntry.end_time);
      let workMin = endMin - startMin;
      if (editingEntry.has_lunch_break && editingEntry.lunch_start && editingEntry.lunch_end) {
        workMin -= Math.max(0, timeToMinutes(editingEntry.lunch_end) - timeToMinutes(editingEntry.lunch_start));
      }
      hours = Math.max(0, workMin / 60);
    }

    if (!Number.isFinite(hours) || hours <= 0) {
      toast({ title: "Ungültige Zeiten", description: "Bitte Von- und Bis-Zeit korrekt eingeben.", variant: "destructive" });
      return;
    }

    const nextLocationType = isAbsence ? "baustelle" : editingEntry.location_type;
    const nextProjectId = isAbsence || nextLocationType !== "baustelle" ? null : editingEntry.project_id;
    const nextDisturbanceIds = !isAbsence && nextLocationType === "regie"
      ? Array.from(new Set(editingEntry.disturbanceIds))
      : [];

    setIsSavingEdit(true);

    // Pausenzeiten aus den editierbaren Feldern
    const pauseMinutes = editingEntry.has_lunch_break
      ? Math.round(Math.max(0, timeToMinutes(editingEntry.lunch_end) - timeToMinutes(editingEntry.lunch_start)))
      : 0;
    const pauseStart = editingEntry.has_lunch_break ? editingEntry.lunch_start : null;
    const pauseEnd = editingEntry.has_lunch_break ? editingEntry.lunch_end : null;

    const { error: updateError } = await supabase
      .from("time_entries")
      .update({
        stunden: Math.round(hours * 1000) / 1000,
        taetigkeit: editingEntry.taetigkeit,
        location_type: nextLocationType,
        project_id: nextProjectId,
        disturbance_id: nextLocationType === "regie" ? (nextDisturbanceIds[0] ?? null) : null,
        start_time: editingEntry.start_time,
        end_time: editingEntry.end_time,
        pause_minutes: pauseMinutes,
        pause_start: pauseStart,
        pause_end: pauseEnd,
        has_breakfast_break: editingEntry.has_breakfast_break,
        has_lunch_break: editingEntry.has_lunch_break,
      })
      .eq("id", editingEntry.id);

    if (updateError) {
      toast({
        title: "Speichern fehlgeschlagen",
        description: updateError.message,
        variant: "destructive",
      });
      setIsSavingEdit(false);
      return;
    }

    const { error: deleteLinksError } = await supabase
      .from("time_entry_disturbances")
      .delete()
      .eq("time_entry_id", editingEntry.id);

    if (deleteLinksError) {
      toast({
        title: "Arbeitsbericht-Verknüpfungen konnten nicht aktualisiert werden",
        description: deleteLinksError.message,
        variant: "destructive",
      });
      setIsSavingEdit(false);
      return;
    }

    if (nextDisturbanceIds.length > 0) {
      const { error: insertLinksError } = await supabase
        .from("time_entry_disturbances")
        .insert(nextDisturbanceIds.map((disturbanceId) => ({
          time_entry_id: editingEntry.id,
          disturbance_id: disturbanceId,
        })));

      if (insertLinksError) {
        toast({
          title: "Arbeitsbericht-Verknüpfungen konnten nicht gespeichert werden",
          description: insertLinksError.message,
          variant: "destructive",
        });
        setIsSavingEdit(false);
        return;
      }
    }

    await fetchTimeEntries();
    setIsSavingEdit(false);
    closeEditDialog(false);
    toast({ title: "Eintrag aktualisiert", description: "Die Stunden wurden gespeichert." });
  };

  const handleDeleteEntry = async () => {
    if (!entryToDelete || isDeletingEntry) return;

    setIsDeletingEntry(true);

    const { error: disturbancesDeleteError } = await supabase
      .from("time_entry_disturbances")
      .delete()
      .eq("time_entry_id", entryToDelete.id);

    if (disturbancesDeleteError) {
      toast({
        title: "Löschen fehlgeschlagen",
        description: disturbancesDeleteError.message,
        variant: "destructive",
      });
      setIsDeletingEntry(false);
      return;
    }

    const { error: workersDeleteError } = await supabase
      .from("time_entry_workers")
      .delete()
      .or(`source_entry_id.eq.${entryToDelete.id},target_entry_id.eq.${entryToDelete.id}`);

    if (workersDeleteError) {
      toast({
        title: "Löschen fehlgeschlagen",
        description: workersDeleteError.message,
        variant: "destructive",
      });
      setIsDeletingEntry(false);
      return;
    }

    const { error: entryDeleteError } = await supabase
      .from("time_entries")
      .delete()
      .eq("id", entryToDelete.id);

    if (entryDeleteError) {
      toast({
        title: "Stundeneintrag konnte nicht gelöscht werden",
        description: entryDeleteError.message,
        variant: "destructive",
      });
      setIsDeletingEntry(false);
      return;
    }

    await fetchTimeEntries();
    closeDeleteDialog(false);
    toast({ title: "Eintrag gelöscht", description: "Der Stundeneintrag wurde entfernt." });
  };

  const generateMonthDays = () => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay();

      days.push({
        date,
        dayNumber: day,
        dayOfWeek,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6 || dayOfWeek === 5,
        isFriday: dayOfWeek === 5,
      });
    }

    return days;
  };

  const calculateOvertime = (date: Date, totalHours: number): number => {
    const normalHours = getNormalWorkingHours(date);
    if (normalHours === 0) return totalHours; // Nicht-Arbeitstag
    return totalHours - normalHours; // Kann negativ sein (Minusstunden)
  };

  const calculateLunchBreak = (entry: TimeEntry) => {
    if (entry.pause_start && entry.pause_end) {
      return {
        start: entry.pause_start.substring(0, 5),
        end: entry.pause_end.substring(0, 5),
      };
    }

    if (!entry.pause_minutes || entry.pause_minutes === 0) return null;

    const pauseStart = new Date("2000-01-01T12:00:00");
    const pauseEnd = new Date(pauseStart);
    pauseEnd.setMinutes(pauseEnd.getMinutes() + entry.pause_minutes);

    return {
      start: format(pauseStart, "HH:mm"),
      end: format(pauseEnd, "HH:mm"),
    };
  };

  const monthDays = generateMonthDays();
  const employeeName = selectedUserId && profiles[selectedUserId]
    ? `${profiles[selectedUserId].vorname} ${profiles[selectedUserId].nachname}`
    : "Mitarbeiter";

  const reportMetrics = useMemo(() => {
    const actualBreakdown = timeEntries.reduce((acc, entry) => {
      const key = getBreakdownKeyForEntry(entry);
      acc[key] += Number(entry.stunden) || 0;
      return acc;
    }, createEmptyBreakdown());

    const noOvertimeBreakdown = Object.values(
      timeEntries.reduce<Record<string, { date: Date; entries: TimeEntry[] }>>((acc, entry) => {
        if (!acc[entry.datum]) {
          acc[entry.datum] = { date: parseISO(entry.datum), entries: [] };
        }
        acc[entry.datum].entries.push(entry);
        return acc;
      }, {})
    ).reduce((acc, dayGroup) => {
      const normalHours = getNormalWorkingHours(dayGroup.date);
      if (normalHours <= 0) return acc;

      const firstAbsence = dayGroup.entries.find((entry) => isAbsenceType(entry.taetigkeit));
      if (firstAbsence) {
        const key = getBreakdownKeyForEntry(firstAbsence);
        acc[key] += normalHours;
      } else {
        acc.arbeitsstunden += normalHours;
      }

      return acc;
    }, createEmptyBreakdown());

    return {
      actual: finalizeBreakdown(actualBreakdown),
      noOvertime: finalizeBreakdown(noOvertimeBreakdown),
      totalHours: timeEntries.reduce((sum, entry) => sum + Number(entry.stunden || 0), 0),
      totalOvertime: (() => {
        // Nur wenn Monat vollständig: alle MO-DO-Tage bis heute/Monatsende
        // müssen Einträge haben. Sonst 0 (wird auch UI-seitig ausgeblendet).
        const byDay: Record<string, { total: number; hasAbsence: boolean }> = {};
        timeEntries.forEach((e) => {
          if (e.taetigkeit === "Zeitausgleich") return;
          if (!byDay[e.datum]) byDay[e.datum] = { total: 0, hasAbsence: false };
          byDay[e.datum].total += Number(e.stunden || 0);
          if (["Urlaub", "Krankenstand", "Weiterbildung", "Arztbesuch"].includes(e.taetigkeit || "")) {
            byDay[e.datum].hasAbsence = true;
          }
        });

        // Erwartete MO-DO Tage im Monat bis heute oder Monatsende
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        const lastDayOfMonth = new Date(year, month, 0);
        const endCheck = lastDayOfMonth < today ? lastDayOfMonth : today;
        const expectedDays: string[] = [];
        for (let d = 1; d <= lastDayOfMonth.getDate(); d++) {
          const dateObj = new Date(year, month - 1, d);
          if (dateObj > endCheck) break;
          if (isWorkingDay(dateObj)) {
            expectedDays.push(dateObj.toISOString().split("T")[0]);
          }
        }
        const missing = expectedDays.filter((d) => !byDay[d]).length;
        if (missing > 0) return 0; // Monat unvollständig → keine Überstunden

        return Object.entries(byDay).reduce((sum, [datum, { total, hasAbsence }]) => {
          const date = new Date(datum + "T00:00:00");
          const target = getNormalWorkingHours(date);
          if (hasAbsence && total <= target + 0.01) return sum;
          if (target === 0 && total > 0) return sum + total;
          if (target > 0) return sum + (total - target);
          return sum;
        }, 0);
      })(),
    };
  }, [timeEntries]);

  const addBordersToCell = (cell: XLSX.CellObject, thick = false, centered = false) => {
    const borderStyle = thick ? "medium" : "thin";
    (cell as XLSX.CellObject & { s?: unknown }).s = {
      border: {
        top: { style: borderStyle, color: { rgb: "000000" } },
        bottom: { style: borderStyle, color: { rgb: "000000" } },
        left: { style: borderStyle, color: { rgb: "000000" } },
        right: { style: borderStyle, color: { rgb: "000000" } },
      },
      alignment: { vertical: "center", horizontal: centered ? "center" : "left" },
    };
  };

  const getExcelBreakdown = (includeOvertime: boolean) =>
    includeOvertime ? reportMetrics.actual : reportMetrics.noOvertime;

  const buildSummaryWorksheetRows = (includeOvertime: boolean) => {
    const breakdown = getExcelBreakdown(includeOvertime);
    return summaryRows.map((row) => ["", "", "", "", "", row.label, breakdown[row.key].toFixed(2), row.key === "gesamtsumme" && includeOvertime ? reportMetrics.totalOvertime.toFixed(2) : "", "", "", "", ""]);
  };

  const buildEmployeeWorksheetData = (includeOvertime: boolean) => {
    const worksheetData: (string | number)[][] = [
      ["FASCHING Gebäudetechnik", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["Dienstnehmer:", "", employeeName, "", "", "", "", "", "Monat:", `${monthNamesShort[month - 1]}-${year.toString().slice(-2)}`, "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
    ];

    if (includeOvertime) {
      worksheetData.push(
        ["Datum", "V o r m i t t a g", "", "Unterbrechung", "N a c h m i t t a g", "", "Stunden", "Überstunden", "Ort", "Projekt", "Tätigkeit", "PLZ"],
        ["", "Beginn", "Ende", "von - bis", "Beginn", "Ende", "Gesamt", "", "", "", "", ""]
      );
    } else {
      worksheetData.push(
        ["Datum", "V o r m i t t a g", "", "Unterbrechung", "N a c h m i t t a g", "", "Stunden", "Ort", "Projekt", "Tätigkeit", "PLZ", ""],
        ["", "Beginn", "Ende", "von - bis", "Beginn", "Ende", "Gesamt", "", "", "", "", ""]
      );
    }

    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);

    const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
    worksheetData.push([prevMonthLastDay, "", "", "", "", "", "", "", "", "", "", ""]);

    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = new Date(year, month - 1, day);
      const dayEntries = timeEntries.filter((e) => isSameDay(parseISO(e.datum), dayDate));

      if (dayEntries.length === 0) {
        worksheetData.push([day, "", "", "", "", "", "", "", "", "", "", ""]);
        continue;
      }

      dayEntries.forEach((entry, entryIndex) => {
        const lunchBreak = calculateLunchBreak(entry);
        const project = entry.project_id ? projects[entry.project_id] : undefined;
        const isAbsence = isAbsenceType(entry.taetigkeit);
        const isRegie = entry.location_type === "regie" || entry.disturbance_id != null;
        const ortText = isRegie ? "Arbeitsbericht" : entry.location_type === "baustelle" ? "Baustelle" : entry.location_type === "werkstatt" ? "Werkstatt" : "";
        const kundeName = (entry as any).disturbances?.kunde_name;
        const regieLabel = kundeName ? `Arbeitsbericht: ${kundeName}` : "Arbeitsbericht";
        const projektName = isAbsence ? entry.taetigkeit : isRegie ? (project ? `${regieLabel} · ${project.name}` : regieLabel) : project?.name || "";
        const plz = isAbsence ? "" : isRegie ? (project?.plz || "") : entry.location_type === "baustelle" ? project?.plz || "" : "";
        const displayDay = entryIndex === 0 ? day : "";

        if (includeOvertime) {
          const isLast = entryIndex === dayEntries.length - 1;
          const dayTotal = dayEntries.reduce((s, e) => s + Number(e.stunden || 0), 0);
          const dayOT = isLast ? calculateOvertime(dayDate, dayTotal) : 0;
          worksheetData.push([
            displayDay,
            entry.start_time?.substring(0, 5) || "",
            lunchBreak?.start || "",
            entry.pause_minutes && lunchBreak ? `${lunchBreak.start} - ${lunchBreak.end}` : "",
            lunchBreak?.end || "",
            entry.end_time?.substring(0, 5) || "",
            Number(entry.stunden || 0).toFixed(2),
            isLast && dayOT !== 0 ? (dayOT > 0 ? "+" : "") + dayOT.toFixed(2) : "",
            ortText,
            projektName,
            entry.taetigkeit,
            plz,
          ]);
        } else {
          const normalHours = getNormalWorkingHours(dayDate);
          worksheetData.push([
            displayDay,
            normalHours > 0 ? "07:00" : "",
            normalHours > 0 ? "12:00" : "",
            normalHours > 0 ? "12:00 - 12:30" : "",
            normalHours > 0 ? "12:30" : "",
            normalHours > 0 ? "17:07:30" : "",
            normalHours.toFixed(2),
            ortText,
            projektName,
            entry.taetigkeit,
            plz,
            "",
          ]);
        }
      });

      if (dayEntries.length > 1) {
        const dayTotalHours = dayEntries.reduce((sum, e) => sum + Number(e.stunden || 0), 0);
        const dayTotalOvertime = dayEntries.reduce((sum, e) => sum + calculateOvertime(dayDate, Number(e.stunden || 0)), 0);
        const dayNormalHours = getNormalWorkingHours(dayDate);

        if (includeOvertime) {
          worksheetData.push(["", "", "", "", "", "Tagessumme:", dayTotalHours.toFixed(2), dayTotalOvertime > 0 ? dayTotalOvertime.toFixed(2) : "", "", "", "", ""]);
        } else {
          worksheetData.push(["", "", "", "", "", "Tagessumme:", dayNormalHours.toFixed(2), "", "", "", "", ""]);
        }
      }
    }

    if (includeOvertime) {
      worksheetData.push(["", "", "", "", "", "SUMME", reportMetrics.totalHours.toFixed(2), reportMetrics.totalOvertime.toFixed(2), "", "", "", ""]);
    } else {
      worksheetData.push(["", "", "", "", "", "SUMME", reportMetrics.noOvertime.gesamtsumme.toFixed(2), "", "", "", "", ""]);
    }

    worksheetData.push(...buildSummaryWorksheetRows(includeOvertime));
    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);

    if (includeOvertime) {
      worksheetData.push(["", "Hiermit bestätige ich die Richtigkeit der von mir angegebenen Überstunden.", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", `Derzeitiger offener Überstundenstand: ${reportMetrics.totalOvertime.toFixed(2)}`, "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "Restliche Überstunden wurden zur Gänze abgegolten.", "", "", "", "", "", "", "", "", "", ""]);
    } else {
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    }

    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    worksheetData.push(["", "Datum:", "", "", "", "Unterschrift:", "", "", "", "", "", ""]);

    return worksheetData;
  };

  const getEmployeeExportBaseName = async (includeOvertime: boolean) => {
    const { sanitizeFilename } = await import("@/lib/fileExport");
    const suffix = includeOvertime ? "_mit_Ueberstunden" : "_ohne_Ueberstunden";
    return sanitizeFilename(`Arbeitszeiterfassung_${employeeName}_${monthNamesShort[month - 1]}_${year}${suffix}`);
  };

  const fetchZaCorrections = async (): Promise<(string | number)[][]> => {
    const { data } = await supabase
      .from("za_adjustments")
      .select("user_id, hours, reason, created_at, adjusted_by")
      .order("created_at", { ascending: false });

    if (!data || data.length === 0) return [];

    // Resolve admin names
    const adminIds = [...new Set(data.map(d => d.adjusted_by))];
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("id, vorname, nachname")
      .in("id", adminIds);

    const adminMap: Record<string, string> = {};
    (adminProfiles || []).forEach(p => {
      adminMap[p.id] = `${p.vorname} ${p.nachname}`.trim();
    });

    const rows: (string | number)[][] = [
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["ZA-Korrekturen (Übersicht)", "", "", "", "", "", "", "", "", "", "", ""],
      ["Datum", "Mitarbeiter", "Stunden", "Grund", "Geändert von", "", "", "", "", "", "", ""],
    ];

    data.forEach(d => {
      const empName = profiles[d.user_id]
        ? `${profiles[d.user_id].vorname} ${profiles[d.user_id].nachname}`.trim()
        : "Unbekannt";
      rows.push([
        format(new Date(d.created_at), "dd.MM.yyyy HH:mm"),
        empName,
        Number(d.hours).toFixed(1),
        d.reason,
        adminMap[d.adjusted_by] || "Unbekannt",
        "", "", "", "", "", "", "",
      ]);
    });

    return rows;
  };

  const fetchVacationData = async (): Promise<{ balanceRow: (string | number)[]; correctionsRows: (string | number)[][] }> => {
    if (!selectedUserId) return { balanceRow: [], correctionsRows: [] };

    const [{ data: adjustments }, { data: vacEntries }] = await Promise.all([
      supabase.from("vacation_adjustments" as any).select("user_id, days, reason, created_at, adjusted_by").order("created_at", { ascending: false }),
      supabase.from("time_entries").select("datum").eq("user_id", selectedUserId).eq("taetigkeit", "Urlaub"),
    ]);

    // Calculate balance for selected user
    const entitled = ((adjustments as any[]) || [])
      .filter((a: any) => a.user_id === selectedUserId)
      .reduce((sum: number, a: any) => sum + Number(a.days), 0);
    const takenDays = new Set((vacEntries || []).map(e => e.datum)).size;
    const saldo = entitled - takenDays;

    const balanceRow = ["Urlaubssaldo:", "", `Guthaben: ${entitled}`, `Verbraucht: ${takenDays}`, `Saldo: ${saldo} Tage`, "", "", "", "", "", "", ""];

    // Build corrections block (all users)
    if (!adjustments || (adjustments as any[]).length === 0) return { balanceRow, correctionsRows: [] };

    const adminIds = [...new Set((adjustments as any[]).map((d: any) => d.adjusted_by))];
    const { data: adminProfiles } = await supabase.from("profiles").select("id, vorname, nachname").in("id", adminIds);
    const adminMap: Record<string, string> = {};
    (adminProfiles || []).forEach(p => { adminMap[p.id] = `${p.vorname} ${p.nachname}`.trim(); });

    const rows: (string | number)[][] = [
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["Urlaubskorrekturen (Übersicht)", "", "", "", "", "", "", "", "", "", "", ""],
      ["Datum", "Mitarbeiter", "Tage", "Grund", "Geändert von", "", "", "", "", "", "", ""],
    ];

    (adjustments as any[]).forEach((d: any) => {
      const empName = profiles[d.user_id]
        ? `${profiles[d.user_id].vorname} ${profiles[d.user_id].nachname}`.trim()
        : "Unbekannt";
      rows.push([
        format(new Date(d.created_at), "dd.MM.yyyy HH:mm"),
        empName,
        Number(d.days).toFixed(0),
        d.reason,
        adminMap[d.adjusted_by] || "Unbekannt",
        "", "", "", "", "", "", "",
      ]);
    });

    return { balanceRow, correctionsRows: rows };
  };

  const exportToExcel = async (includeOvertime = true) => {
    if (!selectedUserId) {
      toast({ title: "Kein Mitarbeiter ausgewählt", variant: "destructive" });
      return;
    }

    const worksheetData = buildEmployeeWorksheetData(includeOvertime);

    // Append ZA corrections block at the end
    const zaRows = await fetchZaCorrections();
    if (zaRows.length > 0) {
      worksheetData.push(...zaRows);
    }

    // Append vacation balance and corrections
    const { balanceRow, correctionsRows } = await fetchVacationData();
    if (balanceRow.length > 0) {
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(balanceRow);
    }
    if (correctionsRows.length > 0) {
      worksheetData.push(...correctionsRows);
    }

    const ws = XLSX.utils.aoa_to_sheet(worksheetData);

    ws["!cols"] = [
      { wch: 12 },
      { wch: 24 },
      { wch: 24 },
      { wch: 26 },
      { wch: 12 },
      { wch: 24 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 22 },
      { wch: 20 },
      { wch: 8 },
    ];

    const footerRowsCount = 9;
    const summaryBlockLength = summaryRows.length;
    const summaryStartRow = buildEmployeeWorksheetData(includeOvertime).length - footerRowsCount - summaryBlockLength;
    const footerBaseRow = buildEmployeeWorksheetData(includeOvertime).length - footerRowsCount;

    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 5 } },
      { s: { r: 4, c: 0 }, e: { r: 4, c: 1 } },
      { s: { r: 4, c: 2 }, e: { r: 4, c: 7 } },
      { s: { r: 4, c: 8 }, e: { r: 4, c: 8 } },
      { s: { r: 4, c: 9 }, e: { r: 4, c: 11 } },
      { s: { r: footerBaseRow + 3, c: 1 }, e: { r: footerBaseRow + 3, c: 10 } },
      { s: { r: footerBaseRow + 5, c: 1 }, e: { r: footerBaseRow + 5, c: 10 } },
      { s: { r: footerBaseRow + 6, c: 1 }, e: { r: footerBaseRow + 6, c: 10 } },
    ];

    ws["!rows"] = ws["!rows"] || [];
    [0, 1, 2, 3].forEach((r) => {
      ws["!rows"]![r] = { hpt: 18 };
    });
    ws["!rows"]![footerBaseRow + 3] = { hpt: 30 };
    ws["!rows"]![footerBaseRow + 5] = { hpt: 25 };

    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) {
          ws[cellAddress] = { t: "s", v: "" };
        }

        const isFirmenHeader = R >= 0 && R <= 3;
        const isHeaderRow = R === 6 || R === 7;
        const isMainSumRow = R === summaryStartRow - 1;
        const isSummaryRow = R >= summaryStartRow && R < footerBaseRow;
        const isFooterRow = R >= footerBaseRow && R < footerBaseRow + footerRowsCount;

        if (isFirmenHeader || isFooterRow) {
          (ws[cellAddress] as XLSX.CellObject & { s?: unknown }).s = {
            alignment: { vertical: "center", horizontal: "left", wrapText: true },
            font: { bold: R === 0, size: R === 0 ? 14 : 11 },
          };
        } else {
          addBordersToCell(ws[cellAddress], isHeaderRow || isMainSumRow || isSummaryRow, isHeaderRow);
          if (isHeaderRow || isMainSumRow || isSummaryRow) {
            (ws[cellAddress] as XLSX.CellObject & { s?: Record<string, unknown> }).s = {
              ...((ws[cellAddress] as XLSX.CellObject & { s?: Record<string, unknown> }).s || {}),
              font: { bold: true },
            };
          }
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Arbeitszeit");
    const fileName = `${await getEmployeeExportBaseName(includeOvertime)}.xlsx`;
    XLSX.writeFile(wb, fileName);

    toast({ title: "Excel exportiert", description: "Die Excel-Datei wurde heruntergeladen" });
  };

  const exportToCsv = async (includeOvertime = true) => {
    if (!selectedUserId) {
      toast({ title: "Kein Mitarbeiter ausgewählt", variant: "destructive" });
      return;
    }

    const { downloadCsv } = await import("@/lib/fileExport");
    const fileName = `${await getEmployeeExportBaseName(includeOvertime)}.csv`;
    downloadCsv(buildEmployeeWorksheetData(includeOvertime), fileName);
    toast({ title: "CSV exportiert", description: "Die CSV-Datei wurde heruntergeladen" });
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Stundenauswertung" backPath="/admin" />
      <div className="container mx-auto p-4 space-y-6">

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "mitarbeiter" | "projekte")} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="mitarbeiter">
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Arbeitszeiterfassung
            </TabsTrigger>
            <TabsTrigger value="projekte">
              <Building2 className="w-4 h-4 mr-2" />
              Projektzeiterfassung
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mitarbeiter" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                      <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6" />
                      Arbeitszeiterfassung nach Mitarbeitern
                    </CardTitle>
                    <CardDescription className="text-sm">Monatsberichte mit Summen-Aufschlüsselung exportieren</CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button disabled={!selectedUserId} className="h-11">
                        <Download className="mr-2 h-4 w-4" />
                        <span className="hidden sm:inline">Exportieren</span>
                        <span className="sm:hidden">Export</span>
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => exportToExcel(true)}>
                        Excel mit Überstunden
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportToExcel(false)}>
                        Excel ohne Überstunden
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportToCsv(true)}>
                        CSV mit Überstunden
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportToCsv(false)}>
                        CSV ohne Überstunden
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  {isAdmin && (
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Mitarbeiter auswählen" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {Object.entries(profiles).map(([id, profile]) => (
                          <SelectItem key={id} value={id}>
                            {profile.vorname} {profile.nachname}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {monthNames.map((name, i) => (
                        <SelectItem key={i} value={(i + 1).toString()}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {years.map((y) => (
                        <SelectItem key={y} value={y.toString()}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedUserId && employeeBalances && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                      <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">ZA-Saldo gesamt</p>
                      <p className={`text-xl font-bold ${employeeBalances.zaBalance >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {employeeBalances.zaBalance >= 0 ? "+" : ""}{employeeBalances.zaBalance.toFixed(1)}h
                      </p>
                      <p className="text-xs text-muted-foreground">aktueller Kontostand</p>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                      <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">Urlaub übrig</p>
                      <p className={`text-xl font-bold ${employeeBalances.vacationBalance >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {employeeBalances.vacationBalance} Tage
                      </p>
                      <p className="text-xs text-muted-foreground">{employeeBalances.vacationUsed} von {employeeBalances.vacationGranted} verbraucht</p>
                    </div>
                    <div className={`rounded-lg p-3 border ${!employeeBalances.monthComplete ? "bg-muted/40 border-border" : employeeBalances.zaEarned >= 0 ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"}`}>
                      <p className={`text-sm font-medium ${!employeeBalances.monthComplete ? "text-muted-foreground" : employeeBalances.zaEarned >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>Über-/Minus im Monat</p>
                      {employeeBalances.monthComplete ? (
                        <>
                          <p className={`text-xl font-bold ${employeeBalances.zaEarned >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {employeeBalances.zaEarned >= 0 ? "+" : ""}{employeeBalances.zaEarned.toFixed(1)}h
                          </p>
                          <p className="text-xs text-muted-foreground">Monat vollständig</p>
                        </>
                      ) : (
                        <>
                          <p className="text-xl font-bold text-muted-foreground">—</p>
                          <p className="text-xs text-muted-foreground">{employeeBalances.missingDays} Tag(e) fehlen</p>
                        </>
                      )}
                    </div>
                    <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                      <p className="text-sm text-orange-600 dark:text-orange-400 font-medium">ZA im Monat genommen</p>
                      <p className="text-xl font-bold text-foreground">-{employeeBalances.zaUsed.toFixed(1)}h</p>
                    </div>
                  </div>
                )}

                {selectedUserId && (
                  <>
                    <div className="bg-muted/50 p-4 rounded-lg">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Gesamtstunden</p>
                          <p className="text-2xl font-bold">{reportMetrics.totalHours.toFixed(2)} h</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Überstunden</p>
                          {employeeBalances?.monthComplete ? (
                            <p className="text-2xl font-bold">{reportMetrics.totalOvertime.toFixed(2)} h</p>
                          ) : (
                            <p className="text-lg font-semibold text-muted-foreground">Monat unvollständig</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <ScrollArea className="h-[500px] rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">Datum</TableHead>
                            <TableHead>Vormittag</TableHead>
                            <TableHead>Pause</TableHead>
                            <TableHead>Nachmittag</TableHead>
                            <TableHead className="text-right">Stunden</TableHead>
                            <TableHead className="text-right">Überstunden</TableHead>
                            <TableHead>Ort</TableHead>
                            <TableHead className="max-w-[120px]">Projekt</TableHead>
                            <TableHead className="max-w-[120px]">Tätigkeit</TableHead>
                            {isAdmin && <TableHead className="w-[72px] px-2 text-right">Aktionen</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {loading ? (
                            <TableRow>
                              <TableCell colSpan={isAdmin ? 10 : 9} className="text-center">
                                Lade...
                              </TableCell>
                            </TableRow>
                          ) : monthDays.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={isAdmin ? 10 : 9} className="text-center">
                                Keine Daten verfügbar
                              </TableCell>
                            </TableRow>
                          ) : (
                            monthDays.map((day) => {
                              const dayEntries = timeEntries.filter((e) => isSameDay(parseISO(e.datum), day.date));
                              const dayTotalHours = dayEntries.reduce((sum, e) => sum + Number(e.stunden || 0), 0);
                              // Über-/Minusstunden: ZA ignorieren, Abwesenheit erfüllt Soll
                              const dayNonZAEntries = dayEntries.filter((e) => e.taetigkeit !== "Zeitausgleich");
                              const dayNonZATotal = dayNonZAEntries.reduce((sum, e) => sum + Number(e.stunden || 0), 0);
                              const dayHasAbsence = dayNonZAEntries.some((e) =>
                                ["Urlaub", "Krankenstand", "Weiterbildung", "Arztbesuch"].includes(e.taetigkeit || "")
                              );
                              const dayTarget = getNormalWorkingHours(day.date);
                              const dayDiff = (dayHasAbsence && dayNonZATotal <= dayTarget + 0.01)
                                ? 0
                                : dayTarget === 0
                                ? dayNonZATotal
                                : dayNonZATotal - dayTarget;
                              const hasMultipleEntries = dayEntries.length > 1;

                              if (dayEntries.length === 0) {
                                return (
                                  <TableRow
                                    key={day.dayNumber}
                                    className={cn(day.isWeekend && "bg-muted/30", "text-muted-foreground")}
                                  >
                                    <TableCell className="font-medium">
                                      <div className="flex flex-col">
                                        <span>{day.dayNumber}</span>
                                        <span className="text-xs text-muted-foreground">
                                          {format(day.date, "EEE", { locale: de })}
                                        </span>
                                      </div>
                                    </TableCell>
                                    <TableCell colSpan={isAdmin ? 9 : 8}></TableCell>
                                  </TableRow>
                                );
                              }

                              return dayEntries.map((entry, entryIndex) => {
                                const lunchBreak = calculateLunchBreak(entry);
                                const dayOvertime = dayDiff;
                                const project = entry.project_id ? projects[entry.project_id] : undefined;
                                const isRegie = entry.location_type === "regie" || entry.disturbance_id != null;
                                const ortIcon = isRegie ? "🧾" : entry.location_type === "baustelle" ? "🏗️" : entry.location_type === "werkstatt" ? "🔧" : "";
                                const ortText = isRegie ? "Arbeitsbericht" : entry.location_type === "baustelle" ? "Baustelle" : entry.location_type === "werkstatt" ? "Werkstatt" : "";
                                const kundeName = (entry as any).disturbances?.kunde_name;
                                const regieLabel = kundeName ? `Arbeitsbericht: ${kundeName}` : "Arbeitsbericht";
                                const projektName = isAbsenceType(entry.taetigkeit)
                                  ? entry.taetigkeit
                                  : isRegie ? (project ? `${regieLabel} · ${project.name}` : regieLabel) : project?.name || "";
                                const isFirstEntry = entryIndex === 0;
                                const isLastEntry = entryIndex === dayEntries.length - 1;

                                return (
                                  <TableRow
                                    key={entry.id}
                                    className={cn(
                                      day.isWeekend && "bg-muted/30",
                                      hasMultipleEntries && !isLastEntry && "border-b-0"
                                    )}
                                  >
                                    <TableCell className="font-medium">
                                      {isFirstEntry && (
                                        <div className="flex flex-col">
                                          <span>{day.dayNumber}</span>
                                          <span className="text-xs text-muted-foreground">
                                            {format(day.date, "EEE", { locale: de })}
                                          </span>
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-1">
                                        <span>{entry.start_time?.substring(0, 5)}</span>
                                        <span>-</span>
                                        <span>{lunchBreak ? lunchBreak.start : entry.end_time?.substring(0, 5)}</span>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      {lunchBreak && entry.pause_minutes > 0 && (
                                        <span className="text-sm">{lunchBreak.start} - {lunchBreak.end}</span>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {lunchBreak && (
                                        <div className="flex items-center gap-1">
                                          <span>{lunchBreak.end}</span>
                                          <span>-</span>
                                          <span>{entry.end_time?.substring(0, 5)}</span>
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right font-medium">
                                      {Number(entry.stunden || 0).toFixed(2)} h
                                      {hasMultipleEntries && isLastEntry && (
                                        <div className="text-xs text-primary font-bold mt-1">
                                          Σ {dayTotalHours.toFixed(2)} h
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {isLastEntry && dayOvertime !== 0 && employeeBalances?.monthComplete && (
                                        <span className={`font-medium ${dayOvertime > 0 ? "text-green-600" : "text-red-600"}`}>
                                          {dayOvertime > 0 ? "+" : ""}{dayOvertime.toFixed(2)} h
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <span className="flex items-center gap-1">
                                        <span>{ortIcon}</span>
                                        <span className="text-sm">{ortText}</span>
                                      </span>
                                    </TableCell>
                                    <TableCell className="max-w-[120px] truncate">
                                      {projektName}
                                    </TableCell>
                                    <TableCell className="max-w-[120px] truncate">
                                      {entry.taetigkeit}
                                    </TableCell>
                                    {isAdmin && (
                                      <TableCell className="w-[72px] px-2 text-right">
                                        <div className="flex items-center justify-end gap-0.5">
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={() => openEditDialog(entry)}
                                            aria-label="Eintrag bearbeiten"
                                            title="Bearbeiten"
                                          >
                                            <Pencil className="h-4 w-4" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={() => openDeleteDialog(entry)}
                                            aria-label="Eintrag löschen"
                                            title="Löschen"
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      </TableCell>
                                    )}
                                  </TableRow>
                                );
                              });
                            })
                          )}
                        </TableBody>
                        <TableFooter>
                          {summaryRows.map((row) => (
                            <TableRow key={row.key}>
                              <TableCell colSpan={4} className="text-right font-bold">
                                {row.label}:
                              </TableCell>
                              <TableCell className="text-right font-bold">
                                {reportMetrics.actual[row.key].toFixed(2)} h
                              </TableCell>
                              <TableCell className="text-right font-bold">
                                {row.key === "gesamtsumme" ? `${reportMetrics.totalOvertime.toFixed(2)} h` : ""}
                              </TableCell>
                              <TableCell colSpan={isAdmin ? 4 : 3}></TableCell>
                            </TableRow>
                          ))}
                        </TableFooter>
                      </Table>
                    </ScrollArea>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="projekte">
            <ProjectHoursReport initialSelectedProjectId={initialProjectId} />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={closeEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stundeneintrag bearbeiten</DialogTitle>
            <DialogDescription>
              {editingEntry ? format(parseISO(editingEntry.datum), "EEEE, dd. MMMM yyyy", { locale: de }) : ""}
            </DialogDescription>
          </DialogHeader>

          {editingEntry && (
            <div className="space-y-4">
              {/* Tätigkeit */}
              <div className="space-y-2">
                <Label htmlFor="edit-activity">Tätigkeit</Label>
                <Input
                  id="edit-activity"
                  value={editingEntry.taetigkeit}
                  onChange={(event) => setEditingEntry((current) => current ? { ...current, taetigkeit: event.target.value } : current)}
                />
              </div>

              {/* Abwesenheit: nur Stunden */}
              {isAbsenceType(editingEntry.taetigkeit) ? (
                <div className="space-y-2">
                  <Label htmlFor="edit-hours">Stunden</Label>
                  <Input
                    id="edit-hours"
                    type="number"
                    min="0.25"
                    step="0.125"
                    value={editingEntry.stunden}
                    onChange={(event) => setEditingEntry((current) => current ? { ...current, stunden: event.target.value } : current)}
                  />
                </div>
              ) : (
                <>
                  {/* Von - Bis */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Von</Label>
                      <Input
                        type="time"
                        step="900"
                        value={editingEntry.start_time}
                        onChange={(e) => setEditingEntry((c) => c ? { ...c, start_time: e.target.value } : c)}
                        className="font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Bis</Label>
                      <Input
                        type="time"
                        step="1"
                        value={editingEntry.end_time}
                        onChange={(e) => setEditingEntry((c) => c ? { ...c, end_time: e.target.value } : c)}
                        className="font-mono"
                      />
                    </div>
                  </div>

                  {/* Pausen */}
                  <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                    <p className="text-sm font-medium text-muted-foreground">Pausen</p>

                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="edit-breakfast"
                          checked={editingEntry.has_breakfast_break}
                          disabled={editBreakfastTaken && !editingEntry.has_breakfast_break}
                          onCheckedChange={(checked) => setEditingEntry((c) => c ? { ...c, has_breakfast_break: !!checked } : c)}
                        />
                        <Label htmlFor="edit-breakfast" className="flex-1 text-sm cursor-pointer">
                          Vormittagspause <span className="text-xs text-muted-foreground">(zählt als Arbeitszeit)</span>
                          {editBreakfastTaken && !editingEntry.has_breakfast_break && <span className="text-xs text-muted-foreground ml-1">– bereits eingetragen</span>}
                        </Label>
                      </div>
                      {editingEntry.has_breakfast_break && (
                        <div className="grid grid-cols-2 gap-2 pl-8">
                          <div>
                            <label className="text-xs text-muted-foreground">Von</label>
                            <Input type="time" value={editingEntry.breakfast_start} onChange={(e) => setEditingEntry((c) => c ? { ...c, breakfast_start: e.target.value } : c)} className="h-9 text-sm font-mono" />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Bis</label>
                            <Input type="time" value={editingEntry.breakfast_end} onChange={(e) => setEditingEntry((c) => c ? { ...c, breakfast_end: e.target.value } : c)} className="h-9 text-sm font-mono" />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="edit-lunch"
                          checked={editingEntry.has_lunch_break}
                          disabled={editLunchTaken && !editingEntry.has_lunch_break}
                          onCheckedChange={(checked) => setEditingEntry((c) => c ? { ...c, has_lunch_break: !!checked } : c)}
                        />
                        <Label htmlFor="edit-lunch" className="flex-1 text-sm cursor-pointer">
                          Mittagspause <span className="text-xs text-destructive">(wird abgezogen)</span>
                          {editLunchTaken && !editingEntry.has_lunch_break && <span className="text-xs text-muted-foreground ml-1">– bereits eingetragen</span>}
                        </Label>
                      </div>
                      {editingEntry.has_lunch_break && (
                        <div className="grid grid-cols-2 gap-2 pl-8">
                          <div>
                            <label className="text-xs text-muted-foreground">Von</label>
                            <Input type="time" value={editingEntry.lunch_start} onChange={(e) => setEditingEntry((c) => c ? { ...c, lunch_start: e.target.value } : c)} className="h-9 text-sm font-mono" />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Bis</label>
                            <Input type="time" value={editingEntry.lunch_end} onChange={(e) => setEditingEntry((c) => c ? { ...c, lunch_end: e.target.value } : c)} className="h-9 text-sm font-mono" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Ort + Projekt */}
                  <div className="space-y-2">
                    <Label>Ort</Label>
                    <Select
                      value={editingEntry.location_type}
                      onValueChange={(value) => setEditingEntry((current) => current ? {
                        ...current,
                        location_type: value,
                        project_id: value === "baustelle" ? current.project_id : null,
                        disturbanceIds: value === "regie" ? current.disturbanceIds : [],
                      } : current)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="baustelle">Baustelle</SelectItem>
                        <SelectItem value="werkstatt">Werkstatt</SelectItem>
                        <SelectItem value="regie">Arbeitsbericht</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {editingEntry.location_type === "baustelle" && (
                    <div className="space-y-2">
                      <Label>Projekt</Label>
                      <Select
                        value={editingEntry.project_id ?? "__none__"}
                        onValueChange={(value) => setEditingEntry((current) => current ? { ...current, project_id: value === "__none__" ? null : value } : current)}
                      >
                        <SelectTrigger><SelectValue placeholder="Projekt auswählen" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Kein Projekt</SelectItem>
                          {Object.values(projects).map((project) => (
                            <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Berechnete Stunden */}
                  <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 flex items-center justify-between">
                    <span className="text-sm font-medium">Berechnete Arbeitszeit</span>
                    <span className="text-lg font-bold">
                      {(() => {
                        const s = timeToMinutes(editingEntry.start_time);
                        const e = timeToMinutes(editingEntry.end_time);
                        let m = e - s;
                        if (editingEntry.has_lunch_break) m -= Math.max(0, timeToMinutes(editingEntry.lunch_end) - timeToMinutes(editingEntry.lunch_start));
                        return Math.max(0, m / 60).toFixed(3);
                      })()} h
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => closeEditDialog(false)} disabled={isSavingEdit}>
              Abbrechen
            </Button>
            <Button onClick={handleSaveEdit} disabled={isSavingEdit || !editingEntry}>
              {isSavingEdit ? "Speichert..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={closeDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stundeneintrag löschen</DialogTitle>
            <DialogDescription>
              Dieser Vorgang löscht nur den ausgewählten Stundeneintrag und seine technischen Verknüpfungen.
            </DialogDescription>
          </DialogHeader>

          {entryToDelete && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Datum</span>
                <span className="font-medium">{format(parseISO(entryToDelete.datum), "dd.MM.yyyy", { locale: de })}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Mitarbeiter</span>
                <span className="font-medium text-right">{getEmployeeDisplayName(entryToDelete.user_id)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Tätigkeit</span>
                <span className="font-medium text-right">{entryToDelete.taetigkeit || "—"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Zeitraum</span>
                <span className="font-medium">{entryToDelete.start_time?.substring(0, 5)} – {entryToDelete.end_time?.substring(0, 5)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Stunden</span>
                <span className="font-medium">{Number(entryToDelete.stunden || 0).toFixed(2)} h</span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => closeDeleteDialog(false)} disabled={isDeletingEntry}>
              Abbrechen
            </Button>
            <Button onClick={handleDeleteEntry} disabled={!entryToDelete || isDeletingEntry}>
              {isDeletingEntry ? "Löscht..." : "Eintrag löschen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
