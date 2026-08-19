import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

export function VideoPlayer({ src }: { src: string }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setLoading(true);

    const isM3u8 = /\.m3u8(\?|$)/i.test(src);

    let hls: Hls | null = null;

    if (isM3u8 && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setLoading(false);
          setError(
            data.type === Hls.ErrorTypes.NETWORK_ERROR
              ? "Erreur réseau — flux probablement expiré ou bloqué (CORS)"
              : `Erreur lecture: ${data.details}`,
          );
        }
      });
    } else {
      video.src = src;
      setLoading(false);
      video.play().catch(() => undefined);
    }

    return () => {
      hls?.destroy();
    };
  }, [src]);

  return (
    <div className="relative">
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        className="aspect-video w-full rounded-lg bg-black"
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 text-sm text-white">
          Chargement du flux…
        </div>
      )}
      {error && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
          <p className="mt-1 text-red-500/80">
            Le token du flux a peut-être expiré ou l'hébergeur bloque la lecture hors-site.
            Re-scrape la page pour obtenir un nouveau lien.
          </p>
        </div>
      )}
      <p className="mt-1 text-[11px] text-slate-400">
        Image noire mais son audible ? Essaie{" "}
        <a href={src} target="_blank" rel="noreferrer" className="underline hover:text-slate-200">
          d'ouvrir le flux dans un onglet
        </a>{" "}
        ou dans un lecteur externe (VLC).
      </p>
    </div>
  );
}
