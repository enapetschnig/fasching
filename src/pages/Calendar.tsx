import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ExternalLink, Calendar as CalIcon, Clock, MapPin, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, isSameDay, isSameMonth } from "date-fns";
import { de } from "date-fns/locale";

type CalendarEvent = {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  mitarbeiter: string[] | null;
  all_day: boolean;
  calendar_type: string | null;
};

type Assignment = {
  id: string;
  datum: string;
  start_time: string | null;
  end_time: string | null;
  notizen: string | null;
  user_id: string;
  kind: "projekt" | "regie";
  projects: { name: string } | null;
  profiles: { vorname: string; nachname: string } | null;
};

export default function Calendar() {
  const { toast } = useToast();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [calendarId, setCalendarId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [currentMonth]);

  const loadData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get role
    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    setUserRole(roleData?.role || null);

    // Get calendar ID from settings
    const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "google_calendar_id").maybeSingle();
    setCalendarId(setting?.value || "");

    const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");

    // Fetch assignments for the month (with profile names)
    const { data: assignData } = await (supabase as any)
      .from("worker_assignments")
      .select("id, datum, start_time, end_time, notizen, user_id, kind, projects(name)")
      .gte("datum", monthStart)
      .lte("datum", monthEnd)
      .order("datum");

    // Fetch calendar events
    const { data: eventData } = await supabase
      .from("calendar_events")
      .select("*")
      .gte("start_date", monthStart)
      .lte("start_date", monthEnd)
      .order("start_date");

    // Fetch profile names for assignments
    const userIds = [...new Set((assignData || []).map((a: any) => a.user_id))];
    let profileMap: Record<string, { vorname: string; nachname: string }> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .in("id", userIds);
      (profiles || []).forEach((p: any) => {
        profileMap[p.id] = { vorname: p.vorname, nachname: p.nachname };
      });
    }

    setAssignments((assignData || []).map((a: any) => ({
      ...a,
      profiles: profileMap[a.user_id] || null,
    })));
    setCalendarEvents(eventData || []);
    setLoading(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-sync", {
        body: { action: "fetch" },
      });
      if (error) throw error;
      toast({ title: "Kalender synchronisiert" });
      loadData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Sync fehlgeschlagen", description: err.message });
    } finally {
      setSyncing(false);
    }
  };

  // Calendar grid
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const weeks: Date[][] = [];
  let day = calStart;
  while (day <= calEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }

  const getAssignmentsForDay = (d: Date) => {
    const dStr = format(d, "yyyy-MM-dd");
    return assignments.filter((a) => a.datum === dStr);
  };

  const getEventsForDay = (d: Date) => {
    const dStr = format(d, "yyyy-MM-dd");
    return calendarEvents.filter((e) => e.start_date === dStr);
  };

  const selectedAssignments = selectedDate ? getAssignmentsForDay(selectedDate) : [];
  const selectedEvents = selectedDate ? getEventsForDay(selectedDate) : [];

  const isAdmin = userRole === "administrator";

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Kalender" />

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
        {/* Header with navigation */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-xl font-bold min-w-[180px] text-center">
              {format(currentMonth, "MMMM yyyy", { locale: de })}
            </h2>
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                Sync
              </Button>
            )}
          </div>
        </div>

        {/* Calendar grid */}
        <Card>
          <CardContent className="p-0 sm:p-2">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b">
              {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
                <div key={d} className="p-2 text-center text-xs font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>

            {/* Weeks */}
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((d, di) => {
                  const dayAssignments = getAssignmentsForDay(d);
                  const dayEvents = getEventsForDay(d);
                  const isToday = isSameDay(d, new Date());
                  const isCurrentMonth = isSameMonth(d, currentMonth);
                  const isSelected = selectedDate && isSameDay(d, selectedDate);
                  const hasItems = dayAssignments.length > 0 || dayEvents.length > 0;

                  return (
                    <div
                      key={di}
                      className={`min-h-[60px] sm:min-h-[80px] border-b border-r p-1 cursor-pointer transition-colors
                        ${!isCurrentMonth ? "bg-muted/30 text-muted-foreground" : ""}
                        ${isToday ? "bg-primary/5" : ""}
                        ${isSelected ? "ring-2 ring-primary ring-inset" : ""}
                        ${hasItems ? "hover:bg-accent/10" : "hover:bg-muted/50"}
                      `}
                      onClick={() => setSelectedDate(d)}
                    >
                      <div className={`text-xs font-medium mb-0.5 ${isToday ? "text-primary font-bold" : ""}`}>
                        {format(d, "d")}
                      </div>
                      {/* Dots for assignments */}
                      <div className="space-y-0.5">
                        {dayAssignments.slice(0, 3).map((a) => (
                          <div key={a.id} className="text-[10px] leading-tight truncate px-0.5 py-px rounded bg-primary/10 text-primary">
                            {a.profiles ? `${a.profiles.vorname.charAt(0)}.` : ""} {a.kind === "regie" ? "Regie" : a.projects?.name?.slice(0, 10) || "?"}
                          </div>
                        ))}
                        {dayAssignments.length > 3 && (
                          <div className="text-[10px] text-muted-foreground">+{dayAssignments.length - 3}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Selected day detail */}
        {selectedDate && (
          <Card className="mt-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {format(selectedDate, "EEEE, dd. MMMM yyyy", { locale: de })}
              </CardTitle>
              <CardDescription>
                {selectedAssignments.length} Einteilung{selectedAssignments.length !== 1 ? "en" : ""}
                {selectedEvents.length > 0 && ` · ${selectedEvents.length} Kalender-Event${selectedEvents.length !== 1 ? "s" : ""}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedAssignments.length === 0 && selectedEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Einträge für diesen Tag.</p>
              ) : (
                <div className="space-y-3">
                  {selectedAssignments.map((a) => (
                    <div key={a.id} className="flex items-start gap-3 p-2 rounded-lg border">
                      <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">{a.kind === "regie" ? "Regie" : a.projects?.name || "?"}</p>
                          {(a.start_time || a.end_time) && (
                            <Badge variant="secondary" className="text-xs">
                              <Clock className="h-3 w-3 mr-1" />
                              {a.start_time?.slice(0, 5)} – {a.end_time?.slice(0, 5)}
                            </Badge>
                          )}
                        </div>
                        {a.profiles && (
                          <p className="text-xs text-muted-foreground">{a.profiles.vorname} {a.profiles.nachname}</p>
                        )}
                        {a.notizen && (
                          <p className="text-xs text-muted-foreground mt-1">{a.notizen}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {selectedEvents.map((e) => (
                    <div key={e.id} className="flex items-start gap-3 p-2 rounded-lg border border-blue-200 bg-blue-50/50">
                      <CalIcon className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold text-sm">{e.title}</p>
                        {!e.all_day && e.start_time && (
                          <p className="text-xs text-muted-foreground">
                            {e.start_time} – {e.end_time || "?"}
                          </p>
                        )}
                        {e.description && <p className="text-xs text-muted-foreground mt-1">{e.description}</p>}
                        {e.mitarbeiter && e.mitarbeiter.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {e.mitarbeiter.map((m, i) => (
                              <Badge key={i} variant="outline" className="text-xs">{m}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Google Calendar subscribe info */}
        {calendarId && (
          <Card className="mt-4">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <CalIcon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Google Kalender abonnieren</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Öffne Google Kalender → "Weitere Kalender" → "Per URL abonnieren" und füge diese ID ein:
                  </p>
                  <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block break-all select-all">
                    {calendarId}
                  </code>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
