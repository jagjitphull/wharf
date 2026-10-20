import { useToastStore, type ToastKind } from "../../state/toastStore";
import { IconCheck, IconClose } from "../Icons/Icons";
import "./Toaster.css";

const ICON: Record<ToastKind, string> = { success: "ok", error: "!", info: "i" };

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="toaster" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <span className="toast-icon" aria-hidden="true">
            {t.kind === "success" ? <IconCheck size={12} /> : ICON[t.kind]}
          </span>
          <span className="toast-message">{t.message}</span>
          <button className="toast-close" title="Dismiss" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
