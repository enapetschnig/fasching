import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Upload, FileText, Trash2, Eye, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { FileViewer } from "@/components/FileViewer";

type DocumentType = "plans" | "reports" | "photos" | "chef";

type StorageFile = {
  name: string;
  id: string;
  created_at: string;
  metadata: any;
};

const bucketMap: Record<DocumentType, string> = {
  plans: "project-plans",
  reports: "project-reports",
  photos: "project-photos",
  chef: "project-chef",
};

const titleMap: Record<DocumentType, string> = {
  plans: "Pläne",
  reports: "Berichte & PDFs",
  photos: "Fotos",
  chef: "🔒 Chefordner",
};

const ProjectDetail = () => {
  const { projectId, type } = useParams<{ projectId: string; type: DocumentType }>();
  const { toast } = useToast();
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewerState, setViewerState] = useState<{
    open: boolean;
    fileName: string;
    filePath: string;
  }>({ open: false, fileName: "", filePath: "" });

  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [urlsLoading, setUrlsLoading] = useState(false);

  useEffect(() => {
    if (projectId && type) {
      checkAdminStatus();
      fetchProjectName();
      fetchFiles();
    }
  }, [projectId, type]);

  useEffect(() => {
    if (files.length > 0 && projectId && type) {
      generateSignedUrls();
    }
  }, [files]);

  const generateSignedUrls = async () => {
    if (!projectId || !type) return;
    
    const bucket = bucketMap[type];
    const isPublic = bucket === "project-photos";
    
    setUrlsLoading(true);
    const urls: Record<string, string> = {};
    
    for (const file of files) {
      const filePath = `${projectId}/${file.name}`;
      
      if (isPublic) {
        const { data } = supabase.storage
          .from(bucket)
          .getPublicUrl(filePath);
        urls[file.name] = data.publicUrl;
      } else {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(filePath, 3600);
        
        if (!error && data) {
          urls[file.name] = data.signedUrl;
        }
      }
    }
    
    setSignedUrls(urls);
    setUrlsLoading(false);
  };

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    setIsAdmin(data?.role === "administrator");
  };

  const fetchProjectName = async () => {
    if (!projectId) return;
    
    const { data } = await supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single();

    if (data) {
      setProjectName(data.name);
    }
  };

  const fetchFiles = async () => {
    if (!projectId || !type) return;

    const bucket = bucketMap[type];
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .list(projectId, {
        sortBy: { column: "created_at", order: "desc" },
      });

    if (!error && data) {
      setFiles(data);
    }
    setLoading(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !projectId || !type) return;

    setUploading(true);
    const file = e.target.files[0];
    const bucket = bucketMap[type];
    const filePath = `${projectId}/${Date.now()}_${file.name}`;

    const { error } = await supabase
      .storage
      .from(bucket)
      .upload(filePath, file);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Datei konnte nicht hochgeladen werden",
      });
    } else {
      toast({
        title: "Erfolg",
        description: "Datei wurde hochgeladen",
      });
      fetchFiles();
    }
    setUploading(false);
    e.target.value = "";
  };

  const handleDelete = async (file: StorageFile) => {
    if (!projectId || !type) return;

    const bucket = bucketMap[type];
    const filePath = `${projectId}/${file.name}`;

    const { error } = await supabase
      .storage
      .from(bucket)
      .remove([filePath]);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Datei konnte nicht gelöscht werden",
      });
    } else {
      toast({
        title: "Gelöscht",
        description: "Datei wurde entfernt",
      });
      fetchFiles();
    }
  };

  const handleFileOpen = (file: StorageFile) => {
    const filePath = `${projectId}/${file.name}`;
    setViewerState({
      open: true,
      fileName: file.name,
      filePath: filePath
    });
  };

  const getFileUrl = (fileName: string) => {
    if (!projectId || !type) return "";
    const bucket = bucketMap[type];
    const { data } = supabase.storage.from(bucket).getPublicUrl(`${projectId}/${fileName}`);
    return data.publicUrl;
  };

  if (!type) {
    return <div>Ungültiger Dokumenttyp</div>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Lädt...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={`${projectName} - ${titleMap[type]}`} backPath={`/projects/${projectId}`} />

      <main className="container mx-auto px-4 py-6 max-w-5xl">
        <Card>
          <CardHeader>
            <CardTitle>{titleMap[type]}</CardTitle>
            <CardDescription>
              {files.length} {files.length === 1 ? 'Datei' : 'Dateien'}
            </CardDescription>
          </CardHeader>

          <CardContent className="p-6">
            {/* Upload section - Admin only, not for reports (auto-generated from Arbeitsberichte) */}
            {isAdmin && type !== "reports" && (
              <div className="mb-6">
                <label htmlFor="file-upload" className="cursor-pointer">
                  <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
                    <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-base font-medium mb-1">
                      {uploading ? "Lädt hoch..." : "Datei auswählen"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Klicken zum Auswählen
                    </p>
                  </div>
                </label>
                <Input
                  id="file-upload"
                  type="file"
                  onChange={handleUpload}
                  disabled={uploading}
                  multiple
                  className="hidden"
                  accept={type === "photos" ? "image/*" : "*"}
                />
              </div>
            )}

            {files.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-semibold mb-2">Keine Dateien</p>
                <p className="text-sm text-muted-foreground">
                  Lade die erste Datei hoch
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-3 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    {urlsLoading ? (
                      <div className="w-12 h-12 sm:w-16 sm:h-16 bg-muted animate-pulse rounded shrink-0" />
                    ) : signedUrls[file.name] && (file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i) || file.name.match(/\.pdf$/i)) ? (
                      <img 
                        src={signedUrls[file.name]} 
                        alt={file.name}
                        className="w-12 h-12 sm:w-16 sm:h-16 object-cover rounded shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <FileText className="w-12 h-12 sm:w-16 sm:h-16 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(file.created_at).toLocaleDateString("de-DE")}
                      </p>
                    </div>

                    <div className="flex gap-2 ml-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleFileOpen(file)}
                      >
                        <Eye className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">Ansehen</span>
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            if (confirm("Datei wirklich löschen?")) handleDelete(file);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <FileViewer
        open={viewerState.open}
        onClose={() => setViewerState({ open: false, fileName: "", filePath: "" })}
        fileName={viewerState.fileName}
        filePath={viewerState.filePath}
        bucketName={bucketMap[type]}
      />
    </div>
  );
};

export default ProjectDetail;
