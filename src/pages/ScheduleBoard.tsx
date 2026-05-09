import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  startOfISOWeek,
  addDays,
  format,
  parseISO,
} from "date-fns";

import type {
  Assignment,
  AssignmentKind,
  DailyTarget,
  ScheduleMode,
} from "@/components/schedule/scheduleTypes";
import { getProjectColorClass } from "@/components/schedule/scheduleUtils";
import { useScheduleData } from "@/components/schedule/useScheduleData";
import { useSchedulePermissions } from "@/components/schedule/useSchedulePermissions";
import { ScheduleHeader } from "@/components/schedule/ScheduleHeader";
import { GanttTimeline } from "@/components/schedule/GanttTimeline";
import { ProjectGanttSection } from "@/components/schedule/ProjectGanttSection";
import { TeamGanttSection } from "@/components/schedule/TeamGanttSection";
import { AssignmentPopover } from "@/components/schedule/AssignmentPopover";
import { DayDetailSheet } from "@/components/schedule/DayDetailSheet";
import { CompanyHolidayManager } from "@/components/schedule/CompanyHolidayManager";
import { YearPlanningView } from "@/components/schedule/YearPlanningView";

export default function ScheduleBoard() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [mode, setMode] = useState<ScheduleMode>("week");
  const [weekStart, setWeekStart] = useState(() => startOfISOWeek(new Date()));

  const {
    profiles,
    projects,
    assignments,
    setAssignments,
    assignmentPhotos,
    resources,
    setResources,
    dailyTargets,
    setDailyTargets,
    leaveRequests,
    companyHolidays,
    loading,
    fetchData,
  } = useScheduleData();

  // Fotos pro Assignment-ID zählen → für den kleinen Indicator in der Gantt-Bar
  const photoCounts: Record<string, number> = {};
  for (const p of assignmentPhotos) {
    photoCounts[p.assignment_id] = (photoCounts[p.assignment_id] || 0) + 1;
  }

  const {
    userId,
    isAdmin,
    isVorarbeiter,
    isExtern,
    canEditProject,
    canManageHolidays,
    loading: permLoading,
  } = useSchedulePermissions();

  const isExternView = isExtern && !isAdmin && !isVorarbeiter;

  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
  const weekEnd = addDays(weekStart, 4);

  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // Assignment popover state
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverUserId, setPopoverUserId] = useState<string | null>(null);
  const [popoverDate, setPopoverDate] = useState<Date | null>(null);
  const [popoverDays, setPopoverDays] = useState<Date[]>([]);
  const [popoverAssignmentId, setPopoverAssignmentId] = useState<string | null>(null);
  const [initialAdditionalUserIds, setInitialAdditionalUserIds] = useState<string[]>([]);

  // Day detail sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetProjectId, setSheetProjectId] = useState<string | null>(null);
  const [sheetDatum, setSheetDatum] = useState<string | null>(null);

  // Plantafel ist für alle authentifizierten Mitarbeiter sichtbar (Read-Only,
  // wenn weder Admin noch Vorarbeiter). Nur nicht-eingeloggte User werden
  // ausgesperrt.
  useEffect(() => {
    if (!permLoading && !userId) {
      navigate("/auth");
    }
  }, [permLoading, userId, navigate]);

  useEffect(() => {
    if (!permLoading) {
      fetchData(weekStart, weekEnd, mode);
    }
  }, [weekStart, mode, permLoading]);

  // --- Assignment handlers ---
  // Erzeugt oder aktualisiert eine Zuweisung. Wenn assignmentId angegeben ist
  // -> UPDATE; sonst -> INSERT (mehrere Einträge pro Tag/MA möglich).
  // additionalUserIds: dieselbe Zuweisung wird auch für diese MAs angelegt.
  const handleAssign = async (
    _uid: string,
    _date: Date,
    kind: AssignmentKind,
    projectId: string | null,
    notizen?: string,
    startTime?: string,
    endTime?: string,
    assignmentId?: string
  ) => {
    const payload = {
      kind,
      project_id: kind === "regie" ? null : projectId,
      notizen: notizen ?? null,
      start_time: startTime || "07:00",
      end_time: endTime || "16:00",
    };

    if (!assignmentId) return;

    const { error } = await (supabase as any)
      .from("worker_assignments")
      .update(payload)
      .eq("id", assignmentId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setAssignments((prev) =>
      prev.map((a) => (a.id === assignmentId ? { ...a, ...payload } : a))
    );
  };

  // Batch-Insert: alle Kombinationen aus uids × dates × blocks anlegen.
  // Fr/Sa/So werden bei mehrtägigen Auswahlen übersprungen (4-Tage-Woche).
  const handleAssignBatch = async (
    uids: string[],
    dates: Date[],
    blocks: Array<{
      kind: AssignmentKind;
      projectId: string | null;
      startTime: string;
      endTime: string;
      notizen: string;
    }>
  ): Promise<string[]> => {
    const rows: Array<Record<string, unknown>> = [];
    const isMultiDay = dates.length > 1;
    for (const uid of uids) {
      for (const d of dates) {
        if (isMultiDay) {
          const dow = d.getDay();
          if (dow === 0 || dow === 5 || dow === 6) continue;
        }
        const datum = format(d, "yyyy-MM-dd");
        for (const b of blocks) {
          if (b.kind === "projekt" && !b.projectId) continue;
          rows.push({
            user_id: uid,
            datum,
            created_by: userId,
            kind: b.kind,
            project_id: b.kind === "regie" ? null : b.projectId,
            start_time: b.startTime || "07:00",
            end_time: b.endTime || "16:00",
            notizen: b.notizen?.trim() || null,
          });
        }
      }
    }
    if (rows.length === 0) {
      toast({ variant: "destructive", title: "Nichts zu speichern", description: "Bitte mindestens ein Projekt oder Regie wählen." });
      return [];
    }
    const { data, error } = await (supabase as any)
      .from("worker_assignments")
      .insert(rows)
      .select();
    if (error) {
      const conflict = String(error.code) === "23505" || /unique/i.test(error.message || "");
      toast({
        variant: "destructive",
        title: conflict ? "Konflikt" : "Fehler",
        description: conflict
          ? "Mindestens eine Kombination existiert bereits."
          : error.message,
      });
      return [];
    }
    if (!data) return [];
    setAssignments((prev) => [...prev, ...(data as Assignment[])]);
    toast({ title: "Zuweisungen gespeichert", description: `${rows.length} Einteilung(en) angelegt.` });
    return (data as Assignment[]).map((a) => a.id);
  };

  const handleRemove = async (_uid: string, _date: Date, assignmentId?: string) => {
    if (!assignmentId) return;
    const { error } = await (supabase as any)
      .from("worker_assignments")
      .delete()
      .eq("id", assignmentId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
  };

  // --- Daily target handlers ---
  const getTarget = (projectId: string, datum: string): DailyTarget | undefined =>
    dailyTargets.find((t) => t.project_id === projectId && t.datum === datum);

  const upsertTarget = (
    projectId: string,
    datum: string,
    field: keyof DailyTarget,
    value: string | number | null
  ) => {
    const key = `${projectId}-${datum}`;
    setDailyTargets((prev) => {
      const existing = prev.find(
        (t) => t.project_id === projectId && t.datum === datum
      );
      if (existing) {
        return prev.map((t) =>
          t.id === existing.id ? { ...t, [field]: value } : t
        );
      }
      return [
        ...prev,
        {
          id: `temp-${key}`,
          project_id: projectId,
          datum,
          tagesziel: null,
          nachkalkulation_stunden: null,
          notizen: null,
          [field]: value,
        } as DailyTarget,
      ];
    });

    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(async () => {
      const current = dailyTargets.find(
        (t) => t.project_id === projectId && t.datum === datum
      );
      const payload: Record<string, unknown> = {
        project_id: projectId,
        datum,
        created_by: userId,
        [field]: value,
      };

      if (current && !current.id.startsWith("temp-")) {
        await supabase
          .from("project_daily_targets")
          .update({ [field]: value })
          .eq("id", current.id);
      } else {
        const tempTarget = dailyTargets.find(
          (t) => t.project_id === projectId && t.datum === datum
        );
        if (tempTarget) {
          payload.tagesziel = tempTarget.tagesziel;
          payload.nachkalkulation_stunden = tempTarget.nachkalkulation_stunden;
          payload.notizen = tempTarget.notizen;
          payload[field] = value;
        }
        const { data } = await supabase
          .from("project_daily_targets")
          .upsert(payload, { onConflict: "project_id,datum" })
          .select()
          .single();
        if (data) {
          setDailyTargets((prev) =>
            prev.map((t) =>
              t.project_id === projectId && t.datum === datum
                ? (data as DailyTarget)
                : t
            )
          );
        }
      }
    }, 500);
  };

  // --- Resource handlers ---
  const handleAddResource = async (
    projectId: string,
    datum: string,
    resourceName: string
  ) => {
    if (!resourceName.trim()) return;
    const { data, error } = await supabase
      .from("assignment_resources")
      .upsert(
        {
          project_id: projectId,
          datum,
          resource_name: resourceName.trim(),
          menge: 1,
          einheit: "Stk",
          created_by: userId,
        },
        { onConflict: "project_id,datum,resource_name" }
      )
      .select()
      .single();

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    if (data) {
      setResources((prev) => {
        const exists = prev.find(
          (r) =>
            r.project_id === projectId &&
            r.datum === datum &&
            r.resource_name === resourceName.trim()
        );
        if (exists)
          return prev.map((r) => (r.id === exists.id ? (data as any) : r));
        return [...prev, data as any];
      });
    }
  };

  const handleUpdateResource = async (
    id: string,
    field: "menge" | "einheit",
    value: number | string | null
  ) => {
    setResources((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
    await supabase
      .from("assignment_resources")
      .update({ [field]: value })
      .eq("id", id);
  };

  const handleDeleteResource = async (id: string) => {
    const { error } = await supabase
      .from("assignment_resources")
      .delete()
      .eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setResources((prev) => prev.filter((r) => r.id !== id));
  };

  // --- Click handlers ---
  const handleCellClick = (cellUserId: string, date: Date) => {
    setPopoverUserId(cellUserId);
    setPopoverDate(date);
    setPopoverDays([]);
    setPopoverAssignmentId(null);
    setInitialAdditionalUserIds([]);
    setPopoverOpen(true);
  };

  const handleAssignmentClick = (assignment: Assignment) => {
    setPopoverUserId(assignment.user_id);
    setPopoverDate(parseISO(assignment.datum));
    setPopoverDays([]);
    setPopoverAssignmentId(assignment.id);
    setInitialAdditionalUserIds([]);
    setPopoverOpen(true);
  };

  const handleRangeSelect = (uids: string[], selectedDays: Date[]) => {
    if (uids.length === 0 || selectedDays.length === 0) return;
    const [primary, ...others] = uids;
    setPopoverUserId(primary);
    setPopoverDate(selectedDays[0]);
    setPopoverDays(selectedDays.length > 1 ? selectedDays : []);
    setPopoverAssignmentId(null);
    setInitialAdditionalUserIds(others);
    setPopoverOpen(true);
  };

  const handleProjectDayClick = (projectId: string, datum: string) => {
    if (canEditProject(projectId, assignments)) {
      setSheetProjectId(projectId);
      setSheetDatum(datum);
      setSheetOpen(true);
    }
  };

  const popoverProfile = profiles.find((p) => p.id === popoverUserId) || null;
  const popoverAssignment = popoverAssignmentId
    ? assignments.find((a) => a.id === popoverAssignmentId) || null
    : null;

  const sheetProject = projects.find((p) => p.id === sheetProjectId) || null;
  const sheetTarget = sheetProjectId && sheetDatum
    ? getTarget(sheetProjectId, sheetDatum)
    : null;

  if (loading || permLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Lade...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")} title="Startseite">
              <Home className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Zurück</span>
            </Button>
            <img
              src="/fasching-logo.jpg"
              alt="FASCHING Gebäudetechnik"
              className="h-8 sm:h-10 cursor-pointer hover:opacity-80 transition-opacity object-contain"
              onClick={() => navigate("/")}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
        <ScheduleHeader
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          mode={isExternView ? "week" : mode}
          onModeChange={isExternView ? undefined : setMode}
          title={isExternView ? "Meine Einteilung" : undefined}
        >
          {canManageHolidays && (
            <CompanyHolidayManager
              holidays={companyHolidays}
              onUpdate={() => fetchData(weekStart, weekEnd, mode)}
              userId={userId}
            />
          )}
        </ScheduleHeader>

        {mode === "week" ? (
          <>
            {/* Legend */}
            {projects.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {projects
                  .filter((p) =>
                    assignments.some((a) => a.project_id === p.id)
                  )
                  .map((p) => (
                    <span
                      key={p.id}
                      className={`text-xs px-2 py-0.5 rounded border ${getProjectColorClass(p.id)}`}
                    >
                      {p.name}
                    </span>
                  ))}
              </div>
            )}

            {/* Gantt Grid */}
            <div className="border rounded-lg overflow-x-auto">
              <GanttTimeline days={weekDays} holidays={companyHolidays} />
              {!isExternView && (
                <ProjectGanttSection
                  projects={projects}
                  assignments={assignments}
                  profiles={profiles}
                  days={weekDays}
                  holidays={companyHolidays}
                  onProjectDayClick={
                    isAdmin || isVorarbeiter ? handleProjectDayClick : undefined
                  }
                />
              )}
              <TeamGanttSection
                profiles={isExternView ? profiles.filter((p) => p.id === userId) : profiles}
                projects={projects}
                assignments={assignments}
                leaveRequests={leaveRequests}
                holidays={companyHolidays}
                days={weekDays}
                canEditProject={(pid) => canEditProject(pid, assignments)}
                photoCounts={photoCounts}
                onCellClick={
                  isAdmin || isVorarbeiter ? handleCellClick : undefined
                }
                onRangeSelect={
                  isAdmin || isVorarbeiter ? handleRangeSelect : undefined
                }
                onAssignmentClick={
                  isAdmin || isVorarbeiter ? handleAssignmentClick : undefined
                }
              />
            </div>
          </>
        ) : (
          <YearPlanningView
            year={weekStart.getFullYear()}
            projects={projects}
            assignments={assignments}
            holidays={companyHolidays}
            leaveRequests={leaveRequests}
          />
        )}
      </main>

      {/* Assignment Popover */}
      <AssignmentPopover
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        profile={popoverProfile}
        date={popoverDate}
        days={popoverDays.length > 1 ? popoverDays : undefined}
        assignment={popoverAssignment || null}
        projects={projects}
        profiles={profiles}
        initialAdditionalUserIds={initialAdditionalUserIds}
        onAssign={handleAssign}
        onAssignBatch={handleAssignBatch}
        onRemove={handleRemove}
      />

      {/* Day Detail Sheet */}
      <DayDetailSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        project={sheetProject}
        datum={sheetDatum}
        profiles={profiles}
        assignments={assignments}
        resources={resources}
        dailyTarget={sheetTarget || null}
        onUpdateTarget={upsertTarget}
        onAddResource={handleAddResource}
        onUpdateResource={handleUpdateResource}
        onDeleteResource={handleDeleteResource}
      />
    </div>
  );
}
