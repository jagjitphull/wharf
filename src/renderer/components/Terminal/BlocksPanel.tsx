import { useEffect, useRef } from "react";
import type { CommandBlock } from "./commandBlocks";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import "./BlocksPanel.css";

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Props {
  blocks: CommandBlock[];
  onClose(): void;
  onJumpTo(block: CommandBlock): void;
  onCopyCommand(block: CommandBlock): void;
  onCopyOutput(block: CommandBlock): void;
  onRerun(block: CommandBlock): void;
  onToggleBookmark(block: CommandBlock): void;
  onExplain(block: CommandBlock): void;
  explainBusyId: string | null;
}

export function BlocksPanel({ blocks, onClose, onJumpTo, onCopyCommand, onCopyOutput, onRerun, onToggleBookmark, onExplain, explainBusyId }: Props) {
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const listRef = useRef<HTMLDivElement>(null);
  const blockCountRef = useRef(0);

  useEffect(() => {
    // Auto-scroll to the newest block, but only when one was actually
    // added — not on every re-render (e.g. a block's exit code arriving
    // shouldn't yank the user's scroll position if they've scrolled up to
    // look at an older one).
    if (blocks.length !== blockCountRef.current) {
      blockCountRef.current = blocks.length;
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [blocks.length]);

  function statusClass(block: CommandBlock): string {
    if (block.exitCode === null) return "running";
    return block.exitCode === 0 ? "ok" : "failed";
  }

  function openRowMenu(e: React.MouseEvent, block: CommandBlock) {
    e.stopPropagation();
    openMenu(e, [
      { label: "Copy command", onClick: () => onCopyCommand(block) },
      { label: "Copy output", onClick: () => onCopyOutput(block) },
      { label: "Re-run", onClick: () => onRerun(block) },
      { label: block.bookmarked ? "Remove bookmark" : "Bookmark", onClick: () => onToggleBookmark(block) },
      ...(block.exitCode !== null && block.exitCode !== 0
        ? [{ label: "Explain & Fix…", onClick: () => onExplain(block) }]
        : []),
    ]);
  }

  return (
    <div className="blocks-panel">
      <div className="blocks-panel-header">
        <span>Command Blocks</span>
        <button title="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="blocks-panel-list" ref={listRef}>
        {blocks.length === 0 && (
          <div className="blocks-panel-empty">
            No blocks yet — run a command. If nothing appears, this shell may not support Command Blocks (bash/zsh
            only), or it's turned off in Settings.
          </div>
        )}
        {blocks.map((block) => (
          <div key={block.id} className="blocks-panel-row" onClick={() => onJumpTo(block)}>
            <span className={`blocks-panel-status ${statusClass(block)}`} title={block.exitCode === null ? "running" : `exit code ${block.exitCode}`} />
            <span className="blocks-panel-command" title={block.command}>
              {block.command}
            </span>
            {block.bookmarked && <span className="blocks-panel-bookmark" title="Bookmarked">★</span>}
            <span className="blocks-panel-time">{relativeTime(block.timestamp)}</span>
            <button className="blocks-panel-more" title="Actions" onClick={(e) => openRowMenu(e, block)}>
              ⋯
            </button>
          </div>
        ))}
      </div>
      <ContextMenu menu={menu} onClose={closeMenu} />
      {explainBusyId && <div className="blocks-panel-explaining">Asking the AI about a failed command…</div>}
    </div>
  );
}
