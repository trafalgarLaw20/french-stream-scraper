import { api } from "../api.js";

export function ExportBar({ id }: { id: string }): JSX.Element {
  return (
    <div className="flex gap-2">
      <a href={api.exportUrl(id, "json")} className="btn-ghost !text-xs">
        Export JSON
      </a>
      <a href={api.exportUrl(id, "csv")} className="btn-ghost !text-xs">
        Export CSV
      </a>
    </div>
  );
}
