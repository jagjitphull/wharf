import type { RefObject } from "react";
import { IconChevronDown, IconChevronUp, IconClose } from "../Icons/Icons";

/** The find-in-terminal box. The query is the caller's; searching itself is the SearchAddon's. */
export function TerminalSearchBar({
  inputRef,
  query,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange(query: string): void;
  onNext(query: string): void;
  onPrevious(query: string): void;
  onClose(): void;
}) {
  return (
    <div className="terminal-search-bar">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrevious(query);
            else onNext(query);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in terminal…"
      />
      <button title="Previous match (Shift+Enter)" onClick={() => onPrevious(query)}>
        <IconChevronUp />
      </button>
      <button title="Next match (Enter)" onClick={() => onNext(query)}>
        <IconChevronDown />
      </button>
      <button title="Close (Esc)" onClick={onClose}>
        <IconClose />
      </button>
    </div>
  );
}
