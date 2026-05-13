import { generatePrompt } from "openscad-gltf-wasm/prompt";
import wasmUrl from "openscad-gltf-wasm/openscad.wasm?url";
import { processScad } from "openscad-gltf-bridge";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

// Import the default script from file as raw text (Vite feature)
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

let currentSelectedModelIdx = ""; // Track current selection for unsaved changes confirmation
let currentMesh = null;
let currentGltfData = null;
let currentAnimations = [];
let isCompiling = false;
let pendingCode = null;
let mixer = null;
let captureNextFrame = false;

// Track the baseline state loaded from the server to compute changes
let currentModelOriginalState = {
  isNew: true,
  options: { autoSmooth: true, creaseAngle: 30 },
  content: "",
};

function syncSmoothState() {
  creaseAngleIn.disabled = !autoSmoothCb.checked;
}

pathTracingCb.addEventListener("change", () => {
  if (pathTracingCb.checked && pathTracer) {
    pathTracer.setScene(scene, camera);
  }
});

// Force a re-compile if Auto Smooth changes
autoSmoothCb.addEventListener("change", () => {
  syncSmoothState();
  checkChanges();
  compileAndRender(editorEl.value || defaultScad);
});

creaseAngleIn.addEventListener("change", () => {
  checkChanges();
  if (autoSmoothCb.checked) {
    compileAndRender(editorEl.value || defaultScad);
  }
});
creaseAngleIn.addEventListener("input", checkChanges);
backendInputEl.addEventListener("input", checkChanges);

// --- Prompt Logic ---
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

// --- SCAD Compilation ---
async function compileAndRender(scadCode) {
  if (!scadCode) return;
  if (isCompiling) {
    pendingCode = scadCode;
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

    // Call the newly created Bridge library
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

renderBtn.onclick = () => compileAndRender(editorEl.value || defaultScad);

let renderTimeout;
editorEl.addEventListener("input", (e) => {
  checkChanges();
  clearTimeout(renderTimeout);
  if (!autoRenderCb.checked) {
    statusEl.innerText = "Changes pending (click Render)";
    return;
  }
  statusEl.innerText = "Waiting to compile...";
  renderTimeout = setTimeout(() => {
    compileAndRender(e.target.value || defaultScad);
  }, 800);
});

autoRenderCb.addEventListener("change", () => {
  if (autoRenderCb.checked) compileAndRender(editorEl.value || defaultScad);
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
  const codeToSave = editorEl.value || defaultScad;
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

// --- Share Logic ---
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
    console.warn("CompressionStream failed, falling back", e);
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

  if (!code || code === defaultScad.trim()) {
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
      await navigator.share({
        title: "OpenSCAD GLTF Viewer",
        url: finalUrl,
      });
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

// --- Drag and Drop SCAD ---
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
  // Restore current selection tracker
  backendSelectEl.value = currentSelectedModelIdx;
}

// Bundle parameters from the new UI explicitly for scad.config.json
function getBackendOptions() {
  const opts = {
    autoSmooth: autoSmoothCb.checked,
    creaseAngle: parseFloat(creaseAngleIn.value) || 30,
  };

  return opts;
}

// Helper to grab and clean up names from the inputs or dropdown
function getSanitizedNames() {
  let input = "";
  const idx = backendSelectEl.value;

  if (idx === "") {
    input = backendInputEl.value.trim();
  } else {
    input = serverConfig.assets[idx].input;
  }

  if (input)
    input = input
      .replace(/\.scad$/i, "")
      .split(/[/\\]/)
      .pop();

  return { input };
}

// Detect and dynamically expose Save Button variations
function checkChanges() {
  if (!serverConfig) return;

  const isNew = backendSelectEl.value === "";
  const input = getSanitizedNames().input;
  const currentOptions = getBackendOptions();
  const currentContent = editorEl.value || defaultScad;

  let scadChanged = false;
  let configChanged = false;

  if (isNew) {
    if (input) {
      scadChanged = true;
      configChanged = true;
    }
  } else {
    if (currentContent !== currentModelOriginalState.content) {
      scadChanged = true;
    }
    if (
      currentOptions.autoSmooth !==
        currentModelOriginalState.options.autoSmooth ||
      currentOptions.creaseAngle !==
        currentModelOriginalState.options.creaseAngle
    ) {
      configChanged = true;
    }
  }

  const hasChanges = scadChanged || configChanged;

  if (hasChanges) {
    backendSingleSaveBtn.style.display = "flex";
    backendSingleSaveBtn.dataset.scadChanged = scadChanged.toString();
    backendSingleSaveBtn.dataset.configChanged = configChanged.toString();

    if (scadChanged && configChanged) {
      backendSingleSaveBtn.innerText = "Save All";
    } else if (scadChanged) {
      backendSingleSaveBtn.innerText = "Save SCAD";
    } else if (configChanged) {
      backendSingleSaveBtn.innerText = "Save Config";
    }
  } else {
    backendSingleSaveBtn.style.display = "none";
  }
}

backendConnectBtn.onclick = async () => {
  const url = backendUrlEl.value.trim();
  if (!url) return;
  try {
    backendConnectBtn.innerText = "Connecting...";
    serverConfig = await fetchBackendConfig(url);
    currentBackendUrl = url;
    backendConnectBtn.innerText = "Connected";
    backendUiEl.classList.add("active");

    currentSelectedModelIdx = ""; // Reset on new connection
    renderBackendSelect();

    currentModelOriginalState = {
      isNew: true,
      options: getBackendOptions(),
      content: editorEl.value || defaultScad,
    };
    checkChanges();
  } catch (err) {
    alert("Connection failed: " + err.message);
    backendConnectBtn.innerText = "Connect";
    backendUiEl.classList.remove("active");
  }
};

// Update Config Parameters form when a new model is selected
backendSelectEl.addEventListener("change", async () => {
  // Check for unsaved changes before switching models
  const hasUnsavedChanges = backendSingleSaveBtn.style.display !== "none";
  if (hasUnsavedChanges) {
    const confirmDiscard = confirm(
      "You have unsaved changes. Are you sure you want to discard them and load another model?",
    );
    if (!confirmDiscard) {
      // Revert dropdown index to the tracked previous item
      backendSelectEl.value = currentSelectedModelIdx;
      return;
    }
  }

  const idx = backendSelectEl.value;
  currentSelectedModelIdx = idx;

  if (idx === "") {
    backendInputEl.value = "";
    backendInputEl.style.display = "block";

    // Reset configuration options to default

    autoSmoothCb.checked = true;
    creaseAngleIn.value = "30";

    currentModelOriginalState = {
      isNew: true,
      options: { autoSmooth: true, creaseAngle: 30 },
      content: editorEl.value || defaultScad,
    };
    checkChanges();
  } else {
    const asset = serverConfig.assets[idx];
    const input = asset.input;
    backendInputEl.value = input || "";
    backendInputEl.style.display = "none";

    // Fill custom parameter config
    const opts = asset.options || {};

    autoSmoothCb.checked = opts.autoSmooth !== false;
    creaseAngleIn.value =
      opts.creaseAngle !== undefined ? opts.creaseAngle : 30;

    // Automatically load the content
    try {
      statusEl.innerText = "Loading from server...";
      const res = await fetch(
        `${currentBackendUrl}/api/models?input=${encodeURIComponent(input)}`,
      );
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to load model");
      }
      const data = await res.json();
      editorEl.value = data.content;
      compileAndRender(data.content);

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

  const payload = {
    input,
    options: getBackendOptions(),
  };

  let method = "POST";
  if (scadChanged || isNew) {
    method = "POST";
    payload.content = editorEl.value || defaultScad;
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

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || "Save failed");
    }

    serverConfig = await fetchBackendConfig(currentBackendUrl);

    // Track newly saved index prior to re-rendering so it is correctly loaded into UI
    const newIdx = serverConfig.assets.findIndex((a) => a.input === input);
    if (newIdx >= 0) {
      currentSelectedModelIdx = newIdx.toString();
    } else {
      currentSelectedModelIdx = "";
    }

    renderBackendSelect();

    if (newIdx >= 0) {
      backendInputEl.style.display = "none";
    }

    currentModelOriginalState = {
      isNew: false,
      options: getBackendOptions(),
      content: editorEl.value || defaultScad,
    };
    checkChanges();
  } catch (err) {
    checkChanges(); // Reset text to correct changed state
    alert("Error: " + err.message);
  }
};

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

// --- GLTF Parsing & Rendering Logic ---
function rebuildSceneFromGLTF(gltfData) {
  return new Promise((resolve, reject) => {
    if (currentMesh) {
      if (mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(mixer.getRoot());
        mixer = null;
      }
      scene.remove(currentMesh);
      currentMesh.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else if (child.material) {
            child.material.dispose();
          }
        }
      });
      currentMesh = null;
    }

    // Parse the data directly
    let parseData = gltfData;
    if (gltfData instanceof Uint8Array) {
      // Convert Uint8Array to ArrayBuffer for the binary loader
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
          if (currentAnimations.length === 1) {
            mixer.clipAction(currentAnimations[0]).play();
          } else {
            let currentAnimIndex = 0;
            const playAnimationSequence = (index) => {
              const clip = currentAnimations[index];
              const action = mixer.clipAction(clip);
              action.reset();
              action.setLoop(THREE.LoopOnce);
              action.clampWhenFinished = true;
              action.play();
              if (statusEl) statusEl.innerText = `Playing: ${clip.name}`;
            };
            mixer.addEventListener("finished", () => {
              currentAnimIndex =
                (currentAnimIndex + 1) % currentAnimations.length;
              playAnimationSequence(currentAnimIndex);
            });
            playAnimationSequence(currentAnimIndex);
          }
        }

        // The bridge handled the smoothing. We only set up shadows.
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

  if (mixer && !pathTracingCb.checked) mixer.update(delta);
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
      if (decoded) {
        editorEl.value = decoded;
        checkChanges();
      }
    } catch (e) {
      console.error("Failed to decode SCAD from URL hash", e);
    }
  }

  if (!editorEl.value.trim()) {
    setTimeout(() => compileAndRender(defaultScad), 500);
  } else {
    setTimeout(() => compileAndRender(editorEl.value), 500);
  }
})();
