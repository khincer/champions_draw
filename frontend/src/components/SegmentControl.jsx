import { useRef } from 'preact/hooks';

/* Single segment/tab control (Design.md §7.8).
   Replaces `ViewTabs`, the `PredictionApp` sub-tabs and `.segment-control`.
   Roving tabindex + Arrow/Home/End keys move and apply selection (the APG
   "selection follows focus" pattern for segmented controls); `aria-pressed` is
   kept so the announcement that ships today does not regress.

   `className` is the shell class only — a site passes exactly one of
   `view-tabs` / `segment-control`, never both, so no rule cascade is retuned. */
export default function SegmentControl({
  items,
  value,
  onChange,
  className = 'segment-control',
  label,
}) {
  const refs = useRef([]);

  function select(index) {
    const item = items[index];
    if (!item || item.disabled) return;
    onChange(item.key);
    refs.current[index]?.focus();
  }

  function handleKeyDown(event) {
    const current = items.findIndex((item) => item.key === value);
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;

    if (step) {
      event.preventDefault();
      let next = current;
      for (let i = 0; i < items.length; i += 1) {
        next = (next + step + items.length) % items.length;
        if (!items[next].disabled) break;
      }
      select(next);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const order = items.map((_, index) => index);
      if (event.key === 'End') order.reverse();
      const index = order.find((candidate) => !items[candidate].disabled);
      if (index != null) select(index);
    }
  }

  return (
    <div className={className} role="group" aria-label={label} onKeyDown={handleKeyDown}>
      {items.map((item, index) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            ref={(el) => { refs.current[index] = el; }}
            className={selected ? 'active' : ''}
            aria-pressed={selected}
            disabled={item.disabled || undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(index)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
