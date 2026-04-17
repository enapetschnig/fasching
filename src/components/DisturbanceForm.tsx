import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, Clock, User, Mail, Phone, MapPin, FileText, Package, Plus, Trash2, FolderOpen, Check, ChevronsUpDown, Camera, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
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
  const submitLock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [workType, setWorkType] = useState<"projekt" | "kunde">("kunde");
  const [hasBreakfastBreak, setHasBreakfastBreak] = useState(false);
  const [hasLunchBreak, setHasLunchBreak] = useState(false);
  const [breakfastStart, setBreakfastStart] = useState(BREAKFAST_BREAK_START);
  const [breakfastEnd, setBreakfastEnd] = useState(BREAKFAST_BREAK_END);
  const [lunchStart, setLunchStart] = useState(LUNCH_BREAK_START);
  const [lunchEnd, setLunchEnd] = useState(LUNCH_BREAK_END);
  const [userId, setUserId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    datum: format(new Date(), "yyyy-MM-dd"),
    startTime: "08:00",
    endTime: "10:00",
    kundeName: "",
    kundeAdresse: "",
    beschreibung: "",
    materialText: "",
  });

  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [materials, setMaterials] = useState<MaterialEntry[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string; plz: string; adresse?: string; kunde_name?: string; kunde_email?: string; kunde_telefon?: string }[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<{ id: string; file: File; previewUrl: string }[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

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
    {
      const spansBreakfast = blockSpansBreakfast(formData.startTime, formData.endTime);
      const spansLunch = blockSpansLunch(formData.startTime, formData.endTime);
      if (!breakfastTaken) setHasBreakfastBreak(spansBreakfast);
      if (!lunchTaken) setHasLunchBreak(spansLunch);
    }
  }, [formData.startTime, formData.endTime, breakfastTaken, lunchTaken]);

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
        kundeAdresse: data.adresse || prev.kundeAdresse,
      }));
    }
  };

  useEffect(() => {
    if (editData) {
      setFormData({
        datum: editData.datum,
        startTime: editData.start_time.slice(0, 5),
        endTime: editData.end_time.slice(0, 5),
        kundeName: editData.kunde_name,
        kundeAdresse: editData.kunde_adresse || "",
        beschreibung: editData.beschreibung,
        materialText: (editData as any).material_text || "",
      });
      setSelectedProjectId(editData.project_id || null);
      setWorkType(editData.project_id ? "projekt" : "kunde");
      loadExistingWorkers(editData.id);
      // Nur laden, falls noch kein material_text gesetzt ist (Rückwärtskompatibilität)
      if (!(editData as any).material_text) loadExistingMaterials(editData.id);
    } else {
      setFormData({
        datum: format(new Date(), "yyyy-MM-dd"),
        startTime: "08:00",
        endTime: "10:00",
        kundeName: "",
        kundeAdresse: "",
        beschreibung: "",
        materialText: "",
      });
      setSelectedEmployees([]);
      setMaterials([]);
      setSelectedProjectId(null);
      setWorkType("kunde");
      setHasBreakfastBreak(false);
      setHasLunchBreak(false);
      setPendingPhotos([]);
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

  const getPauseMinutes = (): number => {
    if (hasLunchBreak && lunchStart && lunchEnd) {
      const [lsH, lsM] = lunchStart.split(":").map(Number);
      const [leH, leM] = lunchEnd.split(":").map(Number);
      return Math.max(0, (leH * 60 + leM) - (lsH * 60 + lsM));
    }
    return 0;
  };

  const calculateHours = (): number => {
    if (!formData.startTime || !formData.endTime) return 0;
    const [startH, startM] = formData.startTime.split(":").map(Number);
    const [endH, endM] = formData.endTime.split(":").map(Number);
    const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM) - getPauseMinutes();
    return Math.max(0, totalMinutes / 60);
  };

  const addMaterial = () => {
    const newId = crypto.randomUUID();
    setMaterials([...materials, { id: newId, material: "", menge: "" }]);
    setTimeout(() => {
      const el = document.querySelector(`[data-material-id="${newId}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const input = el.querySelector("input") as HTMLInputElement | null;
        input?.focus();
      }
    }, 50);
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newOnes = Array.from(files)
      .filter((f) => f.type.startsWith("image/") && f.size <= 10 * 1024 * 1024)
      .map((file) => ({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) }));
    setPendingPhotos((prev) => [...prev, ...newOnes]);
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const removePhoto = (id: string) => {
    setPendingPhotos((prev) => {
      const toRemove = prev.find((p) => p.id === id);
      if (toRemove) URL.revokeObjectURL(toRemove.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const uploadPendingPhotos = async (disturbanceId: string, userId: string, projectId: string | null) => {
    for (const { file } of pendingPhotos) {
      const fileName = `${disturbanceId}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from("disturbance-photos").upload(fileName, file);
      if (uploadErr) {
        console.error("Photo upload failed:", uploadErr);
        continue;
      }
      await supabase.from("disturbance_photos").insert({
        disturbance_id: disturbanceId,
        user_id: userId,
        file_path: fileName,
        file_name: file.name,
      });
      // Auch in Projekt-Fotos ablegen, wenn Projekt verknüpft
      if (projectId) {
        const projectFileName = `${projectId}/arbeitsbericht_${disturbanceId}_${Date.now()}_${file.name}`;
        await supabase.storage.from("project-photos").upload(projectFileName, file);
      }
    }
  };

  const removeMaterial = (id: string) => {
    setMaterials(materials.filter(m => m.id !== id));
  };

  const updateMaterial = (id: string, field: "material" | "menge", value: string) => {
    setMaterials(materials.map(m => m.id === id ? { ...m, [field]: value } : m));
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
    if (!formData.kundeName.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Kundenname ist erforderlich" });
      submitLock.current = false;
      setSaving(false);
      return;
    }

    if (!formData.beschreibung.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Arbeitsbeschreibung ist erforderlich" });
      submitLock.current = false;
      setSaving(false);
      return;
    }

    const [startH, startM] = formData.startTime.split(":").map(Number);
    const [endH, endM] = formData.endTime.split(":").map(Number);
    if (endH * 60 + endM <= startH * 60 + startM) {
      toast({ variant: "destructive", title: "Fehler", description: "Endzeit muss nach Startzeit liegen" });
      submitLock.current = false;
      setSaving(false);
      return;
    }

    const stunden = calculateHours();
    if (stunden <= 0 || stunden > 16) {
      toast({ variant: "destructive", title: "Fehler", description: `Ungültige Stundenzahl: ${stunden.toFixed(2)}h. Maximum ist 16h.` });
      submitLock.current = false;
      setSaving(false);
      return;
    }

    const disturbanceData = {
      user_id: user.id,
      datum: formData.datum,
      start_time: formData.startTime,
      end_time: formData.endTime,
      pause_minutes: getPauseMinutes(),
      stunden,
      kunde_name: formData.kundeName.trim(),
      kunde_email: null as string | null,
      kunde_adresse: formData.kundeAdresse.trim() || null,
      kunde_telefon: null as string | null,
      beschreibung: formData.beschreibung.trim(),
      material_text: formData.materialText.trim() || null,
      notizen: null as string | null,
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
        submitLock.current = false;
        setSaving(false);
        return;
      }

      await updateDisturbanceWorkers(editData.id, selectedEmployees);
      await updateMaterials(editData.id, user.id);

      // Update time entries: delete old ones and recreate
      await createTimeEntriesForDisturbance(editData.id, user.id, stunden, disturbanceData);

      if (pendingPhotos.length > 0) {
        await uploadPendingPhotos(editData.id, user.id, selectedProjectId);
        setPendingPhotos([]);
      }

      toast({ title: "Erfolg", description: "Arbeitsbericht wurde aktualisiert" });
    } else {
      const { data: newDisturbance, error } = await supabase
        .from("disturbances")
        .insert(disturbanceData)
        .select()
        .single();

      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Arbeitsbericht konnte nicht erstellt werden" });
        submitLock.current = false;
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
        submitLock.current = false;
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

      if (pendingPhotos.length > 0) {
        await uploadPendingPhotos(newDisturbance.id, user.id, selectedProjectId);
      }

      toast({ title: "Erfolg", description: "Arbeitsbericht wurde erfasst" });

      submitLock.current = false;
      setSaving(false);
      onOpenChange(false);
      navigate(`/disturbances/${newDisturbance.id}?openSignature=true`);
      return;
    }

    submitLock.current = false;
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
                }}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  workType === "projekt"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                }`}
              >
                <div className="font-medium text-sm">Projekt-Arbeit</div>
                <p className="text-sm text-muted-foreground mt-1">Bestehendes Projekt</p>
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
                <p className="text-sm text-muted-foreground mt-1">Einzelkunde ohne Projekt</p>
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
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
              <Popover open={projectSearchOpen} onOpenChange={setProjectSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={projectSearchOpen}
                    className="w-full justify-between font-normal"
                  >
                    {selectedProjectId
                      ? (() => { const p = projects.find(p => p.id === selectedProjectId); return p ? `${p.name} (${p.plz})` : "Projekt suchen..."; })()
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
                        <CommandItem
                          value="__none__"
                          onSelect={() => {
                            setSelectedProjectId(null);
                            setProjectSearchOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", !selectedProjectId ? "opacity-100" : "opacity-0")} />
                          Kein Projekt
                        </CommandItem>
                        {projects.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={`${p.name} ${p.plz}`}
                            onSelect={() => {
                              setSelectedProjectId(p.id);
                              fetchProjectCustomerData(p.id);
                              setProjectSearchOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", selectedProjectId === p.id ? "opacity-100" : "opacity-0")} />
                            {p.name} ({p.plz})
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Datum & Uhrzeit
              </h3>
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
                  <div>
                    <Label htmlFor="startTime">Startzeit</Label>
                    <Input
                      id="startTime"
                      type="time"
                      step="900"
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
                      step="900"
                      value={formData.endTime}
                      onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                      required
                    />
                  </div>
              <div className="flex items-end">
                <div className="bg-muted rounded-md px-3 py-2 w-full text-center">
                  <span className="text-sm text-muted-foreground">Stunden: </span>
                  <span className="font-bold text-primary">{calculateHours().toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Pausen */}
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="space-y-2">
                <label htmlFor="breakfastBreak" className="flex items-start gap-3 min-h-11 cursor-pointer">
                  <Checkbox id="breakfastBreak" checked={hasBreakfastBreak} disabled={breakfastTaken} onCheckedChange={(checked) => setHasBreakfastBreak(checked === true)} className="mt-1" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Vormittagspause (09:00–09:15)</div>
                    <p className="text-xs text-muted-foreground mt-0.5">Wird zur Arbeitszeit gezählt</p>
                  </div>
                </label>
                {hasBreakfastBreak && (
                  <div className="grid grid-cols-2 gap-2 pl-8">
                    <div>
                      <label className="text-xs text-muted-foreground">Von</label>
                      <Input type="time" step="900" value={breakfastStart} onChange={(e) => setBreakfastStart(e.target.value)} className="h-10 text-sm font-mono" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Bis</label>
                      <Input type="time" step="900" value={breakfastEnd} onChange={(e) => setBreakfastEnd(e.target.value)} className="h-10 text-sm font-mono" />
                    </div>
                  </div>
                )}
                {breakfastTaken && <p className="text-xs text-muted-foreground pl-8">Bereits eingetragen</p>}
              </div>

              <div className="space-y-2">
                <label htmlFor="lunchBreak" className="flex items-start gap-3 min-h-11 cursor-pointer">
                  <Checkbox id="lunchBreak" checked={hasLunchBreak} disabled={lunchTaken} onCheckedChange={(checked) => setHasLunchBreak(checked === true)} className="mt-1" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Mittagspause (12:00–12:30)</div>
                    <p className="text-xs text-muted-foreground mt-0.5">Wird von der Arbeitszeit abgezogen</p>
                  </div>
                </label>
                {hasLunchBreak && (
                  <div className="grid grid-cols-2 gap-2 pl-8">
                    <div>
                      <label className="text-xs text-muted-foreground">Von</label>
                      <Input type="time" step="900" value={lunchStart} onChange={(e) => setLunchStart(e.target.value)} className="h-10 text-sm font-mono" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Bis</label>
                      <Input type="time" step="900" value={lunchEnd} onChange={(e) => setLunchEnd(e.target.value)} className="h-10 text-sm font-mono" />
                    </div>
                  </div>
                )}
                {lunchTaken && <p className="text-xs text-muted-foreground pl-8">Bereits eingetragen</p>}
              </div>
            </div>
          </div>

          {/* Customer Section */}
          <div className="space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <User className="h-4 w-4" />
              Kundendaten
              {workType === "projekt" && selectedProjectId && (
                <span className="text-sm font-normal text-muted-foreground">(aus Projekt übernommen)</span>
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
                <Label htmlFor="kundeAdresse" className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" /> Adresse (optional)
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

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label htmlFor="beschreibung">Durchgeführte Arbeit *</Label>
                <VoiceRecorder
                  compact
                  context="arbeiten"
                  disabled={saving}
                  onResult={(data) => {
                    if (!data.beschreibung) return;
                    setFormData((prev) => ({
                      ...prev,
                      beschreibung: prev.beschreibung.trim()
                        ? `${prev.beschreibung.trimEnd()}\n${data.beschreibung.trim()}`
                        : data.beschreibung,
                    }));
                  }}
                />
              </div>
              <Textarea
                id="beschreibung"
                value={formData.beschreibung}
                onChange={(e) => setFormData({ ...formData, beschreibung: e.target.value })}
                placeholder="Arbeiten beschreiben oder rechts oben diktieren…"
                rows={4}
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label htmlFor="material_text" className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Verwendetes Material (optional)
                </Label>
                <VoiceRecorder
                  compact
                  context="material"
                  disabled={saving}
                  onResult={(data) => {
                    if (!data.beschreibung) return;
                    setFormData((prev) => ({
                      ...prev,
                      materialText: prev.materialText.trim()
                        ? `${prev.materialText.trimEnd()}\n${data.beschreibung.trim()}`
                        : data.beschreibung,
                    }));
                  }}
                />
              </div>
              <Textarea
                id="material_text"
                value={formData.materialText}
                onChange={(e) => setFormData({ ...formData, materialText: e.target.value })}
                placeholder={"Material mit Mengen auflisten oder diktieren, z.B.\n3 Stk Heizkörper\n5 m Kupferrohr 15 mm"}
                rows={3}
              />
            </div>
          </div>
          {false && (
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
                    <div key={mat.id} data-material-id={mat.id} className="flex gap-2 items-start">
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
          )}

          {/* Photos Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium flex items-center gap-2">
                <Camera className="h-4 w-4" />
                Fotos (optional)
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => photoInputRef.current?.click()}
                className="gap-1"
              >
                <Plus className="h-4 w-4" />
                Foto aufnehmen / hinzufügen
              </Button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={handlePhotoSelect}
              />
            </div>
            {pendingPhotos.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {pendingPhotos.map((p) => (
                  <div key={p.id} className="relative group aspect-square">
                    <img
                      src={p.previewUrl}
                      alt={p.file.name}
                      className="w-full h-full object-cover rounded-md border"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6"
                      onClick={() => removePhoto(p.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Fotos landen am Ende der PDF und im Projekt-Ordner unter Fotos (falls ein Projekt verknüpft ist).
            </p>
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
