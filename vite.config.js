import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm,hdr,scad}"],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024, // 30MB limit to ensure Wasm & HDR get cached for offline use
      },
      manifest: {
        name: "OpenSCAD GLTF Viewer",
        short_name: "OpenSCAD Viewer",
        description:
          "A modern, web-based editor and 3D viewer for OpenSCAD supporting WebAssembly compilation, PBR materials, and GPU Path Tracing.",
        theme_color: "#222222",
        background_color: "#222222",
        display: "standalone",
        icons: [
          {
            src: "icon.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icon.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
});
