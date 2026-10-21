import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Grid } from "@/components/grid/Grid";
import { FileTabs } from "@/components/FileTabs";
import { CommitDialog } from "@/components/gitlab/CommitDialog";
import { GitLabWizard } from "@/components/gitlab/GitLabWizard";
import { LocaleBar } from "@/components/LocaleBar";
import { PromptDialog } from "@/components/PromptDialog";
import { Sidebar } from "@/components/Sidebar";
import { Toolbar } from "@/components/Toolbar";
import { Topbar } from "@/components/Topbar";
import { captureDrop } from "@/io/directory";
import { hasUnsavedChanges, loadDrop } from "@/store/actions";

/** 拖放語系資料夾或 JSON 檔到頁面任何地方就載入 */
function useDropZone(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setOver(true);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = () => {
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setOver(false);
      }
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      if (e.dataTransfer?.files.length) void loadDrop(captureDrop(e.dataTransfer));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", overFn);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return over;
}

/** 還有沒存的變更時，關分頁要先問 */
function useBeforeUnload(): void {
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);
}

export function App() {
  const dropping = useDropZone();
  useBeforeUnload();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        <Topbar />
        <main className="flex min-h-0 flex-1">
          <Sidebar />
          <section className="flex min-w-0 flex-1 flex-col">
            <FileTabs />
            <Toolbar />
            <LocaleBar />
            <Grid />
          </section>
        </main>
      </div>

      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-xl border-2 border-dashed border-primary bg-card px-8 py-6 text-base font-medium text-primary shadow-lg">
            <Upload size={20} /> 放開以載入語系資料夾或 JSON 檔案
          </div>
        </div>
      )}

      <PromptDialog />
      <GitLabWizard />
      <CommitDialog />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
