export function blendVertices(vertices, mode = 'average') {
  if (!vertices || vertices.length === 0) {
    return { r: 0, g: 0, b: 0 };
  }

  const clamp = v => Math.max(0, Math.min(1, v));

  if (mode === 'max') {
    let r = 0, g = 0, b = 0;
    vertices.forEach(v => {
      r = Math.max(r, v.color[0]);
      g = Math.max(g, v.color[1]);
      b = Math.max(b, v.color[2]);
    });
    return { r: clamp(r), g: clamp(g), b: clamp(b) };
  }

  let totalWeight = 0;
  let rSum = 0, gSum = 0, bSum = 0;

  vertices.forEach(v => {
    const w = mode === 'weighted' ? (v.weight ?? 1) : 1;
    rSum += v.color[0] * w;
    gSum += v.color[1] * w;
    bSum += v.color[2] * w;
    totalWeight += w;
  });

  if (mode === 'layered') {
    const first = vertices[0];
    return { r: clamp(first.color[0]), g: clamp(first.color[1]), b: clamp(first.color[2]) };
  }

  const inv = totalWeight > 0 ? 1 / totalWeight : 0;
  return { r: clamp(rSum * inv), g: clamp(gSum * inv), b: clamp(bSum * inv) };
}
