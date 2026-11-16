import { AlertTriangle } from "lucide-react";
import type { UrgentStripSelection } from "@/lib/notifications/compact";
import "./inbox.css";

interface Props {
  selection: UrgentStripSelection | null;
  onOpen: (id?: string) => void;
}

/** Slim top-of-page bar for one unread urgent item, plus "+N more". */
export function UrgentStrip({ selection, onOpen }: Props) {
  if (!selection) return null;
  const more = selection.more;
  return (
    <button
      type="button"
      className="nc-strip tap-44"
      data-testid="urgent-strip"
      role="status"
      onClick={() => onOpen(selection.item.id)}
    >
      <AlertTriangle className="h-4 w-4 nc-strip-ico" aria-hidden="true" />
      <span className="nc-strip-msg">
        <b>Urgent</b>
        {" · "}
        {selection.item.title}
        {more > 0 ? ` · +${more} more` : ""}
      </span>
      <span className="nc-strip-view">View</span>
    </button>
  );
}
