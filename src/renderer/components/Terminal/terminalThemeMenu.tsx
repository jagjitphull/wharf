import type { ContextMenuItem } from "../ContextMenu/ContextMenu";
import { TerminalThemeSwatches } from "./TerminalThemeSwatches";

/** [separator, custom swatch-grid item] ready to splice into a ContextMenu's
 * item list. `onSelect` already gets the menu-closing wired up. */
export function buildTerminalThemeMenuItems(activeId: string, onSelect: (id: string) => void): ContextMenuItem[] {
  return [
    { separator: true },
    {
      custom: (close) => (
        <TerminalThemeSwatches
          activeId={activeId}
          onSelect={(id) => {
            onSelect(id);
            close();
          }}
        />
      ),
    },
  ];
}
