/* Button primitive (Design.md §7.9).
   Variants: primary | secondary | ghost | danger. Every state (hover, focus,
   active, disabled) comes from the single `.button.{variant}` definition in
   styles.css — no call site restates them. `disabled` never relies on color
   alone: the stylesheet adds a dashed outline and a `not-allowed` cursor, and
   in-flight writes swap the label text instead of only dimming the control. */
export default function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  children,
  ...rest
}) {
  return (
    <button type={type} className={`button ${variant} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
