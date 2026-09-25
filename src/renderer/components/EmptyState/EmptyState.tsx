import type { ReactNode } from "react";
import "./EmptyState.css";

interface Props {
  icon: ReactNode;
  title: string;
  hint?: string;
  children?: ReactNode;
}

/** A consistent "nothing here yet" screen — a large muted icon, a real
 * heading (not just a paragraph the same weight as body text), an optional
 * one-line hint, and optional action buttons. Used for the two full-panel
 * empty states (no terminal sessions, no SFTP host selected) so both read
 * as one deliberate pattern rather than two different ad-hoc messages. */
export function EmptyState({ icon, title, hint, children }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <p className="empty-state-title">{title}</p>
      {hint && <p className="empty-state-hint">{hint}</p>}
      {children && <div className="empty-state-actions">{children}</div>}
    </div>
  );
}
