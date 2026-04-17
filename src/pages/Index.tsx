import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Session, User } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, FolderKanban, Users, BarChart3, LogOut, FileText, Camera, ArrowRight, Info, User as UserIcon, Zap, CalendarDays, MapPin, StickyNote } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOnboarding } from "@/contexts/OnboardingContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import { NotificationBell } from "@/components/NotificationBell";

// Types
type Project = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

type RecentTimeEntry = {
  id: string;
  datum: string;
  stunden: number;
  taetigkeit: string;
  disturbance_id: string | null;
  project_id: string | null;
  location_type: string | null;
  user_id: string;
  projects: { name: string } | null;
  disturbances: { kunde_name: string; project_id: string | null } | null;
  profiles: { vorname: string; nachname: string } | null;
};

export default function Index() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentEntries, setRecentEntries] = useState<RecentTimeEntry[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isActivated, setIsActivated] = useState<boolean | null>(null);
  const { handleRestartInstallGuide } = useOnboarding();

  const fetchProjects = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status, updated_at")
      .eq("status", "aktiv")
      .order("updated_at", { ascending: false })
      .limit(5);

    if (data) {
      setProjects(data);
    }
  };

  const fetchRecentEntries = async (userId: string, role: string | null) => {
    let query = supabase
      .from("time_entries")
      .select("id, datum, stunden, taetigkeit, disturbance_id, project_id, location_type, user_id, projects(name), disturbances(kunde_name, project_id)")
      .order("datum", { ascending: false });

    if (role === "mitarbeiter") {
      query = query.eq("user_id", userId);
    }

    query = query.limit(10);

    const { data } = await query;

    if (data) {
      // Profile-Namen separat nachladen (Admin sieht alle)
      const uids = Array.from(new Set(data.map((e: any) => e.user_id)));
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .in("id", uids);
      const profMap: Record<string, { vorname: string; nachname: string }> = {};
      (profs || []).forEach((p: any) => { profMap[p.id] = { vorname: p.vorname, nachname: p.nachname }; });

      // Arbeitsberichte: Projekt-Namen nachladen wenn disturbance.project_id gesetzt
      const disturbanceProjectIds = data
        .filter((e: any) => e.location_type === "regie" && e.disturbances?.project_id)
        .map((e: any) => e.disturbances.project_id as string);
      let projectNameMap: Record<string, string> = {};
      if (disturbanceProjectIds.length > 0) {
        const { data: projs } = await supabase
          .from("projects")
          .select("id, name")
          .in("id", Array.from(new Set(disturbanceProjectIds)));
        (projs || []).forEach((p: any) => { projectNameMap[p.id] = p.name; });
      }

      const enriched = data.map((e: any) => ({
        ...e,
        profiles: profMap[e.user_id] || null,
        _disturbanceProjectName: e.disturbances?.project_id ? projectNameMap[e.disturbances.project_id] : null,
      }));
      setRecentEntries(enriched as any);
    }
  };

  const fetchAssignments = async (userId: string) => {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    // Also fetch tomorrow
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];
    // And day after
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    const dayAfterStr = dayAfter.toISOString().split("T")[0];

    const { data } = await supabase
      .from("worker_assignments")
      .select("id, datum, notizen, start_time, end_time, project_id, projects(name)")
      .eq("user_id", userId)
      .gte("datum", todayStr)
      .lte("datum", dayAfterStr)
      .order("datum", { ascending: true });

    if (data) {
      setAssignments(data as any);
    }
  };

  const loadForUser = async (userId: string) => {
    const profileReq = supabase
      .from("profiles")
      .select("vorname, nachname, is_active")
      .eq("id", userId)
      .maybeSingle();

    const roleReq = supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    const [{ data: profileData }, { data: roleData }] = await Promise.all([profileReq, roleReq]);

    setIsActivated(true);
    
    if (profileData) {
      setUserName(`${profileData.vorname} ${profileData.nachname}`.trim());
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata) {
        setUserName(`${user.user_metadata.vorname || ''} ${user.user_metadata.nachname || ''}`.trim() || 'Neuer Benutzer');
      }
    }

    const role = roleData?.role ?? null;
    setUserRole(role);

    await Promise.all([
      fetchProjects(),
      fetchRecentEntries(userId, role),
      fetchAssignments(userId),
    ]);

    setLoading(false);
  };

  useEffect(() => {
    let isMounted = true;

    const handleSession = async (nextSession: Session | null) => {
      if (!isMounted) return;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        setIsActivated(null);
        setUserRole(null);
        setUserName("");
        setProjects([]);
        setRecentEntries([]);
        setLoading(false);
        navigate("/auth");
        return;
      }

      setLoading(true);
      setIsActivated(null);

      await loadForUser(nextSession.user.id);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => {
        void handleSession(nextSession);
      }, 0);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      window.setTimeout(() => {
        void handleSession(session);
      }, 0);
    });

    const projectsChannel = supabase
      .channel("dashboard-projects")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => {
        fetchProjects();
      })
      .subscribe();

    const entriesChannel = supabase
      .channel("dashboard-entries")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "time_entries",
          filter: user ? `user_id=eq.${user.id}` : undefined,
        },
        () => {
          if (user) fetchRecentEntries(user.id, userRole);
        }
      )
      .subscribe();

    const assignmentsChannel = supabase
      .channel("dashboard-assignments")
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_assignments" }, () => {
        if (user) fetchAssignments(user.id);
      })
      .subscribe();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      supabase.removeChannel(projectsChannel);
      supabase.removeChannel(entriesChannel);
      supabase.removeChannel(assignmentsChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: "local" });
    navigate("/auth");
  };

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Lädt...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const isAdmin = userRole === "administrator";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex justify-between items-center gap-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <img src="/fasching-logo.jpg" alt="FASCHING Gebäudetechnik" className="h-8 sm:h-10 w-auto" />
              <div className="hidden sm:block h-8 w-px bg-border" />
              <div className="flex flex-col">
                <span className="text-xs sm:text-sm text-muted-foreground">Hallo</span>
                <span className="text-sm sm:text-base font-semibold">{userName || "Benutzer"}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <UserIcon className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Menü</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Mein Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  
                  <DropdownMenuItem onClick={handleRestartInstallGuide}>
                    <Info className="mr-2 h-4 w-4" />
                    <span>App zum Startbildschirm hinzufügen</span>
                  </DropdownMenuItem>

                  
                  <DropdownMenuSeparator />

                  <ChangePasswordDialog />
                  
                  <DropdownMenuSeparator />
                  
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Abmelden</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8">
        {/* Meine Einteilung - allererstes Element */}
        {assignments.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg sm:text-xl font-bold mb-3 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Meine Einteilung
            </h2>
            <div className="space-y-2">
              {(() => {
                const today = new Date().toISOString().split("T")[0];
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const tomorrowStr = tomorrow.toISOString().split("T")[0];

                const grouped: Record<string, typeof assignments> = {};
                assignments.forEach((a) => {
                  if (!grouped[a.datum]) grouped[a.datum] = [];
                  grouped[a.datum].push(a);
                });

                return Object.entries(grouped).map(([datum, entries]) => {
                  const isToday = datum === today;
                  const isTomorrow = datum === tomorrowStr;
                  const label = isToday ? "Heute" : isTomorrow ? "Morgen" : new Date(datum).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit" });

                  return (
                    <Card key={datum} className={isToday ? "border-primary/50 bg-primary/5" : ""}>
                      <CardContent className="p-3 sm:p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-sm font-bold ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                            {label}
                          </span>
                          {isToday && (
                            <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                              Heute
                            </span>
                          )}
                        </div>
                        <div className="space-y-2">
                          {entries.map((a: any) => (
                            <div key={a.id} className="flex items-start gap-2">
                              <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold text-base">{a.projects?.name || "Unbekanntes Projekt"}</p>
                                  {(a.start_time || a.end_time) && (
                                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                      {a.start_time?.slice(0, 5) || "?"} – {a.end_time?.slice(0, 5) || "?"}
                                    </span>
                                  )}
                                </div>
                                {a.notizen && (
                                  <div className="flex items-start gap-1 mt-0.5">
                                    <StickyNote className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                    <p className="text-sm text-muted-foreground">{a.notizen}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                });
              })()}
            </div>
          </div>
        )}

        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2">
            {isAdmin ? "Admin Dashboard" : "Mein Dashboard"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            {isAdmin
              ? "Verwaltung aller Projekte und Mitarbeiter"
              : "Zeiterfassung und Projektdokumentation"}
          </p>
        </div>

        {/* Main Actions Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
          {/* 1. Zeiterfassung */}
          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
            onClick={() => navigate("/time-tracking")}
          >
            <CardHeader className="space-y-2 pb-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-lg sm:text-xl">Zeiterfassung</CardTitle>
              <CardDescription className="text-sm">
                Stunden auf Projekte buchen
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm">Stunden erfassen</Button>
            </CardContent>
          </Card>

          {/* 2. Arbeitsberichte */}
          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
            onClick={() => navigate("/disturbances")}
          >
            <CardHeader className="space-y-2 pb-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-lg sm:text-xl">Arbeitsberichte</CardTitle>
              <CardDescription className="text-sm">
                Service-Einsätze dokumentieren
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm" variant="outline">Arbeitsberichte öffnen</Button>
            </CardContent>
          </Card>

          {/* 3. Projekte */}
          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
            onClick={() => navigate("/projects")}
          >
            <CardHeader className="space-y-2 pb-3">
              <div className="h-12 w-12 rounded-lg bg-accent/10 flex items-center justify-center">
                <FolderKanban className="h-6 w-6 text-accent" />
              </div>
              <CardTitle className="text-lg sm:text-xl">Projekte</CardTitle>
              <CardDescription className="text-sm">
                {isAdmin ? "Bauvorhaben & Dokumentation" : "Pläne, Bilder, Berichte, etc. hochladen"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm" variant="secondary">Projekte öffnen</Button>
            </CardContent>
          </Card>

          {/* 4. Meine Stunden */}
          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
            onClick={() => navigate("/my-hours")}
          >
            <CardHeader className="space-y-2 pb-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-lg sm:text-xl">Meine Stunden</CardTitle>
              <CardDescription className="text-sm">
                {isAdmin ? "Eigene gebuchte Zeiten anzeigen & bearbeiten" : "Übersicht gebuchter Zeiten"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm" variant="outline">Anzeigen</Button>
            </CardContent>
          </Card>

          {/* 5. Meine Dokumente */}
          {!isAdmin && (
            <Card 
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
              onClick={() => navigate("/my-documents")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-accent/10 flex items-center justify-center">
                  <FileText className="h-6 w-6 text-accent" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Meine Dokumente</CardTitle>
                <CardDescription className="text-sm">
                  Lohnzettel & Krankmeldungen
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline">Dokumente öffnen</Button>
              </CardContent>
            </Card>
          )}

          {/* Admin: Stundenauswertung */}
          {isAdmin && (
            <Card 
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
              onClick={() => navigate("/hours-report")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <BarChart3 className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Stundenauswertung</CardTitle>
                <CardDescription className="text-sm">
                  Auswertung der Projektstunden
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm">Auswerten</Button>
              </CardContent>
            </Card>
          )}

          {/* Plantafel */}
          <Card
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50"
            onClick={() => navigate("/schedule")}
          >
            <CardHeader className="space-y-2 pb-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <CalendarDays className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-lg sm:text-xl">Plantafel</CardTitle>
              <CardDescription className="text-sm">
                {isAdmin ? "Mitarbeiter einteilen & planen" : "Meine Einteilung ansehen"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm" variant="outline">Plantafel öffnen</Button>
            </CardContent>
          </Card>

          {/* Admin: Mitarbeiter */}
          {isAdmin && (
            <Card
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50"
              onClick={() => navigate("/admin")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Mitarbeiter</CardTitle>
                <CardDescription className="text-sm">
                  Benutzerverwaltung
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline">Verwalten</Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Recent Time Entries */}
        {recentEntries.length > 0 && (
          <div className="mt-6">
            <h2 className="text-xl sm:text-2xl font-bold mb-4">
              {isAdmin ? 'Letzte Projektbuchungen (Alle Mitarbeiter)' : 'Meine letzten Buchungen'}
            </h2>
            <div className="space-y-2">
              {recentEntries.map((entry) => (
                <Card 
                  key={entry.id} 
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => {
                    if (entry.disturbance_id) {
                      navigate(`/disturbances/${entry.disturbance_id}`);
                    } else if (isAdmin && entry.project_id) {
                      navigate(`/hours-report?tab=projekte&projectId=${entry.project_id}`);
                    } else if (isAdmin) {
                      navigate("/hours-report?tab=projekte");
                    } else {
                      navigate("/my-hours");
                    }
                  }}
                >
                  <CardContent className="p-3">
                    <div className="flex justify-between items-center gap-3">
                      <div className="flex-1 min-w-0">
                          {(() => {
                            const isRegie = entry.location_type === "regie" || entry.disturbance_id;
                            const disturbanceProjectName = (entry as any)._disturbanceProjectName;
                            const workerName = entry.profiles
                              ? `${entry.profiles.vorname} ${entry.profiles.nachname}`.trim()
                              : null;

                            let primary: string;
                            let secondary: string;

                            if (isRegie) {
                              // Arbeitsbericht
                              const kunde = entry.disturbances?.kunde_name;
                              if (disturbanceProjectName) {
                                primary = `Arbeitsbericht: ${disturbanceProjectName}`;
                              } else if (kunde) {
                                primary = `Arbeitsbericht: ${kunde}`;
                              } else {
                                primary = "Arbeitsbericht";
                              }
                              secondary = isAdmin && workerName
                                ? `gebucht von ${workerName}${entry.taetigkeit ? ` · ${entry.taetigkeit}` : ""}`
                                : entry.taetigkeit || "";
                            } else if (entry.projects?.name) {
                              // Projekt-Buchung
                              primary = `Projekt: ${entry.projects.name}`;
                              secondary = isAdmin && workerName
                                ? `gebucht von ${workerName}${entry.taetigkeit ? ` · ${entry.taetigkeit}` : ""}`
                                : entry.taetigkeit || "";
                            } else {
                              // Werkstatt
                              primary = "Werkstatt";
                              secondary = isAdmin && workerName
                                ? `gebucht von ${workerName}${entry.taetigkeit ? ` · ${entry.taetigkeit}` : ""}`
                                : entry.taetigkeit || "";
                            }

                            return (
                              <>
                                <p className="font-semibold text-base truncate">{primary}</p>
                                {secondary && <p className="text-sm text-muted-foreground truncate">{secondary}</p>}
                              </>
                            );
                          })()}
                      </div>
                      <div className="text-right ml-3 shrink-0">
                        <p className="font-bold">{entry.stunden} h</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(entry.datum).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Button
              variant="outline"
              className="w-full mt-3"
              onClick={() => navigate(isAdmin ? "/hours-report" : "/my-hours")}
            >
              {isAdmin ? "Zur Stundenauswertung" : "Alle Stunden anzeigen"}
            </Button>
          </div>
        )}

        <div className="mt-6 text-center text-xs text-muted-foreground">
          <p>FASCHING Gebäudetechnik</p>
        </div>
      </main>
    </div>
  );
}

