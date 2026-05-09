import { useMemo } from "react";
import {
  startOfYear,
  endOfYear,
  startOfISOWeek,
  addWeeks,
  getISOWeek,
  format,
  isSameDay,
  parseISO,
  isWithinInterval,
  isBefore,
  isAfter,
} from "date-fns";
import { de } from "date-fns/locale";
import { getProjectColor } from "./scheduleUtils";
import type {
  Project,
  Assignment,
  CompanyHoliday,
  LeaveRequest,
} from "./scheduleTypes";

interface Props {
  year: number;
  projects: Project[];
  assignments: Assignment[];
  holidays: CompanyHoliday[];
  leaveRequests: LeaveRequest[];
}

export function YearPlanningView({
  year,
  projects,
  assignments,
  holidays,
}: Props) {
  // Generate all ISO weeks for the year
  const weeks = useMemo(() => {
    const result: { weekNum: number; start: Date; month: string }[] = [];
    let current = startOfISOWeek(new Date(year, 0, 4)); // First ISO week
    const yearEnd = endOfYear(new Date(year, 0, 1));

    while (isBefore(current, yearEnd) || isSameDay(current, yearEnd)) {
      const weekNum = getISOWeek(current);
      result.push({
        weekNum,
        start: current,
        month: format(current, "MMM", { locale: de }),
      });
      current = addWeeks(current, 1);
      // Stop if we've gone past 53 weeks
      if (result.length > 53) break;
    }
    return result;
  }, [year]);

  // Group weeks by month for header
  const monthGroups = useMemo(() => {
    const groups: { month: string; span: number }[] = [];
    let lastMonth = "";
    for (const w of weeks) {
      if (w.month !== lastMonth) {
        groups.push({ month: w.month, span: 1 });
        lastMonth = w.month;
      } else {
        groups[groups.length - 1].span++;
      }
    }
    return groups;
  }, [weeks]);

  // Active projects (those with assignments this year — Regie ohne project_id ignorieren)
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

  // Check if a project has assignments in a given week
  const hasAssignmentsInWeek = (
    projectId: string,
    weekStart: Date
  ): number => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    return assignments.filter((a) => {
      if (a.project_id !== projectId) return false;
      const d = parseISO(a.datum);
      return isWithinInterval(d, { start: weekStart, end: weekEnd });
    }).length;
  };

  const isHolidayWeek = (weekStart: Date): boolean => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 4);
    return holidays.some((h) => {
      const d = parseISO(h.datum);
      return isWithinInterval(d, { start: weekStart, end: weekEnd });
    });
  };

  return (
    <div className="border rounded-lg overflow-x-auto">
      {/* Month header */}
      <div
        className="grid sticky top-0 z-20 bg-card border-b"
        style={{
          gridTemplateColumns: `minmax(140px, 200px) ${monthGroups
            .map((g) => `repeat(${g.span}, minmax(24px, 1fr))`)
            .join(" ")}`,
        }}
      >
        <div className="p-1 border-r sticky left-0 bg-card z-30" />
        {monthGroups.map((g, i) => (
          <div
            key={i}
            className="text-xs font-medium text-center py-1 border-r"
            style={{ gridColumn: `span ${g.span}` }}
          >
            {g.month}
          </div>
        ))}
      </div>

      {/* KW header */}
      <div
        className="grid sticky top-[28px] z-20 bg-card border-b"
        style={{
          gridTemplateColumns: `minmax(140px, 200px) repeat(${weeks.length}, minmax(24px, 1fr))`,
        }}
      >
        <div className="p-1 border-r text-xs text-muted-foreground sticky left-0 bg-card z-30">
          KW
        </div>
        {weeks.map((w) => (
          <div
            key={w.weekNum}
            className={`text-[10px] text-center py-0.5 border-r ${
              isHolidayWeek(w.start)
                ? "bg-gray-200 text-gray-400"
                : "text-muted-foreground"
            }`}
          >
            {w.weekNum}
          </div>
        ))}
      </div>

      {/* Project rows */}
      {activeProjects.map((project) => {
        const color = getProjectColor(project.id);
        return (
          <div
            key={project.id}
            className="grid border-b"
            style={{
              gridTemplateColumns: `minmax(140px, 200px) repeat(${weeks.length}, minmax(24px, 1fr))`,
            }}
          >
            <div className="p-1.5 border-r text-xs font-medium truncate sticky left-0 bg-card z-10">
              {project.name}
            </div>
            {weeks.map((w) => {
              const count = hasAssignmentsInWeek(project.id, w.start);
              const holiday = isHolidayWeek(w.start);
              return (
                <div
                  key={w.weekNum}
                  className={`border-r min-h-[24px] ${
                    holiday ? "bg-gray-100" : ""
                  }`}
                >
                  {count > 0 && (
                    <div
                      className={`h-full ${color.bg} ${color.border} border-y`}
                      title={`${project.name} – KW ${w.weekNum}: ${count} Zuweisungen`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {activeProjects.length === 0 && (
        <div className="px-3 py-8 text-sm text-muted-foreground text-center">
          Keine Projekte mit Zuweisungen in {year}
        </div>
      )}
    </div>
  );
}
