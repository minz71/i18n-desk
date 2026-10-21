import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadPrefs, persistPrefs } from "./io/prefs";
import { setState } from "./store/editor";
import "./index.css";

/* 深色模式跟著系統走 */
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

setState(loadPrefs());
persistPrefs();
// 除錯工具只在 dev server 掛；正式 build 會把整個模組拿掉
if (import.meta.env.DEV) void import("./debug").then((m) => m.installDebugHook());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
