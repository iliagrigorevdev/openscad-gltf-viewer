import { generatePrompt } from "openscad-gltf-wasm/prompt";
import wasmUrl from "openscad-gltf-wasm/openscad.wasm?url";
import { processScad } from "openscad-gltf-bridge";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

import defaultScad from "./default.scad?raw";

// --- UI Elements ---
const promptDescEl = document.getElementById("prompt-desc");
const copyPromptBtn = document.getElementById("copy-prompt-btn");
const editorEl = document.getElementById("editor");
const renderBtn = document.getElementById("render-btn");
const loadScadBtn = document.getElementById("load-scad-btn");
const downloadScadBtn = document.getElementById("download-scad-btn");
const exportGltfBtn = document.getElementById("export-gltf-btn");
const captureImageBtn = document.getElementById("capture-image-btn");
const shareBtn = document.getElementById("share-btn");
const autoRenderCb = document.getElementById("auto-render-cb");
const autoSmoothCb = document.getElementById("auto-smooth-cb");
const creaseAngleIn = document.getElementById("crease-angle-in");
const pathTracingCb = document.getElementById("path-tracing-cb");

const statusEl = document.getElementById("status");
const viewerEl = document.getElementById("viewer");

const backendUrlEl = document.getElementById("backend-url");
const backendConnectBtn = document.getElementById("backend-connect-btn");
const backendUiEl = document.getElementById("backend-ui");
const backendSelectEl = document.getElementById("backend-select");
const backendInputEl = document.getElementById("backend-input");
const backendSingleSaveBtn = document.getElementById("backend-single-save-btn");

const animControlsSection = document.getElementById("anim-controls-section");
const animPlayBtn = document.getElementById("anim-play-btn");
const animSelect = document.getElementById("anim-select");
const animSlider = document.getElementById("anim-slider");

const levelEditorSection = document.getElementById("level-editor-section");
const levelSelect = document.getElementById("level-select");
const levelNameInput = document.getElementById("level-name-input");
const levelCreateBtn = document.getElementById("level-create-btn");
const levelSaveBtn = document.getElementById("level-save-btn");
const levelDeleteBtn = document.getElementById("level-delete-btn");
const levelObjectsContainer = document.getElementById(
  "level-objects-container",
);
const addLevelObjectBtn = document.getElementById("add-level-object-btn");
const levelObjectsList = document.getElementById("level-objects-list");

let currentSelectedModelIdx = "";
let currentMesh = null;
let currentGltfData = null;
let currentAnimations = [];
let isCompiling = false;
let pendingCode = null;
let mixer = null;
let captureNextFrame = false;

let isServerConnected = false;
let currentModelOriginalState = {
  isNew: true,
  options: { autoSmooth: true, creaseAngle: 30 },
  content: "",
};

// Level State
let currentLevelIdx = "";
let currentLevelData = null;
let levelObjectsMeshes = {}; // Maps path string "0-1-0" to THREE.Group
let assetCache = {}; // Caches the Parsed THREE.Scene (ready to be cloned)

let currentAction = null;
let isPlaying = true;
let isDraggingSlider = false;

function getEditorContent() {
  if (isServerConnected) return editorEl.value;
  return editorEl.value || defaultScad;
}

function syncSmoothState() {
  creaseAngleIn.disabled = !autoSmoothCb.checked;
}

pathTracingCb.addEventListener("change", () => {
  if (pathTracingCb.checked && pathTracer) {
    pathTracer.setScene(scene, camera);
  }
});

autoSmoothCb.addEventListener("change", () => {
  syncSmoothState();
  checkChanges();
  compileAndRender(getEditorContent());
});

creaseAngleIn.addEventListener("change", () => {
  checkChanges();
  if (autoSmoothCb.checked) compileAndRender(getEditorContent());
});
creaseAngleIn.addEventListener("input", checkChanges);
backendInputEl.addEventListener("input", checkChanges);

copyPromptBtn.onclick = async () => {
  const desc = promptDescEl.value.trim() || "an object";
  const options = {
    basic: document.getElementById("opt-pbr-basic").checked,
    transmission: document.getElementById("opt-pbr-transmission").checked,
    clearcoat: document.getElementById("opt-pbr-clearcoat").checked,
    sheen: document.getElementById("opt-pbr-sheen").checked,
    emissive: document.getElementById("opt-pbr-emissive").checked,
    specular: document.getElementById("opt-pbr-specular").checked,
    iridescence: document.getElementById("opt-pbr-iridescence").checked,
    animation: document.getElementById("opt-anim").checked,
  };
  const promptText = generatePrompt(desc, options);
  try {
    await navigator.clipboard.writeText(promptText);
    const originalText = copyPromptBtn.innerText;
    copyPromptBtn.innerText = "✅ Copied!";
    setTimeout(() => {
      copyPromptBtn.innerText = originalText;
    }, 2000);
  } catch (err) {
    alert("Failed to copy clipboard: " + err);
  }
};

async function compileAndRender(scadCode) {
  if (typeof scadCode !== "string") return;
  if (isCompiling) {
    pendingCode = scadCode;
    return;
  }
  if (scadCode.trim() === "") {
    clearCurrentMesh();
    statusEl.innerText = "Waiting for code...";
    return;
  }

  isCompiling = true;
  statusEl.innerText = "Compiling & Processing...";
  try {
    let creaseDeg = parseFloat(creaseAngleIn.value);
    if (isNaN(creaseDeg)) creaseDeg = 30;

    const opts = {
      wasmUrl: wasmUrl,
      autoSmooth: autoSmoothCb.checked,
      creaseAngle: creaseDeg,
    };
    currentGltfData = await processScad(scadCode, opts);

    statusEl.innerText = "Building Scene...";
    await rebuildSceneFromGLTF(currentGltfData);
    statusEl.innerText = "Rendering";
  } catch (e) {
    console.error(e);
    statusEl.innerText = "Compilation Error";
  } finally {
    isCompiling = false;
    if (pendingCode !== null) {
      const codeToCompile = pendingCode;
      pendingCode = null;
      compileAndRender(codeToCompile);
    }
  }
}

renderBtn.onclick = () => {
  if (levelSelect && levelSelect.value !== "" && levelSelect.value !== "new")
    return;
  compileAndRender(getEditorContent());
};

let renderTimeout;
editorEl.addEventListener("input", () => {
  checkChanges();
  clearTimeout(renderTimeout);
  if (!autoRenderCb.checked) {
    statusEl.innerText = "Changes pending (click Render)";
    return;
  }
  statusEl.innerText = "Waiting to compile...";
  renderTimeout = setTimeout(() => {
    compileAndRender(getEditorContent());
  }, 800);
});

autoRenderCb.addEventListener("change", () => {
  if (autoRenderCb.checked) compileAndRender(getEditorContent());
});

loadScadBtn.onclick = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".scad";
  input.onchange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      try {
        const text = await e.target.files[0].text();
        editorEl.value = text;
        checkChanges();
        compileAndRender(text);
      } catch (err) {
        alert("Failed to read file: " + err.message);
      }
    }
  };
  input.click();
};

downloadScadBtn.onclick = () => {
  const codeToSave = getEditorContent();
  downloadBlob(new Blob([codeToSave], { type: "text/plain" }), "model.scad");
};

exportGltfBtn.onclick = () => {
  if (!currentGltfData) return;
  downloadBlob(
    new Blob([currentGltfData], { type: "application/octet-stream" }),
    `model.glb`,
  );
};

captureImageBtn.onclick = () => {
  captureNextFrame = true;
};

function padBase64(str) {
  const mod = str.length % 4;
  if (mod === 2) return str + "==";
  if (mod === 3) return str + "=";
  return str;
}

async function encodeCode(code) {
  try {
    if (typeof CompressionStream !== "undefined") {
      const stream = new Blob([code])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw"));
      const buffer = await new Response(stream).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
      return (
        "c" +
        btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
      );
    }
  } catch (e) {
    console.warn("CompressionStream failed", e);
  }
  return (
    "u" +
    btoa(unescape(encodeURIComponent(code)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  );
}

async function decodeCode(hash) {
  const type = hash.charAt(0);
  let data = hash.substring(1);
  data = padBase64(data.replace(/-/g, "+").replace(/_/g, "/"));
  if (type === "c") {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(buffer);
  } else if (type === "u") {
    return decodeURIComponent(escape(atob(data)));
  } else {
    try {
      return decodeURIComponent(
        escape(atob(padBase64(hash.replace(/-/g, "+").replace(/_/g, "/")))),
      );
    } catch {
      return decodeURIComponent(hash);
    }
  }
}

shareBtn.onclick = async () => {
  const code = editorEl.value.trim();
  const url = new URL(window.location.href);
  let finalUrl = "";
  if (!code || (!isServerConnected && code === defaultScad.trim())) {
    finalUrl = url.origin + url.pathname + url.search;
  } else {
    try {
      const hash = await encodeCode(editorEl.value);
      url.hash = hash;
      finalUrl = url.toString();
    } catch (err) {
      finalUrl = url.origin + url.pathname + url.search;
    }
  }
  window.history.replaceState(null, "", finalUrl);
  try {
    if (navigator.share) {
      await navigator.share({ title: "OpenSCAD GLTF Viewer", url: finalUrl });
      const originalText = shareBtn.innerText;
      shareBtn.innerText = "✅ Shared!";
      setTimeout(() => (shareBtn.innerText = originalText), 2000);
    } else {
      await navigator.clipboard.writeText(finalUrl);
      const originalText = shareBtn.innerText;
      shareBtn.innerText = "✅ Copied Link!";
      setTimeout(() => (shareBtn.innerText = originalText), 2000);
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      try {
        await navigator.clipboard.writeText(finalUrl);
        shareBtn.innerText = "✅ Copied Link!";
        setTimeout(() => (shareBtn.innerText = "🔗 Share"), 2000);
      } catch (fallbackErr) {
        alert("Failed to share or copy link.");
      }
    }
  }
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const dragOverlay = document.getElementById("drag-overlay");
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragOverlay.classList.add("active");
});
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  dragOverlay.classList.add("active");
});
dragOverlay.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragOverlay.classList.remove("active");
});
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragOverlay.classList.remove("active");
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    if (
      file.name.toLowerCase().endsWith(".scad") ||
      !file.type ||
      file.type.includes("text")
    ) {
      try {
        const text = await file.text();
        editorEl.value = text;
        checkChanges();
        compileAndRender(text);
      } catch (err) {
        alert("Failed to read file: " + err.message);
      }
    } else {
      alert("Please drop a valid .scad file.");
    }
  }
});

// --- Backend Integration ---
let serverConfig = null;
let currentBackendUrl = "";

async function fetchBackendConfig(url) {
  const res = await fetch(`${url}/api/config`);
  if (!res.ok) throw new Error("Failed to fetch config");
  return await res.json();
}

function renderBackendSelect() {
  backendSelectEl.innerHTML =
    '<option value="">-- Create New Model --</option>';
  if (serverConfig && Array.isArray(serverConfig.assets)) {
    serverConfig.assets.forEach((asset, index) => {
      const opt = document.createElement("option");
      opt.value = index;
      opt.innerText = asset.input;
      backendSelectEl.appendChild(opt);
    });
  }
  backendSelectEl.value = currentSelectedModelIdx;
}

function getBackendOptions() {
  return {
    autoSmooth: autoSmoothCb.checked,
    creaseAngle: parseFloat(creaseAngleIn.value) || 30,
  };
}

function getSanitizedNames() {
  let input = "";
  const idx = backendSelectEl.value;
  if (idx === "") input = backendInputEl.value.trim();
  else input = serverConfig.assets[idx].input;
  if (input)
    input = input
      .replace(/\.scad$/i, "")
      .split(/[/\\]/)
      .pop();
  return { input };
}

function checkChanges() {
  if (!serverConfig) return;
  const isNew = backendSelectEl.value === "";
  const input = getSanitizedNames().input;
  const currentOptions = getBackendOptions();
  const currentContent = editorEl.value;

  let scadChanged = false;
  let configChanged = false;

  if (isNew) {
    if (input) {
      scadChanged = true;
      configChanged = true;
    }
  } else {
    if (currentContent !== currentModelOriginalState.content)
      scadChanged = true;
    if (
      currentOptions.autoSmooth !==
        currentModelOriginalState.options.autoSmooth ||
      currentOptions.creaseAngle !==
        currentModelOriginalState.options.creaseAngle
    )
      configChanged = true;
  }

  const hasChanges = scadChanged || configChanged;
  if (hasChanges) {
    backendSingleSaveBtn.style.display = "flex";
    backendSingleSaveBtn.dataset.scadChanged = scadChanged.toString();
    backendSingleSaveBtn.dataset.configChanged = configChanged.toString();

    if (scadChanged && configChanged)
      backendSingleSaveBtn.innerText = "Save All";
    else if (scadChanged) backendSingleSaveBtn.innerText = "Save SCAD";
    else if (configChanged) backendSingleSaveBtn.innerText = "Save Config";
  } else {
    backendSingleSaveBtn.style.display = "none";
  }
}

async function connectToServer(url, isAutoConnect = false) {
  if (!url) return false;
  try {
    backendConnectBtn.innerText = "Connecting...";
    serverConfig = await fetchBackendConfig(url);
    currentBackendUrl = url;
    isServerConnected = true;

    backendConnectBtn.innerText = "Connected";
    backendUiEl.classList.add("active");
    levelEditorSection.style.display = "flex";

    editorEl.placeholder = "";

    currentSelectedModelIdx = "";
    renderBackendSelect();

    currentLevelIdx = "";
    renderLevelSelect();

    if (!isAutoConnect || !editorEl.value.trim()) {
      editorEl.value = "";
    }

    currentModelOriginalState = {
      isNew: true,
      options: getBackendOptions(),
      content: "",
    };
    checkChanges();

    return true;
  } catch (err) {
    if (!isAutoConnect) alert("Connection failed: " + err.message);
    else console.warn("Auto-connect failed:", err.message);

    backendConnectBtn.innerText = "Connect";
    backendUiEl.classList.remove("active");
    levelEditorSection.style.display = "none";
    isServerConnected = false;
    editorEl.placeholder = defaultScad;

    return false;
  }
}

backendConnectBtn.onclick = async () => {
  const url = backendUrlEl.value.trim();
  const success = await connectToServer(url, false);
  if (success) compileAndRender(getEditorContent());
};

backendSelectEl.addEventListener("change", async () => {
  if (levelSelect.value !== "" && levelSelect.value !== "new") {
    if (levelSaveBtn.style.display !== "none") {
      if (
        !confirm(
          "You have unsaved changes in this level. Discard and switch to Model view?",
        )
      ) {
        backendSelectEl.value = currentSelectedModelIdx;
        return;
      }
    }
    levelSelect.value = "";
    currentLevelIdx = "";
    levelObjectsContainer.style.display = "none";
    levelCreateBtn.style.display = "inline-flex";
    levelNameInput.style.display = "none";
    levelDeleteBtn.style.display = "none";
    levelSaveBtn.style.display = "none";
    editorEl.disabled = false;
    editorEl.style.opacity = "1";
  }

  const hasUnsavedChanges = backendSingleSaveBtn.style.display !== "none";
  if (hasUnsavedChanges) {
    if (
      !confirm(
        "You have unsaved changes. Are you sure you want to discard them and load another model?",
      )
    ) {
      backendSelectEl.value = currentSelectedModelIdx;
      return;
    }
  }

  const idx = backendSelectEl.value;
  currentSelectedModelIdx = idx;

  if (idx === "") {
    backendInputEl.value = "";
    backendInputEl.style.display = "block";
    autoSmoothCb.checked = true;
    creaseAngleIn.value = "30";
    editorEl.value = "";
    compileAndRender(getEditorContent());
    currentModelOriginalState = {
      isNew: true,
      options: { autoSmooth: true, creaseAngle: 30 },
      content: "",
    };
    checkChanges();
  } else {
    const asset = serverConfig.assets[idx];
    const input = asset.input;
    backendInputEl.value = input || "";
    backendInputEl.style.display = "none";

    const opts = asset.options || {};
    autoSmoothCb.checked = opts.autoSmooth !== false;
    creaseAngleIn.value =
      opts.creaseAngle !== undefined ? opts.creaseAngle : 30;

    try {
      statusEl.innerText = "Loading from server...";
      const res = await fetch(
        `${currentBackendUrl}/api/models?input=${encodeURIComponent(input)}`,
      );
      if (!res.ok)
        throw new Error((await res.json()).error || "Failed to load model");
      const data = await res.json();
      editorEl.value = data.content;
      compileAndRender(getEditorContent());

      currentModelOriginalState = {
        isNew: false,
        options: {
          autoSmooth: autoSmoothCb.checked,
          creaseAngle: parseFloat(creaseAngleIn.value) || 30,
        },
        content: data.content,
      };
      checkChanges();
    } catch (err) {
      alert("Error loading model: " + err.message);
    }
  }
  syncSmoothState();
});

backendSingleSaveBtn.onclick = async () => {
  const { input } = getSanitizedNames();
  if (!input) return alert("Input name is required.");

  const scadChanged = backendSingleSaveBtn.dataset.scadChanged === "true";
  const isNew = backendSelectEl.value === "";

  const payload = { input, options: getBackendOptions() };
  let method = "POST";
  if (scadChanged || isNew) {
    method = "POST";
    payload.content = editorEl.value;
  } else {
    method = "PATCH";
  }

  try {
    backendSingleSaveBtn.innerText = "Saving...";
    const res = await fetch(`${currentBackendUrl}/api/models`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Save failed");

    if (assetCache[input]) delete assetCache[input]; // clear cache for level reloading

    serverConfig = await fetchBackendConfig(currentBackendUrl);

    const newIdx = serverConfig.assets.findIndex((a) => a.input === input);
    currentSelectedModelIdx = newIdx >= 0 ? newIdx.toString() : "";
    renderBackendSelect();

    if (newIdx >= 0) backendInputEl.style.display = "none";

    currentModelOriginalState = {
      isNew: false,
      options: getBackendOptions(),
      content: editorEl.value,
    };
    checkChanges();
  } catch (err) {
    checkChanges();
    alert("Error: " + err.message);
  }
};

// --- Level Hierarchy Logic ---

function renderLevelSelect() {
  levelSelect.innerHTML = '<option value="">-- No Level Selected --</option>';
  levelSelect.innerHTML += '<option value="new">+ Create New Level</option>';

  if (serverConfig && Array.isArray(serverConfig.levels)) {
    serverConfig.levels.forEach((lvl, index) => {
      const opt = document.createElement("option");
      opt.value = index;
      opt.innerText = lvl.name;
      levelSelect.appendChild(opt);
    });
  }
  levelSelect.value = currentLevelIdx;
}

function checkLevelChanges() {
  if (currentLevelIdx === "" || currentLevelIdx === "new") {
    levelSaveBtn.style.display = "none";
    return;
  }
  const original = serverConfig.levels[currentLevelIdx];
  if (JSON.stringify(original) !== JSON.stringify(currentLevelData)) {
    levelSaveBtn.style.display = "inline-flex";
  } else {
    levelSaveBtn.style.display = "none";
  }
}

async function saveConfigToServer() {
  try {
    const res = await fetch(`${currentBackendUrl}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serverConfig),
    });
    if (!res.ok) throw new Error("Failed to save config");
    serverConfig = (await res.json()).config;
  } catch (err) {
    alert("Error saving config: " + err.message);
  }
}

levelCreateBtn.addEventListener("click", async () => {
  let name = levelNameInput.value.trim();
  if (levelSelect.value !== "new" && !name) {
    levelSelect.value = "new";
    levelNameInput.style.display = "inline-flex";
    return;
  }
  if (!name) return alert("Please enter a level name.");

  serverConfig.levels = serverConfig.levels || [];
  serverConfig.levels.push({ name, objects: [] });

  await saveConfigToServer();

  currentLevelIdx = (serverConfig.levels.length - 1).toString();
  renderLevelSelect();
  levelSelect.dispatchEvent(new Event("change"));
});

levelDeleteBtn.addEventListener("click", async () => {
  if (!confirm("Are you sure you want to delete this level?")) return;
  serverConfig.levels.splice(currentLevelIdx, 1);
  await saveConfigToServer();
  currentLevelIdx = "";
  renderLevelSelect();
  levelSelect.dispatchEvent(new Event("change"));
});

levelSaveBtn.addEventListener("click", async () => {
  serverConfig.levels[currentLevelIdx] = JSON.parse(
    JSON.stringify(currentLevelData),
  );
  await saveConfigToServer();
  checkLevelChanges();
});

levelSelect.addEventListener("change", async () => {
  if (levelSaveBtn.style.display !== "none") {
    if (!confirm("You have unsaved changes in this level. Discard?")) {
      levelSelect.value = currentLevelIdx;
      return;
    }
  }

  if (levelSelect.value === "") {
    currentLevelIdx = "";
    levelObjectsContainer.style.display = "none";
    levelCreateBtn.style.display = "inline-flex";
    levelNameInput.style.display = "none";
    levelDeleteBtn.style.display = "none";
    levelSaveBtn.style.display = "none";
    editorEl.disabled = false;
    editorEl.style.opacity = "1";
    compileAndRender(getEditorContent());
    return;
  }

  if (levelSelect.value === "new") {
    currentLevelIdx = "new";
    levelObjectsContainer.style.display = "none";
    levelCreateBtn.style.display = "inline-flex";
    levelNameInput.style.display = "inline-flex";
    levelNameInput.value = "";
    levelDeleteBtn.style.display = "none";
    levelSaveBtn.style.display = "none";
    editorEl.disabled = false;
    editorEl.style.opacity = "1";
    return;
  }

  currentLevelIdx = levelSelect.value;
  levelObjectsContainer.style.display = "flex";
  levelCreateBtn.style.display = "none";
  levelNameInput.style.display = "none";
  levelDeleteBtn.style.display = "inline-flex";
  editorEl.disabled = true;
  editorEl.style.opacity = "0.5";

  currentLevelData = JSON.parse(
    JSON.stringify(serverConfig.levels[currentLevelIdx]),
  );

  renderLevelObjectsUI();
  await renderLevel();
  checkLevelChanges();
});

addLevelObjectBtn.addEventListener("click", () => {
  currentLevelData.objects.push({
    asset: "",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    children: [],
  });
  checkLevelChanges();
  renderLevelObjectsUI();
  renderLevel(); // Trigger a rebuild to spawn the empty group
});

// Recursive UI Builder for Level Objects Tree
function renderLevelObjectsUI() {
  levelObjectsList.innerHTML = "";

  const buildNodeUI = (obj, pathArray, container) => {
    const row = document.createElement("div");
    row.className = "level-object-row";

    const header = document.createElement("div");
    header.className = "level-object-header";

    const assetSelect = document.createElement("select");
    assetSelect.innerHTML = '<option value="">-- Empty Node --</option>';
    serverConfig.assets.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.input;
      opt.innerText = a.input;
      if (a.input === obj.asset) opt.selected = true;
      assetSelect.appendChild(opt);
    });

    assetSelect.addEventListener("change", (e) => {
      obj.asset = e.target.value;
      checkLevelChanges();
      renderLevel(); // Asset changes require full hierarchy rebuild
    });

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "level-object-actions";

    const addChildBtn = document.createElement("button");
    addChildBtn.innerText = "➕";
    addChildBtn.title = "Add Child Object";
    addChildBtn.onclick = () => {
      if (!obj.children) obj.children = [];
      obj.children.push({
        asset: "",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        children: [],
      });
      checkLevelChanges();
      renderLevelObjectsUI();
      renderLevel();
    };

    const delBtn = document.createElement("button");
    delBtn.innerText = "❌";
    delBtn.title = "Delete Object";
    delBtn.onclick = () => {
      // Find parent array and remove self
      if (pathArray.length === 1) {
        currentLevelData.objects.splice(pathArray[0], 1);
      } else {
        let parentArray = currentLevelData.objects;
        for (let i = 0; i < pathArray.length - 2; i++) {
          parentArray = parentArray[pathArray[i]].children;
        }
        parentArray[pathArray[pathArray.length - 2]].children.splice(
          pathArray[pathArray.length - 1],
          1,
        );
      }
      checkLevelChanges();
      renderLevelObjectsUI();
      renderLevel();
    };

    actionsDiv.appendChild(addChildBtn);
    actionsDiv.appendChild(delBtn);

    header.appendChild(assetSelect);
    header.appendChild(actionsDiv);
    row.appendChild(header);

    const createTransformRow = (label, arrKey) => {
      const tRow = document.createElement("div");
      tRow.className = "transform-row";
      const lbl = document.createElement("label");
      lbl.innerText = label;
      tRow.appendChild(lbl);

      const xyz = ["X", "Y", "Z"];
      xyz.forEach((axis, i) => {
        const inp = document.createElement("input");
        inp.type = "number";
        inp.step = arrKey === "scale" ? "0.1" : "1";
        inp.value = obj[arrKey][i];
        inp.placeholder = axis;
        inp.addEventListener("input", (e) => {
          obj[arrKey][i] = parseFloat(e.target.value) || 0;
          checkLevelChanges();
          updateLevelObjectTransform(pathArray.join("-"), obj);
        });
        tRow.appendChild(inp);
      });
      return tRow;
    };

    row.appendChild(createTransformRow("P", "position"));
    row.appendChild(createTransformRow("R", "rotation"));
    row.appendChild(createTransformRow("S", "scale"));

    container.appendChild(row);

    // Recursively render children
    if (obj.children && obj.children.length > 0) {
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "level-children-container";
      obj.children.forEach((child, idx) => {
        buildNodeUI(child, [...pathArray, idx], childrenContainer);
      });
      container.appendChild(childrenContainer);
    }
  };

  if (currentLevelData.objects) {
    currentLevelData.objects.forEach((obj, idx) => {
      buildNodeUI(obj, [idx], levelObjectsList);
    });
  }
}

// Transform Syncing for Hierarchy Nodes
function updateLevelObjectTransform(pathStr, objData) {
  const group = levelObjectsMeshes[pathStr];
  if (group) {
    group.position.set(
      objData.position[0],
      objData.position[1],
      objData.position[2],
    );
    group.rotation.set(
      THREE.MathUtils.degToRad(objData.rotation[0]),
      THREE.MathUtils.degToRad(objData.rotation[1]),
      THREE.MathUtils.degToRad(objData.rotation[2]),
    );
    group.scale.set(objData.scale[0], objData.scale[1], objData.scale[2]);

    if (pathTracingCb.checked && pathTracer) {
      pathTracer.setScene(scene, camera);
    }
  }
}

// Function to fetch, compile, and cache a single SCAD model as a parsed THREE.Scene
async function getOrBuildAsset(assetName) {
  if (assetCache[assetName]) return assetCache[assetName];

  statusEl.innerText = `Compiling ${assetName}...`;
  const res = await fetch(
    `${currentBackendUrl}/api/models?input=${encodeURIComponent(assetName)}`,
  );
  if (!res.ok) throw new Error("Fetch failed");
  const data = await res.json();

  const assetConfig = serverConfig.assets.find((a) => a.input === assetName);
  const opts = assetConfig?.options || {};

  const gltfBuffer = await processScad(data.content, {
    wasmUrl: wasmUrl,
    binary: true,
    autoSmooth: opts.autoSmooth !== false,
    creaseAngle: opts.creaseAngle !== undefined ? opts.creaseAngle : 30,
  });

  const parsedGltf = await new Promise((resolve, reject) => {
    let parseData = gltfBuffer;
    if (gltfBuffer instanceof Uint8Array) {
      parseData = gltfBuffer.buffer.slice(
        gltfBuffer.byteOffset,
        gltfBuffer.byteOffset + gltfBuffer.byteLength,
      );
    }
    new GLTFLoader().parse(parseData, "", resolve, reject);
  });

  const sourceMesh = parsedGltf.scene;
  sourceMesh.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  assetCache[assetName] = sourceMesh;
  return sourceMesh;
}

// Preload all unique assets required by a level tree
async function preloadLevelAssets(nodes) {
  for (let obj of nodes) {
    if (obj.asset && !assetCache[obj.asset]) {
      try {
        await getOrBuildAsset(obj.asset);
      } catch (e) {
        console.error(`Failed to load ${obj.asset}`, e);
      }
    }
    if (obj.children && obj.children.length > 0) {
      await preloadLevelAssets(obj.children);
    }
  }
}

// Recursively traverse JSON data and build equivalent Three.js Group Hierarchy
async function buildLevelTree(nodes, parentGroup, pathPrefix) {
  for (let i = 0; i < nodes.length; i++) {
    const obj = nodes[i];
    const currentPath = [...pathPrefix, i].join("-");

    // Group creates the pivot and applies transforms for this node and its children
    const group = new THREE.Group();
    group.position.set(obj.position[0], obj.position[1], obj.position[2]);
    group.rotation.set(
      THREE.MathUtils.degToRad(obj.rotation[0]),
      THREE.MathUtils.degToRad(obj.rotation[1]),
      THREE.MathUtils.degToRad(obj.rotation[2]),
    );
    group.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);

    if (obj.asset && assetCache[obj.asset]) {
      const meshClone = assetCache[obj.asset].clone(); // Deep clone the cached scene graph
      group.add(meshClone);
    }

    levelObjectsMeshes[currentPath] = group;
    parentGroup.add(group);

    if (obj.children && obj.children.length > 0) {
      await buildLevelTree(obj.children, group, [...pathPrefix, i]);
    }
  }
}

async function renderLevel() {
  clearCurrentMesh();
  levelObjectsMeshes = {};

  if (
    !currentLevelData ||
    !currentLevelData.objects ||
    currentLevelData.objects.length === 0
  ) {
    statusEl.innerText = "Empty Level";
    return;
  }

  // 1. Gather & build any uncached SCAD models first so ThreeJS build is synchronous and fast
  await preloadLevelAssets(currentLevelData.objects);

  // 2. Build the actual Scene Graph
  statusEl.innerText = "Building Level Tree...";
  const sceneGroup = new THREE.Group();
  await buildLevelTree(currentLevelData.objects, sceneGroup, []);

  animControlsSection.style.display = "none";
  currentAction = null;

  currentMesh = sceneGroup;
  scene.add(currentMesh);
  fitCamera();
  statusEl.innerText = `Level: ${currentLevelData.name}`;
}

// --- Three.js Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  viewerEl.clientWidth / viewerEl.clientHeight,
  0.1,
  2000,
);
camera.position.set(50, 50, 50);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
viewerEl.appendChild(renderer.domElement);

const pathTracer = new WebGLPathTracer(renderer);
pathTracer.bounces = 10;
pathTracer.transmissiveBounces = 10;
pathTracer.multipleImportanceSampling = true;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.maxDistance = 2000;
controls.addEventListener("change", () => pathTracer.updateCamera());

new HDRLoader().load(
  "./aristea_wreck_puresky_2k.hdr",
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
    pathTracer.setScene(scene, camera);
    pathTracer.updateCamera();
  },
  undefined,
  (err) => console.error("Error loading HDR:", err),
);

const lightGroup = new THREE.Group();
scene.add(lightGroup);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
lightGroup.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.bias = -0.0005;
lightGroup.add(dirLight);
lightGroup.add(dirLight.target);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.8,
    metalness: 0.1,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

pathTracer.setScene(scene, camera);

// --- Animation Controls ---
function playAnimation(index) {
  if (!mixer || !currentAnimations[index]) return;
  if (currentAction) currentAction.stop();
  const clip = currentAnimations[index];
  currentAction = mixer.clipAction(clip);
  currentAction.play();
  isPlaying = true;
  currentAction.paused = false;
  animPlayBtn.innerText = "⏸ Pause";
  animSlider.value = 0;
  if (statusEl)
    statusEl.innerText = `Playing: ${clip.name || `Animation ${index + 1}`}`;
}

animSelect.addEventListener("change", (e) => {
  playAnimation(parseInt(e.target.value));
});
animPlayBtn.addEventListener("click", () => {
  if (!currentAction) return;
  isPlaying = !isPlaying;
  currentAction.paused = !isPlaying;
  animPlayBtn.innerText = isPlaying ? "⏸ Pause" : "▶ Play";
});

animSlider.addEventListener("mousedown", () => {
  isDraggingSlider = true;
});
animSlider.addEventListener("mouseup", () => {
  isDraggingSlider = false;
});
animSlider.addEventListener(
  "touchstart",
  () => {
    isDraggingSlider = true;
  },
  { passive: true },
);
animSlider.addEventListener(
  "touchend",
  () => {
    isDraggingSlider = false;
  },
  { passive: true },
);

animSlider.addEventListener("input", (e) => {
  if (currentAction) {
    const duration = currentAction.getClip().duration;
    currentAction.time = parseFloat(e.target.value) * duration;
    if (mixer) {
      mixer.update(0);
      if (pathTracingCb.checked && pathTracer)
        pathTracer.setScene(scene, camera);
    }
  }
});

// --- GLTF Parsing & Rendering Logic ---
function clearCurrentMesh() {
  if (currentMesh) {
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixer.getRoot());
      mixer = null;
    }
    currentAction = null;
    scene.remove(currentMesh);
    // Be careful disposing geometry/materials when using Cloned assets in levels,
    // they share geometries in assetCache! Only clear if not using level cache.
    if (levelSelect.value === "" || levelSelect.value === "new") {
      currentMesh.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material))
            child.material.forEach((m) => m.dispose());
          else if (child.material) child.material.dispose();
        }
      });
    }
    currentMesh = null;
  }
}

function rebuildSceneFromGLTF(gltfData) {
  return new Promise((resolve, reject) => {
    clearCurrentMesh();
    let parseData = gltfData;
    if (gltfData instanceof Uint8Array) {
      parseData = gltfData.buffer.slice(
        gltfData.byteOffset,
        gltfData.byteOffset + gltfData.byteLength,
      );
    }

    new GLTFLoader().parse(
      parseData,
      "",
      (gltf) => {
        currentMesh = gltf.scene;
        currentAnimations = gltf.animations || [];

        if (currentAnimations.length) {
          mixer = new THREE.AnimationMixer(currentMesh);
          animControlsSection.style.display = "flex";
          animSelect.innerHTML = "";
          currentAnimations.forEach((clip, i) => {
            const opt = document.createElement("option");
            opt.value = i;
            opt.innerText = clip.name || `Animation ${i + 1}`;
            animSelect.appendChild(opt);
          });
          playAnimation(0);
        } else {
          animControlsSection.style.display = "none";
          currentAction = null;
        }

        currentMesh.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        scene.add(currentMesh);
        fitCamera();
        resolve();
      },
      reject,
    );
  });
}

function fitCamera() {
  if (!currentMesh) return;
  const worldBox = new THREE.Box3().setFromObject(currentMesh);
  if (worldBox.isEmpty()) return;

  const center = worldBox.getCenter(new THREE.Vector3());
  const size = worldBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 10;

  floor.position.y = worldBox.min.y - 0.01;

  const fov = camera.fov * (Math.PI / 180);
  let distance = maxDim / (2 * Math.tan(fov / 2));
  if (camera.aspect < 1) distance /= camera.aspect;

  distance *= 1.5;

  camera.position.set(
    center.x + distance * 0.8,
    center.y + distance * 0.8,
    center.z + distance * 0.8,
  );
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();

  dirLight.position.set(
    center.x + maxDim,
    center.y + maxDim * 1.5,
    center.z + maxDim,
  );
  dirLight.target.position.copy(center);
  dirLight.target.updateMatrixWorld();

  const shadowCamSize = maxDim * 1.5;
  dirLight.shadow.camera.left = -shadowCamSize;
  dirLight.shadow.camera.right = shadowCamSize;
  dirLight.shadow.camera.top = shadowCamSize;
  dirLight.shadow.camera.bottom = -shadowCamSize;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = maxDim * 5;
  dirLight.shadow.camera.updateProjectionMatrix();

  lightGroup.visible = !pathTracingCb.checked;
  pathTracer.setScene(scene, camera);
}

// Animation loop
let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const delta = (now - lastTime) / 1000;
  lastTime = now;

  if (mixer && !pathTracingCb.checked) {
    mixer.update(delta);
    if (currentAction && isPlaying && !isDraggingSlider) {
      const duration = currentAction.getClip().duration;
      if (duration > 0) {
        let currentClipTime = currentAction.time % duration;
        if (currentClipTime < 0) currentClipTime += duration;
        animSlider.value = currentClipTime / duration;
      }
    }
  }

  controls.update();

  if (pathTracingCb.checked) {
    lightGroup.visible = false;
    pathTracer.renderSample();
  } else {
    lightGroup.visible = true;
    renderer.render(scene, camera);
  }

  if (captureNextFrame) {
    captureNextFrame = false;
    renderer.domElement.toBlob((blob) => {
      if (blob) downloadBlob(blob, "render.png");
    }, "image/png");
  }
}
animate();

window.addEventListener("resize", () => {
  if (!viewerEl) return;
  const w = viewerEl.clientWidth;
  const h = viewerEl.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  pathTracer.updateCamera();
});
setTimeout(() => window.dispatchEvent(new Event("resize")), 100);

editorEl.placeholder = defaultScad;

(async function init() {
  if (window.location.hash && window.location.hash.length > 1) {
    try {
      const hash = window.location.hash.substring(1);
      const decoded = await decodeCode(hash);
      if (decoded) editorEl.value = decoded;
    } catch (e) {
      console.error("Failed to decode SCAD from URL hash", e);
    }
  }

  const isLocal = ["localhost", "127.0.0.1", ""].includes(
    window.location.hostname,
  );
  if (isLocal) {
    const url = backendUrlEl.value.trim();
    await connectToServer(url, true);
  }

  checkChanges();
  setTimeout(() => compileAndRender(getEditorContent()), 500);
})();
