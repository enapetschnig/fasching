import { useState, useEffect, useRef } from "react";
import { Clock, Plus, AlertTriangle, CheckCircle2, Calendar, Sun, Trash2, Info, Coffee, UtensilsCrossed, Copy, Zap, Check, ChevronsUpDown, WifiOff } from "lucide-react";
import { MultiEmployeeSelect } from "@/components/MultiEmployeeSelect";
import { PageHeader } from "@/components/PageHeader";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

import { useToast } from "@/hooks/use-toast";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useBreakValidation } from "@/hooks/useBreakValidation";
import { supabase } from "@/integrations/supabase/client";
import { toast as sonnerToast } from "sonner";
import {
  calculateSuggestedStartTime,
  calculateWorkTimeRange,
  calculateHoursFromTimes,
  blockSpansBreakfast,
  blockSpansLunch,
  getNormalWorkingHours,
  getWeeklyTargetHours,
  getTotalWorkingHours,
  timeToMinutes,
  isWorkingDay,
  DEFAULT_START_TIME,
  DEFAULT_END_TIME,
  LUNCH_BREAK_START,
  LUNCH_BREAK_END,
  LUNCH_BREAK_MINUTES,
  BREAKFAST_BREAK_START,
  BREAKFAST_BREAK_END,
  DAILY_WORK_HOURS,
} from "@/lib/workingHours";

type Project = {
  id: string;
  name: string;
  status: string;
  plz: string;
};

type ExistingEntry = {
  id: string;
  start_time: string;
  end_time: string;
  stunden: number;
  taetigkeit: string;
  project_name: string | null;
  plz: string | null;
  location_type?: string | null;
};

interface TimeBlock {
  id: string;
  locationType: "baustelle" | "werkstatt";
  projectId: string;
  taetigkeit: string;
  startTime: string;
  endTime: string;
  hasBreakfastBreak: boolean;
  hasLunchBreak: boolean;
  breakfastStart: string;
  breakfastEnd: string;
  lunchStart: string;
  lunchEnd: string;
  selectedEmployees: string[];
}

const createDefaultBlock = (startTime = DEFAULT_START_TIME): TimeBlock => ({
  id: crypto.randomUUID(),
  locationType: "baustelle",
  projectId: "",
  taetigkeit: "",
  startTime,
  endTime: "",
  hasBreakfastBreak: false,
  hasLunchBreak: false,
  breakfastStart: BREAKFAST_BREAK_START,
  breakfastEnd: BREAKFAST_BREAK_END,
  lunchStart: LUNCH_BREAK_START,
  lunchEnd: LUNCH_BREAK_END,
  selectedEmployees: [],
});

const ABSENCE_TYPES = ["Urlaub", "Krankenstand", "Weiterbildung", "Arztbesuch", "Zeitausgleich"];

const TimeTracking = () => {
  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();
  const submitLock = useRef(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [submittingAbsence, setSubmittingAbsence] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [projectSearchOpen, setProjectSearchOpen] = useState<Record<string, boolean>>({});
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPlz, setNewProjectPlz] = useState("");
  const [newProjectAddress, setNewProjectAddress] = useState("");
  const [newProjectKundeName, setNewProjectKundeName] = useState("");
  const [pendingBlockIdForNewProject, setPendingBlockIdForNewProject] = useState<string | null>(null);
  const [existingDayEntries, setExistingDayEntries] = useState<ExistingEntry[]>([]);
  const [loadingDayEntries, setLoadingDayEntries] = useState(false);
  const [showAbsenceDialog, setShowAbsenceDialog] = useState(false);
  const [absenceData, setAbsenceData] = useState({
    date: new Date().toISOString().split("T")[0],
    type: "urlaub" as "urlaub" | "krankenstand" | "weiterbildung" | "arztbesuch" | "zeitausgleich",
    document: null as File | null,
    customHours: "",
    rangeMode: false,
    dateFrom: new Date().toISOString().split("T")[0],
    dateTo: new Date().toISOString().split("T")[0],
  });
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([createDefaultBlock()]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [todayAssignments, setTodayAssignments] = useState<Array<{ project_id: string; project_name: string }>>([]);

  // Break validation: Prüft ob Pausen heute schon eingetragen sind
  const { breakfastTaken, lunchTaken, refresh: refreshBreaks } = useBreakValidation(currentUserId, selectedDate);

  // Plantafel-Zuweisungen laden
  const fetchAssignments = async (date: string, userId: string) => {
    const { data } = await supabase
      .from("worker_assignments")
      .select("project_id, projects(name)")
      .eq("user_id", userId)
      .eq("datum", date);
    if (data) {
      setTodayAssignments(
        data
          .filter((a: any) => a.project_id)
          .map((a: any) => ({ project_id: a.project_id, project_name: a.projects?.name || "" }))
      );
    } else {
      setTodayAssignments([]);
    }
  };

  // Gestern kopieren
  const copyYesterday = async () => {
    if (!currentUserId) return;
    const yesterday = new Date(selectedDate);
    yesterday.setDate(yesterday.getDate() - 1);
    // Gehe zurück bis zum letzten Arbeitstag (max 14 Tage)
    let attempts = 0;
    while (!isWorkingDay(yesterday) && attempts < 14) {
      yesterday.setDate(yesterday.getDate() - 1);
      attempts++;
    }
    if (attempts >= 14) {
      toast({ variant: "destructive", title: "Fehler", description: "Kein Arbeitstag in den letzten 2 Wochen gefunden." });
      return;
    }
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const { data } = await supabase
      .from("time_entries")
      .select("start_time, end_time, location_type, project_id, taetigkeit, has_breakfast_break, has_lunch_break")
      .eq("user_id", currentUserId)
      .eq("datum", yesterdayStr)
      .order("start_time");

    if (!data || data.length === 0) {
      toast({ variant: "destructive", title: "Keine Einträge", description: `Am letzten Arbeitstag (${format(yesterday, "dd.MM.")}) gibt es keine Einträge.` });
      return;
    }

    // Nur reguläre Arbeit kopieren (keine Abwesenheiten)
    const workEntries = data.filter((e) => !ABSENCE_TYPES.includes(e.taetigkeit || ""));
    if (workEntries.length === 0) {
      toast({ variant: "destructive", title: "Keine Arbeit", description: "Am letzten Arbeitstag wurden nur Abwesenheiten eingetragen." });
      return;
    }

    const newBlocks: TimeBlock[] = workEntries.map((e) => ({
      id: crypto.randomUUID(),
      locationType: (e.location_type === "werkstatt" ? "werkstatt" : "baustelle") as "baustelle" | "werkstatt",
      projectId: e.project_id || "",
      taetigkeit: e.taetigkeit || "",
      startTime: e.start_time?.substring(0, 5) || DEFAULT_START_TIME,
      endTime: e.end_time?.substring(0, 8) || "",
      hasBreakfastBreak: !breakfastTaken && (e.has_breakfast_break || false),
      hasLunchBreak: !lunchTaken && (e.has_lunch_break || false),
      breakfastStart: BREAKFAST_BREAK_START,
      breakfastEnd: BREAKFAST_BREAK_END,
      lunchStart: LUNCH_BREAK_START,
      lunchEnd: LUNCH_BREAK_END,
      selectedEmployees: [],
    }));

    setTimeBlocks(newBlocks);
    toast({ title: "Kopiert", description: `${newBlocks.length} Zeitblock(s) vom ${format(yesterday, "dd.MM.")} übernommen` });
  };

  // Normaltag: 07:00–17:07:30, Projekt aus Plantafel, beide Pausen
  const applyQuickDay = () => {
    const dateObj = new Date(selectedDate);
    if (!isWorkingDay(dateObj)) {
      toast({ variant: "destructive", title: "Kein Arbeitstag", description: "An diesem Tag wird nicht gearbeitet (MO-DO)" });
      return;
    }

    const projectId = todayAssignments.length === 1 ? todayAssignments[0].project_id : "";

    setTimeBlocks([{
      id: crypto.randomUUID(),
      locationType: "baustelle",
      projectId,
      taetigkeit: "",
      startTime: DEFAULT_START_TIME,
      endTime: DEFAULT_END_TIME,
      hasBreakfastBreak: !breakfastTaken,
      hasLunchBreak: !lunchTaken,
      breakfastStart: BREAKFAST_BREAK_START,
      breakfastEnd: BREAKFAST_BREAK_END,
      lunchStart: LUNCH_BREAK_START,
      lunchEnd: LUNCH_BREAK_END,
      selectedEmployees: [],
    }]);

    const projectInfo = todayAssignments.length === 1
      ? ` – Projekt: ${todayAssignments[0].project_name}`
      : todayAssignments.length > 1
      ? " – Bitte Projekt manuell wählen (mehrere Einteilungen)"
      : "";
    toast({ title: "Normaltag ausgefüllt", description: `07:00–17:07:30 mit Pausen${projectInfo}` });
  };

  // Reststunden auffüllen: Lücken im Tag erkennen
  const fillGaps = () => {
    if (existingDayEntries.length === 0) {
      applyQuickDay();
      return;
    }

    const dayStart = timeToMinutes(DEFAULT_START_TIME); // 07:00
    const dayEnd = timeToMinutes(DEFAULT_END_TIME); // 17:07:30

    // Bestehende Zeitblöcke sortieren
    const occupied = existingDayEntries
      .filter((e) => !ABSENCE_TYPES.includes(e.taetigkeit))
      .map((e) => ({
        start: timeToMinutes(e.start_time?.substring(0, 8) || "00:00"),
        end: timeToMinutes(e.end_time?.substring(0, 8) || "00:00"),
      }))
      .sort((a, b) => a.start - b.start);

    if (occupied.length === 0) {
      applyQuickDay();
      return;
    }

    // Lücken finden
    const gaps: Array<{ start: number; end: number }> = [];
    let cursor = dayStart;

    for (const block of occupied) {
      if (block.start > cursor + 1) {
        gaps.push({ start: cursor, end: block.start });
      }
      cursor = Math.max(cursor, block.end);
    }
    if (cursor < dayEnd - 1) {
      gaps.push({ start: cursor, end: dayEnd });
    }

    if (gaps.length === 0) {
      toast({ title: "Keine Lücken", description: "Der Tag ist bereits vollständig ausgefüllt." });
      return;
    }

    // Minuten seit Mitternacht → HH:MM String (kein Sekunden, damit time-input es akzeptiert)
    const minsToStr = (totalMins: number): string => {
      const rounded = Math.round(totalMins);
      const h = Math.floor(rounded / 60);
      const m = rounded % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    const newBlocks: TimeBlock[] = gaps.map((gap) => {
      const startStr = minsToStr(gap.start);
      const endStr = minsToStr(gap.end);
      const spansBreakfast = gap.start <= timeToMinutes(BREAKFAST_BREAK_START) && gap.end >= timeToMinutes(BREAKFAST_BREAK_END);
      const spansLunch = gap.start <= timeToMinutes(LUNCH_BREAK_START) && gap.end >= timeToMinutes(LUNCH_BREAK_END);

      return {
        id: crypto.randomUUID(),
        locationType: "baustelle" as const,
        projectId: todayAssignments.length === 1 ? todayAssignments[0].project_id : "",
        taetigkeit: "",
        startTime: startStr,
        endTime: endStr,
        hasBreakfastBreak: !breakfastTaken && spansBreakfast,
        hasLunchBreak: !lunchTaken && spansLunch,
        breakfastStart: BREAKFAST_BREAK_START,
        breakfastEnd: BREAKFAST_BREAK_END,
        lunchStart: LUNCH_BREAK_START,
        lunchEnd: LUNCH_BREAK_END,
        selectedEmployees: [],
      };
    });

    setTimeBlocks(newBlocks);
    const totalGapHours = gaps.reduce((sum, g) => sum + (g.end - g.start) / 60, 0);
    toast({ title: "Reststunden", description: `${newBlocks.length} Lücke(n) gefunden – ${totalGapHours.toFixed(1)}h` });
  };

  // Prüfe ob innerhalb der aktuellen Blöcke schon eine Pause ausgewählt ist
  const breakfastInBlocks = timeBlocks.some((b) => b.hasBreakfastBreak);
  const lunchInBlocks = timeBlocks.some((b) => b.hasLunchBreak);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setCurrentUserId(user.id);
        fetchAssignments(selectedDate, user.id);
      }
    });
  }, []);

  useEffect(() => {
    if (currentUserId) fetchAssignments(selectedDate, currentUserId);
  }, [selectedDate, currentUserId]);

  const getBlockHours = (block: TimeBlock): number => {
    if (!block.startTime || !block.endTime) return 0;
    const startMin = timeToMinutes(block.startTime);
    const endMin = timeToMinutes(block.endTime);
    if (endMin <= startMin) return 0;
    let workMinutes = endMin - startMin;
    // Mittagspause abziehen (benutzerdefinierte Zeiten)
    if (block.hasLunchBreak && block.lunchStart && block.lunchEnd) {
      const lunchMin = timeToMinutes(block.lunchEnd) - timeToMinutes(block.lunchStart);
      workMinutes -= Math.max(0, lunchMin);
    }
    // Vormittagspause zählt als Arbeitszeit -> nicht abziehen
    return Math.max(0, workMinutes / 60);
  };

  const getLastExistingEndTime = (entries: ExistingEntry[] = existingDayEntries): string | null => {
    if (!entries.length) return null;
    return entries[entries.length - 1].end_time;
  };

  const getAbsenceLabel = (type: string) => {
    const map: Record<string, string> = {
      urlaub: "Urlaub",
      krankenstand: "Krankenstand",
      weiterbildung: "Weiterbildung",
      arztbesuch: "Arztbesuch",
      zeitausgleich: "Zeitausgleich",
    };
    return map[type] || type;
  };

  const getEntryLabel = (entry: ExistingEntry) => {
    if (entry.location_type === "regie") return "Arbeitsbericht";
    return entry.project_name || entry.taetigkeit;
  };

  const fetchProjects = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status, plz")
      .eq("status", "aktiv")
      .order("name");

    if (data) setProjects(data);
    setLoading(false);
  };

  const fetchExistingDayEntries = async (date: string) => {
    setLoadingDayEntries(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoadingDayEntries(false);
      return;
    }

    const { data, error } = await supabase
      .from("time_entries")
      .select(`id, start_time, end_time, stunden, taetigkeit, location_type, projects (name, plz)`)
      .eq("user_id", user.id)
      .eq("datum", date)
      .order("start_time");

    if (!error && data) {
      const entries: ExistingEntry[] = data.map((entry: any) => ({
        id: entry.id,
        start_time: entry.start_time,
        end_time: entry.end_time,
        stunden: entry.stunden,
        taetigkeit: entry.taetigkeit,
        location_type: entry.location_type,
        project_name: entry.projects?.name || null,
        plz: entry.projects?.plz || null,
      }));
      setExistingDayEntries(entries);
      const lastEnd = entries.length ? entries[entries.length - 1].end_time : null;
      setTimeBlocks([createDefaultBlock(lastEnd || DEFAULT_START_TIME)]);
    } else {
      setExistingDayEntries([]);
      setTimeBlocks([createDefaultBlock()]);
    }

    setLoadingDayEntries(false);
    refreshBreaks();
  };

  useEffect(() => {
    fetchExistingDayEntries(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    fetchProjects();
    const channel = supabase
      .channel("time-tracking-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, fetchProjects)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const updateBlock = (blockId: string, updates: Partial<TimeBlock>) => {
    setTimeBlocks((prev) => prev.map((block) => {
      if (block.id !== blockId) return block;
      const updated = { ...block, ...updates };
      // Auto-check breaks based on time range
      if ("startTime" in updates || "endTime" in updates) {
        const st = updated.startTime;
        const et = updated.endTime;
        if (!breakfastTaken && !breakfastInBlocks) {
          updated.hasBreakfastBreak = blockSpansBreakfast(st, et);
        }
        if (!lunchTaken && !lunchInBlocks) {
          updated.hasLunchBreak = blockSpansLunch(st, et);
        }
      }
      return updated;
    }));
  };

  const updateBlockEmployees = (blockId: string, employees: string[]) => {
    setTimeBlocks((prev) => prev.map((block) => (
      block.id === blockId ? { ...block, selectedEmployees: employees } : block
    )));
  };

  const addTimeBlock = () => {
    const lastBlock = timeBlocks[timeBlocks.length - 1];
    const nextStart = lastBlock?.endTime || getLastExistingEndTime() || DEFAULT_START_TIME;
    setTimeBlocks((prev) => [...prev, createDefaultBlock(nextStart)]);
  };

  const removeBlock = (blockId: string) => {
    setTimeBlocks((prev) => prev.filter((block) => block.id !== blockId));
  };

  const calculateTotalHours = (): string => {
    return timeBlocks.reduce((sum, block) => sum + getBlockHours(block), 0).toFixed(2);
  };

  const applyFullDayPreset = () => {
    const dateObj = new Date(selectedDate);
    if (!isWorkingDay(dateObj)) {
      toast({ variant: "destructive", title: "Kein Arbeitstag", description: "An diesem Tag wird nicht gearbeitet (MO-DO)" });
      return;
    }

    setTimeBlocks([{
      ...createDefaultBlock(),
      startTime: DEFAULT_START_TIME,
      endTime: DEFAULT_END_TIME,
      hasBreakfastBreak: !breakfastTaken,
      hasLunchBreak: !lunchTaken,
    }]);
  };

  const calculateAbsenceTimes = (date: Date, hours: number) => {
    const calculated = calculateWorkTimeRange(date, hours, DEFAULT_START_TIME);
    return {
      start_time: calculated.startTime,
      end_time: calculated.endTime,
      pause_minutes: calculated.pauseMinutes,
      pause_start: calculated.pauseStart || null,
      pause_end: calculated.pauseEnd || null,
    };
  };

  const getWorkdaysInRange = (from: string, to: string): string[] => {
    const days: string[] = [];
    const current = new Date(from);
    const end = new Date(to);
    while (current <= end) {
      if (isWorkingDay(current)) {
        days.push(current.toISOString().split("T")[0]);
      }
      current.setDate(current.getDate() + 1);
    }
    return days;
  };

  const handleCreateNewProject = async () => {
    if (creatingProject) return;
    if (!newProjectName.trim() || !newProjectPlz.trim()) {
      sonnerToast.error("Name und PLZ sind Pflichtfelder");
      return;
    }
    if (!/^\d{4,5}$/.test(newProjectPlz)) {
      sonnerToast.error("PLZ muss 4-5 Ziffern haben");
      return;
    }

    setCreatingProject(true);
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: newProjectName.trim(), plz: newProjectPlz.trim(), adresse: newProjectAddress.trim() || null, kunde_name: newProjectKundeName.trim() || null, status: "aktiv" })
      .select()
      .single();

    if (error) {
      sonnerToast.error(error.code === "23505" ? "Ein Projekt mit diesem Namen und PLZ existiert bereits" : "Projekt konnte nicht erstellt werden");
      setCreatingProject(false);
      return;
    }

    sonnerToast.success("Projekt erfolgreich erstellt");
    if (pendingBlockIdForNewProject) updateBlock(pendingBlockIdForNewProject, { projectId: data.id });
    setShowNewProjectDialog(false);
    setNewProjectName("");
    setNewProjectPlz("");
    setNewProjectAddress("");
    setNewProjectKundeName("");
    setPendingBlockIdForNewProject(null);
    setCreatingProject(false);
  };

  const handleAbsenceSubmit = async () => {
    if (submittingAbsence) return;
    setSubmittingAbsence(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSubmittingAbsence(false);
      return;
    }

    if (absenceData.rangeMode) {
      const workdays = getWorkdaysInRange(absenceData.dateFrom, absenceData.dateTo);
      if (workdays.length === 0) {
        toast({ variant: "destructive", title: "Fehler", description: "Keine Arbeitstage im gewählten Zeitraum (MO-DO)." });
        setSubmittingAbsence(false);
        return;
      }

      const { data: allExisting } = await supabase
        .from("time_entries")
        .select("datum, stunden, taetigkeit")
        .eq("user_id", user.id)
        .gte("datum", absenceData.dateFrom)
        .lte("datum", absenceData.dateTo);

      const existingByDate = new Map<string, { hours: number; absenceHours: number }>();
      (allExisting || []).forEach((entry) => {
        const prev = existingByDate.get(entry.datum) || { hours: 0, absenceHours: 0 };
        prev.hours += Number(entry.stunden);
        if (ABSENCE_TYPES.includes(entry.taetigkeit || "")) prev.absenceHours += Number(entry.stunden);
        existingByDate.set(entry.datum, prev);
      });

      const inserts: any[] = [];
      const skipped: string[] = [];

      for (const day of workdays) {
        const dateObj = new Date(day);
        const dailyTarget = getTotalWorkingHours(dateObj);
        const hours = getNormalWorkingHours(dateObj);
        const existing = existingByDate.get(day);

        if (existing && (existing.hours + hours > dailyTarget + 0.01 || existing.absenceHours >= dailyTarget)) {
          skipped.push(day);
          continue;
        }

        const absenceTimes = calculateAbsenceTimes(dateObj, hours);
        inserts.push({
          user_id: user.id,
          datum: day,
          project_id: null,
          taetigkeit: getAbsenceLabel(absenceData.type),
          stunden: hours,
          start_time: absenceTimes.start_time,
          end_time: absenceTimes.end_time,
          pause_minutes: absenceTimes.pause_minutes,
          pause_start: absenceTimes.pause_start,
          pause_end: absenceTimes.pause_end,
          location_type: "baustelle",
          notizen: null,
          week_type: null,
        });
      }

      if (inserts.length === 0) {
        toast({ variant: "destructive", title: "Keine Buchung möglich", description: "Alle Tage im Zeitraum sind bereits belegt." });
        setSubmittingAbsence(false);
        return;
      }

      const { error } = await supabase.from("time_entries").insert(inserts);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Konnte nicht gespeichert werden" });
      } else {
        toast({ title: "Erfolg", description: skipped.length ? `${inserts.length} Tage gebucht, ${skipped.length} übersprungen.` : `${inserts.length} Tage ${getAbsenceLabel(absenceData.type)} gebucht.` });
        setShowAbsenceDialog(false);
        fetchExistingDayEntries(selectedDate);
      }
      setSubmittingAbsence(false);
      return;
    }

    // Single day absence
    const selectedDateObj = new Date(absenceData.date);
    const workingHours = absenceData.customHours ? parseFloat(absenceData.customHours) : getNormalWorkingHours(selectedDateObj);
    const { data: existingEntries } = await supabase
      .from("time_entries")
      .select("id, stunden, taetigkeit")
      .eq("user_id", user.id)
      .eq("datum", absenceData.date);

    const existingHours = (existingEntries || []).reduce((sum, entry) => sum + Number(entry.stunden), 0);
    const dailyTarget = getTotalWorkingHours(selectedDateObj);
    if (existingHours + workingHours > dailyTarget + 0.01) {
      toast({ variant: "destructive", title: "Stunden überschritten", description: `Bereits ${existingHours.toFixed(1)}h gebucht.` });
      setSubmittingAbsence(false);
      return;
    }

    const absenceTimes = calculateAbsenceTimes(selectedDateObj, workingHours);
    const { error } = await supabase.from("time_entries").insert({
      user_id: user.id,
      datum: absenceData.date,
      project_id: null,
      taetigkeit: getAbsenceLabel(absenceData.type),
      stunden: workingHours,
      start_time: absenceTimes.start_time,
      end_time: absenceTimes.end_time,
      pause_minutes: absenceTimes.pause_minutes,
      pause_start: absenceTimes.pause_start,
      pause_end: absenceTimes.pause_end,
      location_type: "baustelle",
      notizen: null,
      week_type: null,
    });

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Konnte nicht gespeichert werden" });
    } else {
      toast({ title: "Erfolg", description: `${getAbsenceLabel(absenceData.type)} (${workingHours}h) erfasst` });
      setShowAbsenceDialog(false);
      fetchExistingDayEntries(selectedDate);
    }
    setSubmittingAbsence(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      submitLock.current = false;
      setSaving(false);
      return;
    }

    // Validation
    for (let i = 0; i < timeBlocks.length; i++) {
      const block = timeBlocks[i];
      const blockNum = i + 1;
      const blockHours = getBlockHours(block);

      if (!block.startTime || !block.endTime) {
        toast({ variant: "destructive", title: "Fehler", description: `Block ${blockNum}: Bitte Von- und Bis-Zeit eingeben` });
        submitLock.current = false;
        setSaving(false);
        return;
      }

      if (timeToMinutes(block.endTime) <= timeToMinutes(block.startTime)) {
        toast({ variant: "destructive", title: "Fehler", description: `Block ${blockNum}: Bis-Zeit muss nach Von-Zeit liegen` });
        submitLock.current = false;
        setSaving(false);
        return;
      }

      if (block.locationType === "baustelle" && !block.projectId) {
        toast({ variant: "destructive", title: "Projekt fehlt", description: `Block ${blockNum}: Bitte ein Projekt auswählen (Pflicht bei Baustelle)` });
        submitLock.current = false;
        setSaving(false);
        return;
      }

      if (blockHours <= 0) {
        toast({ variant: "destructive", title: "Fehler", description: `Block ${blockNum}: Keine gültigen Arbeitsstunden` });
        submitLock.current = false;
        setSaving(false);
        return;
      }
    }

    // Check existing entries
    const { data: existingEntries } = await supabase
      .from("time_entries")
      .select("id, start_time, end_time, taetigkeit, stunden")
      .eq("user_id", user.id)
      .eq("datum", selectedDate);

    if (existingEntries && existingEntries.length > 0) {
      const absenceEntries = existingEntries.filter((entry) => ABSENCE_TYPES.includes(entry.taetigkeit));
      const absenceHours = absenceEntries.reduce((sum, entry) => sum + Number(entry.stunden), 0);
      const dailyTarget = getTotalWorkingHours(new Date(selectedDate));

      if (absenceEntries.length > 0 && absenceHours >= dailyTarget && dailyTarget > 0) {
        toast({ variant: "destructive", title: "Tag blockiert", description: `Für diesen Tag sind bereits ${absenceHours.toFixed(1)}h Abwesenheit eingetragen.` });
        submitLock.current = false;
        setSaving(false);
        return;
      }

      const existingHoursTotal = existingEntries.reduce((sum, entry) => sum + Number(entry.stunden), 0);
      const newHoursTotal = timeBlocks.reduce((sum, block) => sum + getBlockHours(block), 0);
      const maxHours = dailyTarget > 0 ? dailyTarget + 4 : 16;
      if (existingHoursTotal + newHoursTotal > maxHours) {
        toast({ variant: "destructive", title: "Zu viele Stunden", description: `Tagessumme würde ${(existingHoursTotal + newHoursTotal).toFixed(1)}h betragen (max. ${maxHours}h).` });
        submitLock.current = false;
        setSaving(false);
        return;
      }

      // Overlap check within new blocks
      for (let i = 0; i < timeBlocks.length; i++) {
        for (let j = i + 1; j < timeBlocks.length; j++) {
          const aStart = timeToMinutes(timeBlocks[i].startTime);
          const aEnd = timeToMinutes(timeBlocks[i].endTime);
          const bStart = timeToMinutes(timeBlocks[j].startTime);
          const bEnd = timeToMinutes(timeBlocks[j].endTime);
          if (aStart < bEnd && aEnd > bStart) {
            toast({ variant: "destructive", title: "Zeitüberschneidung", description: `Block ${i + 1} und Block ${j + 1} überschneiden sich.` });
            submitLock.current = false;
            setSaving(false);
            return;
          }
        }
      }

      // Time overlap check with existing entries
      for (const entry of existingEntries) {
        if (ABSENCE_TYPES.includes(entry.taetigkeit)) continue;
        const existingStart = timeToMinutes(entry.start_time);
        const existingEnd = timeToMinutes(entry.end_time);

        for (let i = 0; i < timeBlocks.length; i++) {
          const block = timeBlocks[i];
          const blockStart = timeToMinutes(block.startTime);
          const blockEnd = timeToMinutes(block.endTime);
          if (blockStart < existingEnd && blockEnd > existingStart) {
            toast({ variant: "destructive", title: "Zeitüberschneidung", description: `Block ${i + 1} überschneidet mit bestehendem Eintrag.` });
            submitLock.current = false;
            setSaving(false);
            return;
          }
        }
      }
    }

    // Save entries
    let totalEntriesCreated = 0;
    let hasError = false;

    for (const block of timeBlocks) {
      const blockHours = getBlockHours(block);
      const lunchPauseMin = block.hasLunchBreak
        ? Math.max(0, timeToMinutes(block.lunchEnd) - timeToMinutes(block.lunchStart))
        : 0;

      const entryData = {
        datum: selectedDate,
        project_id: block.locationType === "baustelle" ? (block.projectId || null) : null,
        disturbance_id: null,
        taetigkeit: block.taetigkeit || "",
        stunden: blockHours,
        start_time: block.startTime,
        end_time: block.endTime,
        pause_minutes: Math.round(lunchPauseMin),
        pause_start: block.hasLunchBreak ? block.lunchStart : null,
        pause_end: block.hasLunchBreak ? block.lunchEnd : null,
        location_type: block.locationType,
        has_breakfast_break: block.hasBreakfastBreak,
        has_lunch_break: block.hasLunchBreak,
        notizen: null,
        week_type: null,
      };

      const mainEntry = { ...entryData, user_id: user.id };
      const teamEntries = block.selectedEmployees.map((workerId) => ({ ...entryData, user_id: workerId }));

      const { data: result, error: functionError } = await supabase.functions.invoke("create-team-time-entries", {
        body: { mainEntry, teamEntries, disturbanceIds: [], createWorkerLinks: true },
      });

      if (functionError || !result?.success) {
        hasError = true;
        console.error("Error creating time entries:", functionError || result?.error);
        continue;
      }

      totalEntriesCreated += result.totalCreated || 1;
    }

    if (!hasError) {
      const teamInfo = timeBlocks.some((block) => block.selectedEmployees.length > 0) ? " (inkl. Team-Mitglieder)" : "";
      toast({ title: "Erfolg", description: `${totalEntriesCreated} Eintrag/Einträge gespeichert${teamInfo}` });
      await fetchExistingDayEntries(selectedDate);
    } else {
      toast({ variant: "destructive", title: "Fehler", description: "Einige Einträge konnten nicht gespeichert werden" });
    }

    submitLock.current = false;
    setSaving(false);
  };

  const absenceEntries = existingDayEntries.filter((entry) => ABSENCE_TYPES.includes(entry.taetigkeit));
  const absenceHoursTotal = absenceEntries.reduce((sum, entry) => sum + Number(entry.stunden), 0);
  const dailyTargetForDate = getTotalWorkingHours(new Date(selectedDate));
  const isDayBlocked = absenceEntries.length > 0 && absenceHoursTotal >= dailyTargetForDate && dailyTargetForDate > 0;
  const isPartialAbsence = absenceEntries.length > 0 && !isDayBlocked;

  if (loading) return <div className="p-4">Lädt...</div>;

  return (
    <div className="min-h-screen bg-background">
      {!isOnline && (
        <div className="bg-destructive text-destructive-foreground px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4" />
          Keine Internetverbindung – Daten werden nicht übertragen
        </div>
      )}
      <PageHeader title="Zeiterfassung" backPath="/" />
      <div className="p-4">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                <CardTitle>Zeiterfassung</CardTitle>
              </div>
              <Button variant="outline" onClick={() => setShowAbsenceDialog(true)} className="gap-2">
                <Calendar className="h-4 w-4" />
                Abwesenheit
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Datum */}
              <div className="space-y-2">
                <Label htmlFor="date">Datum</Label>
                <Input id="date" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} required />
                <p className="text-sm text-muted-foreground">{format(new Date(selectedDate), "EEEE, dd. MMMM yyyy", { locale: de })}</p>
              </div>

              {/* Arbeitszeit-Info */}
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-sm">{getWeeklyTargetHours()}h Wochensoll</Badge>
                  <span className="text-sm text-muted-foreground">MO-DO: {DAILY_WORK_HOURS}h (07:00–17:07:30)</span>
                </div>
              </div>

              {/* Hinweis: Mehrere Baustellen */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Bei mehreren Baustellen bitte verschiedene Zeitblöcke eintragen. Die Vormittagspause (09:00-09:15) zählt als Arbeitszeit, die Mittagspause (12:00-12:30) wird abgezogen.
                </p>
              </div>

              {/* Bestehende Tageseinträge */}
              {loadingDayEntries ? (
                <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4 animate-pulse" />
                  Lade Tageseinträge...
                </div>
              ) : existingDayEntries.length > 0 ? (
                <div className={`rounded-lg p-4 space-y-3 ${isDayBlocked ? "bg-destructive/10 border border-destructive/30" : isPartialAbsence ? "bg-primary/5 border border-primary/20" : "bg-muted/40 border border-border"}`}>
                  <div className="flex items-center gap-2 font-medium text-sm">
                    {isDayBlocked ? (
                      <><AlertTriangle className="w-4 h-4 text-destructive" /><span className="text-destructive">Tag blockiert ({absenceEntries[0]?.taetigkeit})</span></>
                    ) : isPartialAbsence ? (
                      <><Calendar className="w-4 h-4 text-primary" /><span className="text-foreground">Teilweise abwesend</span></>
                    ) : (
                      <><Calendar className="w-4 h-4 text-muted-foreground" /><span className="text-foreground">Bereits gebuchte Zeiten</span></>
                    )}
                  </div>
                  {!isDayBlocked && (
                    <div className="space-y-1.5">
                      {existingDayEntries.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between text-sm bg-background/60 rounded px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">{entry.start_time.substring(0, 5)} - {entry.end_time.substring(0, 5)}</Badge>
                            <span className="truncate max-w-[150px]">{getEntryLabel(entry)}</span>
                          </div>
                          <span className="font-medium">{Number(entry.stunden).toFixed(2)}h</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" />Noch keine Einträge für diesen Tag</p>
                </div>
              )}

              {!isDayBlocked && (
                <>
                  {/* Plantafel-Hinweis */}
                  {todayAssignments.length > 0 && (
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                      <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-1">Heutige Einteilung (Plantafel):</p>
                      <div className="flex flex-wrap gap-1.5">
                        {todayAssignments.map((a, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">{a.project_name}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Schnellaktionen */}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="default" size="sm" onClick={applyQuickDay} className="flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" />Normaltag
                    </Button>
                    {existingDayEntries.length > 0 && (
                      <Button type="button" variant="default" size="sm" onClick={fillGaps} className="flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5" />Reststunden auffüllen
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={copyYesterday} className="flex items-center gap-1.5">
                      <Copy className="w-3.5 h-3.5" />Letzten Tag kopieren
                    </Button>
                  </div>

                  {/* Zeitblöcke */}
                  <div className="space-y-4">
                    {timeBlocks.map((block, index) => (
                      <div key={block.id} className="border rounded-lg p-4 space-y-4 bg-card">
                        {/* Block Header */}
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-sm flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            {timeBlocks.length > 1 ? `Zeitblock ${index + 1}` : "Arbeitszeit"}
                          </h3>
                          {timeBlocks.length > 1 && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => removeBlock(block.id)} className="min-h-[44px] min-w-[44px] text-destructive hover:text-destructive hover:bg-destructive/10">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>

                        {/* Arbeitsort */}
                        <div className="space-y-2">
                          <Label>Arbeitsort</Label>
                          <RadioGroup
                            value={block.locationType}
                            onValueChange={(value: "baustelle" | "werkstatt") => updateBlock(block.id, {
                              locationType: value,
                              projectId: value === "baustelle" ? block.projectId : "",
                            })}
                            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                          >
                            <div>
                              <RadioGroupItem value="baustelle" id={`baustelle-${block.id}`} className="peer sr-only" />
                              <Label htmlFor={`baustelle-${block.id}`} className="flex h-12 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent peer-data-[state=checked]:border-primary text-sm">Baustelle</Label>
                            </div>
                            <div>
                              <RadioGroupItem value="werkstatt" id={`werkstatt-${block.id}`} className="peer sr-only" />
                              <Label htmlFor={`werkstatt-${block.id}`} className="flex h-12 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent peer-data-[state=checked]:border-primary text-sm">Werkstatt</Label>
                            </div>
                          </RadioGroup>
                        </div>

                        {/* Projekt */}
                        {block.locationType === "baustelle" && (
                          <div className="space-y-2">
                            <Label>Projekt *</Label>
                            <Popover
                              open={projectSearchOpen[block.id] || false}
                              onOpenChange={(open) => setProjectSearchOpen(prev => ({ ...prev, [block.id]: open }))}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  aria-expanded={projectSearchOpen[block.id] || false}
                                  className="w-full justify-between font-normal"
                                >
                                  {block.projectId
                                    ? (() => { const p = projects.find(p => p.id === block.projectId); return p ? `${p.name} (${p.plz})` : "Projekt suchen..."; })()
                                    : "Projekt suchen..."}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-full p-0" align="start">
                                <Command>
                                  <CommandInput placeholder="Name oder PLZ eingeben..." />
                                  <CommandList>
                                    <CommandEmpty>Kein Projekt gefunden.</CommandEmpty>
                                    <CommandGroup>
                                      {projects.map((project) => (
                                        <CommandItem
                                          key={project.id}
                                          value={`${project.name} ${project.plz}`}
                                          onSelect={() => {
                                            updateBlock(block.id, { projectId: project.id });
                                            setProjectSearchOpen(prev => ({ ...prev, [block.id]: false }));
                                          }}
                                        >
                                          <Check className={cn("mr-2 h-4 w-4", block.projectId === project.id ? "opacity-100" : "opacity-0")} />
                                          {project.name} ({project.plz})
                                        </CommandItem>
                                      ))}
                                      <CommandItem
                                        value="__new__"
                                        onSelect={() => {
                                          setPendingBlockIdForNewProject(block.id);
                                          setShowNewProjectDialog(true);
                                          setProjectSearchOpen(prev => ({ ...prev, [block.id]: false }));
                                        }}
                                      >
                                        <Plus className="mr-2 h-4 w-4" />
                                        Neues Projekt erstellen
                                      </CommandItem>
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </div>
                        )}

                        {/* Tätigkeit */}
                        <div className="space-y-2">
                          <Label>Tätigkeit <span className="text-muted-foreground font-normal">(optional)</span></Label>
                          <Input value={block.taetigkeit} onChange={(e) => updateBlock(block.id, { taetigkeit: e.target.value })} placeholder="z.B. Heizungsmontage, Sanitärarbeiten..." />
                        </div>

                        {/* Von - Bis Zeiten */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Von</Label>
                            <Input
                              type="time"
                              value={block.startTime}
                              onChange={(e) => updateBlock(block.id, { startTime: e.target.value })}
                              className="text-center font-mono"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Bis</Label>
                            <Input
                              type="time"
                              value={block.endTime}
                              onChange={(e) => updateBlock(block.id, { endTime: e.target.value })}
                              className="text-center font-mono"
                            />
                            {block.endTime && block.endTime.includes(":30") && block.endTime.length > 5 && (
                              <p className="text-xs text-muted-foreground text-center">{block.endTime}</p>
                            )}
                          </div>
                        </div>

                        {/* Pausen */}
                        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                          <p className="text-sm font-medium text-muted-foreground">Pausen</p>

                          {/* Vormittagspause */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-3">
                              <Checkbox
                                id={`breakfast-${block.id}`}
                                checked={block.hasBreakfastBreak}
                                disabled={breakfastTaken || (breakfastInBlocks && !block.hasBreakfastBreak)}
                                onCheckedChange={(checked) => updateBlock(block.id, { hasBreakfastBreak: !!checked })}
                              />
                              <label htmlFor={`breakfast-${block.id}`} className="flex-1 flex items-center gap-2 text-sm cursor-pointer">
                                <Coffee className="w-4 h-4 text-amber-600" />
                                <span>Vormittagspause</span>
                                <Badge variant="outline" className="text-xs ml-auto">zählt als Arbeitszeit</Badge>
                              </label>
                            </div>
                            {block.hasBreakfastBreak && (
                              <div className="grid grid-cols-2 gap-2 pl-8">
                                <div>
                                  <label className="text-xs text-muted-foreground">Von</label>
                                  <Input type="time" value={block.breakfastStart} onChange={(e) => updateBlock(block.id, { breakfastStart: e.target.value })} className="h-9 text-sm font-mono" />
                                </div>
                                <div>
                                  <label className="text-xs text-muted-foreground">Bis</label>
                                  <Input type="time" value={block.breakfastEnd} onChange={(e) => updateBlock(block.id, { breakfastEnd: e.target.value })} className="h-9 text-sm font-mono" />
                                </div>
                              </div>
                            )}
                            {(breakfastTaken || (breakfastInBlocks && !block.hasBreakfastBreak)) && (
                              <p className="text-xs text-muted-foreground pl-8">Bereits eingetragen</p>
                            )}
                          </div>

                          {/* Mittagspause */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-3">
                              <Checkbox
                                id={`lunch-${block.id}`}
                                checked={block.hasLunchBreak}
                                disabled={lunchTaken || (lunchInBlocks && !block.hasLunchBreak)}
                                onCheckedChange={(checked) => updateBlock(block.id, { hasLunchBreak: !!checked })}
                              />
                              <label htmlFor={`lunch-${block.id}`} className="flex-1 flex items-center gap-2 text-sm cursor-pointer">
                                <UtensilsCrossed className="w-4 h-4 text-orange-600" />
                                <span>Mittagspause</span>
                                <Badge variant="outline" className="text-xs text-destructive border-destructive/30 ml-auto">wird abgezogen</Badge>
                              </label>
                            </div>
                            {block.hasLunchBreak && (
                              <div className="grid grid-cols-2 gap-2 pl-8">
                                <div>
                                  <label className="text-xs text-muted-foreground">Von</label>
                                  <Input type="time" value={block.lunchStart} onChange={(e) => updateBlock(block.id, { lunchStart: e.target.value })} className="h-9 text-sm font-mono" />
                                </div>
                                <div>
                                  <label className="text-xs text-muted-foreground">Bis</label>
                                  <Input type="time" value={block.lunchEnd} onChange={(e) => updateBlock(block.id, { lunchEnd: e.target.value })} className="h-9 text-sm font-mono" />
                                </div>
                              </div>
                            )}
                            {(lunchTaken || (lunchInBlocks && !block.hasLunchBreak)) && (
                              <p className="text-xs text-muted-foreground pl-8">Bereits eingetragen</p>
                            )}
                          </div>
                        </div>

                        {/* Team-Mitglieder */}
                        <div className="border-t pt-3">
                          <MultiEmployeeSelect selectedEmployees={block.selectedEmployees} onSelectionChange={(employees) => updateBlockEmployees(block.id, employees)} date={selectedDate} startTime={block.startTime} endTime={block.endTime} label="Weitere Mitarbeiter (optional)" />
                        </div>

                        {/* Berechnete Stunden */}
                        <div className="bg-muted/50 rounded px-3 py-2 flex items-center justify-between text-sm">
                          <span>Berechnete Arbeitszeit</span>
                          <span className="font-bold text-lg">{getBlockHours(block).toFixed(2)} h</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Weiterer Block */}
                  <Button type="button" variant="outline" onClick={addTimeBlock} className="w-full gap-2 border-dashed">
                    <Plus className="w-4 h-4" />Weiteren Zeitblock hinzufügen
                  </Button>

                  {/* Gesamt */}
                  <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex items-center justify-between">
                    <span className="font-medium">Gesamt zu buchen</span>
                    <span className="text-2xl font-bold">{calculateTotalHours()} h</span>
                  </div>

                  {/* Submit */}
                  <Button type="submit" className="w-full" disabled={saving}>
                    {saving ? "Wird gespeichert..." : `${timeBlocks.length > 1 ? "Alle Einträge" : "Stunden"} erfassen`}
                  </Button>
                </>
              )}
            </form>
          </CardContent>
        </Card>

        {/* New Project Dialog */}
        <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neues Projekt erstellen</DialogTitle>
              <DialogDescription>Geben Sie die Details ein.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div><Label>Projektname *</Label><Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} /></div>
              <div><Label>PLZ *</Label><Input value={newProjectPlz} onChange={(e) => setNewProjectPlz(e.target.value)} maxLength={5} /></div>
              <div><Label>Adresse</Label><Input value={newProjectAddress} onChange={(e) => setNewProjectAddress(e.target.value)} /></div>
              <div><Label>Kundenname</Label><Input value={newProjectKundeName} onChange={(e) => setNewProjectKundeName(e.target.value)} placeholder="z.B. Mustermann GmbH" /></div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setShowNewProjectDialog(false); setNewProjectName(""); setNewProjectPlz(""); setNewProjectAddress(""); setNewProjectKundeName(""); setPendingBlockIdForNewProject(null); }} disabled={creatingProject}>Abbrechen</Button>
                <Button onClick={handleCreateNewProject} disabled={creatingProject}>{creatingProject ? "Wird erstellt..." : "Erstellen"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Absence Dialog */}
        <Dialog open={showAbsenceDialog} onOpenChange={setShowAbsenceDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Abwesenheit erfassen</DialogTitle>
              <DialogDescription>Erfassen Sie Urlaub, Krankenstand, Weiterbildung, Arztbesuch oder Zeitausgleich</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Label className="text-sm">Modus:</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant={!absenceData.rangeMode ? "default" : "outline"} size="sm" onClick={() => setAbsenceData({ ...absenceData, rangeMode: false })}>Einzelner Tag</Button>
                  <Button type="button" variant={absenceData.rangeMode ? "default" : "outline"} size="sm" onClick={() => setAbsenceData({ ...absenceData, rangeMode: true })}>Zeitraum</Button>
                </div>
              </div>

              {absenceData.rangeMode ? (
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Von</Label><Input type="date" value={absenceData.dateFrom} onChange={(e) => setAbsenceData({ ...absenceData, dateFrom: e.target.value })} /></div>
                  <div><Label>Bis</Label><Input type="date" value={absenceData.dateTo} onChange={(e) => setAbsenceData({ ...absenceData, dateTo: e.target.value })} /></div>
                </div>
              ) : (
                <div><Label>Datum</Label><Input type="date" value={absenceData.date} onChange={(e) => setAbsenceData({ ...absenceData, date: e.target.value })} /></div>
              )}

              <div>
                <Label>Art</Label>
                <Select value={absenceData.type} onValueChange={(value: any) => setAbsenceData({ ...absenceData, type: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urlaub">Urlaub</SelectItem>
                    <SelectItem value="krankenstand">Krankenstand</SelectItem>
                    <SelectItem value="weiterbildung">Weiterbildung</SelectItem>
                    <SelectItem value="arztbesuch">Arztbesuch</SelectItem>
                    <SelectItem value="zeitausgleich">Zeitausgleich</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {!absenceData.rangeMode && (
                <div>
                  <Label>Stunden (optional)</Label>
                  <Input type="number" step="0.5" min="0" max="24" value={absenceData.customHours} onChange={(e) => setAbsenceData({ ...absenceData, customHours: e.target.value })} placeholder="Leer lassen für automatische Berechnung" />
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowAbsenceDialog(false)} disabled={submittingAbsence}>Abbrechen</Button>
                <Button onClick={handleAbsenceSubmit} disabled={submittingAbsence}>{submittingAbsence ? "Wird gespeichert..." : "Speichern"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
};

export default TimeTracking;
