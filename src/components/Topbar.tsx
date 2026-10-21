import { useRef } from "react";
import {
  Download,
  ExternalLink,
  FileJson,
  FolderOpen,
  GitBranch,
  Package,
  Pencil,
  Save,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { supportsDirectoryInput, supportsDirectoryPicker } from "@/io/directory";
import { cn } from "@/lib/utils";
import {
  downloadAll,
  downloadChanged,
  editPattern,
  loadDirectoryInput,
  loadFiles,
  pickDirectory,
  saveToDirectory,
} from "@/store/actions";
import { totalChanges, useEditor } from "@/store/editor";
import { openGitLabCommit, openGitLabLoad } from "./gitlab/gitlab-dialogs";

/* 各種來源的差別只有一個：能不能直接寫回原檔。這個標籤就是為了讓人不用猜。 */
function ModeBadge() {
  const mode = useEditor((s) => s.mode);
  const project = useEditor((s) => s.gitlab?.project || "");
  const dirName = useEditor((s) => s.dirName);
  const loaded = useEditor((s) => s.doc.order.length > 0);

  const spec = !loaded
    ? { text: "尚未載入", title: "", cls: "bg-muted text-muted-foreground" }
    : mode === "gitlab"
      ? {
          text: "GitLab 模式 · 可直接 commit",
          title:
            "「提交到 GitLab」會把所有變更打包成一個 commit 送回 " +
            project +
            "，送出前會先確認遠端沒有被別人推過",
          cls: "bg-gitlab/15 text-gitlab border-gitlab/40",
        }
      : mode === "folder"
        ? {
            text: "資料夾模式 · 可直接儲存",
            title: "「儲存到資料夾」會覆寫原本的檔案",
            cls: "bg-folder/15 text-folder border-folder/40",
          }
        : dirName
          ? {
              text: "資料夾（唯讀）· 只能下載",
              title:
                "這個瀏覽器只能讀資料夾、不能寫回。改完請按「下載變更」，zip 裡的路徑跟原本的資料夾一樣，" +
                "解壓縮到「" +
                dirName +
                "」裡就會蓋過原檔",
              cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
            }
          : {
              text: "檔案模式 · 只能下載",
              title:
                "用「載入 JSON 檔…」進來的檔案無法寫回原處，改完請按「下載變更」，再把檔案放回原本的資料夾",
              cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
            };

  return (
    <span
      className={cn(
        "shrink-0 rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        spec.cls,
      )}
      title={spec.title}
    >
      {spec.text}
    </span>
  );
}

function FolderInfo() {
  const label = useEditor((s) => s.loadLabel);
  const locales = useEditor((s) => s.doc.order.length);
  const keys = useEditor((s) => s.doc.keyOrder.length);
  const files = useEditor((s) => s.docs.length);
  const pattern = useEditor((s) => s.pattern);
  useEditor((s) => s.docRev);
  if (!locales) return null;
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="truncate">
        {label} · {locales} 個語系{files > 1 ? " × " + files + " 份檔" : ""} · {keys} 個 key
      </span>
      {/* 讀錯版面時從這裡改；平常它只是告訴你檔案是照什麼規則找到的 */}
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent hover:text-foreground"
        title="語系檔是照這個路徑樣板找到的：{code} 是語系代碼，{ns} 是同一個語系底下的哪一份檔。讀錯了可以點這裡改"
        onClick={() => void editPattern()}
      >
        {pattern} <Pencil size={11} />
      </button>
    </span>
  );
}

function Count({ n }: { n: number }) {
  return n ? <span className="tabular-nums opacity-80">({n})</span> : null;
}

function GroupLabel({ children }: { children: string }) {
  return (
    <span className="text-[11px] font-medium tracking-wide text-muted-foreground">{children}</span>
  );
}

export function Topbar() {
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement | null>(null);
  const mode = useEditor((s) => s.mode);
  const loaded = useEditor((s) => s.doc.order.length > 0);
  const changed = useEditor(totalChanges);
  const mrUrl = useEditor((s) => s.gitlab?.mrUrl || "");
  const canPick = supportsDirectoryPicker();
  // 不能直接讀寫的話退一步：選得到資料夾、讀得到路徑，只是改完要下載
  const canReadDir = !canPick && supportsDirectoryInput();
  const folderTitle = canPick
    ? ""
    : canReadDir
      ? "這個瀏覽器只能讀資料夾、不能直接寫回，改完請按「下載變更」"
      : "這個瀏覽器不支援開資料夾，請改用「載入 JSON 檔…」或拖放";

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <strong className="shrink-0 text-sm font-semibold tracking-tight whitespace-nowrap">
          i18n desk
        </strong>
        <ModeBadge />
        <FolderInfo />
        {mrUrl && (
          <a
            href={mrUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap text-gitlab hover:underline"
          >
            開啟 MR <ExternalLink size={12} />
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <GroupLabel>來源</GroupLabel>
        <Button
          size="sm"
          variant={canPick || canReadDir ? "default" : "outline"}
          disabled={!canPick && !canReadDir}
          title={folderTitle}
          onClick={() => (canPick ? void pickDirectory() : dirInput.current?.click())}
        >
          <FolderOpen /> 選擇語系資料夾…
        </Button>
        <Button
          size="sm"
          variant={canPick || canReadDir ? "outline" : "default"}
          onClick={() => fileInput.current?.click()}
        >
          <FileJson /> 載入 JSON 檔…
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-gitlab/50 text-gitlab hover:bg-gitlab/10 hover:text-gitlab"
          onClick={openGitLabLoad}
        >
          <GitBranch /> 從 GitLab 載入…
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5!" />
        <GroupLabel>輸出</GroupLabel>
        {mode === "folder" && (
          <Button size="sm" disabled={!changed} onClick={() => void saveToDirectory()}>
            <Save /> 儲存到資料夾 <Count n={changed} />
          </Button>
        )}
        {mode === "gitlab" && (
          <Button
            size="sm"
            disabled={!changed}
            className="bg-gitlab text-gitlab-foreground hover:bg-gitlab/90"
            onClick={openGitLabCommit}
          >
            <Upload /> 提交到 GitLab <Count n={changed} />
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={!changed} onClick={downloadChanged}>
          <Download /> 下載變更 <Count n={changed} />
        </Button>
        <Button size="sm" variant="outline" disabled={!loaded} onClick={downloadAll}>
          <Package /> 下載全部 (zip)
        </Button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void loadFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {canReadDir && (
        <input
          ref={(el) => {
            dirInput.current = el;
            // React 不認得 webkitdirectory 這個屬性，直接設在 DOM 上
            if (el) el.webkitdirectory = true;
          }}
          type="file"
          hidden
          onChange={(e) => {
            if (e.target.files) void loadDirectoryInput(e.target.files);
            e.target.value = "";
          }}
        />
      )}
    </header>
  );
}
