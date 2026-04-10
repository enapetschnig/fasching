import { Resend } from "https://esm.sh/resend@2.0.0";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// Supabase Admin Client for reading settings
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Logo removed - using text header instead

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Material {
  id: string;
  material: string;
  menge: string | null;
  notizen: string | null;
}

interface Photo {
  id: string;
  file_path: string;
  file_name: string;
}

interface Disturbance {
  id: string;
  datum: string;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  stunden: number;
  kunde_name: string;
  kunde_email: string | null;
  kunde_adresse: string | null;
  kunde_telefon: string | null;
  beschreibung: string;
  notizen: string | null;
  unterschrift_kunde: string;
}

interface ReportRequest {
  disturbance: Disturbance;
  materials: Material[];
  technicianNames?: string[];
  technicianName?: string; // Legacy support
  photos?: Photo[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-AT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-AT", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("Failed to fetch image:", url, response.status);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error("Error fetching image:", error);
    return null;
  }
}

async function generatePDF(data: ReportRequest & { technicians: string[] }, photoImages: (string | null)[]): Promise<string> {
  const { disturbance, materials, technicians, photos } = data;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const m = 18;
  const cw = pw - 2 * m;
  let y = m;
  const blue: [number, number, number] = [37, 99, 168];
  const darkBlue: [number, number, number] = [20, 60, 120];
  const textColor: [number, number, number] = [40, 40, 40];
  const labelColor: [number, number, number] = [110, 110, 110];
  const lineColor: [number, number, number] = [210, 210, 210];
  const bgLight: [number, number, number] = [248, 249, 250];

  const addFooter = () => {
    // Thin line
    doc.setDrawColor(...lineColor);
    doc.setLineWidth(0.3);
    doc.line(m, ph - 16, m + cw, ph - 16);
    // Left: company
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...labelColor);
    doc.text("FASCHING Geb\u00e4udetechnik  |  Heizung \u2022 K\u00e4lte \u2022 L\u00fcftung \u2022 Sanit\u00e4r \u2022 Service", m, ph - 12);
    // Right: date + page
    const pageNum = (doc as any).internal.getCurrentPageInfo().pageNumber;
    doc.text(`Seite ${pageNum}  |  ${new Date().toLocaleDateString("de-AT")}`, m + cw, ph - 12, { align: "right" });
  };

  const checkPage = (needed: number) => {
    if (y + needed > ph - 22) { addFooter(); doc.addPage(); y = m; }
  };

  const sectionHeader = (title: string) => {
    checkPage(14);
    y += 3;
    // Blue left bar + title
    doc.setFillColor(...blue);
    doc.rect(m, y - 4, 2, 6, "F");
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...darkBlue);
    doc.text(title, m + 5, y);
    y += 5;
    doc.setTextColor(...textColor);
  };

  const fieldRow = (label: string, value: string, options?: { bold?: boolean; half?: "left" | "right" }) => {
    checkPage(6);
    const xStart = options?.half === "right" ? m + cw / 2 : m;
    const labelW = 32;
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...labelColor);
    doc.text(label, xStart + 5, y);
    doc.setTextColor(...textColor);
    doc.setFont("helvetica", options?.bold ? "bold" : "normal");
    doc.text(value, xStart + labelW + 5, y);
    if (!options?.half || options.half === "right") y += 5.5;
  };

  // ========================================
  // HEADER BAR
  // ========================================
  doc.setFillColor(...blue);
  doc.rect(0, 0, pw, 28, "F");

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("FASCHING", m, 12);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 220, 255);
  doc.text("GEB\u00c4UDETECHNIK", m + 45, 12);

  doc.setFontSize(7);
  doc.setTextColor(180, 200, 240);
  doc.text("Heizung  \u2022  K\u00e4lte  \u2022  L\u00fcftung  \u2022  Sanit\u00e4r  \u2022  Service", m, 18);

  // Arbeitsbericht title right
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("Arbeitsbericht", m + cw, 13, { align: "right" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 220, 255);
  doc.text(formatDate(disturbance.datum), m + cw, 20, { align: "right" });

  y = 36;

  // ========================================
  // KUNDENDATEN + EINSATZDATEN (zwei Spalten)
  // ========================================
  // Background box
  doc.setFillColor(...bgLight);
  doc.setDrawColor(...lineColor);
  doc.setLineWidth(0.3);
  const boxH = 38;
  doc.roundedRect(m, y - 3, cw, boxH, 2, 2, "FD");

  const leftCol = m;
  const rightCol = m + cw / 2 + 2;
  const yBox = y;

  // Left: Kundendaten
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...blue);
  doc.text("KUNDE", leftCol + 5, yBox + 2);
  doc.setTextColor(...textColor);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(disturbance.kunde_name, leftCol + 5, yBox + 9);
  if (disturbance.kunde_adresse) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...labelColor);
    doc.text(disturbance.kunde_adresse, leftCol + 5, yBox + 15);
  }

  // Vertical divider
  doc.setDrawColor(...lineColor);
  doc.line(m + cw / 2, yBox - 1, m + cw / 2, yBox + boxH - 4);

  // Right: Einsatzdaten
  const st = disturbance.start_time.slice(0, 5);
  const et = disturbance.end_time.slice(0, 5);

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...blue);
  doc.text("EINSATZ", rightCol, yBox + 2);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...labelColor);
  doc.text("Arbeitszeit", rightCol, yBox + 9);
  doc.setTextColor(...textColor);
  doc.setFont("helvetica", "bold");
  doc.text(`${st} \u2013 ${et} Uhr`, rightCol + 30, yBox + 9);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...labelColor);
  doc.text("Stunden", rightCol, yBox + 15);
  doc.setTextColor(...textColor);
  doc.setFont("helvetica", "bold");
  doc.text(`${disturbance.stunden.toFixed(2)} h`, rightCol + 30, yBox + 15);

  if (disturbance.pause_minutes > 0) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...labelColor);
    doc.text("Pause", rightCol, yBox + 21);
    doc.setTextColor(...textColor);
    doc.text(`${disturbance.pause_minutes} Min.`, rightCol + 30, yBox + 21);
  }

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...labelColor);
  doc.text("Techniker", rightCol, yBox + (disturbance.pause_minutes > 0 ? 27 : 21));
  doc.setTextColor(...textColor);
  doc.setFont("helvetica", "normal");
  const techText = technicians.length > 0 ? technicians.join(", ") : "-";
  doc.text(techText, rightCol + 30, yBox + (disturbance.pause_minutes > 0 ? 27 : 21));

  y = yBox + boxH + 6;

  // ========================================
  // DURCHGEFÜHRTE ARBEITEN
  // ========================================
  sectionHeader("Durchgef\u00fchrte Arbeiten");
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...textColor);
  const lines = doc.splitTextToSize(disturbance.beschreibung, cw - 5);
  for (const line of lines) {
    checkPage(5.5);
    doc.text(line, m + 5, y);
    y += 5;
  }
  y += 3;

  // ========================================
  // MATERIAL
  // ========================================
  if (materials && materials.length > 0) {
    sectionHeader("Verwendetes Material");

    // Table header
    doc.setFillColor(...darkBlue);
    doc.roundedRect(m, y - 4.5, cw, 7.5, 1, 1, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("Material", m + 4, y);
    doc.text("Menge", m + cw - 4, y, { align: "right" });
    y += 7;

    doc.setFontSize(9);
    materials.forEach((mat, i) => {
      checkPage(7);
      // Alternating row
      if (i % 2 === 0) {
        doc.setFillColor(...bgLight);
        doc.rect(m, y - 4, cw, 7, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...textColor);
      doc.text(mat.material || "-", m + 4, y);
      doc.setTextColor(...labelColor);
      doc.text(mat.menge || "-", m + cw - 4, y, { align: "right" });
      y += 6.5;
    });
    // Bottom line
    doc.setDrawColor(...lineColor);
    doc.line(m, y - 2, m + cw, y - 2);
    y += 5;
  }

  // ========================================
  // FOTOS
  // ========================================
  if (photos && photos.length > 0 && photoImages.some(img => img !== null)) {
    addFooter(); doc.addPage(); y = m;
    sectionHeader("Fotodokumentation");
    for (let i = 0; i < photos.length; i++) {
      const imgData = photoImages[i];
      if (!imgData) continue;
      checkPage(72);
      try {
        // Photo with border
        doc.setDrawColor(...lineColor);
        doc.setLineWidth(0.3);
        doc.rect(m, y - 1, 82, 62, "S");
        doc.addImage(imgData, "JPEG", m + 1, y, 80, 60);
        y += 64;
        doc.setFontSize(7);
        doc.setTextColor(...labelColor);
        doc.text(photos[i].file_name, m, y);
        y += 8;
      } catch (e) { console.error("Error adding image:", e); }
    }
  }

  // ========================================
  // UNTERSCHRIFT
  // ========================================
  checkPage(60);
  sectionHeader("Kundenunterschrift");
  y += 2;

  if (disturbance.unterschrift_kunde) {
    try {
      doc.addImage(disturbance.unterschrift_kunde, "PNG", m + 5, y, 55, 22);
      y += 26;
    } catch (e) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(...labelColor);
      doc.text("[Unterschrift nicht verf\u00fcgbar]", m + 5, y + 8);
      y += 18;
    }
  }

  // Signature line
  doc.setDrawColor(...textColor);
  doc.setLineWidth(0.4);
  doc.line(m + 5, y, m + 75, y);
  y += 4;
  doc.setFontSize(7);
  doc.setTextColor(...labelColor);
  doc.text("Datum, Unterschrift Auftraggeber", m + 5, y);
  y += 10;

  // Confirmation
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...labelColor);
  const confirm = "Hiermit wird die ordnungsgem\u00e4\u00dfe Durchf\u00fchrung der oben aufgef\u00fchrten Arbeiten best\u00e4tigt.";
  doc.text(doc.splitTextToSize(confirm, cw), m + 5, y);

  // Footer on last page
  addFooter();

  return doc.output("datauristring").split(",")[1];
}

function generateEmailHtml(data: ReportRequest & { technicians: string[] }): string {
  const { disturbance, technicians } = data;
  const technicianDisplay = technicians.length === 1 ? technicians[0] : technicians.join(", ");
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #333; line-height: 1.5; }
        .header { color: #b41c1c; font-size: 24px; font-weight: bold; margin-bottom: 10px; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .info-box { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">FASCHING GEBÄUDETECHNIK</div>
        <h2>Arbeitsbericht</h2>
        
        <p>Sehr geehrte Damen und Herren,</p>
        
        <p>im Anhang finden Sie den Arbeitsbericht für den Einsatz bei <strong>${disturbance.kunde_name}</strong> vom <strong>${formatDate(disturbance.datum)}</strong>.</p>
        
        <div class="info-box">
          <strong>Zusammenfassung:</strong><br>
          Techniker: ${technicianDisplay}<br>
          Arbeitszeit: ${disturbance.start_time.slice(0, 5)} - ${disturbance.end_time.slice(0, 5)} Uhr<br>
          Gesamtstunden: ${disturbance.stunden.toFixed(2)} h
        </div>
        
        <p>Der vollständige Bericht mit allen Details und der Kundenunterschrift befindet sich im angehängten PDF-Dokument.</p>
        
        <p>Mit freundlichen Grüßen,<br>
        FASCHING Gebäudetechnik</p>
      </div>
    </body>
    </html>
  `;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { disturbance, materials, technicianNames, technicianName, photos }: ReportRequest = await req.json();

    // Backward compatibility + fallback
    const technicians = technicianNames?.length ? technicianNames : 
                        technicianName ? [technicianName] : ["Techniker"];

    if (!disturbance || !disturbance.unterschrift_kunde) {
      return new Response(
        JSON.stringify({ error: "Disturbance data and signature required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Generating PDF for disturbance:", disturbance.id);

    // Fetch photo images from storage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const photoImages: (string | null)[] = [];
    if (photos && photos.length > 0) {
      console.log(`Fetching ${photos.length} photos...`);
      for (const photo of photos) {
        const photoUrl = `${supabaseUrl}/storage/v1/object/public/disturbance-photos/${photo.file_path}`;
        const imageData = await fetchImageAsBase64(photoUrl);
        photoImages.push(imageData);
      }
    }

    // Generate PDF
    const pdfBase64 = await generatePDF({ disturbance, materials, technicians, photos }, photoImages);

    // Generate simple email HTML
    const emailHtml = generateEmailHtml({ disturbance, materials, technicians });

    // Fetch office email from settings with fallback
    const { data: setting } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "disturbance_report_email")
      .maybeSingle();

    const officeEmail = setting?.value || "office@fasching-gebaeudetechnik.at";
    console.log("Using office email:", officeEmail);

    // Prepare recipients - office email for all reports
    const recipients = [officeEmail];
    if (disturbance.kunde_email) {
      recipients.push(disturbance.kunde_email);
    }

    // Create filename
    const dateForFilename = formatDateShort(disturbance.datum).replace(/\./g, "-");
    const kundeForFilename = disturbance.kunde_name.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, "_");
    const pdfFilename = `Arbeitsbericht_${kundeForFilename}_${dateForFilename}.pdf`;

    const subject = `Arbeitsbericht - ${disturbance.kunde_name} - ${formatDateShort(disturbance.datum)}`;

    console.log("Sending email with PDF attachment to:", recipients);

    const emailResponse = await resend.emails.send({
      from: "FASCHING Gebäudetechnik <noreply@chrisnapetschnig.at>",
      to: recipients,
      subject: subject,
      html: emailHtml,
      attachments: [
        {
          filename: pdfFilename,
          content: pdfBase64,
        },
      ],
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailResponse }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Error sending disturbance report:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
