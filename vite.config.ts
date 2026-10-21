/// <reference types="vitest/config" />
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// File System Access API 需要 secure context。http://127.0.0.1 算，file:// 不算，
// 所以本機一律走 dev server。port 固定（strictPort），被占用時直接失敗而不是換一個：
// 瀏覽器的偏好、草稿與記住的 token 都綁在 origin 上，換 port 就讀不到了。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  preview: { host: "127.0.0.1", port: 5181, strictPort: true },
  // React + Radix + 圖示大約 165KB gzip，只有一個頁面、載入一次就常駐，拆 chunk 換不到什麼，只把警告門檻調高
  build: { chunkSizeWarningLimit: 600 },
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
