export interface WorkTimePreset {
  startTime: string;
  endTime: string;
  pauseStart: string;
  pauseEnd: string;
  pauseMinutes: number;
  totalHours: number;
}

export interface CalculatedWorkTimeResult {
  startTime: string;
  endTime: string;
  pauseStart: string;
  pauseEnd: string;
  pauseMinutes: number;
  totalHours: number;
}

// ===== Konstanten: FASCHING Gebäudetechnik 4-Tage-Woche =====

// Vormittagspause: 09:00-09:15 (zählt ALS Arbeitszeit)
export const BREAKFAST_BREAK_START = "09:00";
export const BREAKFAST_BREAK_END = "09:15";
export const BREAKFAST_BREAK_START_MINUTES = 9 * 60;
export const BREAKFAST_BREAK_END_MINUTES = 9 * 60 + 15;
export const BREAKFAST_BREAK_MINUTES = 15;

// Mittagspause: 12:00-12:30 (zählt NICHT als Arbeitszeit)
export const LUNCH_BREAK_START = "12:00";
export const LUNCH_BREAK_END = "12:30";
export const LUNCH_BREAK_START_MINUTES = 12 * 60;
export const LUNCH_BREAK_END_MINUTES = 12 * 60 + 30;
export const LUNCH_BREAK_MINUTES = 30;

// Regelarbeitszeit: MO-DO 07:00-17:07:30 = 9h 37.5min/Tag (ohne Mittagspause)
export const DAILY_WORK_MINUTES = 577.5; // 9h 37.5min
export const DAILY_WORK_HOURS = 9.625; // 9h 37.5min
export const WEEKLY_TARGET_HOURS = 38.5;
export const DEFAULT_START_TIME = "07:00";
// MO-DO Regelende exakt: 17:07:30 = 07:00 + 9h37.5min + 30min Mittagspause
// Bis-Feld nutzt step="1" für Sekunden-Unterstützung
export const DEFAULT_END_TIME = "17:07:30";
export const DEFAULT_END_TIME_DISPLAY = "17:07:30";

export function timeToMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  const hours = parts[0] || 0;
  const minutes = parts[1] || 0;
  const seconds = parts[2] || 0;
  return hours * 60 + minutes + seconds / 60;
}

export function minutesToTime(totalMinutes: number): string {
  const normalizedMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Prüft ob ein Tag ein Arbeitstag ist (MO-DO)
 */
export function isWorkingDay(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 4; // Mo=1, Di=2, Mi=3, Do=4
}

/**
 * Prüft ob ein Tag ein arbeitsfreier Tag ist (FR, SA, SO)
 */
export function isNonWorkingDay(date: Date): boolean {
  return !isWorkingDay(date);
}

/**
 * Gibt die Normalarbeitszeit für einen Tag zurück
 * MO-DO: 9.625h (9h 37.5min), FR-SO: 0h
 */
export function getNormalWorkingHours(date: Date): number {
  return isWorkingDay(date) ? DAILY_WORK_HOURS : 0;
}

/**
 * Gibt die tatsächlichen Soll-Arbeitsstunden für einen Tag zurück
 * MO-DO: 9.625h, FR-SO: 0h
 */
export function getTotalWorkingHours(date: Date): number {
  return isWorkingDay(date) ? DAILY_WORK_HOURS : 0;
}

/**
 * Gibt die Sollstunden für eine Woche zurück: 38.5 Stunden
 */
export function getWeeklyTargetHours(): number {
  return WEEKLY_TARGET_HOURS;
}

/**
 * Berechnet die Arbeitsstunden aus Von-Bis-Zeiten
 * Mittagspause wird abgezogen (zählt nicht als Arbeitszeit)
 * Vormittagspause wird NICHT abgezogen (zählt als Arbeitszeit)
 */
export function calculateHoursFromTimes(
  startTime: string,
  endTime: string,
  hasLunchBreak: boolean
): number {
  if (!startTime || !endTime) return 0;
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  if (endMin <= startMin) return 0;
  let workMinutes = endMin - startMin;
  if (hasLunchBreak) {
    workMinutes -= LUNCH_BREAK_MINUTES;
  }
  return Math.max(0, workMinutes / 60);
}

/**
 * Prüft ob ein Zeitblock die Vormittagspause umfasst (09:00-09:15)
 */
export function blockSpansBreakfast(startTime: string, endTime: string): boolean {
  if (!startTime || !endTime) return false;
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  return startMin <= BREAKFAST_BREAK_START_MINUTES && endMin >= BREAKFAST_BREAK_END_MINUTES;
}

/**
 * Prüft ob ein Zeitblock die Mittagspause umfasst (12:00-12:30)
 */
export function blockSpansLunch(startTime: string, endTime: string): boolean {
  if (!startTime || !endTime) return false;
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  return startMin <= LUNCH_BREAK_START_MINUTES && endMin >= LUNCH_BREAK_END_MINUTES;
}

/**
 * Berechnet die Differenz zum Tagessoll (positiv = Überstunden, negativ = Minusstunden)
 * MO-DO: Differenz zu 9.625h, FR/SA/SO: alles = Überstunde
 */
export function calculateDailyOvertime(date: Date, totalWorkedHours: number): number {
  const target = getNormalWorkingHours(date);
  if (target === 0) return totalWorkedHours; // Freitag/Wochenende = alles ist Überstunde
  return totalWorkedHours - target;
}

// ===== Legacy-Kompatibilität =====

export function normalizeWorkStartTime(date: Date, startTime: string): string {
  if (!isWorkingDay(date)) return startTime;
  const startMinutes = timeToMinutes(startTime);
  if (startMinutes >= LUNCH_BREAK_START_MINUTES && startMinutes < LUNCH_BREAK_END_MINUTES) {
    return LUNCH_BREAK_END;
  }
  return startTime;
}

export function calculateSuggestedStartTime(date: Date, lastEndTime: string | null): string {
  if (!lastEndTime) return DEFAULT_START_TIME;
  return normalizeWorkStartTime(date, lastEndTime);
}

export function calculateWorkTimeRange(
  date: Date,
  totalHours: number,
  requestedStartTime = DEFAULT_START_TIME
): CalculatedWorkTimeResult {
  const normalizedStartTime = normalizeWorkStartTime(date, requestedStartTime);
  const safeHours = Number.isFinite(totalHours) ? Math.max(0, totalHours) : 0;

  if (safeHours === 0) {
    return {
      startTime: normalizedStartTime,
      endTime: "",
      pauseStart: "",
      pauseEnd: "",
      pauseMinutes: 0,
      totalHours: 0,
    };
  }

  const startMinutes = timeToMinutes(normalizedStartTime);
  const workingMinutes = Math.round(safeHours * 60);
  const rawEndMinutes = startMinutes + workingMinutes;
  const needsLunchBreak = isWorkingDay(date)
    && startMinutes < LUNCH_BREAK_START_MINUTES
    && rawEndMinutes > LUNCH_BREAK_START_MINUTES;

  const pauseMinutes = needsLunchBreak ? LUNCH_BREAK_MINUTES : 0;
  const endMinutes = rawEndMinutes + pauseMinutes;

  return {
    startTime: normalizedStartTime,
    endTime: minutesToTime(endMinutes),
    pauseStart: needsLunchBreak ? LUNCH_BREAK_START : "",
    pauseEnd: needsLunchBreak ? LUNCH_BREAK_END : "",
    pauseMinutes,
    totalHours: safeHours,
  };
}

/**
 * Gibt Standard-Arbeitszeiten für einen Tag zurück
 * MO-DO: 07:00–17:07:30, mit Vormittags- und Mittagspause
 */
export function getDefaultWorkTimes(date: Date): WorkTimePreset | null {
  if (!isWorkingDay(date)) return null;

  return {
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
    pauseStart: LUNCH_BREAK_START,
    pauseEnd: LUNCH_BREAK_END,
    pauseMinutes: LUNCH_BREAK_MINUTES,
    totalHours: DAILY_WORK_HOURS,
  };
}
