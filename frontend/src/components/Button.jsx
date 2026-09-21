
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
