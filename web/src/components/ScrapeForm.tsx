import { useState } from "react";

export function ScrapeForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (url: string, resolveStreams: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  const [url, setUrl] = useState("");
  const [resolve, setResolve] = useState(true);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    onSubmit(trimmed, resolve);
  };

  return (
    <form onSubmit={submit} className="card p-4">
      <label className="mb-1.5 block text-sm font-medium">URL de la page film</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://french-stream.one/index.php?newsid=..."
          className="input flex-1"
          disabled={disabled}
          autoFocus
        />
        <button type="submit" className="btn-primary shrink-0" disabled={disabled || !url.trim()}>
          Scraper
        </button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={resolve}
          onChange={(e) => setResolve(e.target.checked)}
          className="h-4 w-4 rounded accent-brand"
        />
        Résoudre le flux direct (m3u8/mp4) — plus lent mais donne un lien lisible
      </label>
    </form>
  );
}
