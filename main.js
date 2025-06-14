import WindowManager from './WindowManager.js';
import GPUComputationRenderer from './GPUComputationRenderer.js';
import { createColorShader } from './computeShader.js';
import { createSubCubeMaterial, createCubeMaterial } from './materials.js';
import { generateSymbol, getSubCubeSymbol, getRowColLayerFromSymbol, orderSubCubes } from './symbolUtils.js';
import { openDB, saveCube, loadCubes, saveSubCube, loadSubCubes, saveVertex, loadVertices, deleteSubCubesByCube, deleteVerticesByCube, deleteCube, deleteWindowData, cleanupStaleWindows } from './db.js';
import { blendVertices } from './subcubeBlending.js';
import { verticesToMatrix, matrixToVertices, saveMatrixToStorage, loadMatrixFromStorage } from './subpixelMatrix.js';

let t = THREE;
let camera, scene, renderer, world;
let near, far;
let pixR = window.devicePixelRatio ? window.devicePixelRatio : 1;
let cubes = [];
let gui;
let thisWindowId;
let gpu;
let colorVar;
let colorTexSize = { x: 1, y: 1 };
let colorTexture;
let db;
let cubeControls = {
    width: 150,
    height: 150,
    depth: 150,
    subDepth: 2,
    rows: 2,
    columns: 2,
    posX: 0,
    posY: 0,
    velocityX: 0,
    velocityY: 0,
    color: '#ff0000',
    subColor: '#ff0000',
    matchDepth: false,
    animate: true,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    selRow: 0,
    selCol: 0,
    selLayer: 0,
    selColor: '#ff0000',
    selWeight: 1
};

let globalSettings = {
    animate: cubeControls.animate,
    rotX: cubeControls.rotX,
    rotY: cubeControls.rotY,
    rotZ: cubeControls.rotZ
};

function indexToCoord(index, count) {
    let half = (count - 1) / 2;
    return index - half;
}

function coordToIndex(coord, count) {
    let half = (count - 1) / 2;
    let idx = Math.round(coord + half);
    if (idx < 0) idx = 0;
    if (idx > count - 1) idx = count - 1;
    return idx;
}

function createLineCubeGeometry(w, h, d) {
    let hw = w / 2;
    let hh = h / 2;
    let hd = d / 2;
    let corners = [
        new t.Vector3(-hw, -hh, -hd),
        new t.Vector3(hw, -hh, -hd),
        new t.Vector3(hw, hh, -hd),
        new t.Vector3(-hw, hh, -hd),
        new t.Vector3(-hw, -hh, hd),
        new t.Vector3(hw, -hh, hd),
        new t.Vector3(hw, hh, hd),
        new t.Vector3(-hw, hh, hd)
    ];
    let edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    let path = new t.CurvePath();
    let lineVerts = [];
    for (let i = 0; i < edges.length; i++) {
        let a = edges[i][0];
        let b = edges[i][1];
        path.add(new t.LineCurve3(corners[a], corners[b]));
        lineVerts.push(corners[a].x, corners[a].y, corners[a].z);
        lineVerts.push(corners[b].x, corners[b].y, corners[b].z);
    }
    let pointVerts = [];
    for (let i = 0; i < corners.length; i++) {
        pointVerts.push(corners[i].x, corners[i].y, corners[i].z);
    }
    let lineGeom = new t.BufferGeometry();
    lineGeom.setAttribute('position', new t.Float32BufferAttribute(lineVerts, 3));
    let pointGeom = new t.BufferGeometry();
    pointGeom.setAttribute('position', new t.Float32BufferAttribute(pointVerts, 3));
    return { lineGeom, pointGeom, path };
}

let sceneOffsetTarget = { x: 0, y: 0 };
let sceneOffset = { x: 0, y: 0 };

let today = new Date();
today.setHours(0);
today.setMinutes(0);
today.setSeconds(0);
today.setMilliseconds(0);
today = today.getTime();

let internalTime = getTime();
let windowManager;
let initialized = false;

function loadGlobalSettings() {
    let stored = localStorage.getItem(`settings_${thisWindowId}`);
    if (stored) {
        try {
            let obj = JSON.parse(stored);
            if (typeof obj.animate === 'boolean') globalSettings.animate = obj.animate;
            if (typeof obj.rotX === 'number') globalSettings.rotX = obj.rotX;
            if (typeof obj.rotY === 'number') globalSettings.rotY = obj.rotY;
            if (typeof obj.rotZ === 'number') globalSettings.rotZ = obj.rotZ;
        } catch (e) {}
    }
    cubeControls.animate = globalSettings.animate;
    cubeControls.rotX = globalSettings.rotX;
    cubeControls.rotY = globalSettings.rotY;
    cubeControls.rotZ = globalSettings.rotZ;
}

function saveGlobalSettings() {
    globalSettings.animate = cubeControls.animate;
    globalSettings.rotX = cubeControls.rotX;
    globalSettings.rotY = cubeControls.rotY;
    globalSettings.rotZ = cubeControls.rotZ;
    localStorage.setItem(`settings_${thisWindowId}`, JSON.stringify(globalSettings));
}

function getTime() {
    return (new Date().getTime() - today) / 1000.0;
}

if (new URLSearchParams(window.location.search).get("clear")) {
    localStorage.clear();
} else {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== 'hidden' && !initialized) {
            init();
        }
    });

    window.addEventListener('storage', (e) => {
        if (e.key === `settings_${thisWindowId}` && e.newValue) {
            try {
                let obj = JSON.parse(e.newValue);
                globalSettings = Object.assign(globalSettings, obj);
                cubeControls.animate = globalSettings.animate;
                cubeControls.rotX = globalSettings.rotX;
                cubeControls.rotY = globalSettings.rotY;
                cubeControls.rotZ = globalSettings.rotZ;
                updateAnimButton();
            } catch (_) {}
        } else if (e.key && e.key.startsWith('subMatrix_')) {
            const [, cubeId, subId] = e.key.split('_');
            applyMatrixFromStorage(cubeId, subId);
        }
    });

    window.onload = () => {
        if (document.visibilityState !== 'hidden') {
            init();
        }
    };

    async function init() {
        initialized = true;

        setTimeout(async () => {
            setupWindowManager();
            try {
                db = await openDB();
                await cleanupStaleWindows(db, windowManager.getWindows().map(w => w.id));
                window.addEventListener("beforeunload", () => { if (db) deleteWindowData(db, windowManager.getThisWindowID()); });
            } catch (err) {
                console.error('IndexedDB init failed', err);
            }
            loadGlobalSettings();
            updateAnimButton();
            windowManager.getThisWindowData().metaData.animate = cubeControls.animate;
            windowManager.getThisWindowData().metaData.rotX = cubeControls.rotX;
            windowManager.getThisWindowData().metaData.rotY = cubeControls.rotY;
            windowManager.getThisWindowData().metaData.rotZ = cubeControls.rotZ;
            windowManager.updateWindowsLocalStorage();
            setupScene();
            setupGUI();
            setupControls();
            await windowsUpdated();
            if (db) await loadIndexedData();
            resize();
            updateWindowShape(false);
            render();
            window.addEventListener('resize', resize);
        }, 500);
    }

    function setupScene() {
        camera = new t.OrthographicCamera(0, 0, window.innerWidth, window.innerHeight, -10000, 10000);
        camera.position.z = 2.5;
        near = camera.position.z - 0.5;
        far = camera.position.z + 0.5;

        scene = new t.Scene();
        scene.background = new t.Color(0.0);
        scene.add(camera);

        renderer = new t.WebGLRenderer({ antialias: true, depthBuffer: true });
        renderer.setPixelRatio(pixR);

        world = new t.Object3D();
        scene.add(world);

        renderer.domElement.setAttribute("id", "scene");
        document.body.appendChild(renderer.domElement);
    }

    function initGPU(count) {
        let needed = Math.ceil(Math.sqrt(count));

        if (gpu && gpu.sizeX >= needed && gpu.sizeY >= needed) {
            colorTexSize = { x: gpu.sizeX, y: gpu.sizeY };
            return;
        }

        colorTexSize = { x: needed, y: needed };
        gpu = new GPUComputationRenderer(needed, needed, renderer);
        colorTexture = gpu.createTexture();
        colorVar = gpu.addVariable('colorTex', createColorShader(), colorTexture);
        colorVar.material.uniforms.time = { value: 0 };
        let err = gpu.init();
        if (err) console.error(err);
    }

    let selRowCtrl, selColCtrl, selLayerCtrl;

    function setupGUI() {
        gui = new dat.GUI();
        gui.add(cubeControls, 'width', 50, 300, 1).onChange(updateCubeSize);
        gui.add(cubeControls, 'height', 50, 300, 1).onChange(updateCubeSize);
        gui.add(cubeControls, 'depth', 50, 300, 1).onChange(updateCubeSize);
        gui.add(cubeControls, 'rows', 1, 10, 1).onChange(() => { updateSubCubeLayout(); refreshSelectionControllers(); });
        gui.add(cubeControls, 'columns', 1, 10, 1).onChange(() => { updateSubCubeLayout(); refreshSelectionControllers(); });
        gui.add(cubeControls, 'subDepth', 1, 10, 1).onChange(() => { updateCubeSize(); updateSubCubeLayout(); refreshSelectionControllers(); });
        gui.add(cubeControls, 'posX', -300, 300, 1);
        gui.add(cubeControls, 'posY', -300, 300, 1);
        gui.add(cubeControls, 'velocityX', -10, 10, 0.1);
        gui.add(cubeControls, 'velocityY', -10, 10, 0.1);
        gui.addColor(cubeControls, 'color').onChange(updateCubeColor);
        gui.addColor(cubeControls, 'subColor').onChange(updateSubCubeColor);
        gui.add(cubeControls, 'matchDepth').onChange(updateCubeSize);
        gui.add(cubeControls, 'animate').onChange(() => { updateAnimButton(); saveGlobalSettings(); });
        gui.add(cubeControls, 'rotX', 0, Math.PI * 2, 0.1).onChange(updateRotation);
        gui.add(cubeControls, 'rotY', 0, Math.PI * 2, 0.1).onChange(updateRotation);
        gui.add(cubeControls, 'rotZ', 0, Math.PI * 2, 0.1).onChange(updateRotation);
        selRowCtrl = gui.add(cubeControls, 'selRow', indexToCoord(0, cubeControls.rows), indexToCoord(cubeControls.rows - 1, cubeControls.rows), 1).onChange(updateSelectedSubCubeColor);
        selColCtrl = gui.add(cubeControls, 'selCol', indexToCoord(0, cubeControls.columns), indexToCoord(cubeControls.columns - 1, cubeControls.columns), 1).onChange(updateSelectedSubCubeColor);
        selLayerCtrl = gui.add(cubeControls, 'selLayer', indexToCoord(0, cubeControls.subDepth), indexToCoord(cubeControls.subDepth - 1, cubeControls.subDepth), 1).onChange(updateSelectedSubCubeColor);
        gui.addColor(cubeControls, 'selColor').onChange(updateSelectedSubCubeColor);
        gui.add(cubeControls, 'selWeight', 0, 10, 0.1).onChange(updateSelectedSubCubeWeight);
    }

    function setupControls() {
        let fileInput = document.getElementById('colorFile');
        let toggleBtn = document.getElementById('toggleGUI');
        let animBtn = document.getElementById('toggleAnim');
        if (fileInput) {
            fileInput.addEventListener('input', async (e) => {
                let f = e.target.files[0];
                if (!f) return;
                let text = await f.text();
                try {
                    let data = JSON.parse(text);
                    applyColorData(data);
                } catch (err) {
                    console.error('Invalid color file', err);
                }
            });
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggleGUI);
        }

        if (animBtn) {
            animBtn.addEventListener('click', toggleAnimation);
            updateAnimButton();
        }

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') toggleGUI();
            if (e.key === 'p') toggleAnimation();
        });
    }

    function toggleGUI() {
        if (gui && gui.domElement) {
            let d = gui.domElement.style.display === 'none' ? 'block' : 'none';
            gui.domElement.style.display = d;
        }
    }

    function toggleAnimation() {
        cubeControls.animate = !cubeControls.animate;
        updateAnimButton();
        saveGlobalSettings();
        let wins = windowManager ? windowManager.getWindows() : [];
        cubes.forEach((cube, idx) => {
            if (cube.userData.winId === thisWindowId && wins[idx] && wins[idx].metaData) {
                wins[idx].metaData.animate = cubeControls.animate;
                cube.userData.metaData = wins[idx].metaData;
            }
        });
        if (windowManager) windowManager.updateWindowsLocalStorage();
    }

    function updateAnimButton() {
        let btn = document.getElementById('toggleAnim');
        if (btn) btn.textContent = cubeControls.animate ? 'Pause Anim' : 'Resume Anim';
    }

    function refreshSelectionControllers() {
        if (selRowCtrl) {
            selRowCtrl.min(indexToCoord(0, cubeControls.rows));
            selRowCtrl.max(indexToCoord(cubeControls.rows - 1, cubeControls.rows));
            if (cubeControls.selRow < indexToCoord(0, cubeControls.rows) || cubeControls.selRow > indexToCoord(cubeControls.rows - 1, cubeControls.rows)) {
                cubeControls.selRow = indexToCoord(0, cubeControls.rows);
                selRowCtrl.updateDisplay();
            }
        }
        if (selColCtrl) {
            selColCtrl.min(indexToCoord(0, cubeControls.columns));
            selColCtrl.max(indexToCoord(cubeControls.columns - 1, cubeControls.columns));
            if (cubeControls.selCol < indexToCoord(0, cubeControls.columns) || cubeControls.selCol > indexToCoord(cubeControls.columns - 1, cubeControls.columns)) {
                cubeControls.selCol = indexToCoord(0, cubeControls.columns);
                selColCtrl.updateDisplay();
            }
        }
        if (selLayerCtrl) {
            selLayerCtrl.min(indexToCoord(0, cubeControls.subDepth));
            selLayerCtrl.max(indexToCoord(cubeControls.subDepth - 1, cubeControls.subDepth));
            if (cubeControls.selLayer < indexToCoord(0, cubeControls.subDepth) || cubeControls.selLayer > indexToCoord(cubeControls.subDepth - 1, cubeControls.subDepth)) {
                cubeControls.selLayer = indexToCoord(0, cubeControls.subDepth);
                selLayerCtrl.updateDisplay();
            }
        }
    }

    function setupWindowManager() {
        windowManager = new WindowManager();
        windowManager.setWinShapeChangeCallback(updateWindowShape);
        windowManager.setWinChangeCallback(windowsUpdated);

        let metaData = {
            color: cubeControls.color,
            subColors: {},
            subWeights: {},
            animate: cubeControls.animate,
            rotX: cubeControls.rotX,
            rotY: cubeControls.rotY,
            rotZ: cubeControls.rotZ
        };

        windowManager.init(metaData);

        thisWindowId = windowManager.getThisWindowID();
        document.body.dataset.idWindow = thisWindowId;
        document.body.dataset.idColor = metaData.color;
    }

    async function windowsUpdated() {
        await updateNumberOfCubes();
    }

    async function loadIndexedData() {
        if (!db) return;
        try {
            let cubesData = await loadCubes(db, thisWindowId);
            for (let cd of cubesData) {
                let cube = cubes.find(c => c.userData.winId === cd.id);
                if (!cube) continue;
                if (cd.center) cube.position.set(cd.center[0], cd.center[1], cd.center[2]);
                if (cd.subIds && cd.subIds.length > 0) {
                    let subs = await loadSubCubes(db, thisWindowId, cd.id);
                    if (subs.length !== cd.subIds.length) {
                        console.warn(`Subcube count mismatch for cube ${cd.id}: expected ${cd.subIds.length}, got ${subs.length}`);
                    }
                    subs.sort((a, b) => a.order - b.order);
                    for (let s of subs) {
                        let [r, c, d] = getRowColLayerFromSymbol(cube, s.id);
                        if (s.color) applyColorToSubCube(cube, r, c, d, s.color);
                        if (s.weight !== undefined) applyWeightToSubCube(cube, r, c, d, s.weight);
                        let verts = await loadVertices(db, thisWindowId, cd.id, s.id);
                        verts.forEach(v => {
                            let group = cube.userData.subMatrix?.[d]?.[r]?.[c];
                            if (group && group.userData && group.userData.vertexAttr) {
                                let vi = v.index;
                                group.userData.vertexAttr.array[vi * 3] = v.color[0] / 255;
                                group.userData.vertexAttr.array[vi * 3 + 1] = v.color[1] / 255;
                                group.userData.vertexAttr.array[vi * 3 + 2] = v.color[2] / 255;
                                group.userData.vertexAttr.needsUpdate = true;
                            }
                        });

                        const group = cube.userData.subMatrix?.[d]?.[r]?.[c];
                        if (group && group.userData && group.userData.vertexAttr) {
                            const m = await loadMatrixFromStorage(cd.id, s.id);
                            if (m) matrixToVertices(group.userData.vertexAttr, m);
                        }
                    }
                }
                if (cd.vertexEntries) {
                    cd.vertexEntries.forEach((ve, vi) => {
                        let [pos, color, weight, blend] = ve;
                        saveVertex(db, thisWindowId, cd.id, cd.id, vi, color, pos, blend, weight)
                            .catch(err => console.error('DB save vertex', err));
                    });
                }
            }
            blendAllSubCubeColors();
            await applyAllMatricesFromStorage();
        } catch (err) {
            console.error('DB load error', err);
        }
    }

    async function persistCube(cube) {
        if (!db) return;
        let center = [cube.position.x, cube.position.y, cube.position.z];
        let subIds = [];
        if (cube.userData.subGroup) {
            let ordered = orderSubCubes(cube);
            subIds = ordered.map((_, idx) => generateSymbol(idx));
        }
        let hw = cube.geometry.parameters.width / 2;
        let hh = cube.geometry.parameters.height / 2;
        let hd = cube.geometry.parameters.depth / 2;
        let corners = [
            [-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd],
            [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]
        ];
        let col = cube.material.color;
        let vertexEntries = corners.map(pos => [pos, [Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255)], 1.0, 'blendBackground']);
        try {
            await saveCube(db, thisWindowId, cube.userData.winId, center, subIds, vertexEntries);
        } catch (err) {
            console.error('DB save cube', err);
        }
    }

    async function persistSubCube(cube, row, col, layer, symbol = 'AA') {
        if (!db || !cube.userData.subInfo) return;
        let rows = cube.userData.subInfo.rows;
        let cols = cube.userData.subInfo.cols;
        let layers = cube.userData.subInfo.layers;

        let r = row;
        let c = col;
        let d = layer;

        let subId = symbol;
        let idx = d * rows * cols + r * cols + c;

        let { subW, subH, subD } = cube.userData.subInfo;
        let width = subW * cols;
        let height = subH * rows;
        let depth = subD * layers;
        let center = [
            -width / 2 + subW * (c + 0.5),
            -height / 2 + subH * (r + 0.5),
            -depth / 2 + subD * (d + 0.5)
        ];
        let vertexIds = [];
        let signs = [
            [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
            [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
        ];
        let left = c === 0, right = c === cols - 1;
        let bottom = r === 0, top = r === rows - 1;
        let back = d === 0, front = d === layers - 1;

        for (let i = 0; i < 8; i++) {
            let vid = `${subId}vtx${i}`;
            vertexIds.push(vid);
            let hw = cube.userData.subInfo.subW / 2;
            let hh = cube.userData.subInfo.subH / 2;
            let hd = cube.userData.subInfo.subD / 2;
            let verts = [
                [-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd],
                [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]
            ];
            let p = verts[i];
            let color = cube.userData.colorBuffer && cube.userData.colorBuffer.length > idx * 3 + 2 ? [
                Math.round(cube.userData.colorBuffer[idx * 3] * 255),
                Math.round(cube.userData.colorBuffer[idx * 3 + 1] * 255),
                Math.round(cube.userData.colorBuffer[idx * 3 + 2] * 255)
            ] : [255, 0, 0]; // Fallback to red if colorBuffer is invalid
            let weight = cube.userData.weightBuffer && cube.userData.weightBuffer.length > idx ? cube.userData.weightBuffer[idx] : 1;
            let s = signs[i];
            let matchAxes = 0;
            if ((left && s[0] < 0) || (right && s[0] > 0)) matchAxes++;
            if ((bottom && s[1] < 0) || (top && s[1] > 0)) matchAxes++;
            if ((back && s[2] < 0) || (front && s[2] > 0)) matchAxes++;
            let blend = matchAxes >= 2 ? 'blendCorner' : 'blendsoft';
            try {
                await saveVertex(db, thisWindowId, cube.userData.winId, subId, i, color, [p[0] + center[0], p[1] + center[1], p[2] + center[2]], blend, weight);
            } catch (err) {
                console.error('DB save vertex', err);
            }
        }

        try {
            await saveSubCube(db, thisWindowId, cube.userData.winId, subId, center, 'blend_soft', vertexIds, idx);
            const group = cube.userData.subMatrix?.[d]?.[r]?.[c];
            if (group && group.userData && group.userData.vertexAttr) {
                const mat = verticesToMatrix(group.userData.vertexAttr);
                if (mat) await saveMatrixToStorage(cube.userData.winId, subId, mat);
            }
        } catch (err) {
            console.error('DB save subcube', err);
        }
    }

    async function persistAllSubCubes(cube) {
        if (!db || !cube.userData.subGroup || !cube.userData.subInfo) {
            console.warn(`persistAllSubCubes: Skipping cube ${cube.userData.winId} due to missing subGroup or subInfo`);
            return;
        }

        let ordered = orderSubCubes(cube);
        let rows = cube.userData.subInfo.rows;
        let cols = cube.userData.subInfo.cols;
        let layers = cube.userData.subInfo.layers;
        let subcubesStructure = [];

        for (let d = 0; d < layers; d++) {
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    let idx = d * rows * cols + r * cols + c;
                    let subGroup = cube.userData.subMatrix?.[d]?.[r]?.[c];
                    if (subGroup) {
                        let { subW, subH, subD } = cube.userData.subInfo;
                        let center = [
                            -cubeControls.width / 2 + subW * (c + 0.5),
                            -cubeControls.height / 2 + subH * (r + 0.5),
                            -cubeControls.depth / 2 + subD * (d + 0.5)
                        ];
                        let color = cube.userData.colorBuffer && cube.userData.colorBuffer.length > idx * 3 + 2 ? 
                            new t.Color().fromArray(cube.userData.colorBuffer, idx * 3) : 
                            new t.Color(cubeControls.subColor);
                        let weight = cube.userData.weightBuffer && cube.userData.weightBuffer.length > idx ? 
                            cube.userData.weightBuffer[idx] : 1;
                        let vertexIds = [];
                        for (let i = 0; i < 8; i++) {
                            vertexIds.push(`${generateSymbol(idx)}vtx${i}`);
                        }
                        let symbol = generateSymbol(idx);
                        subcubesStructure.push({
                            id: symbol,
                            center: center,
                            vertexIds: vertexIds,
                            color: `#${color.getHexString()}`,
                            weight: weight,
                            order: idx
                        });

                        await persistSubCube(cube, r, c, d, symbol);
                    }
                }
            }
        }

        try {
            await storeSubCubes(db, thisWindowId, cube.userData.winId, subcubesStructure);
            console.log(`Subcubes for cube ${cube.userData.winId} stored successfully`);
        } catch (err) {
            console.error('Error storing subcubes:', err);
        }
    }

    async function storeSubCubes(db, windowUID, cubeId, subcubesStructure) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!subcubesStructure || subcubesStructure.length === 0) {
                    console.warn('subcubesStructure is empty or undefined');
                    reject(new Error('subcubesStructure not provided'));
                    return;
                }

                const storedData = {};

                for (const subcube of subcubesStructure) {
                    const subcubeId = subcube.id;
                    const order = subcube.order || 0;
                    const updatedSubcube = {
                        id: subcubeId,
                        center: subcube.center,
                        originID: cubeId,
                        vertexIds: subcube.vertexIds || [],
                        order: order
                    };
                    await saveSubCube(db, windowUID, cubeId, subcubeId, subcube.center, 'blend_soft', subcube.vertexIds, order);
                    storedData[subcubeId] = updatedSubcube;
                }

                resolve(storedData);
            } catch (error) {
                console.error('Error in storeSubCubes:', error);
                reject(error);
            }
        });
    }


    async function updateNumberOfCubes() {
        let wins = windowManager.getWindows();

        let selfData = windowManager.getThisWindowData();
        if (selfData && selfData.metaData) {
            document.body.dataset.idColor = selfData.metaData.color;
        }

        cubes.forEach((c) => {
            world.remove(c);
            c.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });
        });

        cubes = [];

        for (let i = 0; i < wins.length; i++) {
            let win = wins[i];

            let baseDepth = cubeControls.depth;
            if (cubeControls.matchDepth) baseDepth = (cubeControls.width / cubeControls.columns) * cubeControls.subDepth;
            let color = cubeControls.color;
            if (win.metaData && win.metaData.color) color = win.metaData.color;
            let cube = new t.Mesh(
                new t.BoxBufferGeometry(cubeControls.width, cubeControls.height, baseDepth),
                createCubeMaterial(color)
            );
            cube.userData.winId = win.id;
            cube.userData.metaData = win.metaData || {
                color: color,
                subColors: {},
                subWeights: {},
                animate: cubeControls.animate,
                rotX: cubeControls.rotX,
                rotY: cubeControls.rotY,
                rotZ: cubeControls.rotZ
            };
            cube.position.x = win.shape.x + (win.shape.w * 0.5);
            cube.position.y = win.shape.y + (win.shape.h * 0.5);

            try {
                await createSubCubeGrid(cube, baseDepth);
                await persistCube(cube);
                await persistAllSubCubes(cube);
                cubes.push(cube);
                world.add(cube);
            } catch (err) {
                console.error(`Error creating cube for window ${win.id}:`, err);
            }
        }
    }

    async function updateCubeSize() {
        for (const cube of cubes) {
            cube.geometry.dispose();
            let baseDepth = cubeControls.depth;
            if (cubeControls.matchDepth) baseDepth = (cubeControls.width / cubeControls.columns) * cubeControls.subDepth;
            cube.geometry = new t.BoxBufferGeometry(cubeControls.width, cubeControls.height, baseDepth);
            cube.material.color.set(cubeControls.color);
            cube.material.needsUpdate = true;
            await createSubCubeGrid(cube, baseDepth);
            await persistCube(cube);
            await persistAllSubCubes(cube);
        }
        updateSubCubeColor();
        updateSelectedSubCubeColor();
        blendAllSubCubeColors();
        windowManager.updateWindowsLocalStorage();
    }

    function updateCubeColor() {
        let wins = windowManager.getWindows();
        cubes.forEach((cube, idx) => {
            if (cube.userData.winId === thisWindowId) {
                cube.material.color.set(cubeControls.color);
                let win = wins[idx];
                if (win && win.metaData) {
                    win.metaData.color = cubeControls.color;
                    cube.userData.metaData = win.metaData;
                }
                document.body.dataset.idColor = cubeControls.color;
            }
        });
        windowManager.updateWindowsLocalStorage();
        cubes.forEach(c => persistCube(c));
    }

    function updateSubCubeColor() {
        cubes.forEach((cube) => {
            if (cube.userData.winId === thisWindowId && cube.userData.subGroup) {
                let color = new t.Color(cubeControls.subColor);
                let idx = 0;
                cube.userData.subGroup.children.forEach(g => {
                    g.children.forEach(obj => { obj.material.color.copy(color); });
                    if (g.userData && g.userData.vertexAttr) {
                        for (let vi = 0; vi < g.userData.vertexAttr.count; vi++) {
                            g.userData.vertexAttr.array[vi * 3] = color.r;
                            g.userData.vertexAttr.array[vi * 3 + 1] = color.g;
                            g.userData.vertexAttr.array[vi * 3 + 2] = color.b;
                        }
                        g.userData.vertexAttr.needsUpdate = true;
                    }
                    if (cube.userData.colorBuffer && cube.userData.colorBuffer.length > idx * 3 + 2) {
                        cube.userData.colorBuffer[idx * 3] = color.r;
                        cube.userData.colorBuffer[idx * 3 + 1] = color.g;
                        cube.userData.colorBuffer[idx * 3 + 2] = color.b;
                    }
                    idx++;
                });

                if (!cube.userData.metaData.subColors) cube.userData.metaData.subColors = {};
                let rows = Math.max(1, cubeControls.rows | 0);
                let cols = Math.max(1, cubeControls.columns | 0);
                let layers = Math.max(1, cubeControls.subDepth | 0);
                for (let d = 0; d < layers; d++) {
                    for (let r = 0; r < rows; r++) {
                        for (let c = 0; c < cols; c++) {
                            let key = `${r}_${c}_${d}`;
                            cube.userData.metaData.subColors[key] = cubeControls.subColor;
                        }
                    }
                }
            }
        });
        blendAllSubCubeColors();
        windowManager.updateWindowsLocalStorage();
    }

    function updateRotation() {
        cubes.forEach((cube) => {
            if (cube.userData.winId === thisWindowId) {
                let md = cube.userData.metaData || {};
                md.rotX = cubeControls.rotX;
                md.rotY = cubeControls.rotY;
                md.rotZ = cubeControls.rotZ;
                cube.userData.metaData = md;
            }
        });
        saveGlobalSettings();
        windowManager.updateWindowsLocalStorage();
        cubes.forEach(c => persistCube(c));
    }

    function updateSelectedSubCubeColor() {
        setSubCubeColor(
            cubeControls.selRow,
            cubeControls.selCol,
            cubeControls.selLayer,
            cubeControls.selColor
        );
    }

    function updateSelectedSubCubeWeight() {
        setSubCubeWeight(
            cubeControls.selRow,
            cubeControls.selCol,
            cubeControls.selLayer,
            cubeControls.selWeight
        );
    }

    function setSubCubeColor(row, col, layer, colorStr) {
        cubes.forEach((cube) => {
            if (cube.userData.winId === thisWindowId && cube.userData.subGroup) {
                applyColorToSubCube(cube, row, col, layer, colorStr);
            }
        });
        blendAllSubCubeColors();
        windowManager.updateWindowsLocalStorage();
    }

    function setSubCubeWeight(row, col, layer, weightVal) {
        cubes.forEach((cube) => {
            if (cube.userData.winId === thisWindowId && cube.userData.subGroup) {
                applyWeightToSubCube(cube, row, col, layer, weightVal);
            }
        });
        blendAllSubCubeColors();
        windowManager.updateWindowsLocalStorage();
    }

    window.setSubCubeColor = setSubCubeColor;
    window.setSubCubeWeight = setSubCubeWeight;
    window.applyMatrixFromStorage = applyMatrixFromStorage;

    function applyColorToSubCube(cube, row, col, layer, colorStr) {
        let m = cube.userData.subMatrix;
        if (!m || !cube.userData.subInfo) return;
        let layers = cube.userData.subInfo.layers;
        let rows = cube.userData.subInfo.rows;
        let cols = cube.userData.subInfo.cols;
        let d = coordToIndex(layer, layers);
        let r = coordToIndex(row, rows);
        let c = coordToIndex(col, cols);
        if (m && m[d] && m[d][r] && m[d][r][c]) {
            let group = m[d][r][c];
            let color = new t.Color(colorStr);
            group.children.forEach(obj => obj.material.color.copy(color));
            if (group.userData && group.userData.vertexAttr) {
                for (let vi = 0; vi < group.userData.vertexAttr.count; vi++) {
                    group.userData.vertexAttr.array[vi * 3] = color.r;
                    group.userData.vertexAttr.array[vi * 3 + 1] = color.g;
                    group.userData.vertexAttr.array[vi * 3 + 2] = color.b;
                }
                group.userData.vertexAttr.needsUpdate = true;
            }
            let bufferIndex = d * rows * cols + r * cols + c;
            if (cube.userData.colorBuffer && cube.userData.colorBuffer.length > bufferIndex * 3 + 2) {
                cube.userData.colorBuffer[bufferIndex * 3] = color.r;
                cube.userData.colorBuffer[bufferIndex * 3 + 1] = color.g;
                cube.userData.colorBuffer[bufferIndex * 3 + 2] = color.b;
            }
            if (!cube.userData.metaData.subColors) cube.userData.metaData.subColors = {};
            let key = `${r}_${c}_${d}`;
            cube.userData.metaData.subColors[key] = colorStr;
            let symbol = getSubCubeSymbol(cube, r, c, d);
            persistSubCube(cube, r, c, d, symbol);
        }
    }

    function applyWeightToSubCube(cube, row, col, layer, weightVal) {
        let m = cube.userData.subMatrix;
        if (!m || !cube.userData.subInfo) return;
        let layers = cube.userData.subInfo.layers;
        let rows = cube.userData.subInfo.rows;
        let cols = cube.userData.subInfo.cols;
        let d = coordToIndex(layer, layers);
        let r = coordToIndex(row, rows);
        let c = coordToIndex(col, cols);
        if (m[d] && m[d][r] && m[d][r][c]) {
            let bufferIndex = d * rows * cols + r * cols + c;
            if (cube.userData.weightBuffer && cube.userData.weightBuffer.length > bufferIndex) {
                cube.userData.weightBuffer[bufferIndex] = weightVal;
            }
            if (!cube.userData.metaData.subWeights) cube.userData.metaData.subWeights = {};
            let key = `${r}_${c}_${d}`;
            cube.userData.metaData.subWeights[key] = weightVal;
            let symbol = getSubCubeSymbol(cube, r, c, d);
            persistSubCube(cube, r, c, d, symbol);
        }
    }

    async function applyMatrixFromStorage(cubeId, subId) {
        const cube = cubes.find(c => c.userData.winId === cubeId);
        if (!cube || !cube.userData.subInfo) return;
        let [r, c, d] = getRowColLayerFromSymbol(cube, subId);
        const group = cube.userData.subMatrix?.[d]?.[r]?.[c];
        if (group && group.userData && group.userData.vertexAttr) {
            const m = await loadMatrixFromStorage(cubeId, subId);
            if (m) {
                matrixToVertices(group.userData.vertexAttr, m);
                blendAllSubCubeColors();
            }
        }
    }

    function applyColorData(arr) {
        cubes.forEach((cube) => {
            if (cube.userData.subGroup) {
                for (let i = 0; i < Math.min(cube.userData.subGroup.children.length, arr.length); i++) {
                    let cval = arr[i];
                    if (Array.isArray(cval) && cval.length >= 3) {
                        let g = cube.userData.subGroup.children[i];
                        g.children.forEach(obj => obj.material.color.setRGB(cval[0], cval[1], cval[2]));
                        if (g.userData && g.userData.vertexAttr) {
                            for (let vi = 0; vi < g.userData.vertexAttr.count; vi++) {
                                g.userData.vertexAttr.array[vi * 3] = cval[0];
                                g.userData.vertexAttr.array[vi * 3 + 1] = cval[1];
                                g.userData.vertexAttr.array[vi * 3 + 2] = cval[2];
                            }
                            g.userData.vertexAttr.needsUpdate = true;
                        }
                        if (cube.userData.colorBuffer && cube.userData.colorBuffer.length > i * 3 + 2) {
                            cube.userData.colorBuffer[i * 3] = cval[0];
                            cube.userData.colorBuffer[i * 3 + 1] = cval[1];
                            cube.userData.colorBuffer[i * 3 + 2] = cval[2];
                        }
                    }
                }
            }
        });
        blendAllSubCubeColors();
    }

    async function applyAllMatricesFromStorage() {
        for (const cube of cubes) {
            if (!cube.userData.subGroup) return;
            const rows = cube.userData.subInfo.rows;
            const cols = cube.userData.subInfo.cols;
            const layers = cube.userData.subInfo.layers;
            for (let d = 0; d < layers; d++) {
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const symbol = getSubCubeSymbol(cube, r, c, d);
                        await applyMatrixFromStorage(cube.userData.winId, symbol);
                    }
                }
            }
        }
    }

    function blendAllSubCubeColors() {
        cubes.forEach(cube => {
            if (!cube.userData || !cube.userData.subInfo || !cube.userData.subMatrix) return;
            const { rows, cols, layers } = cube.userData.subInfo;
            const colors = cube.userData.colorBuffer;
            const weights = cube.userData.weightBuffer || [];
            if (!colors) return;

            for (let d = 0; d < layers; d++) {
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const idx = d * rows * cols + r * cols + c;
                        const g = cube.userData.subMatrix[d]?.[r]?.[c];
                        if (!g || !g.userData || !g.userData.vertexAttr) continue;

                        const verts = [];
                        const attr = g.userData.vertexAttr;
                        for (let vi = 0; vi < attr.count; vi++) {
                            verts.push({
                                color: [attr.array[vi * 3], attr.array[vi * 3 + 1], attr.array[vi * 3 + 2]],
                                weight: weights[idx] || 1
                            });
                        }

                        const col = blendVertices(verts, 'weighted');
                        g.children.forEach(obj => obj.material.color.setRGB(col.r, col.g, col.b));

                        if (colors && colors.length > idx * 3 + 2) {
                            colors[idx * 3] = col.r;
                            colors[idx * 3 + 1] = col.g;
                            colors[idx * 3 + 2] = col.b;
                        }
                    }
                }
            }
        });
    }

    async function createSubCubeGrid(cube, baseDepth = cubeControls.depth) {
        if (cube.userData.subGroup) {
            cube.remove(cube.userData.subGroup);
            cube.userData.subGroup.children.forEach(ch => {
                ch.traverse(obj => {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) obj.material.dispose();
                });
            });
        }

        cube.userData.subMatrix = [];
        cube.userData.subGroup = new t.Group();

        if (db) {
            try {
                await Promise.all([
                    deleteSubCubesByCube(db, cube.userData.winId),
                    deleteVerticesByCube(db, cube.userData.winId)
                ]);
                console.log(`Cleaned up old subcubes/vertices for cube ${cube.userData.winId}`);
            } catch (err) {
                console.error('Failed to clean up old subcubes/vertices:', err);
            }
        }

        let rows = Math.max(1, cubeControls.rows | 0);
        let cols = Math.max(1, cubeControls.columns | 0);
        let layers = Math.max(1, cubeControls.subDepth | 0);

        console.log(`Creating ${rows * cols * layers} subcubes for cube ${cube.userData.winId}`);

        let subW = cubeControls.width / cols;
        let subH = cubeControls.height / rows;
        let subD = baseDepth / layers;

        let count = rows * cols * layers;
        if (!gpu || (gpu.sizeX * gpu.sizeY) < count) {
            initGPU(count);
        } else {
            colorTexSize = { x: gpu.sizeX, y: gpu.sizeY };
        }

        let existingBuffer = cube.userData.colorBuffer && cube.userData.colorBuffer.length === count * 3;
        if (!existingBuffer) {
            cube.userData.colorBuffer = new Float32Array(count * 3);
        }

        let existingWeightBuffer = cube.userData.weightBuffer && cube.userData.weightBuffer.length === count;
        if (!existingWeightBuffer) {
            cube.userData.weightBuffer = new Float32Array(count);
            for (let i = 0; i < count; i++) cube.userData.weightBuffer[i] = 1;
        }

        cube.userData.subInfo = { rows, cols, layers, subW, subH, subD };
        let colors = cube.userData.colorBuffer;

        for (let d = 0; d < layers; d++) {
            cube.userData.subMatrix[d] = [];
            for (let r = 0; r < rows; r++) {
                cube.userData.subMatrix[d][r] = [];
                for (let c = 0; c < cols; c++) {
                    let idx = d * rows * cols + r * cols + c;
                    let colorSet = false;
                    let weightKey = `${r}_${c}_${d}`;
                    let weightVal = 1;
                    if (cube.userData.metaData && cube.userData.metaData.subColors) {
                        let key = `${r}_${c}_${d}`;
                        if (cube.userData.metaData.subColors[key]) {
                            let cval = new t.Color(cube.userData.metaData.subColors[key]);
                            colors[idx * 3] = cval.r;
                            colors[idx * 3 + 1] = cval.g;
                            colors[idx * 3 + 2] = cval.b;
                            colorSet = true;
                        }
                    }
                    if (cube.userData.metaData && cube.userData.metaData.subWeights && cube.userData.metaData.subWeights[weightKey] !== undefined) {
                        weightVal = cube.userData.metaData.subWeights[weightKey];
                    } else if (!existingWeightBuffer) {
                        weightVal = 1;
                    } else {
                        weightVal = cube.userData.weightBuffer[idx];
                    }
                    if (!colorSet && !existingBuffer) {
                        let colObj = new t.Color(cubeControls.subColor);
                        colors[idx * 3] = colObj.r;
                        colors[idx * 3 + 1] = colObj.g;
                        colors[idx * 3 + 2] = colObj.b;
                    }

                    let { lineGeom, pointGeom } = createLineCubeGeometry(subW, subH, subD);
                    let mat = new t.LineBasicMaterial({
                        transparent: true,
                        blending: t.AdditiveBlending,
                        depthWrite: false
                    });
                    mat.color.fromArray(colors, idx * 3);
                    let line = new t.LineSegments(lineGeom, mat);
                    let pColors = new Float32Array(8 * 3);
                    for (let vi = 0; vi < 8; vi++) {
                        pColors[vi * 3] = colors[idx * 3];
                        pColors[vi * 3 + 1] = colors[idx * 3 + 1];
                        pColors[vi * 3 + 2] = colors[idx * 3 + 2];
                    }
                    pointGeom.setAttribute('color', new t.Float32BufferAttribute(pColors, 3));
                    pointGeom.attributes.color.needsUpdate = true;
                    let pMat = new t.PointsMaterial({
                        size: 4,
                        sizeAttenuation: false,
                        transparent: true,
                        blending: t.AdditiveBlending,
                        depthWrite: false,
                        vertexColors: true
                    });
                    let points = new t.Points(pointGeom, pMat);
                    let container = new t.Group();
                    container.add(line);
                    container.add(points);
                    container.userData.vertexAttr = pointGeom.getAttribute('color');
                    container.position.set(
                        -cubeControls.width / 2 + subW * (c + 0.5),
                        -cubeControls.height / 2 + subH * (r + 0.5),
                        -baseDepth / 2 + subD * (d + 0.5)
                    );
                    cube.userData.subGroup.add(container);

                    cube.userData.subMatrix[d][r][c] = container;
                    cube.userData.weightBuffer[idx] = weightVal;
                    container.userData.vertexColors = pColors;
                }
            }
        }

        if (gpu && colorVar && (!cube.userData.metaData || !cube.userData.metaData.subColors || Object.keys(cube.userData.metaData.subColors).length === 0)) {
            colorVar.material.uniforms.time.value = internalTime;
            gpu.compute();
            let read = new Float32Array(colorTexSize.x * colorTexSize.y * 4);
            renderer.readRenderTargetPixels(gpu.getCurrentRenderTarget(colorVar), 0, 0, colorTexSize.x, colorTexSize.y, read);
            let idx = 0;
            cube.userData.subGroup.children.forEach(g => {
                g.children.forEach(obj => obj.material.color.setRGB(read[idx], read[idx + 1], read[idx + 2]));
                if (g.userData && g.userData.vertexAttr) {
                    for (let vi = 0; vi < g.userData.vertexAttr.count; vi++) {
                        g.userData.vertexAttr.array[vi * 3] = read[idx];
                        g.userData.vertexAttr.array[vi * 3 + 1] = read[idx + 1];
                        g.userData.vertexAttr.array[vi * 3 + 2] = read[idx + 2];
                    }
                    g.userData.vertexAttr.needsUpdate = true;
                }
                colors[(idx / 4) * 3] = read[idx];
                colors[(idx / 4) * 3 + 1] = read[idx + 1];
                colors[(idx / 4) * 3 + 2] = read[idx + 2];
                idx += 4;
            });
        }

        cube.add(cube.userData.subGroup);
        blendAllSubCubeColors();
    }

    async function updateSubCubeLayout() {
        for (const cube of cubes) {
            let baseDepth = cubeControls.depth;
            if (cubeControls.matchDepth) baseDepth = (cubeControls.width / cubeControls.columns) * cubeControls.subDepth;
            await createSubCubeGrid(cube, baseDepth);
            await persistCube(cube);
            await persistAllSubCubes(cube);
        }
        updateSubCubeColor();
        updateSelectedSubCubeColor();
        windowManager.updateWindowsLocalStorage();
    }

    function updateWindowShape(easing = true) {
        sceneOffsetTarget = { x: -window.screenX, y: -window.screenY };
        if (!easing) sceneOffset = sceneOffsetTarget;
    }

    function render() {
        let now = getTime();
        let deltaTime = now - internalTime;
        internalTime = now;

        windowManager.update();

        let falloff = 0.05;
        sceneOffset.x = sceneOffset.x + ((sceneOffsetTarget.x - sceneOffset.x) * falloff);
        sceneOffset.y = sceneOffset.y + ((sceneOffsetTarget.y - sceneOffset.y) * falloff);

        world.position.x = sceneOffset.x;
        world.position.y = sceneOffset.y;

        let wins = windowManager.getWindows();

        for (let i = 0; i < cubes.length; i++) {
            let cube = cubes[i];
            let win = wins[i];
            let _t = internalTime;

            let posTarget = {
                x: win.shape.x + (win.shape.w * 0.5) + cubeControls.posX,
                y: win.shape.y + (win.shape.h * 0.5) + cubeControls.posY
            };

            cube.position.x = cube.position.x + (posTarget.x - cube.position.x) * falloff;
            cube.position.y = cube.position.y + (posTarget.y - cube.position.y) * falloff;

            let md = cube.userData.metaData || {};
            let animate = md.animate !== undefined ? md.animate : cubeControls.animate;
            let rotX = md.rotX !== undefined ? md.rotX : cubeControls.rotX;
            let rotY = md.rotY !== undefined ? md.rotY : cubeControls.rotY;
            let rotZ = md.rotZ !== undefined ? md.rotZ : cubeControls.rotZ;

            let cubeDt = animate ? deltaTime : 0;
            cube.position.x += cubeControls.velocityX * cubeDt;
            cube.position.y += cubeControls.velocityY * cubeDt;
            cube.rotation.x = rotX + (animate ? _t * 0.5 : 0);
            cube.rotation.y = rotY + (animate ? _t * 0.3 : 0);
            cube.rotation.z = rotZ;
            persistCube(cube);
        }

        if (gpu && colorVar) {
            colorVar.material.uniforms.time.value = internalTime;
            gpu.compute();
            let read = new Float32Array(colorTexSize.x * colorTexSize.y * 4);
            renderer.readRenderTargetPixels(
                gpu.getCurrentRenderTarget(colorVar),
                0,
                0,
                colorTexSize.x,
                colorTexSize.y,
                read
            );
            cubes.forEach((cube) => {
                if (
                    cube.userData &&
                    cube.userData.subGroup &&
                    (!cube.userData.metaData ||
                        !cube.userData.metaData.subColors ||
                        Object.keys(cube.userData.metaData.subColors).length === 0)
                ) {
                    let idx = 0;
                    cube.userData.subGroup.children.forEach(g => {
                        g.children.forEach(obj => {
                            if (obj.material) {
                                obj.material.color.setRGB(read[idx], read[idx + 1], read[idx + 2]);
                            }
                        });
                        if (cube.userData.colorBuffer && cube.userData.colorBuffer.length > (idx / 4) * 3 + 2) {
                            cube.userData.colorBuffer[(idx / 4) * 3] = read[idx];
                            cube.userData.colorBuffer[(idx / 4) * 3 + 1] = read[idx + 1];
                            cube.userData.colorBuffer[(idx / 4) * 3 + 2] = read[idx + 2];
                        }
                        idx += 4;
                    });
                }
            });
            blendAllSubCubeColors();
        }

        renderer.render(scene, camera);
        requestAnimationFrame(render);
    }

    function resize() {
        let width = window.innerWidth;
        let height = window.innerHeight;

        camera = new t.OrthographicCamera(0, width, height, 0, -10000, 10000);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }
}