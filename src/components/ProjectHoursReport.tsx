import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Download, Calendar, Briefcase, MapPin, Wrench, ChevronDown, Receipt, Trash2 } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadCsv, sanitizeFilename } from "@/lib/fileExport";

interface DetailedProjectEntry {
  id: string;
  userId: string;
  employeeName: string;
  datum: string;
  startTime: string;
  endTime: string;
  pauseStart: string | null;
  pauseEnd: string | null;
  pauseMinutes: number;
  taetigkeit: string;
  hours: number;
  locationType: string;
  disturbanceId: string | null;
  disturbanceKundeName: string | null;
}

interface Project {
  id: string;
  name: string;
  plz?: string;
}

type RangePreset = "current-month" | "last-month" | "last-quarter" | "all" | "custom";

interface ProjectHoursReportProps {
  initialSelectedProjectId?: string;
}

const toIsoDate = (date: Date) => format(date, "yyyy-MM-dd");

const getCurrentMonthRange = () => {
  const now = new Date();
  return {
    startDate: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: toIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};

const getLastMonthRange = () => {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    startDate: toIsoDate(lastMonth),
    endDate: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
};

const getLastQuarterRange = () => {
  const now = new Date();
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3 - 3;
  return {
    startDate: toIsoDate(new Date(now.getFullYear(), quarterStartMonth, 1)),
    endDate: toIsoDate(new Date(now.getFullYear(), quarterStartMonth + 3, 0)),
  };
};

export default function ProjectHoursReport({ initialSelectedProjectId }: ProjectHoursReportProps) {
  const initialRange = getCurrentMonthRange();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialSelectedProjectId || "");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectData, setProjectData] = useState<DetailedProjectEntry[]>([]);
  const [totalHours, setTotalHours] = useState(0);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Record<string, { vorname: string; nachname: string }>>({});
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [rangePreset, setRangePreset] = useState<RangePreset>("current-month");
  const [startDate, setStartDate] = useState<string>(initialRange.startDate);
  const [endDate, setEndDate] = useState<string>(initialRange.endDate);
  const [allTimeRange, setAllTimeRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [invoices, setInvoices] = useState<{ id: string; user_id: string; hours: number; reason: string; created_at: string }[]>([]);
  const [invoiceForm, setInvoiceForm] = useState({ userId: "", hours: "", reason: "" });
  const [savingInvoice, setSavingInvoice] = useState(false);
  const { toast } = useToast();

  const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.hours), 0);

  useEffect(() => {
    fetchProfiles();
    fetchProjects();
    checkAdmin();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      fetchInvoices();
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (initialSelectedProjectId) {
      setSelectedProjectId(initialSelectedProjectId);
    }
  }, [initialSelectedProjectId]);

  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectDateRange();
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (rangePreset === "all" && allTimeRange) {
      setStartDate(allTimeRange.startDate);
      setEndDate(allTimeRange.endDate);
    }
  }, [rangePreset, allTimeRange]);

  useEffect(() => {
    if (selectedProjectId && profilesLoaded) {
      fetchProjectHours();
    }
  }, [selectedProjectId, startDate, endDate, profilesLoaded]);

  useEffect(() => {
    if (!selectedProjectId) return;

    const channel = supabase
      .channel("project-hours-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "time_entries",
          filter: `project_id=eq.${selectedProjectId}`,
        },
        () => {
          fetchProjectHours();
          fetchProjectDateRange();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedProjectId, startDate, endDate, profilesLoaded]);

  const fetchProfiles = async () => {
    const { data } = await supabase.from("profiles").select("id, vorname, nachname");

    if (data) {
      const profileMap: Record<string, { vorname: string; nachname: string }> = {};
      data.forEach((profile) => {
        profileMap[profile.id] = { vorname: profile.vorname, nachname: profile.nachname };
      });
      setProfiles(profileMap);
    }

    setProfilesLoaded(true);
  };

  const checkAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "administrator")
      .maybeSingle();
    setIsAdmin(!!data);
  };

  const fetchInvoices = async () => {
    if (!selectedProjectId) return;
    const { data } = await supabase
      .from("project_invoices")
      .select("id, user_id, hours, reason, created_at")
      .eq("project_id", selectedProjectId)
      .order("created_at", { ascending: false });
    setInvoices(data || []);
  };

  const handleSaveInvoice = async () => {
    if (!invoiceForm.userId || !invoiceForm.hours || !selectedProjectId) return;
    setSavingInvoice(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingInvoice(false); return; }

    const { error } = await supabase.from("project_invoices").insert({
      project_id: selectedProjectId,
      user_id: invoiceForm.userId,
      hours: parseFloat(invoiceForm.hours),
      reason: invoiceForm.reason.trim(),
      invoiced_by: user.id,
    });

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Verrechnung konnte nicht gespeichert werden" });
    } else {
      toast({ title: "Erfolg", description: "Verrechnung gespeichert" });
      setInvoiceForm({ userId: "", hours: "", reason: "" });
      fetchInvoices();
    }
    setSavingInvoice(false);
  };

  const handleDeleteInvoice = async (id: string) => {
    const { error } = await supabase.from("project_invoices").delete().eq("id", id);
    if (!error) fetchInvoices();
  };

  const fetchProjects = async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, plz")
      .order("name");

    if (data && !error) {
      setProjects(data);

      const requestedProjectExists = initialSelectedProjectId
        ? data.some((project) => project.id === initialSelectedProjectId)
        : false;

      if (requestedProjectExists && initialSelectedProjectId) {
        setSelectedProjectId(initialSelectedProjectId);
      } else if (!selectedProjectId && data.length > 0) {
        setSelectedProjectId(data[0].id);
      }
    }

    setLoading(false);
  };

  const fetchProjectDateRange = async () => {
    if (!selectedProjectId) return;

    const [{ data: firstEntry, error: firstError }, { data: lastEntry, error: lastError }] = await Promise.all([
      supabase
        .from("time_entries")
        .select("datum")
        .eq("project_id", selectedProjectId)
        .not("project_id", "is", null)
        .order("datum", { ascending: true })
        .limit(1),
      supabase
        .from("time_entries")
        .select("datum")
        .eq("project_id", selectedProjectId)
        .not("project_id", "is", null)
        .order("datum", { ascending: false })
        .limit(1),
    ]);

    if (firstError || lastError || !firstEntry?.[0] || !lastEntry?.[0]) {
      setAllTimeRange(null);
      return;
    }

    setAllTimeRange({
      startDate: firstEntry[0].datum,
      endDate: lastEntry[0].datum,
    });
  };

  const fetchProjectHours = async () => {
    if (!selectedProjectId) return;

    setLoading(true);

    const { data, error } = await supabase
      .from("time_entries")
      .select("id, datum, start_time, end_time, pause_start, pause_end, pause_minutes, stunden, taetigkeit, user_id, location_type, disturbance_id, disturbances(kunde_name)")
      .eq("project_id", selectedProjectId)
      .gte("datum", startDate)
      .lte("datum", endDate)
      .not("project_id", "is", null)
      .order("datum", { ascending: true });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Projektstunden konnten nicht geladen werden",
      });
      setLoading(false);
      return;
    }

    const detailedEntries: DetailedProjectEntry[] = (data || []).map((entry) => {
      const profile = profiles[entry.user_id];
      const employeeName = profile
        ? `${profile.vorname} ${profile.nachname}`.trim()
        : "Unbekannter Mitarbeiter";

      return {
        id: entry.id,
        userId: entry.user_id,
        employeeName,
        datum: entry.datum,
        startTime: entry.start_time,
        endTime: entry.end_time,
        pauseStart: entry.pause_start,
        pauseEnd: entry.pause_end,
        pauseMinutes: entry.pause_minutes || 0,
        taetigkeit: entry.taetigkeit,
        hours: Number(entry.stunden || 0),
        locationType: entry.location_type || "baustelle",
        disturbanceId: entry.disturbance_id || null,
        disturbanceKundeName: (entry as any).disturbances?.kunde_name || null,
      };
    });

    detailedEntries.sort((a, b) => {
      const dateCompare = a.datum.localeCompare(b.datum);
      if (dateCompare !== 0) return dateCompare;
      return a.employeeName.localeCompare(b.employeeName, "de");
    });

    setProjectData(detailedEntries);
    setTotalHours(detailedEntries.reduce((sum, entry) => sum + entry.hours, 0));
    setLoading(false);
  };

  const formatTime = (time: string | null): string => {
    if (!time) return "";
    return time.substring(0, 5);
  };

  const formatPause = (entry: DetailedProjectEntry): string => {
    if (entry.pauseStart && entry.pauseEnd) {
      return `${formatTime(entry.pauseStart)} - ${formatTime(entry.pauseEnd)}`;
    }
    if (entry.pauseMinutes > 0) {
      return `${entry.pauseMinutes} Min.`;
    }
    return "";
  };

  const addBordersToCell = (cell: any, thick = false) => {
    const borderStyle = thick ? "medium" : "thin";
    cell.s = {
      border: {
        top: { style: borderStyle, color: { rgb: "000000" } },
        bottom: { style: borderStyle, color: { rgb: "000000" } },
        left: { style: borderStyle, color: { rgb: "000000" } },
        right: { style: borderStyle, color: { rgb: "000000" } },
      },
      alignment: { vertical: "center", horizontal: "left" },
    };
  };

  const applyRangePreset = (preset: Exclude<RangePreset, "custom">) => {
    setRangePreset(preset);

    if (preset === "current-month") {
      const range = getCurrentMonthRange();
      setStartDate(range.startDate);
      setEndDate(range.endDate);
      return;
    }

    if (preset === "last-month") {
      const range = getLastMonthRange();
      setStartDate(range.startDate);
      setEndDate(range.endDate);
      return;
    }

    if (preset === "last-quarter") {
      const range = getLastQuarterRange();
      setStartDate(range.startDate);
      setEndDate(range.endDate);
      return;
    }

    if (allTimeRange) {
      setStartDate(allTimeRange.startDate);
      setEndDate(allTimeRange.endDate);
    }
  };

  const buildGroupedEntries = () => {
    const sortedEntries = [...projectData].sort((a, b) => {
      const employeeCompare = a.employeeName.localeCompare(b.employeeName, "de");
      if (employeeCompare !== 0) return employeeCompare;

      const dateCompare = a.datum.localeCompare(b.datum);
      if (dateCompare !== 0) return dateCompare;

      return formatTime(a.startTime).localeCompare(formatTime(b.startTime));
    });

    return sortedEntries.reduce<
      Array<{ employeeName: string; entries: DetailedProjectEntry[]; totalHours: number }>
    >((groups, entry) => {
      const existingGroup = groups.find((group) => group.employeeName === entry.employeeName);

      if (existingGroup) {
        existingGroup.entries.push(entry);
        existingGroup.totalHours += entry.hours;
      } else {
        groups.push({
          employeeName: entry.employeeName,
          entries: [entry],
          totalHours: entry.hours,
        });
      }

      return groups;
    }, []);
  };

  const buildProjectWorksheetData = () => {
    const selectedProject = projects.find((project) => project.id === selectedProjectId);
    if (!selectedProject) return null;

    const groupedEntries = buildGroupedEntries();
    const worksheetData: Array<Array<string | number>> = [
      ["Projektzeiterfassung", selectedProject.name],
      ["PLZ:", selectedProject.plz || "k.A."],
      ["Zeitraum:", `${startDate} bis ${endDate}`],
      [],
      ["Datum", "Start", "Ende", "Pause", "Stunden", "Mitarbeiter", "Tätigkeit", "Ort"],
    ];

    const employeeHeaderRows: number[] = [];
    const employeeSummaryRows: number[] = [];

    groupedEntries.forEach((group, groupIndex) => {
      employeeHeaderRows.push(worksheetData.length);
      worksheetData.push([`Mitarbeiter: ${group.employeeName}`, "", "", "", "", "", "", ""]);

      group.entries.forEach((entry) => {
        const dateFormatted = format(parseISO(entry.datum), "dd.MM.yyyy", { locale: de });
        const ortText =
          entry.locationType === "werkstatt"
            ? entry.taetigkeit?.trim() || "Sonstiges"
            : "Baustelle";

        worksheetData.push([
          dateFormatted,
          formatTime(entry.startTime),
          formatTime(entry.endTime),
          formatPause(entry),
          entry.hours.toFixed(2),
          entry.employeeName,
          entry.taetigkeit,
          ortText,
        ]);
      });

      employeeSummaryRows.push(worksheetData.length);
      worksheetData.push(["", "", "", "Summe Mitarbeiter", group.totalHours.toFixed(2), "", "", ""]);

      if (groupIndex < groupedEntries.length - 1) {
        worksheetData.push([]);
      }
    });

    if (groupedEntries.length > 0) {
      worksheetData.push([]);
    }

    const totalRowIndex = worksheetData.length;
    worksheetData.push(["GESAMT", "", "", "", totalHours.toFixed(2), "", "", ""]);

    // Add Teilverrechnung section
    if (invoices.length > 0) {
      worksheetData.push([]);
      worksheetData.push(["TEILVERRECHNUNG", "", "", "", "", "", "", ""]);
      worksheetData.push(["Mitarbeiter", "Stunden", "Grund", "Datum", "", "", "", ""]);
      invoices.forEach((inv) => {
        const p = profiles[inv.user_id];
        const name = p ? `${p.vorname} ${p.nachname}` : "Unbekannt";
        worksheetData.push([
          name,
          Number(inv.hours).toFixed(2),
          inv.reason || "",
          format(new Date(inv.created_at), "dd.MM.yyyy"),
          "", "", "", "",
        ]);
      });
      worksheetData.push(["Verrechnet gesamt", totalInvoiced.toFixed(2), "", "", "", "", "", ""]);
      worksheetData.push(["Offen", (totalHours - totalInvoiced).toFixed(2), "", "", "", "", "", ""]);
    }

    return { selectedProject, worksheetData, employeeHeaderRows, employeeSummaryRows, totalRowIndex };
  };

  const getProjectExportBaseName = () => {
    const selectedProject = projects.find((project) => project.id === selectedProjectId);
    return selectedProject ? sanitizeFilename(`Projektzeiterfassung_${selectedProject.name}`) : "Projektzeiterfassung";
  };

  const exportToExcel = () => {
    const exportData = buildProjectWorksheetData();
    if (!exportData) return;

    const { selectedProject, worksheetData, employeeHeaderRows, employeeSummaryRows, totalRowIndex } = exportData;
    const ws = XLSX.utils.aoa_to_sheet(worksheetData);

    ws["!cols"] = [
      { wch: 12 },
      { wch: 8 },
      { wch: 8 },
      { wch: 14 },
      { wch: 10 },
      { wch: 22 },
      { wch: 24 },
      { wch: 12 },
    ];

    ws["!merges"] = [
      { s: { r: 0, c: 1 }, e: { r: 0, c: 7 } },
      { s: { r: 2, c: 1 }, e: { r: 2, c: 7 } },
      ...employeeHeaderRows.map((rowIndex) => ({
        s: { r: rowIndex, c: 0 },
        e: { r: rowIndex, c: 7 },
      })),
    ];

    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) {
          ws[cellAddress] = { t: "s", v: "" };
        }

        const isHeaderRow = R === 4;
        const isEmployeeHeaderRow = employeeHeaderRows.includes(R);
        const isEmployeeSummaryRow = employeeSummaryRows.includes(R);
        const isTotalRow = R === totalRowIndex;
        const shouldEmphasize = isHeaderRow || isEmployeeHeaderRow || isEmployeeSummaryRow || isTotalRow;

        addBordersToCell(ws[cellAddress], shouldEmphasize);

        if (shouldEmphasize) {
          ws[cellAddress].s = {
            ...ws[cellAddress].s,
            font: { bold: true },
          };
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, selectedProject.name.substring(0, 31));
    XLSX.writeFile(wb, `${getProjectExportBaseName()}.xlsx`);

    toast({
      title: "Export erfolgreich",
      description: "Die Excel-Datei wurde heruntergeladen",
    });
  };

  const exportToCsv = () => {
    const exportData = buildProjectWorksheetData();
    if (!exportData) return;

    downloadCsv(exportData.worksheetData, `${getProjectExportBaseName()}.csv`);
    toast({
      title: "Export erfolgreich",
      description: "Die CSV-Datei wurde heruntergeladen",
    });
  };

  if (loading && projects.length === 0) {
    return <div className="text-center py-8">Lädt Projekte...</div>;
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start gap-3 flex-wrap">
          <div>
            <CardTitle>Projektzeiterfassung</CardTitle>
            <CardDescription>Detaillierte Stunden nach Projekt mit Arbeitszeiten</CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={!selectedProjectId || projectData.length === 0}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                Exportieren
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportToExcel}>Excel exportieren</DropdownMenuItem>
              <DropdownMenuItem onClick={exportToCsv}>CSV exportieren</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Projekt auswählen</label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Projekt wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name} {project.plz && `(${project.plz})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Von:</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    setRangePreset("custom");
                    setStartDate(event.target.value);
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Bis:</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => {
                    setRangePreset("custom");
                    setEndDate(event.target.value);
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant={rangePreset === "current-month" ? "default" : "outline"}
                size="sm"
                onClick={() => applyRangePreset("current-month")}
              >
                Dieser Monat
              </Button>
              <Button
                variant={rangePreset === "last-month" ? "default" : "outline"}
                size="sm"
                onClick={() => applyRangePreset("last-month")}
              >
                Letzter Monat
              </Button>
              <Button
                variant={rangePreset === "last-quarter" ? "default" : "outline"}
                size="sm"
                onClick={() => applyRangePreset("last-quarter")}
              >
                Letztes Quartal
              </Button>
              <Button
                variant={rangePreset === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => applyRangePreset("all")}
                disabled={!allTimeRange}
              >
                Gesamt
              </Button>
            </div>
          </CardContent>
        </Card>

        {selectedProject && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Projekt</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-bold">{selectedProject.name}</p>
                  <p className="text-xs text-muted-foreground">PLZ: {selectedProject.plz || "k.A."}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Gesamt-Stunden</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{totalHours.toFixed(2)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Verrechnet</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-emerald-600">{totalInvoiced.toFixed(2)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Offen</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className={`text-2xl font-bold ${(totalHours - totalInvoiced) > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                    {(totalHours - totalInvoiced).toFixed(2)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {isAdmin && (
              <div className="flex justify-end">
                <Button variant="outline" className="gap-2" onClick={() => setShowInvoiceDialog(true)}>
                  <Receipt className="h-4 w-4" />
                  Teilverrechnung
                </Button>
              </div>
            )}
          </>
        )}

        {projectData.length > 0 ? (
          <Card>
            <CardContent className="pt-6 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>Ende</TableHead>
                    <TableHead>Pause</TableHead>
                    <TableHead className="text-right">Stunden</TableHead>
                    <TableHead>Mitarbeiter</TableHead>
                    <TableHead>Tätigkeit</TableHead>
                    <TableHead>Ort</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                {projectData.map((entry) => (
                    <TableRow key={entry.id} className={entry.disturbanceId ? "bg-blue-50/60 dark:bg-blue-950/30" : ""}>
                      <TableCell className="font-medium">
                        {format(parseISO(entry.datum), "dd.MM.yyyy", { locale: de })}
                      </TableCell>
                      <TableCell>{formatTime(entry.startTime)}</TableCell>
                      <TableCell>{formatTime(entry.endTime)}</TableCell>
                      <TableCell>{formatPause(entry)}</TableCell>
                      <TableCell className="text-right font-medium">{entry.hours.toFixed(2)}</TableCell>
                      <TableCell>{entry.employeeName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className="gap-1">
                            <Briefcase className="w-3 h-3" />
                            {entry.taetigkeit}
                          </Badge>
                          {entry.disturbanceId && (
                            <Badge className="bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800 text-[10px] px-1.5 py-0">
                              Arbeitsbericht{entry.disturbanceKundeName ? `: ${entry.disturbanceKundeName}` : ''}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {entry.locationType === "werkstatt" ? (
                          <Badge variant="secondary" className="gap-1">
                            <Wrench className="w-3 h-3" />
                            {entry.taetigkeit?.trim() || "Sonstiges"}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1">
                            <MapPin className="w-3 h-3" />
                            Baustelle
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4} className="font-bold">
                      Gesamt
                    </TableCell>
                    <TableCell className="text-right font-bold">{totalHours.toFixed(2)}</TableCell>
                    <TableCell colSpan={3}></TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        ) : selectedProjectId ? (
          <div className="text-center py-12 text-muted-foreground">
            <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Keine Stunden für dieses Projekt erfasst</p>
          </div>
        ) : null}
      </CardContent>

      {/* Teilverrechnung Dialog */}
      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Teilverrechnung
            </DialogTitle>
            <DialogDescription>
              Bereits verrechnete Stunden pro Mitarbeiter erfassen
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Mitarbeiter</Label>
                <Select value={invoiceForm.userId} onValueChange={(v) => setInvoiceForm({ ...invoiceForm, userId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const projectUserIds = [...new Set(projectData.map(e => e.userId))];
                      return projectUserIds.map((id) => {
                        const p = profiles[id];
                        if (!p) return null;
                        return (
                          <SelectItem key={id} value={id}>
                            {p.vorname} {p.nachname}
                          </SelectItem>
                        );
                      });
                    })()}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Stunden</Label>
                <Input
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={invoiceForm.hours}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, hours: e.target.value })}
                  placeholder="z.B. 8"
                />
              </div>
            </div>
            <div>
              <Label>Grund / Rechnung (optional)</Label>
              <Input
                value={invoiceForm.reason}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, reason: e.target.value })}
                placeholder="z.B. Rechnung RE-2026-001"
              />
            </div>
            <Button onClick={handleSaveInvoice} disabled={savingInvoice || !invoiceForm.userId || !invoiceForm.hours} className="w-full">
              {savingInvoice ? "Speichern..." : "Verrechnung eintragen"}
            </Button>
          </div>

          {invoices.length > 0 && (
            <div className="mt-4">
              <h4 className="font-medium mb-2">Bisherige Verrechnungen</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {invoices.map((inv) => {
                  const p = profiles[inv.user_id];
                  return (
                    <div key={inv.id} className="flex items-center justify-between text-sm border rounded-md p-2">
                      <div>
                        <span className="font-medium">{p ? `${p.vorname} ${p.nachname}` : "Unbekannt"}</span>
                        <span className="ml-2 text-muted-foreground">{Number(inv.hours).toFixed(2)} h</span>
                        {inv.reason && <span className="ml-2 text-xs text-muted-foreground">({inv.reason})</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(inv.created_at), "dd.MM.yy")}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => handleDeleteInvoice(inv.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-sm font-medium text-right">
                Gesamt verrechnet: {totalInvoiced.toFixed(2)} h
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
