import { getProjectColor } from "./scheduleUtils";

interface Props {
  projectId?: string;
  label: string;
  variant?: "project" | "regie" | "leave" | "holiday";
  onClick?: () => void;
  badge?: string | number;
  colorOverride?: { bg: string; text: string; border: string };
}

export function GanttBar({
  projectId,
  label,
  variant = "project",
  onClick,
  badge,
  colorOverride,
}: Props) {
  const baseClasses =
    "rounded-md px-2 py-1 text-xs font-medium truncate min-h-[32px] flex items-center gap-1 transition-opacity";

  if (variant === "leave") {
    return (
      <div className={`${baseClasses} bg-green-100 text-green-800 border border-green-300`}>
        <span className="truncate">{label}</span>
      </div>
    );
  }

  if (variant === "holiday") {
    return (
      <div className={`${baseClasses} bg-gray-100 text-gray-500 border border-gray-200`}>
        <span className="truncate">{label}</span>
      </div>
    );
  }

  if (variant === "regie") {
    return (
      <div
        className={`${baseClasses} bg-orange-100 text-orange-900 border border-orange-300 ${onClick ? "cursor-pointer hover:opacity-80" : ""}`}
        onClick={onClick}
      >
        <span className="truncate flex-1">{label}</span>
        {badge != null && (
          <span className="shrink-0 text-[10px] bg-white/60 rounded px-1">
            {badge}
          </span>
        )}
      </div>
    );
  }

  const color = colorOverride ?? (projectId ? getProjectColor(projectId) : null);
  return (
    <div
      className={`${baseClasses} ${
        color
          ? `${color.bg} ${color.text} border ${color.border}`
          : "bg-muted/30 border-dashed border-muted-foreground/30 text-muted-foreground"
      } ${onClick ? "cursor-pointer hover:opacity-80" : ""}`}
      onClick={onClick}
    >
      <span className="truncate flex-1">{label}</span>
      {badge != null && (
        <span className="shrink-0 text-[10px] bg-white/60 rounded px-1">
          {badge}
        </span>
      )}
    </div>
  );
}
