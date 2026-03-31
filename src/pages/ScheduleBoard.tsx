import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  startOfISOWeek,
  addDays,
  format,
} from "date-fns";

import type {
  Assignment,
  DailyTarget,
  ScheduleMode,
} from "@/components/schedule/scheduleTypes";
import { getAssignmentForDay, getProjectColorClass } from "@/components/schedule/scheduleUtils";
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
    resources,
    setResources,
    dailyTargets,
    setDailyTargets,
    leaveRequests,
    companyHolidays,
    loading,
    fetchData,
  } = useScheduleData();

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

  // Day detail sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetProjectId, setSheetProjectId] = useState<string | null>(null);
  const [sheetDatum, setSheetDatum] = useState<string | null>(null);

  useEffect(() => {
    if (!permLoading && !isAdmin && !isVorarbeiter && !isExtern) {
      navigate("/");
    }
  }, [permLoading, isAdmin, isVorarbeiter, isExtern, navigate]);

  useEffect(() => {
    if (!permLoading) {
      fetchData(weekStart, weekEnd, mode);
    }
  }, [weekStart, mode, permLoading]);

  // --- Assignment handlers ---
  const handleAssign = async (uid: string, date: Date, projectId: string, notizen?: string, startTime?: string, endTime?: string) => {
    const datum = format(date, "yyyy-MM-dd");
    const existing = getAssignmentForDay(assignments, uid, date);

    const payload = {
      project_id: projectId,
      notizen: notizen ?? null,
      start_time: startTime || "07:00",
      end_time: endTime || "16:00",
    };

    let assignmentId: string | null = null;

    if (existing) {
      const { error } = await supabase
        .from("worker_assignments")
        .update(payload)
        .eq("id", existing.id);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
      assignmentId = existing.id;
      setAssignments((prev) =>
        prev.map((a) =>
          a.id === existing.id ? { ...a, ...payload } : a
        )
      );
    } else {
      const { data, error } = await supabase
        .from("worker_assignments")
        .upsert(
          { user_id: uid, datum, created_by: userId, ...payload },
          { onConflict: "user_id,project_id,datum,start_time" }
        )
        .select()
        .single();
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
      if (data) {
        assignmentId = data.id;
        setAssignments((prev) => [...prev, data as Assignment]);
      }
    }

    // Sync to Google Calendar (fire and forget)
    if (assignmentId) {
      supabase.functions.invoke("sync-assignment-to-calendar", {
        body: { action: "sync", assignment_id: assignmentId },
      }).catch((e: any) => console.error("Calendar sync failed:", e));
    }
  };

  const handleRemove = async (uid: string, date: Date) => {
    const existing = getAssignmentForDay(assignments, uid, date);
    if (!existing) return;

    // Delete from Google Calendar first (fire and forget)
    supabase.functions.invoke("sync-assignment-to-calendar", {
      body: { action: "delete", assignment_id: existing.id },
    }).catch((e: any) => console.error("Calendar delete failed:", e));

    const { error } = await supabase
      .from("worker_assignments")
      .delete()
      .eq("id", existing.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setAssignments((prev) => prev.filter((a) => a.id !== existing.id));
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
    setPopoverOpen(true);
  };

  const handleRangeSelect = (uid: string, selectedDays: Date[]) => {
    setPopoverUserId(uid);
    setPopoverDate(selectedDays[0]);
    setPopoverDays(selectedDays);
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
  const popoverAssignment =
    popoverUserId && popoverDate
      ? getAssignmentForDay(assignments, popoverUserId, popoverDate)
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
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Zurück</span>
            </Button>
            <img
              src="/schafferhofer-logo.svg"
              alt="Schafferhofer Bau"
              className="h-10 w-10 sm:h-14 sm:w-14 cursor-pointer hover:opacity-80 transition-opacity object-contain"
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
                onCellClick={
                  isAdmin || isVorarbeiter ? handleCellClick : undefined
                }
                onRangeSelect={
                  isAdmin || isVorarbeiter ? handleRangeSelect : undefined
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
        onAssign={async (uid, date, projectId, notizen) => {
          const daysToAssign = popoverDays.length > 1 ? popoverDays : [date];
          for (const d of daysToAssign) {
            await handleAssign(uid, d, projectId, notizen);
          }
        }}
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
