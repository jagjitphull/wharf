import { useEffect, useState } from "react";
import { wharf } from "../../api/wharf";
import { useAppStore } from "../../state/store";
import { useUiPrefsStore } from "../../state/uiPrefsStore";
import { IconCheck, IconClose } from "../Icons/Icons";

interface Props {
  hostCount: number;
  onAddHost(): void;
}

/** A short first-run checklist on Home: a host, an SSH key, a master password. It hides itself once all three are done, or when dismissed. */
export function GettingStarted({ hostCount, onAddHost }: Props) {
  const dismissed = useUiPrefsStore((s) => s.gettingStartedDismissed);
  const dismiss = useUiPrefsStore((s) => s.dismissGettingStarted);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [hasMaster, setHasMaster] = useState<boolean | null>(null);

  useEffect(() => {
    if (dismissed) return;
    void wharf.sshKeys.list().then(
      (keys) => setHasKey(keys.length > 0),
      () => setHasKey(null),
    );
    void wharf.secrets.status().then(
      (s) => setHasMaster(s.masterPassword !== "none"),
      () => setHasMaster(null),
    );
  }, [dismissed]);

  if (dismissed || hasKey === null || hasMaster === null) return null;
  const steps = [
    {
      done: hostCount > 0,
      title: "Add a host",
      hint: "Save a server once, then connect with a click.",
      action: "New host",
      run: onAddHost,
    },
    {
      done: hasKey,
      title: "Create an SSH key",
      hint: "Sign in without typing a password.",
      action: "SSH keys",
      run: () => setActiveView("keys"),
    },
    {
      done: hasMaster,
      title: "Protect saved passwords",
      hint: "Lock them behind a master password.",
      action: "Settings",
      run: () => setActiveView("settings"),
    },
  ];
  if (steps.every((s) => s.done)) return null;

  return (
    <section className="getting-started" aria-label="Getting started">
      <header>
        <h2>Getting started</h2>
        <span className="getting-started-progress">
          {steps.filter((s) => s.done).length} of {steps.length} done
        </span>
        <button
          className="getting-started-hide"
          onClick={dismiss}
          title="Hide this checklist"
          aria-label="Hide the getting started checklist"
        >
          <IconClose size={14} />
        </button>
      </header>
      <ul>
        {steps.map((step) => (
          <li key={step.title} className={step.done ? "done" : ""}>
            <span className="getting-started-tick">{step.done && <IconCheck size={12} />}</span>
            <span className="getting-started-text">
              <strong>{step.title}</strong>
              <small>{step.hint}</small>
            </span>
            {!step.done && (
              <button className="btn small" onClick={step.run}>
                {step.action}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
