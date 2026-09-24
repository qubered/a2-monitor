import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { fitFilters } from "../filter-fit";

export type FilterOption = { key: string; label: string; count: number };

type FilterBarProps = {
  options: readonly FilterOption[];
  active: string;
  onChoose: (key: string) => void;
};

const DEFAULT_GAP_PX = 8;

/**
 * The channel filters as one row of chips. What does not fit goes into a
 * "More" dropdown, so the row never grows past one line, and the active filter
 * always stays in the row. On a phone the row is a native dropdown instead.
 */
export function FilterBar({ options, active, onChoose }: FilterBarProps) {
  const row = useRef<HTMLElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<number[] | null>(null);
  const [open, setOpen] = useState(false);
  const activeIndex = options.findIndex(({ key }) => key === active);

  const measure = useCallback(() => {
    const rowElement = row.current;
    const rulerElement = ruler.current;
    if (!rowElement || !rulerElement) return;
    const available = rowElement.clientWidth;
    const chips = [
      ...rulerElement.querySelectorAll<HTMLElement>("[data-chip]"),
    ];
    const widths = chips.map((chip) => chip.offsetWidth);
    // Without layout (or while hidden) show every chip.
    if (available === 0 || widths.some((width) => width === 0)) {
      setShown(null);
      return;
    }
    const moreWidth =
      rulerElement.querySelector<HTMLElement>("[data-more]")?.offsetWidth ?? 0;
    const gap = Number.parseFloat(getComputedStyle(rowElement).columnGap);
    const fit = fitFilters(
      widths,
      Number.isFinite(gap) ? gap : DEFAULT_GAP_PX,
      moreWidth,
      available,
      activeIndex,
    );
    setShown(fit.length === options.length ? null : fit);
  }, [activeIndex, options.length]);

  useLayoutEffect(() => {
    measure();
  }, [measure, options]);

  useEffect(() => {
    if (!row.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row.current);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!more.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const visible = shown ?? options.map((_, index) => index);
  const hidden = options.filter((_, index) => !visible.includes(index));
  const hiddenNeed = hidden.length;

  return (
    <>
      <nav className="filters" aria-label="Channel filters" ref={row}>
        {visible.map((index) => {
          const option = options[index]!;
          return (
            <button
              type="button"
              className="filter-button"
              aria-pressed={active === option.key}
              onClick={() => onChoose(option.key)}
              key={option.key}
            >
              {option.label} <span>{option.count}</span>
            </button>
          );
        })}
        {hiddenNeed > 0 ? (
          <div
            className="filter-more"
            ref={more}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                event.stopPropagation();
                setOpen(false);
              }
            }}
          >
            <button
              type="button"
              className="filter-button"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              More <span>{hiddenNeed}</span>
              <svg
                viewBox="0 0 12 12"
                width="12"
                height="12"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 4.5 6 8l3.5-3.5" />
              </svg>
            </button>
            {open ? (
              <div className="filter-more-list" role="menu">
                {hidden.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active === option.key}
                    className="filter-more-item"
                    onClick={() => {
                      setOpen(false);
                      onChoose(option.key);
                    }}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.count}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </nav>
      {/* Every chip at its natural width, unseen, to decide what fits. */}
      <div className="filter-ruler" aria-hidden="true" ref={ruler}>
        {options.map((option) => (
          <span className="filter-button" data-chip key={option.key}>
            {option.label} <span>{option.count}</span>
          </span>
        ))}
        <span className="filter-button" data-more>
          More <span>{options.length}</span>
          <svg viewBox="0 0 12 12" width="12" height="12" />
        </span>
      </div>
      <label className="filter-select">
        <span className="sr-only">Channel filter</span>
        <select
          value={active}
          onChange={(event) => onChoose(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label} ({option.count})
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 12 12"
          width="12"
          height="12"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </label>
    </>
  );
}
