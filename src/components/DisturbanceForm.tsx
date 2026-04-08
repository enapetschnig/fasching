import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, Clock, User, Mail, Phone, MapPin, FileText, Package, Plus, Trash2, FolderOpen } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LocationButton } from "@/components/LocationButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useBreakValidation } from "@/hooks/useBreakValidation";
import { format } from "date-fns";
import { MultiEmployeeSelect } from "@/components/MultiEmployeeSelect";
import { blockSpansBreakfast, blockSpansLunch, BREAKFAST_BREAK_START, BREAKFAST_BREAK_END, LUNCH_BREAK_START, LUNCH_BREAK_END, LUNCH_BREAK_MINUTES } from "@/lib/workingHours";
import { VoiceRecorder } from "@/components/VoiceRecorder";

type MaterialEntry = {
  id: string;
  material: string;
  menge: string;
};

type DisturbanceFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  editData?: {
    id: string;
    datum: string;
    start_time: string;
    end_time: string;
    pause_minutes: number;
    kunde_name: string;
    kunde_email: string | null;
    kunde_adresse: string | null;
    kunde_telefon: string | null;
    beschreibung: string;
    notizen: string | null;
    project_id?: string | null;
  } | null;
};

export const DisturbanceForm = ({ open, onOpenChange, onSuccess, editData }: DisturbanceFormProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [directHoursMode, setDirectHoursMode] = useState(false);
  const [directHours, setDirectHours] = useState("");
  const [workType, setWorkType] = useState<"projekt" | "kunde">("kunde");
  const [hasBreakfastBreak, setHasBreakfastBreak] = useState(false);
  const [hasLunchBreak, setHasLunchBreak] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    datum: format(new Date(), "yyyy-MM-dd"),
    startTime: "08:00",
    endTime: "10:00",
    pauseMinutes: 0,
    kundeName: "",
    kundeEmail: "",
    kundeAdresse: "",
    kundeTelefon: "",
    beschreibung: "",
    notizen: "",
  });

  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [materials, setMaterials] = useState<MaterialEntry[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string; plz: string; adresse?: string; kunde_name?: string; kunde_email?: string; kunde_telefon?: string }[]>([]);

  const { breakfastTaken, lunchTaken } = useBreakValidation(
    userId,
    formData.datum,
    editData ? [editData.id] : []
  );

  // Fetch current user ID
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  // Auto-check breaks based on time range
  useEffect(() => {
    if (!directHoursMode) {
      const spansBreakfast = blockSpansBreakfast(formData.startTime, formData.endTime);
      const spansLunch = blockSpansLunch(formData.startTime, formData.endTime);
      if (!breakfastTaken) setHasBreakfastBreak(spansBreakfast);
      if (!lunchTaken) setHasLunchBreak(spansLunch);
    }
  }, [formData.startTime, formData.endTime, breakfastTaken, lunchTaken, directHoursMode]);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, plz, adresse, kunde_name, kunde_email, kunde_telefon")
      .eq("status", "aktiv")
      .order("name");
    if (data) setProjects(data);
  };

  const fetchProjectCustomerData = async (projectId: string) => {
    const { data } = await supabase
      .from("projects")
      .select("name, plz, adresse, kunde_name, kunde_email, kunde_telefon")
      .eq("id", projectId)
      .single();
    if (data) {
      setFormData(prev => ({
        ...prev,
        kundeName: data.kunde_name || prev.kundeName,
        kundeEmail: data.kunde_email || prev.kundeEmail,
        kundeAdresse: data.adresse || prev.kundeAdresse,
        kundeTelefon: data.kunde_telefon || prev.kundeTelefon,
      }));
    }
  };

  useEffect(() => {
    if (editData) {
      setFormData({
        datum: editData.datum,
        startTime: editData.start_time.slice(0, 5),
        endTime: editData.end_time.slice(0, 5),
        pauseMinutes: editData.pause_minutes,
        kundeName: editData.kunde_name,
        kundeEmail: editData.kunde_email || "",
        kundeAdresse: editData.kunde_adresse || "",
        kundeTelefon: editData.kunde_telefon || "",
        beschreibung: editData.beschreibung,
        notizen: editData.notizen || "",
      });
      setSelectedProjectId(editData.project_id || null);
      setWorkType(editData.project_id ? "projekt" : "kunde");
      loadExistingWorkers(editData.id);
      loadExistingMaterials(editData.id);
    } else {
      setFormData({
        datum: format(new Date(), "yyyy-MM-dd"),
        startTime: "08:00",
        endTime: "10:00",
        pauseMinutes: 0,
        kundeName: "",
        kundeEmail: "",
        kundeAdresse: "",
        kundeTelefon: "",
        beschreibung: "",
        notizen: "",
      });
      setSelectedEmployees([]);
      setMaterials([]);
      setSelectedProjectId(null);
      setWorkType("kunde");
      setHasBreakfastBreak(false);
      setHasLunchBreak(false);
    }
  }, [editData, open]);

  const loadExistingWorkers = async (disturbanceId: string) => {
    const { data } = await supabase
      .from("disturbance_workers")
      .select("user_id, is_main")
      .eq("disturbance_id", disturbanceId);
    
    if (data) {
      // Only load non-main workers (main is the creator)
      const additionalWorkers = data.filter(w => !w.is_main).map(w => w.user_id);
      setSelectedEmployees(additionalWorkers);
    }
  };

  const loadExistingMaterials = async (disturbanceId: string) => {
    const { data } = await supabase
      .from("disturbance_materials")
      .select("id, material, menge")
      .eq("disturbance_id", disturbanceId);
    
    if (data) {
      setMaterials(data.map(m => ({
        id: m.id,
        material: m.material,
        menge: m.menge || "",
      })));
    }
  };

  const calculateHours = (): number => {
    const [startH, startM] = formData.startTime.split(":").map(Number);
    const [endH, endM] = formData.endTime.split(":").map(Number);
    // Lunch break replaces the old pauseMinutes when checked
    const breakMinutes = hasLunchBreak ? LUNCH_BREAK_MINUTES : formData.pauseMinutes;
    const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM) - breakMinutes;
    return Math.max(0, totalMinutes / 60);
  };

  const addMaterial = () => {
    setMaterials([...materials, { id: crypto.randomUUID(), material: "", menge: "" }]);
  };

  const removeMaterial = (id: string) => {
    setMaterials(materials.filter(m => m.id !== id));
  };

  const updateMaterial = (id: string, field: "material" | "menge", value: string) => {
    setMaterials(materials.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSaving(false);
      return;
    }

    // Validation
    if (!formData.kundeName.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Kundenname ist erforderlich" });
      setSaving(false);
      return;
    }

    if (!formData.beschreibung.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Arbeitsbeschreibung ist erforderlich" });
      setSaving(false);
      return;
    }

    const [startH, startM] = formData.startTime.split(":").map(Number);
    const [endH, endM] = formData.endTime.split(":").map(Number);
    if (endH * 60 + endM <= startH * 60 + startM) {
      toast({ variant: "destructive", title: "Fehler", description: "Endzeit muss nach Startzeit liegen" });
      setSaving(false);
      return;
    }

    const stunden = calculateHours();

    const disturbanceData = {
      user_id: user.id,
      datum: formData.datum,
      start_time: formData.startTime,
      end_time: formData.endTime,
      pause_minutes: formData.pauseMinutes,
      stunden,
      kunde_name: formData.kundeName.trim(),
      kunde_email: formData.kundeEmail.trim() || null,
      kunde_adresse: formData.kundeAdresse.trim() || null,
      kunde_telefon: formData.kundeTelefon.trim() || null,
      beschreibung: formData.beschreibung.trim(),
      notizen: formData.notizen.trim() || null,
      project_id: selectedProjectId || null,
      has_breakfast_break: hasBreakfastBreak,
      has_lunch_break: hasLunchBreak,
    };

    if (editData) {
      const { error } = await supabase
        .from("disturbances")
        .update(disturbanceData)
        .eq("id", editData.id);

      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Arbeitsbericht konnte nicht aktualisiert werden" });
        setSaving(false);
        return;
      }

      await updateDisturbanceWorkers(editData.id, selectedEmployees);
      await updateMaterials(editData.id, user.id);

      // Update time entries: delete old ones and recreate
      await createTimeEntriesForDisturbance(editData.id, user.id, stunden, disturbanceData);

      toast({ title: "Erfolg", description: "Arbeitsbericht wurde aktualisiert" });
    } else {
      const { data: newDisturbance, error } = await supabase
        .from("disturbances")
        .insert(disturbanceData)
        .select()
        .single();

      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Arbeitsbericht konnte nicht erstellt werden" });
        setSaving(false);
        return;
      }

      const workerRows = [
        { disturbance_id: newDisturbance.id, user_id: user.id, is_main: true },
        ...selectedEmployees.map((workerId) => ({
          disturbance_id: newDisturbance.id,
          user_id: workerId,
          is_main: false,
        })),
      ];

      const { error: workersError } = await supabase.from("disturbance_workers").insert(workerRows);

      if (workersError) {
        toast({ variant: "destructive", title: "Fehler", description: "Mitarbeiter konnten nicht gespeichert werden" });
        setSaving(false);
        return;
      }

      const validMaterials = materials.filter(m => m.material.trim());
      if (validMaterials.length > 0) {
        await supabase.from("disturbance_materials").insert(
          validMaterials.map(m => ({
            disturbance_id: newDisturbance.id,
            user_id: user.id,
            material: m.material.trim(),
            menge: m.menge.trim() || null,
          }))
        );
      }

      // Create time entries for creator and team
      await createTimeEntriesForDisturbance(newDisturbance.id, user.id, stunden, disturbanceData);

      toast({ title: "Erfolg", description: "Arbeitsbericht wurde erfasst" });

      setSaving(false);
      onOpenChange(false);
      navigate(`/disturbances/${newDisturbance.id}?openSignature=true`);
      return;
    }

    setSaving(false);
    onSuccess();
  };

  const createTimeEntriesForDisturbance = async (
    disturbanceId: string,
    userId: string,
    stunden: number,
    data: { datum: string; start_time: string; end_time: string; pause_minutes: number; has_breakfast_break?: boolean; has_lunch_break?: boolean }
  ) => {
    // Delete existing time entries linked to this disturbance
    await supabase
      .from("time_entries")
      .delete()
      .eq("disturbance_id", disturbanceId);

    // Calculate pause_start/pause_end in the middle of the shift
    let calculatedPauseStart: string | null = null;
    let calculatedPauseEnd: string | null = null;
    if (data.pause_minutes > 0) {
      const [sh, sm] = data.start_time.split(":").map(Number);
      const [eh, em] = data.end_time.split(":").map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      const midpoint = (startMin + endMin) / 2;
      const halfPause = data.pause_minutes / 2;
      // Round pStart down to nearest 30-minute step
      const pStart = Math.floor((midpoint - halfPause) / 30) * 30;
      const pEnd = pStart + data.pause_minutes;
      calculatedPauseStart = `${String(Math.floor(pStart / 60)).padStart(2, "0")}:${String(pStart % 60).padStart(2, "0")}`;
      calculatedPauseEnd = `${String(Math.floor(pEnd / 60)).padStart(2, "0")}:${String(pEnd % 60).padStart(2, "0")}`;
    }

    const mainEntry = {
      user_id: userId,
      datum: data.datum,
      project_id: selectedProjectId || null,
      disturbance_id: disturbanceId,
      taetigkeit: "Regiearbeit",
      stunden,
      start_time: data.start_time,
      end_time: data.end_time,
      pause_minutes: data.pause_minutes,
      pause_start: calculatedPauseStart,
      pause_end: calculatedPauseEnd,
      location_type: "regie",
      notizen: null,
      week_type: null,
      has_breakfast_break: data.has_breakfast_break || false,
      has_lunch_break: data.has_lunch_break || false,
    };

    const teamEntries = selectedEmployees.map((workerId) => ({
      user_id: workerId,
      datum: data.datum,
      project_id: selectedProjectId || null,
      disturbance_id: disturbanceId,
      taetigkeit: "Regiearbeit",
      stunden,
      start_time: data.start_time,
      end_time: data.end_time,
      pause_minutes: data.pause_minutes,
      pause_start: calculatedPauseStart,
      pause_end: calculatedPauseEnd,
      location_type: "regie",
      notizen: null,
      week_type: null,
      has_breakfast_break: data.has_breakfast_break || false,
      has_lunch_break: data.has_lunch_break || false,
    }));

    const { error } = await supabase.functions.invoke("create-team-time-entries", {
      body: {
        mainEntry,
        teamEntries,
        disturbanceIds: [],
        createWorkerLinks: true,
      },
    });

    if (error) {
      console.error("Error creating time entries for disturbance:", error);
    }
  };

  const updateDisturbanceWorkers = async (disturbanceId: string, newWorkerIds: string[]) => {
    const { data: currentWorkers } = await supabase
      .from("disturbance_workers")
      .select("user_id, is_main")
      .eq("disturbance_id", disturbanceId);

    const currentNonMainIds = (currentWorkers || [])
      .filter(w => !w.is_main)
      .map(w => w.user_id);

    const toAdd = newWorkerIds.filter(id => !currentNonMainIds.includes(id));
    const toRemove = currentNonMainIds.filter(id => !newWorkerIds.includes(id));

    for (const workerId of toRemove) {
      await supabase
        .from("disturbance_workers")
        .delete()
        .eq("disturbance_id", disturbanceId)
        .eq("user_id", workerId);
    }

    if (toAdd.length > 0) {
      await supabase.from("disturbance_workers").insert(
        toAdd.map((workerId) => ({
          disturbance_id: disturbanceId,
          user_id: workerId,
          is_main: false,
        }))
      );
    }
  };

  const updateMaterials = async (disturbanceId: string, userId: string) => {
    await supabase
      .from("disturbance_materials")
      .delete()
      .eq("disturbance_id", disturbanceId);

    const validMaterials = materials.filter(m => m.material.trim());
    if (validMaterials.length > 0) {
      await supabase.from("disturbance_materials").insert(
        validMaterials.map(m => ({
          disturbance_id: disturbanceId,
          user_id: userId,
          material: m.material.trim(),
          menge: m.menge.trim() || null,
        }))
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {editData ? "Arbeitsbericht bearbeiten" : "Neuen Arbeitsbericht erfassen"}
          </DialogTitle>
          <DialogDescription>
            Erfassen Sie einen Service-Einsatz beim Kunden. Die Arbeitszeit wird automatisch für den Ersteller und alle ausgewählten Mitarbeiter gebucht.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Work Type Selection */}
          <div className="space-y-3">
            <h3 className="font-medium flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              Art der Arbeit
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setWorkType("projekt");
                  if (!selectedProjectId) {
                    // Clear project-related state
                  }
                }}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  workType === "projekt"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                }`}
              >
                <div className="font-medium text-sm">Projekt-Arbeit</div>
                <p className="text-xs text-muted-foreground mt-1">Bestehendes Projekt</p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setWorkType("kunde");
                  setSelectedProjectId(null);
                }}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  workType === "kunde"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                }`}
              >
                <div className="font-medium text-sm">Kunden-Arbeit</div>
                <p className="text-xs text-muted-foreground mt-1">Einzelkunde ohne Projekt</p>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {workType === "projekt"
                ? "Wählen Sie ein bestehendes Projekt - Kundendaten werden automatisch übernommen."
                : "Arbeit für einen einzelnen Kunden ohne Projektbezug."}
            </p>
          </div>

          {/* Project Selection (only for Projekt-Arbeit) */}
          {workType === "projekt" && (
            <div className="space-y-4">
              <h3 className="font-medium flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                Projekt auswählen
              </h3>
              <Select
                value={selectedProjectId || "none"}
                onValueChange={(val) => {
                  const projectId = val === "none" ? null : val;
                  setSelectedProjectId(projectId);
                  if (projectId) {
                    fetchProjectCustomerData(projectId);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Projekt auswählen..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Kein Projekt</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.plz})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Datum & Uhrzeit
              </h3>
              <Button
                type="button"
                variant={directHoursMode ? "default" : "outline"}
                size="sm"
                onClick={() => setDirectHoursMode(!directHoursMode)}
                className="text-xs"
              >
                <Clock className="h-3 w-3 mr-1" />
                {directHoursMode ? "Beginn/Ende" : "Stunden direkt"}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="datum">Datum</Label>
                <Input
                  id="datum"
                  type="date"
                  value={formData.datum}
                  onChange={(e) => setFormData({ ...formData, datum: e.target.value })}
                  required
                />
              </div>
              {directHoursMode ? (
                <>
                  <div className="col-span-2">
                    <Label htmlFor="directHours">Stunden</Label>
                    <Input
                      id="directHours"
                      type="number"
                      step="0.25"
                      min="0.25"
                      max="12"
                      value={directHours}
                      onChange={(e) => {
                        setDirectHours(e.target.value);
                        const hours = parseFloat(e.target.value) || 0;
                        // Auto-calculate start/end from 07:00
                        const startMinutes = 7 * 60;
                        let endMinutes = startMinutes + hours * 60;

                        // Regie: keine automatische Mittagspause
                        const pauseMinutes = 0;

                        const endH = Math.floor(endMinutes / 60);
                        const endM = Math.round(endMinutes % 60);
                        setFormData({
                          ...formData,
                          startTime: "07:00",
                          endTime: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
                          pauseMinutes,
                        });
                      }}
                      placeholder="z.B. 2.5"
                      className="text-center text-lg font-mono"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Berechnet: {formData.startTime} – {formData.endTime}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label htmlFor="startTime">Startzeit</Label>
                    <Input
                      id="startTime"
                      type="time"
                      value={formData.startTime}
                      onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="endTime">Endzeit</Label>
                    <Input
                      id="endTime"
                      type="time"
                      value={formData.endTime}
                      onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                      required
                    />
                  </div>
                </>
              )}
              <div>
                <Label htmlFor="pauseMinutes">Pause (Minuten)</Label>
                <Input
                  id="pauseMinutes"
                  type="number"
                  min="0"
                  value={formData.pauseMinutes}
                  onChange={(e) => setFormData({ ...formData, pauseMinutes: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-end">
                <div className="bg-muted rounded-md px-3 py-2 w-full text-center">
                  <span className="text-sm text-muted-foreground">Stunden: </span>
                  <span className="font-bold text-primary">{calculateHours().toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Break Checkboxes */}
            {!directHoursMode && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="breakfastBreak"
                    checked={hasBreakfastBreak}
                    onCheckedChange={(checked) => setHasBreakfastBreak(checked === true)}
                    disabled={breakfastTaken}
                  />
                  <Label htmlFor="breakfastBreak" className="text-sm font-normal cursor-pointer">
                    Vormittagspause ({BREAKFAST_BREAK_START}–{BREAKFAST_BREAK_END})
                    {breakfastTaken && (
                      <span className="text-xs text-muted-foreground ml-1">(bereits eingetragen)</span>
                    )}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="lunchBreak"
                    checked={hasLunchBreak}
                    onCheckedChange={(checked) => setHasLunchBreak(checked === true)}
                    disabled={lunchTaken}
                  />
                  <Label htmlFor="lunchBreak" className="text-sm font-normal cursor-pointer">
                    Mittagspause ({LUNCH_BREAK_START}–{LUNCH_BREAK_END})
                    {lunchTaken && (
                      <span className="text-xs text-muted-foreground ml-1">(bereits eingetragen)</span>
                    )}
                  </Label>
                </div>
              </div>
            )}
          </div>

          {/* Customer Section */}
          <div className="space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <User className="h-4 w-4" />
              Kundendaten
              {workType === "projekt" && selectedProjectId && (
                <span className="text-xs font-normal text-muted-foreground">(aus Projekt übernommen)</span>
              )}
            </h3>
            <div className="space-y-3">
              <div>
                <Label htmlFor="kundeName">Kundenname *</Label>
                <Input
                  id="kundeName"
                  value={formData.kundeName}
                  onChange={(e) => setFormData({ ...formData, kundeName: e.target.value })}
                  placeholder="Max Mustermann"
                  required
                />
              </div>
              <div>
                <Label htmlFor="kundeEmail" className="flex items-center gap-1">
                  <Mail className="h-3 w-3" /> E-Mail (optional)
                </Label>
                <Input
                  id="kundeEmail"
                  type="email"
                  value={formData.kundeEmail}
                  onChange={(e) => setFormData({ ...formData, kundeEmail: e.target.value })}
                  placeholder="kunde@email.at"
                />
              </div>
              <div>
                <Label htmlFor="kundeTelefon" className="flex items-center gap-1">
                  <Phone className="h-3 w-3" /> Telefon (optional)
                </Label>
                <Input
                  id="kundeTelefon"
                  type="tel"
                  value={formData.kundeTelefon}
                  onChange={(e) => setFormData({ ...formData, kundeTelefon: e.target.value })}
                  placeholder="+43 664 ..."
                />
              </div>
              <div>
                <Label htmlFor="kundeAdresse" className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Adresse (optional)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="kundeAdresse"
                    value={formData.kundeAdresse}
                    onChange={(e) => setFormData({ ...formData, kundeAdresse: e.target.value })}
                    placeholder="Musterstraße 1, 9020 Klagenfurt"
                    className="flex-1"
                  />
                  <LocationButton
                    onAddressFound={(address) => setFormData({ ...formData, kundeAdresse: address })}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Multi-Employee Selection */}
          <MultiEmployeeSelect
            selectedEmployees={selectedEmployees}
            onSelectionChange={setSelectedEmployees}
            date={formData.datum}
            startTime={formData.startTime}
            endTime={formData.endTime}
          />

          {/* Work Description Section */}
          <div className="space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Arbeitsdetails
            </h3>
            <div className="space-y-3">
              {/* KI-Spracheingabe */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-blue-800 dark:text-blue-200">KI-Spracheingabe: Tätigkeiten und Material diktieren</p>
                <VoiceRecorder
                  disabled={saving}
                  onResult={(data) => {
                    if (data.beschreibung) {
                      setFormData((prev) => ({
                        ...prev,
                        beschreibung: data.beschreibung,
                        kundeName: data.kundeName || prev.kundeName,
                        kundeAdresse: data.kundeAdresse || prev.kundeAdresse,
                      }));
                    }
                    if (data.materials && data.materials.length > 0) {
                      setMaterials(data.materials.map((m) => ({
                        id: crypto.randomUUID(),
                        material: m.material,
                        menge: m.menge,
                      })));
                    }
                  }}
                />
              </div>

              <div>
                <Label htmlFor="beschreibung">Durchgeführte Arbeit *</Label>
                <Textarea
                  id="beschreibung"
                  value={formData.beschreibung}
                  onChange={(e) => setFormData({ ...formData, beschreibung: e.target.value })}
                  placeholder="Beschreiben Sie die durchgeführten Arbeiten oder nutzen Sie die Spracheingabe oben..."
                  rows={4}
                  required
                />
              </div>
              <div>
                <Label htmlFor="notizen">Notizen (optional)</Label>
                <Textarea
                  id="notizen"
                  value={formData.notizen}
                  onChange={(e) => setFormData({ ...formData, notizen: e.target.value })}
                  placeholder="Zusätzliche Bemerkungen..."
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Materials Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium flex items-center gap-2">
                <Package className="h-4 w-4" />
                Verwendetes Material (optional)
              </h3>
              <Button type="button" variant="outline" size="sm" onClick={addMaterial}>
                <Plus className="h-4 w-4 mr-1" />
                Material
              </Button>
            </div>
            
            {materials.length > 0 && (
              <div className="space-y-2">
                {materials.map((mat) => (
                  <div key={mat.id} className="flex gap-2 items-start">
                    <Input
                      placeholder="Material"
                      value={mat.material}
                      onChange={(e) => updateMaterial(mat.id, "material", e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Menge"
                      value={mat.menge}
                      onChange={(e) => updateMaterial(mat.id, "menge", e.target.value)}
                      className="w-24"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMaterial(mat.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>
        </div>

        {/* Sticky Actions */}
        <div className="flex gap-3 justify-end pt-4 border-t bg-background flex-shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={(e) => { 
            e.preventDefault();
            const form = document.querySelector('form');
            if (form) form.requestSubmit();
          }} disabled={saving}>
            {saving ? "Speichern..." : editData ? "Aktualisieren" : "Arbeitsbericht erfassen"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
