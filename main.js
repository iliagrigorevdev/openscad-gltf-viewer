import { convertScadToGltf } from "openscad-gltf-wasm/convert";
import { generatePrompt } from "openscad-gltf-wasm/prompt";
import wasmUrl from "openscad-gltf-wasm/openscad.wasm?url";
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
const autoRenderCb = document.getElementById("auto-render-cb");
const autoSmoothCb = document.getElementById("auto-smooth-cb");
const pathTracingCb = document.getElementById("path-tracing-cb");
const statusEl = document.getElementById("status");
const viewerEl = document.getElementById("viewer");

let currentMesh = null;
let currentGltfData = null;
let isCompiling = false;
let pendingCode = null;
let mixer = null;
let captureNextFrame = false;

pathTracingCb.addEventListener("change", () => {
  if (pathTracingCb.checked && pathTracer) {
    // Rebuild the BVH and refresh the scene graph to match the current animation frame
    pathTracer.setScene(scene, camera);
  }
});

autoSmoothCb.addEventListener("change", () => {
  if (currentGltfData) {
    statusEl.innerText = "Building BVH & Scene...";
    // setTimeout defers the thread block allowing the UI to repaint the status first
    setTimeout(async () => {
      try {
        await rebuildSceneFromGLTF(currentGltfData);
        statusEl.innerText = "Rendering";
      } catch (e) {
        console.error(e);
        statusEl.innerText = "Error Rendering";
      }
    }, 10);
  }
});

// --- Prompt Logic ---
copyPromptBtn.onclick = async () => {
  const desc = promptDescEl.value.trim() || "an object";
  // Generated using the new JavaScript module export
  const promptText = generatePrompt(desc);

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
  statusEl.innerText = "Compiling WASM...";

  try {
    currentGltfData = await convertScadToGltf(scadCode, wasmUrl);
    statusEl.innerText = "Building BVH & Scene...";
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

// Fallback to the defaultScad if the editor is empty
renderBtn.onclick = () => compileAndRender(editorEl.value || defaultScad);

// Editor Auto-Render Debounce
let renderTimeout;
editorEl.addEventListener("input", (e) => {
  clearTimeout(renderTimeout);
  if (!autoRenderCb.checked) {
    statusEl.innerText = "Changes pending (click Render)";
    return;
  }
  statusEl.innerText = "Waiting to compile...";
  renderTimeout = setTimeout(() => {
    // Fallback to the defaultScad if the user clears the editor
    compileAndRender(e.target.value || defaultScad);
  }, 800);
});

autoRenderCb.addEventListener("change", () => {
  if (autoRenderCb.checked) {
    compileAndRender(editorEl.value || defaultScad);
  }
});

loadScadBtn.onclick = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".scad";
  input.onchange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      try {
        const text = await file.text();
        editorEl.value = text;
        compileAndRender(text);
      } catch (err) {
        console.error("Failed to read file", err);
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
    "model.glb",
  );
};

captureImageBtn.onclick = () => {
  captureNextFrame = true;
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

    // Check for scad extension or text fallback
    if (
      file.name.toLowerCase().endsWith(".scad") ||
      !file.type ||
      file.type.includes("text")
    ) {
      try {
        const text = await file.text();
        editorEl.value = text;
        compileAndRender(text);
      } catch (err) {
        console.error("Failed to read file", err);
        alert("Failed to read file: " + err.message);
      }
    } else {
      alert("Please drop a valid .scad file.");
    }
  }
});

// --- Three.js Setup ---
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x8899aa, 200, 1000);

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

// Environment & Lights (Updated to load local HDR)
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
  new THREE.PlaneGeometry(10000, 10000),
  new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.8,
    metalness: 0.1,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Initial empty setup
pathTracer.setScene(scene, camera);

// --- Auto Smooth Logic ---
function computeSmoothNormals(positions, creaseAngle = Math.PI / 4) {
  const hashToVertices = new Map();
  const vertexNormals = new Float32Array(positions.length);

  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i],
      ay = positions[i + 1],
      az = positions[i + 2];
    const bx = positions[i + 3],
      by = positions[i + 4],
      bz = positions[i + 5];
    const cx = positions[i + 6],
      cy = positions[i + 7],
      cz = positions[i + 8];

    const cbx = cx - bx,
      cby = cy - by,
      cbz = cz - bz;
    const abx = ax - bx,
      aby = ay - by,
      abz = az - bz;

    const nx = cby * abz - cbz * aby;
    const ny = cbz * abx - cbx * abz;
    const nz = cbx * aby - cby * abx;

    let len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len === 0) len = 1;
    const normal = { x: nx / len, y: ny / len, z: nz / len };

    for (let j = 0; j < 3; j++) {
      const vIdx = i + j * 3;
      const x = positions[vIdx];
      const y = positions[vIdx + 1];
      const z = positions[vIdx + 2];
      const hash = `${Math.round(x * 1e4)}_${Math.round(y * 1e4)}_${Math.round(z * 1e4)}`;

      let list = hashToVertices.get(hash);
      if (!list) {
        list = [];
        hashToVertices.set(hash, list);
      }
      list.push({ index: vIdx, faceNormal: normal });
    }
  }

  const cosAngle = Math.cos(creaseAngle);

  for (const list of hashToVertices.values()) {
    const adj = Array.from({ length: list.length }, () => []);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const dot =
          list[i].faceNormal.x * list[j].faceNormal.x +
          list[i].faceNormal.y * list[j].faceNormal.y +
          list[i].faceNormal.z * list[j].faceNormal.z;
        if (dot >= cosAngle - 0.0001) {
          adj[i].push(j);
          adj[j].push(i);
        }
      }
    }

    const visited = new Array(list.length).fill(false);
    for (let i = 0; i < list.length; i++) {
      if (!visited[i]) {
        const component = [];
        const q = [i];
        visited[i] = true;
        while (q.length > 0) {
          const curr = q.shift();
          component.push(curr);
          for (const neighbor of adj[curr]) {
            if (!visited[neighbor]) {
              visited[neighbor] = true;
              q.push(neighbor);
            }
          }
        }

        let nx = 0,
          ny = 0,
          nz = 0;
        for (const idx of component) {
          nx += list[idx].faceNormal.x;
          ny += list[idx].faceNormal.y;
          nz += list[idx].faceNormal.z;
        }
        let len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len === 0) len = 1;

        nx /= len;
        ny /= len;
        nz /= len;

        for (const idx of component) {
          const v = list[idx];
          vertexNormals[v.index] = nx;
          vertexNormals[v.index + 1] = ny;
          vertexNormals[v.index + 2] = nz;
        }
      }
    }
  }

  return vertexNormals;
}

function autoSmoothGeometry(geometry) {
  const nonIndexed = geometry.index
    ? geometry.toNonIndexed()
    : geometry.clone();
  const positions = nonIndexed.attributes.position.array;

  const hasColor = nonIndexed.attributes.color !== undefined;
  const colors = hasColor ? nonIndexed.attributes.color.array : null;

  const hasSkinIndex = nonIndexed.attributes.skinIndex !== undefined;
  const skinIndices = hasSkinIndex
    ? nonIndexed.attributes.skinIndex.array
    : null;

  const hasSkinWeight = nonIndexed.attributes.skinWeight !== undefined;
  const skinWeights = hasSkinWeight
    ? nonIndexed.attributes.skinWeight.array
    : null;

  const normals = computeSmoothNormals(positions, Math.PI / 6);

  const weldedPositions = [];
  const weldedColors = [];
  const weldedNormals = [];
  const weldedSkinIndices = [];
  const weldedSkinWeights = [];
  const indices = [];
  const vertexHash = new Map();
  let nextVertexIndex = 0;

  for (let i = 0; i < positions.length / 3; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];

    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];

    let r = 0,
      g = 0,
      b = 0;
    if (hasColor) {
      r = colors[i * 3];
      g = colors[i * 3 + 1];
      b = colors[i * 3 + 2];
    }

    let si0 = 0,
      si1 = 0,
      si2 = 0,
      si3 = 0;
    if (hasSkinIndex) {
      si0 = skinIndices[i * 4];
      si1 = skinIndices[i * 4 + 1];
      si2 = skinIndices[i * 4 + 2];
      si3 = skinIndices[i * 4 + 3];
    }

    let sw0 = 0,
      sw1 = 0,
      sw2 = 0,
      sw3 = 0;
    if (hasSkinWeight) {
      sw0 = skinWeights[i * 4];
      sw1 = skinWeights[i * 4 + 1];
      sw2 = skinWeights[i * 4 + 2];
      sw3 = skinWeights[i * 4 + 3];
    }

    const hx = Math.round(px * 1e4);
    const hy = Math.round(py * 1e4);
    const hz = Math.round(pz * 1e4);
    const hnx = Math.round(nx * 1e4);
    const hny = Math.round(ny * 1e4);
    const hnz = Math.round(nz * 1e4);

    let hash = `${hx}_${hy}_${hz}_${hnx}_${hny}_${hnz}`;
    if (hasColor) {
      const hr = Math.round(r * 1e4);
      const hg = Math.round(g * 1e4);
      const hb = Math.round(b * 1e4);
      hash += `_${hr}_${hg}_${hb}`;
    }
    if (hasSkinIndex) {
      hash += `_${si0}_${si1}_${si2}_${si3}`;
    }
    if (hasSkinWeight) {
      const hw0 = Math.round(sw0 * 1e3);
      const hw1 = Math.round(sw1 * 1e3);
      const hw2 = Math.round(sw2 * 1e3);
      const hw3 = Math.round(sw3 * 1e3);
      hash += `_${hw0}_${hw1}_${hw2}_${hw3}`;
    }

    let idx = vertexHash.get(hash);
    if (idx === undefined) {
      idx = nextVertexIndex++;
      vertexHash.set(hash, idx);
      weldedPositions.push(px, py, pz);
      if (hasColor) weldedColors.push(r, g, b);
      weldedNormals.push(nx, ny, nz);
      if (hasSkinIndex) weldedSkinIndices.push(si0, si1, si2, si3);
      if (hasSkinWeight) weldedSkinWeights.push(sw0, sw1, sw2, sw3);
    }
    indices.push(idx);
  }

  const newGeometry = new THREE.BufferGeometry();
  newGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(weldedPositions, 3),
  );
  if (hasColor) {
    newGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(weldedColors, 3),
    );
  }
  newGeometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(weldedNormals, 3),
  );
  if (hasSkinIndex) {
    newGeometry.setAttribute(
      "skinIndex",
      new THREE.Uint16BufferAttribute(weldedSkinIndices, 4),
    );
  }
  if (hasSkinWeight) {
    newGeometry.setAttribute(
      "skinWeight",
      new THREE.Float32BufferAttribute(weldedSkinWeights, 4),
    );
  }

  newGeometry.setIndex(indices);

  if (nonIndexed.groups && nonIndexed.groups.length > 0) {
    for (const g of nonIndexed.groups) {
      newGeometry.addGroup(g.start, g.count, g.materialIndex);
    }
  }

  nonIndexed.dispose();

  return newGeometry;
}

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

    const loader = new GLTFLoader();
    const arrayBuffer = gltfData.buffer.slice(
      gltfData.byteOffset,
      gltfData.byteOffset + gltfData.byteLength,
    );

    loader.parse(
      arrayBuffer,
      "",
      (gltf) => {
        currentMesh = gltf.scene;

        if (gltf.animations?.length) {
          mixer = new THREE.AnimationMixer(currentMesh);
          gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
        }

        currentMesh.traverse((child) => {
          if (child.isMesh) {
            if (autoSmoothCb.checked && child.geometry) {
              const oldGeom = child.geometry;
              child.geometry = autoSmoothGeometry(oldGeom);
              oldGeom.dispose();

              if (child.material) {
                const makeSmooth = (m) => {
                  m.flatShading = false;
                  m.needsUpdate = true;
                };
                if (Array.isArray(child.material)) {
                  child.material.forEach(makeSmooth);
                } else {
                  makeSmooth(child.material);
                }
              }
            }
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

  // Drop the floor slightly below the object bounds to prevent Z-fighting
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

  // Adjust directional light to cover the object dynamically
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

  // Send the updated geometry scene to the GPU path tracer (generates BVH and resets accumulation)
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

  // Pause animation while path tracing to correctly accumulate over the frozen geometry
  if (mixer && !pathTracingCb.checked) mixer.update(delta);
  controls.update();

  if (pathTracingCb.checked) {
    lightGroup.visible = false;
    pathTracer.renderSample();
  } else {
    lightGroup.visible = true;
    renderer.render(scene, camera);
  }

  // Capture frame buffer immediately after rendering
  if (captureNextFrame) {
    captureNextFrame = false;
    // Using toBlob is more efficient for high-res images than toDataURL
    renderer.domElement.toBlob((blob) => {
      if (blob) downloadBlob(blob, "render.png");
    }, "image/png");
  }
}
animate();

// Resize handler
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

// --- Initialization ---
// Display the script as a hint, leaving the text field functionally empty
editorEl.placeholder = defaultScad;

if (!editorEl.value.trim()) {
  // Trigger initial compile after a brief delay to ensure WASM loads smoothly
  setTimeout(() => compileAndRender(defaultScad), 500);
}
