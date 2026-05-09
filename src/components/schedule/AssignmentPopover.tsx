import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Trash2, Clock, Users, Plus, X, Camera, Wrench, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Profile, Project, Assignment, AssignmentKind, AssignmentPhoto } from "./scheduleTypes";

type Block = {
  id: string;
  kind: AssignmentKind;
  projectId: string;
  startTime: string;
  endTime: string;
  notizen: string;
};

export type BatchBlock = {
  kind: AssignmentKind;
  projectId: string | null;
  startTime: string;
  endTime: string;
  notizen: string;
};

type PendingPhoto = {
  id: string;
  file: File;
  previewUrl: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: Profile | null;
  date: Date | null;
  days?: Date[];
  assignment: Assignment | null;
  projects: Project[];
  profiles?: Profile[];
  initialAdditionalUserIds?: string[];
  /** Nur im Edit-Modus genutzt — Single Update einer bestehenden Zuweisung. */
  onAssign: (
    userId: string,
    date: Date,
    kind: AssignmentKind,
    projectId: string | null,
    notizen?: string,
    startTime?: string,
    endTime?: string,
    assignmentId?: string
  ) => void;
  /** Batch-Insert (Erstellen-Modus mit beliebig vielen MA × Tagen × Blöcken). Liefert IDs zurück, an die anschließend Fotos gehängt werden. */
  onAssignBatch?: (
    uids: string[],
    dates: Date[],
    blocks: BatchBlock[]
  ) => Promise<string[]>;
  onRemove: (userId: string, date: Date, assignmentId?: string) => void;
}

const newBlock = (): Block => ({
  id: crypto.randomUUID(),
  kind: "projekt",
  projectId: "",
  startTime: "07:00",
  endTime: "16:00",
  notizen: "",
});

export function AssignmentPopover({
  open,
  onOpenChange,
  profile,
  date,
  days,
  assignment,
  projects,
  profiles = [],
  initialAdditionalUserIds,
  onAssign,
  onAssignBatch,
  onRemove,
}: Props) {
  const { toast } = useToast();
  const [blocks, setBlocks] = useState<Block[]>([newBlock()]);
  const [additionalUserIds, setAdditionalUserIds] = useState<string[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<AssignmentPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const isRangeMode = !!(days && days.length > 1);
  const isEditMode = !!assignment;

  useEffect(() => {
    if (assignment) {
      setBlocks([
        {
          id: assignment.id,
          kind: assignment.kind || "projekt",
          projectId: assignment.project_id || "",
          startTime: assignment.start_time || "07:00",
          endTime: assignment.end_time || "16:00",
          notizen: assignment.notizen || "",
        },
      ]);
    } else {
      setBlocks([newBlock()]);
    }
    setAdditionalUserIds(initialAdditionalUserIds || []);
    setPendingPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment, open]);

  // Bestehende Fotos laden, wenn ein Assignment bearbeitet wird
  useEffect(() => {
    const loadPhotos = async () => {
      if (!assignment) {
        setExistingPhotos([]);
        return;
      }
      const { data } = await (supabase as any)
        .from("worker_assignment_photos")
        .select("id, assignment_id, file_path, file_name")
        .eq("assignment_id", assignment.id)
        .order("created_at", { ascending: true });
      setExistingPhotos((data || []) as AssignmentPhoto[]);
    };
    if (open) loadPhotos();
  }, [assignment, open]);

  if (!profile || !date) return null;

  const updateBlock = (id: string, field: keyof Block, value: string) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  };

  const setBlockKind = (id: string, kind: AssignmentKind) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, kind, projectId: kind === "regie" ? "" : b.projectId } : b
      )
    );
  };

  const addBlock = () => {
    setBlocks((prev) => {
      const last = prev[prev.length - 1];
      const startTime = last?.endTime || "12:00";
      return [...prev, { ...newBlock(), startTime }];
    });
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => (prev.length === 1 ? prev : prev.filter((b) => b.id !== id)));
  };

  const toggleAdditional = (uid: string) => {
    setAdditionalUserIds((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]
    );
  };

  const onPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newOnes = Array.from(files)
      .filter((f) => f.type.startsWith("image/") && f.size <= 10 * 1024 * 1024)
      .map((file) => ({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) }));
    setPendingPhotos((prev) => [...prev, ...newOnes]);
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const removePendingPhoto = (id: string) => {
    setPendingPhotos((prev) => {
      const toRemove = prev.find((p) => p.id === id);
      if (toRemove) URL.revokeObjectURL(toRemove.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const removeExistingPhoto = async (photoId: string, filePath: string) => {
    const { error } = await (supabase as any)
      .from("worker_assignment_photos")
      .delete()
      .eq("id", photoId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    await supabase.storage.from("assignment-photos").remove([filePath]);
    setExistingPhotos((prev) => prev.filter((p) => p.id !== photoId));
  };

  const uploadPhotosForAssignments = async (assignmentIds: string[]) => {
    if (pendingPhotos.length === 0 || assignmentIds.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Pro Foto: einmal in Storage hochladen, dann für jede Assignment-ID einen DB-Eintrag mit demselben file_path
    const rows: Array<Record<string, unknown>> = [];
    for (const p of pendingPhotos) {
      const filePath = `${assignmentIds[0]}/${Date.now()}_${p.file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("assignment-photos")
        .upload(filePath, p.file);
      if (uploadErr) {
        console.error("Photo upload failed:", uploadErr);
        continue;
      }
      for (const aid of assignmentIds) {
        rows.push({
          assignment_id: aid,
          file_path: filePath,
          file_name: p.file.name,
          user_id: user.id,
        });
      }
    }
    if (rows.length > 0) {
      await (supabase as any).from("worker_assignment_photos").insert(rows);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);

    if (isEditMode) {
      const b = blocks[0];
      if (b.kind === "projekt" && !b.projectId) {
        setSaving(false);
        return;
      }
      onAssign(
        profile.id,
        date,
        b.kind,
        b.kind === "regie" ? null : b.projectId,
        b.notizen || undefined,
        b.startTime,
        b.endTime,
        assignment!.id
      );
      // Neu hochgeladene Fotos für dieses Assignment dranhängen
      await uploadPhotosForAssignments([assignment!.id]);
      setSaving(false);
      onOpenChange(false);
      return;
    }

    const validBlocks = blocks.filter((b) => b.kind === "regie" || !!b.projectId);
    if (validBlocks.length === 0) {
      setSaving(false);
      return;
    }

    if (onAssignBatch) {
      const dates = isRangeMode ? days! : [date];
      const uids = [profile.id, ...additionalUserIds];
      const batchBlocks: BatchBlock[] = validBlocks.map((b) => ({
        kind: b.kind,
        projectId: b.kind === "regie" ? null : b.projectId,
        startTime: b.startTime,
        endTime: b.endTime,
        notizen: b.notizen,
      }));
      const createdIds = await onAssignBatch(uids, dates, batchBlocks);
      await uploadPhotosForAssignments(createdIds);
    }
    setSaving(false);
    onOpenChange(false);
  };

  const dateLabel = isRangeMode
    ? `${days!.length} Tage: ${format(days![0], "EE dd.MM.", { locale: de })} – ${format(days![days!.length - 1], "EE dd.MM.", { locale: de })}`
    : format(date, "EEEE, dd. MMMM yyyy", { locale: de });

  const otherProfiles = profiles.filter((p) => p.id !== profile.id);
  const validBlockCount = blocks.filter((b) => b.kind === "regie" || !!b.projectId).length;
  const totalRows =
    validBlockCount *
    (isRangeMode ? days!.filter((d) => { const dow = d.getDay(); return dow !== 0 && dow !== 5 && dow !== 6; }).length : 1) *
    (1 + additionalUserIds.length);

  const calcHours = (b: Block) => {
    const [sh, sm] = b.startTime.split(":").map(Number);
    const [eh, em] = b.endTime.split(":").map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    const pause = mins > 360 ? 30 : 0;
    return Math.max(0, (mins - pause) / 60).toFixed(1);
  };

  const photoUrl = (filePath: string) =>
    supabase.storage.from("assignment-photos").getPublicUrl(filePath).data.publicUrl;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {isEditMode ? "Auftrag bearbeiten" : "Auftrag zuweisen"}
            {" – "}
            {profile.vorname} {profile.nachname}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{dateLabel}</p>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {!isEditMode && (
            <p className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2 border border-dashed">
              Du kannst hier Projekte oder Regie-Einsätze einteilen — pro Block einzeln wählbar.
              Mehrere Blöcke werden als eigene Zuweisungen gebucht.
            </p>
          )}

          {/* Block-Liste */}
          <div className="space-y-3">
            {blocks.map((b, idx) => (
              <div key={b.id} className="rounded-md border p-3 space-y-2 bg-card relative">
                {!isEditMode && blocks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBlock(b.id)}
                    className="absolute right-2 top-2 text-muted-foreground hover:text-destructive"
                    title="Entfernen"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Einteilung {idx + 1}
                  </span>
                </div>

                {/* Projekt / Regie Toggle */}
                <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => setBlockKind(b.id, "projekt")}
                    className={`flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                      b.kind === "projekt"
                        ? "bg-card shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Briefcase className="h-3.5 w-3.5" /> Projekt
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlockKind(b.id, "regie")}
                    className={`flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                      b.kind === "regie"
                        ? "bg-orange-100 text-orange-900 shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Wrench className="h-3.5 w-3.5" /> Regie
                  </button>
                </div>

                {b.kind === "projekt" ? (
                  <Select
                    value={b.projectId}
                    onValueChange={(v) => updateBlock(b.id, "projectId", v)}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Projekt wählen…" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-md border border-dashed border-orange-300 bg-orange-50 px-3 py-2 text-xs text-orange-900">
                    Regiearbeit (Service ohne Projektzuordnung) — Details bitte in der Notiz erfassen.
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Arbeitszeit
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={b.startTime}
                      onChange={(e) => updateBlock(b.id, "startTime", e.target.value)}
                      className="h-9 text-sm"
                    />
                    <span className="text-muted-foreground text-sm">–</span>
                    <Input
                      type="time"
                      value={b.endTime}
                      onChange={(e) => updateBlock(b.id, "endTime", e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{calcHours(b)}h (abzgl. Pause)</p>
                </div>

                <Textarea
                  placeholder={
                    b.kind === "regie"
                      ? "Kunde / Tätigkeit / Hinweise…"
                      : "Notiz (optional)…"
                  }
                  value={b.notizen}
                  onChange={(e) => updateBlock(b.id, "notizen", e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>
            ))}
          </div>

          {!isEditMode && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addBlock}
              className="w-full gap-2 border-dashed"
            >
              <Plus className="h-4 w-4" />
              Weitere Einteilung
            </Button>
          )}

          {/* Foto-Upload */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1">
                <Camera className="h-3 w-3" /> Fotos für den MA (optional)
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => photoInputRef.current?.click()}
                className="h-7 gap-1 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Foto
              </Button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={onPhotoSelect}
              />
            </div>

            {(existingPhotos.length > 0 || pendingPhotos.length > 0) && (
              <div className="grid grid-cols-3 gap-2">
                {existingPhotos.map((p) => (
                  <div key={p.id} className="relative aspect-square">
                    <img
                      src={photoUrl(p.file_path)}
                      alt={p.file_name}
                      className="w-full h-full object-cover rounded-md border"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-5 w-5"
                      onClick={() => removeExistingPhoto(p.id, p.file_path)}
                      title="Entfernen"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {pendingPhotos.map((p) => (
                  <div key={p.id} className="relative aspect-square">
                    <img
                      src={p.previewUrl}
                      alt={p.file.name}
                      className="w-full h-full object-cover rounded-md border"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-5 w-5"
                      onClick={() => removePendingPhoto(p.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Fotos werden mit allen erzeugten Einteilungen verknüpft und sind dann für die MA als Hilfe sichtbar.
            </p>
          </div>

          {/* Multi-Mitarbeiter (nur beim Erstellen) */}
          {!isEditMode && otherProfiles.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1">
                <Users className="h-3 w-3" />
                Auch zuweisen an
              </Label>
              <div className="rounded-md border bg-muted/30 max-h-40 overflow-y-auto p-2 space-y-1.5">
                {otherProfiles.map((p) => (
                  <label
                    key={p.id}
                    htmlFor={`add-${p.id}`}
                    className="flex items-center gap-2 cursor-pointer text-sm hover:bg-background/60 rounded px-1 py-0.5"
                  >
                    <Checkbox
                      id={`add-${p.id}`}
                      checked={additionalUserIds.includes(p.id)}
                      onCheckedChange={() => toggleAdditional(p.id)}
                    />
                    <span>{p.vorname} {p.nachname}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {!isEditMode && totalRows > 1 && (
            <p className="text-xs text-muted-foreground">
              Es werden <span className="font-semibold text-foreground">{totalRows}</span> Einteilung(en) angelegt
              ({1 + additionalUserIds.length} MA × {isRangeMode ? days!.filter((d) => { const dow = d.getDay(); return dow !== 0 && dow !== 5 && dow !== 6; }).length : 1} Tag(e) × {validBlockCount} Block/Blöcke).
            </p>
          )}

          {isEditMode && !isRangeMode && (
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={() => {
                onRemove(profile.id, date, assignment!.id);
                onOpenChange(false);
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Zuweisung entfernen
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || validBlockCount === 0}
          >
            {saving
              ? "Speichern…"
              : isEditMode
              ? "Speichern"
              : totalRows > 1
              ? `${totalRows} Einteilung(en) anlegen`
              : "Zuweisen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
