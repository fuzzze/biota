import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const base = process.env.VITE_BASE || "/";

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Base path: "/" for Tauri (served from root) and local dev; set VITE_BASE to
  // the GitHub Pages project path (e.g. "/biota/") when building for Pages.
  base,

  plugins: [
    // Turns the static web build into an installable, offline-capable PWA.
    // Workbox precaches every build asset (JS/CSS/HTML + tile PNGs/SVG + fonts),
    // so once the page has loaded once it runs with no network at all.
    // We register the service worker manually (in main.ts, guarded against the
    // Tauri runtime), so injectRegister is disabled here.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "icons/*.png"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2,ttf}"],
        // Everything is bundled; never fall back to the network for navigations.
        navigateFallback: `${base}index.html`,
      },
      manifest: {
        name: "Biota — шифр в тайлах",
        short_name: "Biota",
        description: "Кодирование текста в повороты шестиугольных тайлов. Работает офлайн, ничего не уходит на сервер.",
        lang: "ru",
        dir: "ltr",
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "portrait",
        background_color: "#0e1013",
        theme_color: "#0e1013",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
