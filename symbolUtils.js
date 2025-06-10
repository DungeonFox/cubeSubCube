let t = THREE;

export function generateSymbol(index) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let symbol = '';
    let value = index;
    do {
        symbol = chars[value % chars.length] + symbol;
        value = Math.floor(value / chars.length);
    } while (value > 0 && symbol.length < 4);
    return symbol.padEnd(2, 'A');
}

export function getSubCubeSymbol(cube, r, c, d) {
    let ordered = orderSubCubes(cube);
    for (let i = 0; i < ordered.length; i++) {
        let o = ordered[i];
        if (o.row === r && o.col === c && o.layer === d) {
            return generateSymbol(i);
        }
    }
    return 'AA';
}

export function getRowColLayerFromSymbol(cube, symbol) {
    let ordered = orderSubCubes(cube);
    for (let i = 0; i < ordered.length; i++) {
        if (generateSymbol(i) === symbol) {
            let ent = ordered[i];
            return [ent.row, ent.col, ent.layer];
        }
    }
    return [0, 0, 0]; // Default to first subcube
}

export function orderSubCubes(cube) {
    if (!cube.userData.subInfo || !cube.userData.subMatrix) return [];
    let { rows, cols, layers } = cube.userData.subInfo;
    let result = [];
    let center = { row: Math.floor(rows / 2), col: Math.floor(cols / 2), layer: Math.floor(layers / 2) };

    function pushEntry(r, c, d) {
        if (!cube.userData.subMatrix[d] || !cube.userData.subMatrix[d][r] || !cube.userData.subMatrix[d][r][c]) return;
        let idx = d * rows * cols + r * cols + c;
        let color = new THREE.Color(
            cube.userData.colorBuffer[idx * 3],
            cube.userData.colorBuffer[idx * 3 + 1],
            cube.userData.colorBuffer[idx * 3 + 2]
        );
        let weight = cube.userData.weightBuffer ? cube.userData.weightBuffer[idx] : 1;
        result.push({ row: r, col: c, layer: d, color: `#${color.getHexString()}`, weight });
    }

    // Step 1: Add center subcube first
    pushEntry(center.row, center.col, center.layer);

    // Step 2: Add corner subcubes
    let corners = [
        [0, 0, 0],
        [0, 0, layers - 1],
        [0, cols - 1, 0],
        [0, cols - 1, layers - 1],
        [rows - 1, 0, 0],
        [rows - 1, 0, layers - 1],
        [rows - 1, cols - 1, 0],
        [rows - 1, cols - 1, layers - 1]
    ];
    corners.forEach(co => {
        let key = `${co[0]},${co[1]},${co[2]}`;
        if (!result.some(ent => ent.row === co[0] && ent.col === co[1] && ent.layer === co[2])) {
            pushEntry(co[0], co[1], co[2]);
        }
    });

    // Step 3: Add remaining subcubes in top-left to bottom-right order
    let added = new Set(result.map(ent => `${ent.row},${ent.col},${ent.layer}`));
    for (let d = 0; d < layers; d++) {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                let key = `${r},${c},${d}`;
                if (!added.has(key)) {
                    pushEntry(r, c, d);
                    added.add(key);
                }
            }
        }
    }

    return result;
}