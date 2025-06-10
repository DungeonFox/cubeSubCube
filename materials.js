let t = THREE;

export function createSubCubeMaterial() {
    // Use vertex colors per instance so each sub-cube can be uniquely tinted
    return new t.MeshBasicMaterial({ vertexColors: true });
}

export function createCubeMaterial(color) {
    return new t.MeshBasicMaterial({ color, wireframe: true });
}

export function createPointsMaterial(texture) {
    return new t.ShaderMaterial({
        uniforms: {
            map: { value: texture },
            size: { value: 1.0 },
            opacity: { value: 1.0 }
        },
        vertexShader: `
            attribute float alpha;
            varying float vAlpha;
            void main() {
                vAlpha = alpha;
                gl_PointSize = size;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D map;
            varying float vAlpha;
            void main() {
                gl_FragColor = texture2D(map, gl_PointCoord) * vAlpha;
            }
        `,
        transparent: true,
        depthWrite: false
    });
}
