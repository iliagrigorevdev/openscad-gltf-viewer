# OpenSCAD GLTF Viewer

A modern, web-based editor and 3D viewer for OpenSCAD. It natively compiles `.scad` scripts directly to **glTF/GLB** formats in the browser using WebAssembly, and renders them using a cutting-edge Three.js pipeline supporting **GPU Path Tracing**, **PBR materials**, and **Skeletal Animations**.

**🌐 Live Demo:** [openscad-gltf-viewer](https://iliagrigorevdev.github.io/openscad-gltf-viewer/)

![OpenSCAD GLTF Viewer Screenshot](screenshot.png)

## ✨ Features

- **100% Client-Side Compilation**: Compiles OpenSCAD scripts directly to `.glb` (binary) format entirely in the browser using [`openscad-gltf-wasm`](https://github.com/iliagrigorevdev/openscad-gltf-wasm) and WebAssembly.
- **Photorealistic GPU Path Tracing**: Toggle on **Path Tracing** for incredibly realistic lighting, soft shadows, and physically accurate glass refractions/transmissions powered by `three-gpu-pathtracer`.
- **Extended PBR Support**: Visualize advanced material properties extending standard OpenSCAD, including `metalness`, `roughness`, `transmission` (glass), `clearcoat`, `sheen`, `ior`, `emissive`, `specular`, and `iridescence`.
- **Skeletal Animations**: Fully supports parsing and playing hierarchical bone animations defined in the custom SCAD engine, complete with timeline playback controls.
- **Auto Smooth & Crease Angle**: Toggle on **Auto Smooth** to automatically calculate and apply smooth vertex normals to blocky CAD geometry. Fine-tune the **Crease Angle** to perfectly preserve intended sharp edges.
- **Local File Sync (SCAD Serve)**: Connect the web viewer to the local filesystem using the `openscad-gltf-wasm` CLI. Instantly manage, edit, and save `.scad` files directly from your browser.
- **Compressed URL Sharing**: Share your designs instantly without a database. The app uses the native `CompressionStream` API to deflate your SCAD code and embed it into the URL hash, making even complex models shareable via a single link.
- **Drag-and-Drop Support**: Instantly load existing scripts by dragging and dropping any `.scad` file directly into the browser window.
- **AI Prompt Generator**: Because LLMs don't know about this engine's custom syntax, the viewer includes a built-in tool to generate AI-ready prompts. Customise the required PBR/Animation rules, describe your object, copy the prompt, and paste it into Gemini or Claude to get perfectly compatible SCAD code!
- **Instant Export & Image Capture**: Download your `.scad` source code, export the resulting standard `.glb` file (which automatically bakes in your smoothed geometry and animations), or instantly save a `.png` screenshot of your current render viewport.

## 🎮 How to Use

### 1. The AI Prompt Generator

1. Toggle the exact PBR properties and animation support you want the AI to include using the checkboxes.
2. Type a description of the object you want into the text area (e.g., _"A shiny gold ring with an embedded red gem"_).
3. Click **📋 Copy Prompt to Clipboard**.
4. Paste the copied text into your favorite LLM (Gemini, Claude, etc.). The copied text secretly includes all the custom syntax rules the AI needs to generate PBR materials and animations.
5. Copy the AI's generated OpenSCAD code and paste it into the editor.

### 2. The SCAD Editor

- **Load & Drag-and-Drop**: Click the **📁 Load** button to open a file dialog, or drag a `.scad` file from your computer and drop it anywhere on the app to instantly load its contents into the editor and trigger a render.
- Toggle **Auto Render** to automatically compile and update the 3D viewer when you stop typing (debounced at 800ms). Enabled by default. (Note: If the editor is empty and not connected to a backend, it will fall back to a default sample scene).
- You can manually trigger a render using the **▶ Render** button.
- Use **⬇ SCAD** or **⬇ GLTF** to download your work. _(Note: If "Auto Smooth" is enabled, the `.glb` export will preserve the computed smooth vertex normals!)_
- Click **🔗 Share** to generate a permanent link to your current script. On mobile devices, this opens the native share sheet; on desktop, it copies the link to your clipboard. Since the data is stored in the URL hash, your code is never sent to a server.
- Use **📷 Image** to capture and download a high-quality `.png` screenshot of the 3D viewport.

### 3. Animation Controls

- If your model contains valid OpenSCAD animations, an **Animation Controls** section will dynamically appear.
- Select which animation to play from the dropdown menu.
- Use the **▶ Play / ⏸ Pause** button to control playback.
- Scrub through the animation manually using the provided timeline slider.

### 4. Local File Sync (SCAD Serve Backend)

The viewer can connect to a local development environment to save files directly to your hard drive and manage files using the [`openscad-gltf-wasm`](https://github.com/iliagrigorevdev/openscad-gltf-wasm) CLI.

**1. Start the local backend server:**
Run this in your project folder to bridge the web editor to your filesystem.

- **Option A: Run directly (No installation)**
  ```bash
  npx -p github:iliagrigorevdev/openscad-gltf-wasm scad-serve
  ```
- **Option B: If installed locally (`npm install --save-dev github:iliagrigorevdev/openscad-gltf-wasm`)**
  ```bash
  npx scad-serve
  ```

**2. Connect and Edit:**

1. In the Web Viewer, ensure the Backend URL is correct and click **Connect**.
2. Select `-- Create New Model --` to start a new file, or choose an existing model from the dropdown.
3. The UI tracks unsaved changes. Use the **Save** button to update your `.scad` files on your disk.

### 5. Viewer Controls

- **Orbit Controls**: Left-click and drag to rotate, right-click and drag to pan, scroll to zoom.
- **Path Tracing Toggle**: Switches from the standard WebGL rasterizer to a physically-based path tracer. This is highly recommended for materials with `transmission` (glass/water) to see accurate refractions.
- **Auto Smooth**: Averages face normals based on the specified crease angle, instantly giving your faceted models a smooth, modern 3D look.

## 🚀 Local Development

To run this project locally, ensure you have [Node.js](https://nodejs.org/) installed:

```bash
# Install dependencies
npm install

# Start the Vite development server
npm run dev
```

## 🛠 Tech Stack

- **Framework**: Vanilla JS + [Vite](https://vitejs.dev/)
- **Core Processing Engine**: [`openscad-gltf-wasm`](https://github.com/iliagrigorevdev/openscad-gltf-wasm)
- **3D Engine**: [Three.js](https://threejs.org/)
- **Path Tracing**: [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)
- **Compression**: Native browser `CompressionStream` (deflate-raw) for URL state management.

## 📄 Custom SCAD Syntax Overview

Because this viewer uses a custom fork of OpenSCAD, you can use powerful new syntax:

**PBR Materials:**

```openscad
color("white", roughness = 0.1, metalness = 1.0, clearcoat = 1.0, iridescence = 1.0, emissive = [0.2, 0.5, 1.0], emissiveIntensity = 2.0) {
    sphere(r=10);
}
```

**Skeletal Animations:**

```openscad
armature(animations = [
  ["Spin", [
    ["Rotor", [[0.0, [0,0,0]], [1.0, [0,90,0]], [2.0, [0,180,0]]]]
  ]]
]) {
    bone(name="Rotor") {
        cylinder(h=5, r=10);
    }
}
```

_(For full syntax, see the [openscad-gltf-wasm](https://github.com/iliagrigorevdev/openscad-gltf-wasm))._

## Assets

- **Environment Map (HDR)**: [Aristea Wreck Puresky](https://polyhaven.com/a/aristea_wreck_puresky) by **Jarod Guest** via [Poly Haven](https://polyhaven.com/). Licensed under [CC0](https://polyhaven.com/license).

## 📜 License

Please see the `LICENSE` file for details. Note that the underlying OpenSCAD engine retains its GPL-2.0 (or later) licensing.
