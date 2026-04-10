import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X, ZoomIn, ZoomOut, Loader2, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface FileViewerProps {
  open: boolean;
  onClose: () => void;
  fileName: string;
  filePath: string;
  bucketName: string;
  fileType?: "image" | "pdf" | "other";
}

export function FileViewer({ 
  open, 
  onClose, 
  fileName, 
  filePath, 
  bucketName,
  fileType = "other"
}: FileViewerProps) {
  const [zoom, setZoom] = useState(100);
  const [loading, setLoading] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);

  // Check if bucket is public
  const isPublicBucket = bucketName === "project-photos";

  useEffect(() => {
    if (!open) {
      setSignedUrl(null);
      return;
    }

    const getFileUrl = async () => {
      if (isPublicBucket) {
        const { data } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);
        setSignedUrl(data.publicUrl);
      } else {
        setUrlLoading(true);
        try {
          const { data, error } = await supabase.storage
            .from(bucketName)
            .createSignedUrl(filePath, 3600); // 60 minutes validity

          if (error) throw error;
          setSignedUrl(data.signedUrl);
        } catch (error: any) {
          console.error("Error creating signed URL:", error);
          toast({
            variant: "destructive",
            title: "Vorschau nicht verfügbar",
            description: "Datei kann nicht angezeigt werden. Bitte herunterladen.",
          });
        } finally {
          setUrlLoading(false);
        }
      }
    };

    getFileUrl();
  }, [open, filePath, bucketName, isPublicBucket]);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from(bucketName)
        .download(filePath);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download erfolgreich",
        description: `${fileName} wurde heruntergeladen`,
      });
    } catch (error: any) {
      console.error("Download error:", error);
      toast({
        variant: "destructive",
        title: "Download fehlgeschlagen",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const detectFileType = (): "image" | "pdf" | "other" => {
    if (fileType !== "other") return fileType;
    const ext = fileName.toLowerCase().split(".").pop();
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext || "")) return "image";
    if (ext === "pdf") return "pdf";
    return "other";
  };

  const actualFileType = detectFileType();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg truncate pr-4">{fileName}</DialogTitle>
            <div className="flex gap-2">
              {actualFileType === "image" && (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setZoom(Math.max(50, zoom - 25))}
                    disabled={zoom <= 50}
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setZoom(Math.min(200, zoom + 25))}
                    disabled={zoom >= 200}
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                onClick={handleDownload}
                disabled={loading}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                Download
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto bg-muted/30 p-4">
          {urlLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : !signedUrl ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <p className="text-muted-foreground">
                Datei konnte nicht geladen werden
              </p>
              <Button onClick={handleDownload} disabled={loading}>
                <Download className="w-4 h-4 mr-2" />
                Datei herunterladen
              </Button>
            </div>
          ) : actualFileType === "image" ? (
            <div className="flex items-center justify-center h-full">
              <img
                src={signedUrl}
                alt={fileName}
                style={{ 
                  maxWidth: `${zoom}%`, 
                  maxHeight: `${zoom}%`,
                  objectFit: "contain" 
                }}
                className="rounded-lg shadow-lg"
              />
            </div>
          ) : actualFileType === "pdf" ? (
            <div className="w-full h-full flex flex-col">
              <iframe
                src={`${signedUrl}#toolbar=1&navpanes=0`}
                className="w-full flex-1 rounded-lg border-0 bg-white"
                title={fileName}
              />
              <div className="flex justify-center gap-2 pt-3">
                <Button variant="outline" size="sm" onClick={() => window.open(signedUrl, "_blank")} className="gap-2">
                  <Eye className="w-4 h-4" />
                  In neuem Tab öffnen
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownload} disabled={loading} className="gap-2">
                  <Download className="w-4 h-4" />
                  Herunterladen
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <p className="text-muted-foreground">
                Vorschau für diesen Dateityp nicht verfügbar
              </p>
              <Button onClick={handleDownload} disabled={loading}>
                <Download className="w-4 h-4 mr-2" />
                Datei herunterladen
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
