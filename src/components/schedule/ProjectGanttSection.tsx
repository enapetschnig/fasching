import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { isSameDay, parseISO } from "date-fns";
import { GanttBar } from "./GanttBar";
import { getProjectDayRanges, isCompanyHoliday } from "./scheduleUtils";
import type { Assignment, Project, CompanyHoliday, Profile } from "./scheduleTypes";

interface Props {
  projects: Project[];
  assignments: Assignment[];
  profiles: Profile[];
  days: Date[];
  holidays: CompanyHoliday[];
  onProjectDayClick?: (projectId: string, datum: string) => void;
}

export function ProjectGanttSection({
  projects,
  assignments,
  profiles,
  days,
  holidays,
  onProjectDayClick,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const getProfileName = (userId: string): string => {
    const p = profiles.find((pr) => pr.id === userId);
    return p ? `${p.vorname} ${p.nachname.charAt(0)}.` : "?";
  };

  // Only show projects that have assignments this period (Regie ohne project_id wird hier ignoriert)
  const activeProjectIds = [
    ...new Set(
      assignments
        .filter((a) => a.kind !== "regie" && a.project_id)
        .map((a) => a.project_id as string)
    ),
  ];
  const activeProjects = projects.filter((p) =>
    activeProjectIds.includes(p.id)
  );

  return (
    <div className="border-b">
      {/* Section header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" />
        )}
        <span className="font-semibold text-sm">Projekte</span>
        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {activeProjects.length} aktiv
        </span>
      </button>

      {!collapsed &&
        activeProjects.map((project) => {
          const ranges = getProjectDayRanges(assignments, project.id, days);

          return (
            <div
              key={project.id}
              className="grid border-t"
              style={{
                gridTemplateColumns: `minmax(140px, 200px) repeat(${days.length}, minmax(40px, 1fr))`,
              }}
            >
              {/* Label */}
              <div className="p-2 border-r text-sm font-medium truncate sticky left-0 bg-card z-10 flex items-center">
                {project.name}
              </div>

              {/* Day cells */}
              {days.map((day, dayIdx) => {
                const holiday = isCompanyHoliday(holidays, day);
                const dayAssignments = assignments.filter(
                  (a) =>
                    a.project_id === project.id &&
                    isSameDay(parseISO(a.datum), day)
                );
                const workerCount = dayAssignments.length;
                const workerNames = dayAssignments.map((a) => getProfileName(a.user_id));

                return (
                  <div
                    key={day.toISOString()}
                    className={`p-0.5 border-r min-h-[40px] ${
                      holiday ? "bg-gray-100" : ""
                    }`}
                  >
                    {workerCount > 0 && !holiday && (
                      <GanttBar
                        projectId={project.id}
                        label={workerNames.join(", ")}
                        badge={workerCount}
                        onClick={
                          onProjectDayClick
                            ? () =>
                                onProjectDayClick(
                                  project.id,
                                  day.toISOString().split("T")[0]
                                )
                            : undefined
                        }
                      />
                    )}
                    {holiday && workerCount === 0 && (
                      <GanttBar
                        label={holiday.bezeichnung || "Feiertag"}
                        variant="holiday"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

      {!collapsed && activeProjects.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
          Keine Projekte in diesem Zeitraum
        </div>
      )}
    </div>
  );
}
