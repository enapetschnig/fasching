import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, Image as ImageIcon, Wrench, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  startOfISOWeek,
  addDays,
  format,
  isSameDay,
  parseISO,
  isWithinInterval,
  getISOWeek,
} from "date-fns";
import { de } from "date-fns/locale";
import { getProjectColor } from "@/components/schedule/scheduleUtils";

type WeekAssignment = {
  id: string;
  datum: string;
  kind: "projekt" | "regie";
  project_id: string | null;
  project_name: string;
  notizen: string | null;
  start_time: string | null;
  end_time: string | null;
  photos: { id: string; file_path: string; file_name: string }[];
};

type HolidayDay = {
  datum: string;
  bezeichnung: string | null;
};

type LeaveDay = {
  start_date: string;
  end_date: string;
  type: string;
};

interface Props {
  userId: string;
}

export function WeeklyAssignmentWidget({ userId }: Props) {
  const [assignmentsByDay, setAssignmentsByDay] = useState<Record<string, WeekAssignment[]>>({});
  const [holidays, setHolidays] = useState<HolidayDay[]>([]);
  const [leaves, setLeaves] = useState<LeaveDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [activeAssignment, setActiveAssignment] = useState<WeekAssignment | null>(null);

  const weekStart = startOfISOWeek(new Date());
  const weekEnd = addDays(weekStart, 4);
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));

  useEffect(() => {
    const fetch = async () => {
      const fromDate = format(weekStart, "yyyy-MM-dd");
      const toDate = format(weekEnd, "yyyy-MM-dd");

      const sb = supabase as any;
      const [{ data: assignData }, { data: holidayData }, { data: leaveData }] =
        await Promise.all([
          sb
            .from("worker_assignments")
            .select(
              "id, datum, project_id, kind, notizen, start_time, end_time, projects:project_id(name)"
            )
            .eq("user_id", userId)
            .gte("datum", fromDate)
            .lte("datum", toDate)
            .order("start_time", { ascending: true }),
          sb
            .from("company_holidays")
            .select("datum, bezeichnung")
            .gte("datum", fromDate)
            .lte("datum", toDate),
          sb
            .from("leave_requests")
            .select("start_date, end_date, type")
            .eq("user_id", userId)
            .eq("status", "genehmigt")
            .lte("start_date", toDate)
            .gte("end_date", fromDate),
        ]);

      let mapped: WeekAssignment[] = [];
      if (assignData) {
        mapped = (assignData as any[]).map((a: any) => ({
          id: a.id,
          datum: a.datum,
          kind: (a.kind as "projekt" | "regie") || "projekt",
          project_id: a.project_id,
          project_name:
            a.kind === "regie" ? "Regie" : a.projects?.name || "–",
          notizen: a.notizen ?? null,
          start_time: a.start_time,
          end_time: a.end_time,
          photos: [],
        }));

        // Fotos für die geladenen Assignments holen
        const ids = mapped.map((a) => a.id);
        if (ids.length > 0) {
          const { data: photos } = await (supabase as any)
            .from("worker_assignment_photos")
            .select("id, assignment_id, file_path, file_name")
            .in("assignment_id", ids);
          if (photos) {
            const byAssignment: Record<string, WeekAssignment["photos"]> = {};
            for (const p of photos as any[]) {
              (byAssignment[p.assignment_id] ||= []).push({
                id: p.id,
                file_path: p.file_path,
                file_name: p.file_name,
              });
            }
            mapped = mapped.map((a) => ({ ...a, photos: byAssignment[a.id] || [] }));
          }
        }
      }

      const grouped: Record<string, WeekAssignment[]> = {};
      for (const a of mapped) {
        (grouped[a.datum] ||= []).push(a);
      }
      setAssignmentsByDay(grouped);

      if (holidayData) setHolidays(holidayData as HolidayDay[]);
      if (leaveData) setLeaves(leaveData as LeaveDay[]);

      setLoading(false);
    };

    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (loading) return null;

  const hasAnyData =
    Object.keys(assignmentsByDay).length > 0 ||
    holidays.length > 0 ||
    leaves.length > 0;
  if (!hasAnyData) return null;

  const photoUrl = (filePath: string) =>
    supabase.storage.from("assignment-photos").getPublicUrl(filePath).data.publicUrl;

  const openPhotos = (a: WeekAssignment) => {
    setActiveAssignment(a);
    setPhotoOpen(true);
  };

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-primary" />
        Meine Einteilung – KW {getISOWeek(weekStart)}
      </h2>
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-5 gap-1.5">
            {weekDays.map((day) => {
              const datum = format(day, "yyyy-MM-dd");
              const dayAssigns = assignmentsByDay[datum] || [];
              const holiday = holidays.find((h) =>
                isSameDay(parseISO(h.datum), day)
              );
              const leave = leaves.find((l) =>
                isWithinInterval(day, {
                  start: parseISO(l.start_date),
                  end: parseISO(l.end_date),
                })
              );

              return (
                <div key={day.toISOString()} className="text-center space-y-1">
                  <div className="text-[10px] font-medium text-muted-foreground mb-1">
                    {format(day, "EEE", { locale: de })}
                  </div>
                  {holiday ? (
                    <div className="rounded-md bg-gray-100 text-gray-500 text-[10px] px-1 py-2 border border-gray-200">
                      {holiday.bezeichnung || "Feiertag"}
                    </div>
                  ) : leave ? (
                    <div className="rounded-md bg-green-100 text-green-800 text-[10px] px-1 py-2 border border-green-300">
                      {leave.type === "urlaub"
                        ? "Urlaub"
                        : leave.type === "krankenstand"
                        ? "Krank"
                        : leave.type === "za"
                        ? "ZA"
                        : leave.type}
                    </div>
                  ) : dayAssigns.length > 0 ? (
                    dayAssigns.map((a) => {
                      const isRegie = a.kind === "regie";
                      const color =
                        !isRegie && a.project_id
                          ? getProjectColor(a.project_id)
                          : null;
                      const containerCls = isRegie
                        ? "bg-orange-100 text-orange-900 border-orange-300"
                        : `${color?.bg} ${color?.text} ${color?.border}`;
                      return (
                        <div
                          key={a.id}
                          className={`relative rounded-md ${containerCls} text-[10px] px-1 py-2 border`}
                        >
                          <div className="flex items-center justify-center gap-1 truncate">
                            {isRegie && <Wrench className="h-2.5 w-2.5" />}
                            <span className="truncate">{a.project_name}</span>
                          </div>
                          {a.notizen && (
                            <div className="text-[9px] opacity-75 mt-0.5 break-words whitespace-normal leading-tight">
                              {a.notizen}
                            </div>
                          )}
                          {a.photos.length > 0 && (
                            <button
                              type="button"
                              onClick={() => openPhotos(a)}
                              className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded bg-white/90 px-1 py-0.5 text-[9px] font-medium text-foreground shadow-sm hover:bg-white"
                              title={`${a.photos.length} Foto(s) ansehen`}
                            >
                              <ImageIcon className="h-2.5 w-2.5" />
                              {a.photos.length}
                            </button>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-md border border-dashed border-muted-foreground/20 text-muted-foreground text-[10px] px-1 py-2">
                      –
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={photoOpen} onOpenChange={setPhotoOpen}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="h-4 w-4" />
              Fotos – {activeAssignment?.project_name}
              {activeAssignment?.start_time && activeAssignment?.end_time && (
                <span className="text-xs text-muted-foreground font-normal">
                  {activeAssignment.start_time.slice(0, 5)}–{activeAssignment.end_time.slice(0, 5)}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {activeAssignment?.notizen && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {activeAssignment.notizen}
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {activeAssignment?.photos.map((p) => (
              <a
                key={p.id}
                href={photoUrl(p.file_path)}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square rounded-md overflow-hidden border hover:opacity-90"
              >
                <img
                  src={photoUrl(p.file_path)}
                  alt={p.file_name}
                  className="w-full h-full object-cover"
                />
              </a>
            ))}
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setPhotoOpen(false)}>
              <X className="h-3.5 w-3.5 mr-1" /> Schließen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
