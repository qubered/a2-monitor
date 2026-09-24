import { useEffect, useId, useRef, useState } from "react";

/** Lucide glyphs, 2px stroke (DESIGN.md §7). */
const ICONS = {
  audio: (
    <>
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
    </>
  ),
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  manager: (
    <>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </>
  ),
} as const;

export type HeaderMenuItem = {
  key: string;
  icon: keyof typeof ICONS;
  label: string;
  /** What is set now, shown under the label. */
  value?: string;
  /** This item wants the operator's attention (an unset name, no audio choice). */
  attention?: boolean;
  onSelect?: () => void;
  href?: string;
};

/**
 * The header's one menu: settings that change rarely (where audio plays, who
 * is operating, the Manager link) live here instead of as buttons of their
 * own. The cog carries a dot while any of them needs the operator.
 */
export function HeaderMenu({ items }: { items: readonly HeaderMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const attention = items.some((item) => item.attention);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) toggle.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const entries = [
      ...(root.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []),
    ];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? entries[(at + 1) % entries.length]
        : entries[(at - 1 + entries.length) % entries.length];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  return (
    <div className="header-menu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={toggle}
        className="header-menu-toggle"
        type="button"
        aria-label={attention ? "Settings. Needs your attention" : "Settings"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {attention ? (
          <i className="header-menu-dot" aria-hidden="true" />
        ) : null}
      </button>
      {open ? (
        <div className="header-menu-list" role="menu" id={menuId}>
          {items.map((item) => {
            const content = (
              <>
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {ICONS[item.icon]}
                </svg>
                <span className="header-menu-text">
                  <strong>{item.label}</strong>
                  {item.value ? (
                    <span
                      className={item.attention ? "is-attention" : undefined}
                    >
                      {item.value}
                    </span>
                  ) : null}
                </span>
              </>
            );
            return item.href ? (
              <a
                key={item.key}
                role="menuitem"
                className="header-menu-item"
                href={item.href}
              >
                {content}
              </a>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className="header-menu-item"
                onClick={() => {
                  close(false);
                  item.onSelect?.();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
