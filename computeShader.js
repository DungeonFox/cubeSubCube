export function createColorShader() {
    return `
        uniform float time;
        float rand(vec2 co){
            return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
        }
        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            float i = uv.y * resolution.x + uv.x;
            vec3 base = vec3(
                0.5 + 0.5 * sin(time + i * 0.1),
                0.5 + 0.5 * sin(time * 0.5 + i * 0.2),
                0.5 + 0.5 * sin(time * 0.8 + i * 0.3)
            );
            float n = rand(uv + time * 0.1);
            vec3 col = mix(base, base.bgr, n);
            gl_FragColor = vec4(col, 1.0);
        }
    `;
}

export function createPositionShader() {
    return `
        uniform float time;
        vec3 getPos(float i) {
            float angle = i * 0.05 + time * 0.2;
            float radius = 50.0 + 10.0 * sin(time * 0.5 + i * 0.13);
            return vec3(cos(angle) * radius, sin(angle) * radius, sin(angle*0.5) * radius * 0.2);
        }
        void main() {
            float i = gl_FragCoord.y * resolution.x + gl_FragCoord.x;
            vec3 p = getPos(i);
            gl_FragColor = vec4(p, 1.0);
        }
    `;
}

export function createVelocityShader() {
    return `
        uniform sampler2D posTex;
        uniform sampler2D velTex;
        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec3 pos = texture2D(posTex, uv).xyz;
            vec3 vel = texture2D(velTex, uv).xyz;
            vel += -pos * 0.002;
            vel *= 0.98;
            gl_FragColor = vec4(vel, 1.0);
        }
    `;
}

export function createIntegrateShader() {
    return `
        uniform sampler2D posTex;
        uniform sampler2D velTex;
        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec3 pos = texture2D(posTex, uv).xyz;
            vec3 vel = texture2D(velTex, uv).xyz;
            gl_FragColor = vec4(pos + vel, 1.0);
        }
    `;
}
