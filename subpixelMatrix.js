export function extractSubPixelMatrix(cube) {
  if (!cube || !cube.userData || !cube.userData.subMatrix || !cube.userData.subInfo) {
    return null;
  }
  const { rows, cols, layers } = cube.userData.subInfo;
  const data = {};
  for (let d = 0; d < layers; d++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const g = cube.userData.subMatrix[d]?.[r]?.[c];
        if (!g || !g.userData || !g.userData.vertexAttr) continue;
        const attr = g.userData.vertexAttr;
        const verts = [];
        for (let vi = 0; vi < attr.count; vi++) {
          verts.push([
            attr.array[vi * 3],
            attr.array[vi * 3 + 1],
            attr.array[vi * 3 + 2]
          ]);
        }
        data[`${r},${c},${d}`] = verts;
      }
    }
  }
  return data;
}

export function applySubPixelMatrix(cube, matrix) {
  if (!matrix || !cube || !cube.userData || !cube.userData.subMatrix || !cube.userData.subInfo) {
    return;
  }
  const { rows, cols, layers } = cube.userData.subInfo;
  for (let d = 0; d < layers; d++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const verts = matrix[`${r},${c},${d}`];
        if (!verts) continue;
        const g = cube.userData.subMatrix[d]?.[r]?.[c];
        if (!g || !g.userData || !g.userData.vertexAttr) continue;
        const attr = g.userData.vertexAttr;
        for (let vi = 0; vi < Math.min(attr.count, verts.length); vi++) {
          const vCol = verts[vi];
          if (!vCol) continue;
          attr.array[vi * 3] = vCol[0];
          attr.array[vi * 3 + 1] = vCol[1];
          attr.array[vi * 3 + 2] = vCol[2];
        }
        attr.needsUpdate = true;
      }
    }
  }
}

export function saveMatrixLocal(cubeId, matrix) {
  try {
    localStorage.setItem(`subpixel_matrix_${cubeId}`, JSON.stringify(matrix));
  } catch (e) {
    console.error('saveMatrixLocal failed', e);
  }
}

export function loadMatrixLocal(cubeId) {
  try {
    const str = localStorage.getItem(`subpixel_matrix_${cubeId}`);
    return str ? JSON.parse(str) : null;
  } catch (e) {
    console.error('loadMatrixLocal failed', e);
    return null;
  }
}
