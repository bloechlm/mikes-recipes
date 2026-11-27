'use strict';

const canvas = document.querySelector('canvas');
const button = document.querySelector('button');
const status = document.querySelector('#status');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const gl = canvas.getContext('webgl', { alpha: true, antialias: true });

function makeProgram(vertexSource, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  return program;
}

function pizzaMesh() {
  const segments = 144;
  const rings = [
    [0, .057], [.31, .06], [.61, .061], [.74, .065], [.8, .075],
    [.85, .105], [.89, .159], [.93, .165], [.968, .143],
    [.993, .102], [1, .064], [.985, .028], [.955, .009], [.91, 0],
  ];
  const vertices = [];
  const indices = [];
  for (const [index, [radius, elevation]] of rings.entries()) {
    for (let step = 0; step < segments; step++) {
      const angle = 2 * Math.PI * step / segments;
      const edge = .013 * Math.sin(angle * 5 + .55) + .019 * Math.cos(angle * 3)
        + .010 * Math.sin(angle * 13 + 1.18) + .007 * Math.cos(angle * 21);
      const bubbles = .016 * Math.sin(angle * 10 + .3) + .010 * Math.cos(angle * 17)
        + .010 * Math.sin(angle * 5);
      const distance = radius * (1 + edge);
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const y = Math.max(0, elevation + bubbles * Math.exp(-((radius - .93) ** 2) / .012)
        * Math.min(elevation / .085, 1));
      const textureRadius = index <= 8 ? radius : .965 - (index - 8) * .006;
      vertices.push(x, y, z, .5 + .485 * textureRadius * Math.cos(angle),
        .5 + .485 * textureRadius * Math.sin(angle), 0, 0, 0);
      if (index) {
        const previous = (index - 1) * segments + step;
        const next = (index - 1) * segments + (step + 1) % segments;
        indices.push(previous, next, next + segments, previous, next + segments, previous + segments);
      }
    }
  }

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 8, b = indices[i + 1] * 8, c = indices[i + 2] * 8;
    const ab = [vertices[b] - vertices[a], vertices[b + 1] - vertices[a + 1], vertices[b + 2] - vertices[a + 2]];
    const ac = [vertices[c] - vertices[a], vertices[c + 1] - vertices[a + 1], vertices[c + 2] - vertices[a + 2]];
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0]];
    for (const offset of [a, b, c]) {
      normal.forEach((value, axis) => { vertices[offset + 5 + axis] += value; });
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

async function start() {
  if (!gl) throw Error('WebGL unavailable');
  const topping = new Image();
  topping.src = 'pizza-assets/margherita.webp';
  await topping.decode();

  const program = makeProgram(`
    precision mediump float;
    attribute vec3 position;
    attribute vec2 uv;
    attribute vec3 normal;
    uniform float angle;
    uniform float shadowPass;
    varying vec2 texcoord;
    varying vec3 surfaceNormal;
    varying vec3 localPosition;
    void main() {
      float c = cos(angle);
      float s = sin(angle);
      mat2 spin = mat2(c, s, -s, c);
      vec2 groundPosition = spin * position.xz;
      float elevation = position.y;
      if (shadowPass > 0.5) {
        groundPosition = position.xz * vec2(1.13, 1.15) + vec2(.04, .11);
        elevation = -.008;
      }
      float depth = 1.0 - groundPosition.y * .21 - elevation * .10;
      vec2 screen = vec2(.48, -.35) + vec2(groundPosition.x * .66,
        (elevation * .90 - groundPosition.y * .43) * 1.15) / depth;
      gl_Position = vec4(screen * depth, depth - 1.0, depth);
      texcoord = uv;
      vec2 n = spin * normal.xz;
      surfaceNormal = vec3(n.x, normal.y, n.y);
      localPosition = position;
    }`, `
    precision mediump float;
    uniform sampler2D topping;
    uniform float shadowPass;
    varying vec2 texcoord;
    varying vec3 surfaceNormal;
    varying vec3 localPosition;
    void main() {
      if (shadowPass > 0.5) {
        float distanceFromCenter = length(localPosition.xz);
        gl_FragColor = vec4(.048, .022, .012, .69 * (1.0 - smoothstep(.72, 1.0, distanceFromCenter)));
        return;
      }
      vec3 n = normalize(surfaceNormal + vec3(0., .00001, 0.));
      vec3 fire = normalize(vec3(-.48, .55, -.72));
      vec3 diffuse = texture2D(topping, texcoord).rgb;
      float side = smoothstep(.26, .85, 1.0 - n.y);
      float grain = sin(localPosition.x * 91.0 + localPosition.y * 59.0)
        * sin(localPosition.z * 83.0 - localPosition.y * 27.0);
      diffuse = mix(diffuse, diffuse * (.79 + .09 * grain), side);
      float lit = max(dot(n, fire), 0.0);
      vec3 warmth = vec3(.76, .66, .53) + lit * vec3(.44, .31, .19);
      float gloss = pow(max(dot(n, normalize(fire + vec3(0., .4, 1.))), 0.), 18.);
      gl_FragColor = vec4(diffuse * warmth + .065 * gloss * vec3(1., .61, .3), 1.);
    }`);
  gl.useProgram(program);
  const mesh = pizzaMesh();
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
  for (const [name, size, offset] of [['position', 3, 0], ['uv', 2, 12], ['normal', 3, 20]]) {
    const location = gl.getAttribLocation(program, name);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
    gl.enableVertexAttribArray(location);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, topping);

  const angle = gl.getUniformLocation(program, 'angle');
  const shadowPass = gl.getUniformLocation(program, 'shadowPass');
  let frame = 0;
  let turns = 0;
  let manualAngle = 0;
  let previousTime = 0;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  function draw(time) {
    frame = 0;
    const targetAngle = turns * Math.PI / 3;
    const elapsed = previousTime ? Math.min(time - previousTime, 40) : 16;
    previousTime = time;
    const isAnimating = Math.abs(targetAngle - manualAngle) > .002;
    manualAngle = isAnimating && !reducedMotion.matches
      ? manualAngle + (targetAngle - manualAngle) * Math.min(elapsed / 140, 1) : targetAngle;
    const scrollRange = document.documentElement.scrollHeight - innerHeight;
    const progress = reducedMotion.matches || scrollRange <= 0 ? 0
      : Math.max(0, Math.min(1, scrollY / scrollRange));
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Flat shadow stays on the stone while the model rotates above it.
    gl.enable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.uniform1f(shadowPass, 1);
    gl.drawElements(gl.TRIANGLES, 144 * 6 * 10, gl.UNSIGNED_SHORT, 0);

    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.uniform1f(shadowPass, 0);
    gl.uniform1f(angle, progress * Math.PI / 3 + manualAngle);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    if (isAnimating && !reducedMotion.matches) schedule();
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  button.disabled = false;
  button.addEventListener('click', () => { turns++; schedule(); });
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  reducedMotion.addEventListener('change', schedule);
  canvas.addEventListener('webglcontextlost', unavailable);
  schedule();
}

function unavailable() {
  canvas.hidden = true;
  button.disabled = true;
  status.textContent = 'Die 3D-Drehprobe konnte auf diesem Gerät nicht geladen werden.';
}

start().catch(error => {
  console.error(error);
  unavailable();
});
