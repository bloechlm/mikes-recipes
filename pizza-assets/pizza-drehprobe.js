'use strict';

const canvas = document.querySelector('canvas');
const title = document.querySelector('h1');
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

function pizzaMesh(topping) {
  const sampler = document.createElement('canvas');
  sampler.width = sampler.height = 192;
  const ctx = sampler.getContext('2d');
  ctx.drawImage(topping, 0, 0, 192, 192);
  const pixels = ctx.getImageData(0, 0, 192, 192).data;
  const surfaceRings = 27;
  const segments = 144;
  const rings = [
    ...Array.from({ length: surfaceRings }, (_, i) => [.78 * i / (surfaceRings - 1), .066]),
    [.8, .075],
    [.85, .118], [.89, .152], [.93, .161], [.968, .145],
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
      const sampleX = Math.floor((.5 + .485 * radius * Math.cos(angle)) * 192);
      const sampleY = Math.floor((.5 + .485 * radius * Math.sin(angle)) * 192);
      const pixel = (sampleY * 192 + sampleX) * 4;
      const [red, green, blue] = [pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]];
      const cheese = Math.max(0, (green + blue - 175) / 335);
      const basil = Math.max(0, (green - red + 18) / 100);
      const relief = (cheese * .029 + basil * .027 + .005 * Math.cos(x * 29 + z * 23))
        * Math.max(0, Math.min(1, (.79 - radius) * 14));
      const y = Math.max(0, elevation + relief + bubbles * Math.exp(-((radius - .93) ** 2) / .012)
        * Math.min(elevation / .085, 1));
      const textureRadius = index < surfaceRings + 5 ? radius : .96;
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
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices), shadowIndexCount: (surfaceRings + 6) * segments * 6 };
}

async function start() {
  if (!gl) throw Error('WebGL unavailable');
  const topping = new Image();
  topping.src = 'pizza-assets/margherita-render.webp';
  const crust = new Image();
  crust.src = 'pizza-assets/cornicione-texture.webp';
  const diavola = new Image();
  diavola.src = 'pizza-assets/diavola-render.webp';
  await Promise.all([topping.decode(), crust.decode(), diavola.decode()]);

  const program = makeProgram(`
    precision mediump float;
    attribute vec3 position;
    attribute vec2 uv;
    attribute vec3 normal;
    attribute vec3 diavolaPosition;
    attribute vec3 diavolaNormal;
    uniform float toppingMix;
    uniform float angle;
    uniform float shadowPass;
    varying vec2 texcoord;
    varying vec3 surfaceNormal;
    varying vec3 localPosition;
    void main() {
      float c = cos(angle);
      float s = sin(angle);
      mat2 spin = mat2(c, s, -s, c);
      vec3 shape = mix(position, diavolaPosition, toppingMix);
      vec3 shapeNormal = mix(normal, diavolaNormal, toppingMix);
      vec2 groundPosition = spin * shape.xz;
      float elevation = shape.y;
      if (shadowPass > 0.5) {
        groundPosition = (spin * position.xz) * vec2(1.08, 1.12) + vec2(.04, .11);
        elevation = -.008;
      }
      float depth = 1.0 - groundPosition.y * .21 - elevation * .10;
      vec2 screen = vec2(.62, -.47) + vec2(groundPosition.x * .735,
        (elevation * .96 - groundPosition.y * .43) * 1.22) / depth;
      gl_Position = vec4(screen * depth, depth - 1.0, depth);
      texcoord = uv;
      vec2 n = spin * shapeNormal.xz;
      surfaceNormal = vec3(n.x, shapeNormal.y, n.y);
      localPosition = shape;
    }`, `
    precision mediump float;
    uniform sampler2D topping;
    uniform sampler2D crust;
    uniform sampler2D diavola;
    uniform float toppingMix;
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
      vec3 diffuse = mix(texture2D(topping, texcoord).rgb, texture2D(diavola, texcoord).rgb, toppingMix);
      float radius = length(localPosition.xz);
      float side = smoothstep(.815, .94, radius);
      float around = atan(localPosition.z, localPosition.x) / 6.2831853 + .5;
      vec2 breadUV = vec2(around * 6.0, .88 - localPosition.y * 3.8);
      vec3 bread = texture2D(crust, breadUV).rgb;
      float toasted = smoothstep(.08, .42, dot(bread, vec3(.299, .587, .114)));
      bread *= mix(.64, 1.04, toasted);
      diffuse = mix(diffuse, bread, side);
      float contact = mix(.56, 1.0, smoothstep(.009, .13, localPosition.y));
      float lit = max(dot(n, fire), 0.0);
      vec3 warmth = vec3(.66, .56, .46) + lit * vec3(.56, .41, .26);
      vec3 halfVector = normalize(fire + normalize(vec3(-.16, .43, 1.0)));
      float highlight = max(dot(n, halfVector), 0.0);
      float wetness = smoothstep(.16, .72, max(diffuse.r, diffuse.g));
      float sheen = pow(highlight, 16.0) * .20 + pow(highlight, 46.0) * .56;
      vec3 reflection = vec3(1.0, .68, .38) * sheen * mix(.18, .9, wetness) * (1.0 - side * .94);
      gl_FragColor = vec4(diffuse * warmth * contact + reflection, 1.);
    }`);
  gl.useProgram(program);
  const mesh = pizzaMesh(topping);
  const secondMesh = pizzaMesh(diavola);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
  for (const [name, size, offset] of [['position', 3, 0], ['uv', 2, 12], ['normal', 3, 20]]) {
    const location = gl.getAttribLocation(program, name);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
    gl.enableVertexAttribArray(location);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, secondMesh.vertices, gl.STATIC_DRAW);
  for (const [name, offset] of [['diavolaPosition', 0], ['diavolaNormal', 20]]) {
    const location = gl.getAttribLocation(program, name);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 32, offset);
    gl.enableVertexAttribArray(location);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  for (const [unit, name, image] of [[0, 'topping', topping], [1, 'crust', crust], [2, 'diavola', diavola]]) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, unit === 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, unit === 1 ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    if (unit === 1) gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
  }

  const angle = gl.getUniformLocation(program, 'angle');
  const shadowPass = gl.getUniformLocation(program, 'shadowPass');
  let frame = 0;
  let turns = 0;
  let manualAngle = 0;
  let previousTime = 0;
  let selectedDiavola = false;
  const toppingMix = gl.getUniformLocation(program, 'toppingMix');
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
    const progress = scrollRange <= 0 ? 0
      : Math.max(0, Math.min(1, scrollY / scrollRange));
    const isDiavola = progress >= .5;
    if (selectedDiavola !== isDiavola) {
      selectedDiavola = isDiavola;
      title.textContent = isDiavola ? 'Diavola' : 'Margherita';
    }
    const blend = Math.max(0, Math.min(1, (progress - .20) / .60));
    gl.uniform1f(toppingMix, reducedMotion.matches ? Number(isDiavola) : blend * blend * (3 - 2 * blend));
    const rotation = (reducedMotion.matches ? 0 : progress) * Math.PI / 3 + manualAngle;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Flat shadow stays on the stone while the model rotates above it.
    gl.enable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.uniform1f(angle, rotation);
    gl.uniform1f(shadowPass, 1);
    gl.drawElements(gl.TRIANGLES, mesh.shadowIndexCount, gl.UNSIGNED_SHORT, 0);

    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.uniform1f(shadowPass, 0);
    gl.uniform1f(angle, rotation);
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
