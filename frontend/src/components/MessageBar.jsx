import { AlertCircle, CheckCircle2 } from 'lucide-preact';

export default function MessageBar({ error, notice }) {
  return (
    <div className={`message-bar ${error ? 'error' : 'notice'}`}>
      {error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
      <span>{error || notice}</span>
    </div>
  );
}
