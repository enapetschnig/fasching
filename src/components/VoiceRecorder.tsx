import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface ParsedVoiceData {
  beschreibung: string;
  materials: Array<{ material: string; menge: string }>;
  kundeName?: string | null;
  kundeAdresse?: string | null;
}

interface VoiceRecorderProps {
  onResult: (data: ParsedVoiceData) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Context for the AI prompt. "arbeiten" = report style, "material" = list of materials */
  context?: "arbeiten" | "material";
  /** Custom label for the non-compact button */
  label?: string;
}

// Check browser support
const isSpeechRecognitionSupported = () => {
  return !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
};

export function VoiceRecorder({ onResult, disabled, compact, context, label }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Cleanup bei Unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) {}
      }
    };
  }, []);

  const startRecording = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      setError("Spracherkennung wird von diesem Browser nicht unterstützt. Bitte verwende Chrome oder Edge.");
      return;
    }

    setError(null);
    setSuccess(false);
    setTranscript("");

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.lang = "de-DE";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + " ";
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(finalTranscript + interim);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        setError("Mikrofonzugriff verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.");
      } else if (event.error !== "aborted") {
        setError(`Spracherkennungsfehler: ${event.error}`);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      if (finalTranscript.trim()) {
        setTranscript(finalTranscript.trim());
        parseTranscript(finalTranscript.trim());
      } else {
        setError("Keine Sprache erkannt. Bitte sprechen Sie deutlich und versuchen Sie es erneut.");
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  const parseTranscript = async (text: string) => {
    setIsParsing(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error: fnError } = await supabase.functions.invoke("parse-voice-input", {
        body: { transcript: text, context: context || "arbeiten" },
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      });

      if (fnError) throw fnError;

      if (data?.success && data?.data) {
        onResult(data.data);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(data?.error || "KI konnte die Eingabe nicht verarbeiten");
      }
    } catch (err: any) {
      console.error("Parse error:", err);
      setError(err.message || "Fehler bei der KI-Verarbeitung");
    } finally {
      setIsParsing(false);
    }
  };

  if (!isSpeechRecognitionSupported()) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-2">
        <AlertCircle className="w-4 h-4" />
        <span>Spracherkennung nicht verfügbar. Bitte Chrome oder Edge verwenden.</span>
      </div>
    );
  }

  if (compact) {
    const iconCls = "h-4 w-4";
    return (
      <div className="inline-flex items-center gap-2">
        {isRecording ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={stopRecording}
            disabled={disabled}
            className="gap-1.5 h-8"
          >
            <MicOff className={iconCls} />
            Stopp
          </Button>
        ) : isParsing ? (
          <Button type="button" variant="outline" size="sm" disabled className="gap-1.5 h-8">
            <Loader2 className={cn(iconCls, "animate-spin")} />
            KI
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startRecording}
            disabled={disabled}
            className="gap-1.5 h-8"
            title="Spracheingabe starten"
          >
            <Mic className={iconCls} />
            Diktieren
          </Button>
        )}
        {isRecording && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <span className="w-1.5 h-1.5 bg-destructive rounded-full animate-pulse" />
            läuft
          </span>
        )}
        {success && <Check className="h-4 w-4 text-green-600" />}
        {error && (
          <span className="text-xs text-destructive flex items-center gap-1" title={error}>
            <AlertCircle className="h-3 w-3" />
            Fehler
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {isRecording ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={stopRecording}
            disabled={disabled}
            className="gap-2"
          >
            <MicOff className="w-4 h-4" />
            Aufnahme stoppen
          </Button>
        ) : isParsing ? (
          <Button type="button" variant="outline" size="sm" disabled className="gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            KI verarbeitet...
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startRecording}
            disabled={disabled}
            className="gap-2"
          >
            <Mic className="w-4 h-4" />
            Spracheingabe
          </Button>
        )}

        {isRecording && (
          <Badge variant="destructive" className="animate-pulse gap-1">
            <span className="w-2 h-2 bg-white rounded-full" />
            Aufnahme läuft...
          </Badge>
        )}

        {success && (
          <Badge variant="default" className="bg-green-600 gap-1">
            <Check className="w-3 h-3" />
            Eingetragen
          </Badge>
        )}
      </div>

      {/* Live-Transkript */}
      {(isRecording || transcript) && !success && (
        <Card className="bg-muted/30">
          <CardContent className="p-3">
            <p className="text-sm text-muted-foreground mb-1">Transkript:</p>
            <p className="text-sm">{transcript || "Sprechen Sie jetzt..."}</p>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
