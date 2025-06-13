export function verticesToMatrix(attr) {
  if (!attr || !attr.array || attr.count < 8) return null;
  const out = [];
  let i = 0;
  for (let z = 0; z < 2; z++) {
    out[z] = [];
    for (let y = 0; y < 2; y++) {
      out[z][y] = [];
      for (let x = 0; x < 2; x++) {
        out[z][y][x] = [
          attr.array[i * 3],
          attr.array[i * 3 + 1],
          attr.array[i * 3 + 2]
        ];
        i++;
      }
    }
  }
  return out;
}

export function matrixToVertices(attr, matrix) {
  if (!attr || !attr.array || !matrix) return;
  let i = 0;
  for (let z = 0; z < 2; z++) {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const col = matrix[z]?.[y]?.[x];
        if (col) {
          attr.array[i * 3] = col[0];
          attr.array[i * 3 + 1] = col[1];
          attr.array[i * 3 + 2] = col[2];
        }
        i++;
      }
    }
  }
  attr.needsUpdate = true;
}

let openPromise = null;

async function openMatrixDB() {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    if (!navigator.storageBuckets) {
      const req = indexedDB.open('SubMatrixDB', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('matrices')) {
          db.createObjectStore('matrices', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      return;
    }
    (async () => {
      try {
        const bucket = await navigator.storageBuckets.open('submatrix');
        const req = bucket.indexedDB.open('Matrices', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('matrices')) {
            db.createObjectStore('matrices', { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    })();
  });
  return openPromise;
}

export async function saveMatrixToStorage(cubeId, subId, matrix) {
  try {
    const db = await openMatrixDB();
    await new Promise((res, rej) => {
      const tx = db.transaction('matrices', 'readwrite');
      tx.objectStore('matrices').put({ id: `${cubeId}_${subId}`, cubeId, subId, matrix });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    localStorage.setItem(`subMatrix_${cubeId}_${subId}`, Date.now().toString());
  } catch (e) {
    console.warn('Failed to save subpixel matrix', e);
  }
}

export async function loadMatrixFromStorage(cubeId, subId) {
  try {
    const db = await openMatrixDB();
    const res = await new Promise((resolve, reject) => {
      const tx = db.transaction('matrices', 'readonly');
      const req = tx.objectStore('matrices').get(`${cubeId}_${subId}`);
      req.onsuccess = () => resolve(req.result ? req.result.matrix : null);
      req.onerror = () => reject(req.error);
    });
    return res;
  } catch (e) {
    console.warn('Failed to load subpixel matrix', e);
    return null;
  }
}
