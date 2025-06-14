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

import { openDB, saveMatrix, loadMatrix } from './db.js';

export async function saveMatrixToStorage(cubeId, subId, matrix) {
  try {
    const db = await openDB();
    await saveMatrix(db, cubeId, subId, matrix);
    localStorage.setItem(`subMatrix_${cubeId}_${subId}`, Date.now().toString());
  } catch (e) {
    console.warn('Failed to save subpixel matrix', e);
  }
}

export async function loadMatrixFromStorage(cubeId, subId) {
  try {
    const db = await openDB();
    return await loadMatrix(db, cubeId, subId);
  } catch (e) {
    console.warn('Failed to load subpixel matrix', e);
    return null;
  }
}
