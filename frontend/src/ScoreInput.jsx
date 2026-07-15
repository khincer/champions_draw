import { useEffect, useRef } from 'preact/hooks';

export default function ScoreInput({ value, onChange, disabled, animateOnChange }) {
  const ref = useRef(null);
  const prevValue = useRef(value);

  useEffect(() => {
    if (animateOnChange && value !== prevValue.current && ref.current && value != null) {
      ref.current.classList.remove('score-flash');
      void ref.current.offsetWidth;
      ref.current.classList.add('score-flash');
    }
    prevValue.current = value;
  }, [value, animateOnChange]);

  return (
    <input
      ref={ref}
      className="score-input"
      type="number"
      min="0"
      max="99"
      value={value ?? ''}
      disabled={disabled}
      onInput={(e) => {
        const v = e.currentTarget.value;
        if (v === '') {
          onChange(null);
        } else {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 0 && n <= 99) {
            onChange(n);
          }
        }
      }}
    />
  );
}
