export async function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('CubeDB', 2);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const upgradeTx = event.target.transaction;

            // Create cube store if it doesn't exist
            let cubeStore;
            if (!db.objectStoreNames.contains('cubes')) {
                cubeStore = db.createObjectStore('cubes', { keyPath: 'id' });
                cubeStore.createIndex('windowUID', 'windowUID', { unique: false });
            } else {
                cubeStore = upgradeTx.objectStore('cubes');
            }

            // Create subcubes store or get reference
            let subStore;
            if (!db.objectStoreNames.contains('subcubes')) {
                subStore = db.createObjectStore('subcubes', { keyPath: 'id' });
                subStore.createIndex('cubeId', 'cubeId', { unique: false });
                subStore.createIndex('windowUID', 'windowUID', { unique: false });
            } else {
                subStore = upgradeTx.objectStore('subcubes');
            }

            // Create vertices store if needed
            if (!db.objectStoreNames.contains('vertices')) {
                const vertStore = db.createObjectStore('vertices', { keyPath: 'id' });
                vertStore.createIndex('subCubeId', 'subCubeId', { unique: false });
                vertStore.createIndex('cubeId', 'cubeId', { unique: false });
                vertStore.createIndex('windowUID', 'windowUID', { unique: false });
            }

            // If upgrading from a version without subcubes store, populate it
            if (event.oldVersion < 2 && subStore && cubeStore) {
                cubeStore.openCursor().onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        const cube = cursor.value;
                        const subIds = Array.isArray(cube.value?.[1]) ? cube.value[1] : [];
                        subIds.forEach((sid, idx) => {
                            subStore.put({
                                id: sid,
                                cubeId: cube.id,
                                windowUID: cube.windowUID,
                                center: null,
                                originID: cube.id,
                                blendingLogicId: null,
                                vertexIds: [],
                                order: idx
                            });
                        });
                        cursor.continue();
                    }
                };
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            populateSubcubesFromCubes(db)
                .then(() => resolve(db))
                .catch(reject);
        };
        request.onerror = () => reject(request.error);
    });
}

export async function saveCube(db, windowUID, cubeId, center, subIds, vertexEntries) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('cubes', 'readwrite');
        const store = tx.objectStore('cubes');
        const value = [center, subIds, vertexEntries];
        store.put({ id: cubeId, windowUID, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadCubes(db, windowUID) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('cubes', 'readonly');
        const store = tx.objectStore('cubes');
        const index = store.index('windowUID');
        const req = index.getAll(IDBKeyRange.only(windowUID));
        req.onsuccess = () => resolve(req.result.map(r => ({
            id: r.id,
            windowUID: r.windowUID,
            center: r.value ? r.value[0] : null,
            subIds: r.value ? r.value[1] : [],
            vertexEntries: r.value ? r.value[2] : []
        })));
        req.onerror = () => reject(req.error);
    });
}

export async function saveSubCube(db, windowUID, cubeId, subId, center, blendId, vertexIds, order) {
    return new Promise((resolve, reject) => {
        // Open transaction for both cubes and subcubes stores
        const tx = db.transaction(['cubes', 'subcubes'], 'readwrite');
        const cubeStore = tx.objectStore('cubes');
        const subStore = tx.objectStore('subcubes');

        // Retrieve the cube to get subIds
        const cubeReq = cubeStore.get(cubeId);

        cubeReq.onsuccess = () => {
            const cube = cubeReq.result;
            let assignedSubId = subId;

            if (cube && cube.value && Array.isArray(cube.value[1]) && order >= 0 && order < cube.value[1].length) {
                assignedSubId = cube.value[1][order];
            }

            subStore.put({
                id: assignedSubId,
                windowUID,
                cubeId,
                center,
                originID: cubeId,
                blendingLogicId: blendId,
                vertexIds,
                order: order
            });

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        };

        cubeReq.onerror = () => reject(cubeReq.error);
    });
}

export async function loadSubCubes(db, windowUID, cubeId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('subcubes', 'readonly');
        const store = tx.objectStore('subcubes');
        const index = store.index('cubeId');
        const req = index.getAll(IDBKeyRange.only(cubeId));
        req.onsuccess = () => {
            let out = req.result
                .filter(r => r.windowUID === windowUID)
                .map(r => ({
                    id: r.id,
                    cubeId: r.cubeId,
                    windowUID: r.windowUID,
                    center: r.center,
                    originID: r.originID,
                    blendingLogicId: r.blendingLogicId,
                    vertexIds: r.vertexIds || [],
                    order: r.order ?? 0
                }));
            out.sort((a,b) => a.order - b.order);
            resolve(out);
        };
        req.onerror = () => reject(req.error);
    });
}

export async function saveVertex(db, windowUID, cubeId, subId, index, color, position, blendId, weight) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('vertices', 'readwrite');
        const store = tx.objectStore('vertices');
        const id = `${subId}_${index}`;
        const value = [color, position, blendId, weight];
        store.put({ id, windowUID, cubeId, subCubeId: subId, index, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadVertices(db, windowUID, cubeId, subId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('vertices', 'readonly');
        const store = tx.objectStore('vertices');
        const index = store.index('subCubeId');
        const req = index.getAll(IDBKeyRange.only(subId));
        req.onsuccess = () => resolve(req.result.filter(r => r.windowUID === windowUID && r.cubeId === cubeId).map(r => ({
            id: r.id,
            index: r.index,
            subCubeId: r.subCubeId,
            cubeId: r.cubeId,
            windowUID: r.windowUID,
            color: r.value ? r.value[0] : null,
            position: r.value ? r.value[1] : null,
            blendingLogicId: r.value ? r.value[2] : null,
            weight: r.value ? r.value[3] : null
        })));
        req.onerror = () => reject(req.error);
    });
}

export async function deleteSubCubesByCube(db, cubeId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('subcubes', 'readwrite');
        const store = tx.objectStore('subcubes');
        const index = store.index('cubeId');
        const req = index.getAllKeys(IDBKeyRange.only(cubeId));
        req.onsuccess = () => { req.result.forEach(key => store.delete(key)); };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function deleteVerticesByCube(db, cubeId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('vertices', 'readwrite');
        const store = tx.objectStore('vertices');
        const index = store.index('cubeId');
        const req = index.getAllKeys(IDBKeyRange.only(cubeId));
        req.onsuccess = () => { req.result.forEach(key => store.delete(key)); };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function deleteCube(db, cubeId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('cubes', 'readwrite');
        const store = tx.objectStore('cubes');
        store.delete(cubeId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function deleteWindowData(db, windowUID) {
    await Promise.all([
        new Promise((res, rej) => {
            const tx = db.transaction('cubes', 'readwrite');
            const store = tx.objectStore('cubes');
            const index = store.index('windowUID');
            const req = index.getAllKeys(IDBKeyRange.only(windowUID));
            req.onsuccess = () => { req.result.forEach(key => store.delete(key)); };
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        }),
        new Promise((res, rej) => {
            const tx = db.transaction('subcubes', 'readwrite');
            const store = tx.objectStore('subcubes');
            const index = store.index('windowUID');
            const req = index.getAllKeys(IDBKeyRange.only(windowUID));
            req.onsuccess = () => { req.result.forEach(key => store.delete(key)); };
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        }),
        new Promise((res, rej) => {
            const tx = db.transaction('vertices', 'readwrite');
            const store = tx.objectStore('vertices');
            const index = store.index('windowUID');
            const req = index.getAllKeys(IDBKeyRange.only(windowUID));
            req.onsuccess = () => { req.result.forEach(key => store.delete(key)); };
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        })
    ]);
}

async function populateSubcubesFromCubes(db) {
    if (!db.objectStoreNames.contains('cubes') ||
        !db.objectStoreNames.contains('subcubes')) {
        return;
    }

    // Helper to store a batch of subcube entries using a single transaction
    const putBatch = (entries) => new Promise((res, rej) => {
        const tx = db.transaction('subcubes', 'readwrite');
        const store = tx.objectStore('subcubes');
        entries.forEach(ent => store.put(ent));
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });

    const cubes = await new Promise((res, rej) => {
        const tx = db.transaction('cubes', 'readonly');
        const store = tx.objectStore('cubes');
        const req = store.getAll();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    });

    for (const cube of cubes) {
        const subIds = Array.isArray(cube.value?.[1]) ? cube.value[1] : [];
        const entries = subIds.map((sid, idx) => ({
            id: sid,
            cubeId: cube.id,
            windowUID: cube.windowUID,
            center: null,
            originID: cube.id,
            blendingLogicId: null,
            vertexIds: [],
            order: idx
        }));

        const threshold = subIds.length > 8 ? 9 : 5;

        if (entries.length) {
            await putBatch(entries.slice(0, threshold));
            const asyncEntries = entries.slice(threshold);
            if (asyncEntries.length) {
                await Promise.all(asyncEntries.map(ent => putBatch([ent])));
            }
        }
    }
}

export async function cleanupStaleWindows(db, validIds) {
    const toDelete = [];
    await new Promise((resolve, reject) => {
        const tx = db.transaction('cubes', 'readonly');
        const store = tx.objectStore('cubes');
        const req = store.getAll();
        req.onsuccess = () => {
            req.result.forEach(r => { if (!validIds.includes(r.windowUID)) toDelete.push(r.windowUID); });
            resolve();
        };
        req.onerror = () => reject(req.error);
    });
    for (let id of [...new Set(toDelete)]) {
        await deleteWindowData(db, id);
    }
}