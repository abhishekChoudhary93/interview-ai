import { lazy, Suspense, useMemo } from "react";
import { Loader2, Pencil } from "lucide-react";

const Excalidraw = lazy(() =>
  import("@excalidraw/excalidraw").then((mod) => ({ default: mod.Excalidraw }))
);

export default function ReportCanvas({ scene, className = "" }) {
  const initialData = useMemo(() => {
    if (!scene || typeof scene !== "object") return null;
    return {
      elements: Array.isArray(scene.elements) ? scene.elements : [],
      appState: { ...(scene.appState || {}), collaborators: new Map() },
      files: scene.files || {},
    };
  }, [scene]);

  return (
    <div className={`overflow-hidden rounded-2xl border border-border/50 bg-card/50 ${className}`}>
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2">
        <Pencil className="h-4 w-4 text-accent" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Design canvas</p>
      </div>

      <div className="h-[min(460px,60vh)] bg-background">
        <Suspense fallback={<CanvasFallback />}>
          <Excalidraw
            initialData={initialData}
            viewModeEnabled
            UIOptions={{
              canvasActions: {
                saveToActiveFile: false,
                loadScene: false,
                export: false,
                toggleTheme: false,
              },
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}

function CanvasFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
