import { useRef } from 'preact/hooks';

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
