import { useState, useEffect } from "react";
import { Package, Plus, Edit, Trash2, Save, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { de } from "date-fns/locale";

type Material = {
  id: string;
  material: string;
  menge: string | null;
  notizen: string | null;
  created_at: string;
};

type DisturbanceMaterialsProps = {
  disturbanceId: string;
  canEdit: boolean;
  hideWhenEmpty?: boolean;
};

export const DisturbanceMaterials = ({ disturbanceId, canEdit, hideWhenEmpty = false }: DisturbanceMaterialsProps) => {
  const { toast } = useToast();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    material: "",
    menge: "",
    notizen: "",
  });

  useEffect(() => {
    fetchMaterials();
  }, [disturbanceId]);

  const fetchMaterials = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("disturbance_materials")
      .select("*")
      .eq("disturbance_id", disturbanceId)
      .order("created_at", { ascending: true });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Materialien konnten nicht geladen werden",
      });
    } else {
      setMaterials(data || []);
    }
    setLoading(false);
  };

  const openAddForm = () => {
    setEditingMaterial(null);
    setFormData({ material: "", menge: "", notizen: "" });
    setShowForm(true);
  };

  const openEditForm = (material: Material) => {
    setEditingMaterial(material);
    setFormData({
      material: material.material,
      menge: material.menge || "",
      notizen: material.notizen || "",
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.material.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Material ist erforderlich" });
      return;
    }

    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSaving(false);
      return;
    }

    const materialData = {
      disturbance_id: disturbanceId,
      user_id: user.id,
      material: formData.material.trim(),
      menge: formData.menge.trim() || null,
      notizen: formData.notizen.trim() || null,
    };

    if (editingMaterial) {
      const { error } = await supabase
        .from("disturbance_materials")
        .update({
          material: materialData.material,
          menge: materialData.menge,
          notizen: materialData.notizen,
        })
        .eq("id", editingMaterial.id);

      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Material konnte nicht aktualisiert werden" });
      } else {
        toast({ title: "Erfolg", description: "Material wurde aktualisiert" });
        setShowForm(false);
        fetchMaterials();
      }
    } else {
      const { error } = await supabase
        .from("disturbance_materials")
        .insert(materialData);

      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Material konnte nicht hinzugefügt werden" });
      } else {
        toast({ title: "Erfolg", description: "Material wurde hinzugefügt" });
        setShowForm(false);
        fetchMaterials();
      }
    }

    setSaving(false);
  };

  const handleDelete = async (materialId: string) => {
    setDeleting(materialId);

    const { error } = await supabase
      .from("disturbance_materials")
      .delete()
      .eq("id", materialId);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Material konnte nicht gelöscht werden" });
    } else {
      toast({ title: "Erfolg", description: "Material wurde gelöscht" });
      fetchMaterials();
    }

    setDeleting(null);
  };

  if (hideWhenEmpty && !canEdit && !loading && materials.length === 0) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Verwendete Materialien
          </CardTitle>
          {canEdit && (
            <Button size="sm" onClick={openAddForm}>
              <Plus className="h-4 w-4 mr-1" />
              Material hinzufügen
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
            </div>
          ) : materials.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Keine Materialien erfasst</p>
              {canEdit && (
                <Button variant="outline" size="sm" className="mt-2" onClick={openAddForm}>
                  <Plus className="h-4 w-4 mr-1" />
                  Erstes Material hinzufügen
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>Menge</TableHead>
                  <TableHead>Notizen</TableHead>
                  {canEdit && <TableHead className="w-[100px]">Aktionen</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.map((material) => (
                  <TableRow key={material.id}>
                    <TableCell className="font-medium">{material.material}</TableCell>
                    <TableCell>{material.menge || "-"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{material.notizen || "-"}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditForm(material)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={deleting === material.id}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Material löschen?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Möchten Sie "{material.material}" wirklich löschen?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(material.id)}
                                  className="bg-destructive text-destructive-foreground"
                                >
                                  Löschen
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Material Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingMaterial ? "Material bearbeiten" : "Material hinzufügen"}
            </DialogTitle>
            <DialogDescription>
              Erfassen Sie das verwendete Material für diesen Einsatz.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="material">Material *</Label>
              <Input
                id="material"
                value={formData.material}
                onChange={(e) => setFormData({ ...formData, material: e.target.value })}
                placeholder="z.B. Sicherungsautomat 16A"
                required
              />
            </div>
            <div>
              <Label htmlFor="menge">Menge</Label>
              <Input
                id="menge"
                value={formData.menge}
                onChange={(e) => setFormData({ ...formData, menge: e.target.value })}
                placeholder="z.B. 2 Stück, 5m, 1 Karton"
              />
            </div>
            <div>
              <Label htmlFor="notizen">Notizen</Label>
              <Textarea
                id="notizen"
                value={formData.notizen}
                onChange={(e) => setFormData({ ...formData, notizen: e.target.value })}
                placeholder="Zusätzliche Bemerkungen..."
                rows={2}
              />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Speichern..." : editingMaterial ? "Aktualisieren" : "Hinzufügen"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
