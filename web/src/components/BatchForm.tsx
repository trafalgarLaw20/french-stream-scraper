import { useState } from "react";

export function BatchForm({
  onSubmit,
  disabled,
  progress,
}: {
  onSubmit: (urls: string[], resolveStreams: boolean) => void;
  disabled?: boolean;
  progress?: { done: number; total: number } | null;
}): JSX.Element {
  const [text, setText] = useState("");
  const [resolve, setResolve] = useState(false);

  const urls = text
    .split(/[\n,]/)
    .map((u) => u.trim())
    .filter(Boolean);
  const count = urls.length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (urls.length === 0) return;
    onSubmit(urls, resolve);
  };

  return (
    <form onSubmit={submit} className="card p-4">
      <label className="mb-1.5 block text-sm font-medium">
        URLs à scraper <span className="text-slate-400">({count} détectée{count > 1 ? "s" : ""})</span>
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Une URL par ligne:\nhttps://french-stream.one/index.php?newsid=...\nhttps://french-stream.one/index.php?newsid=..."}
        className="input min-h-[140px] font-mono text-xs"
        disabled={disabled}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            checked={resolve}
            onChange={(e) => setResolve(e.target.checked)}
            className="h-4 w-4 rounded accent-brand"
          />
          Résoudre les flux directs
        </label>
        <div className="flex items-center gap-3">
          {progress && (
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {progress.done}/{progress.total}
            </span>
          )}
          <button type="submit" className="btn-primary" disabled={disabled || count === 0}>
            Lancer le batch
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Les URLs sont scrapées une à une (file séquentielle), avec un délai de 4 s entre chaque pour éviter le bannissement.
      </p>
    </form>
  );
}
