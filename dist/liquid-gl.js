// WebGL2 liquid renderer: particles are splatted into a per-colour density field
// (two RGBA16F targets via MRT), then a full-screen pass turns the field into glossy
// beads — height from the dominant colour minus its neighbour (so different colours
// meet in a groove), normals from the field gradient, refraction of the real page
// background, specular + fresnel rim, and a soft caustic glint.

const VS_SPLAT = `#version 300 es
in vec4 a_p; // x, y, colour, size
uniform vec2 u_view; uniform float u_top, u_ppu;
out float v_c; out float v_g;
void main(){
  vec2 p = vec2(a_p.x / u_view.x, (a_p.y - u_top) / u_view.y);
  gl_Position = vec4(p.x * 2. - 1., 1. - p.y * 2., 0., 1.);
  float gq = floor(a_p.w / 100.); float rad = a_p.w - gq * 100.; // size packs radius + 100×gel level
  gl_PointSize = rad * u_ppu * 2.;
  v_c = a_p.z; v_g = gq / 8.;
}`;
const FS_SPLAT = `#version 300 es
precision mediump float;
in float v_c; in float v_g;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
uniform float u_gain;
void main(){
  vec2 d = gl_PointCoord * 2. - 1.; float r2 = dot(d, d);
  if (r2 > 1.) discard;
  float w = 1. - r2; w = w * w * w * u_gain;
  int c = int(floor(v_c + .01));
  float pr = (v_c - float(c)) / .45;
  o0 = vec4(c == 1 ? w : 0., c == 2 ? w : 0., c == 3 ? w : 0., c == 4 ? w : 0.);
  o1 = vec4(c == 5 ? w : 0., c == 6 ? w : 0., v_g * w, pr * w);
}`;
const VS_QUAD = `#version 300 es
in vec2 a_q; out vec2 v_uv;
void main(){ v_uv = a_q * .5 + .5; gl_Position = vec4(a_q, 0., 1.); }`;
const FS_BLUR = `#version 300 es
precision mediump float;
in vec2 v_uv;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
uniform sampler2D u_a, u_b; uniform vec2 u_dir;
const float W0 = .2270270, W1 = .3162162, W2 = .0702703;
void main(){
  vec2 d1 = u_dir * 1.3846154, d2 = u_dir * 3.2307692;
  o0 = texture(u_a, v_uv) * W0 + (texture(u_a, v_uv + d1) + texture(u_a, v_uv - d1)) * W1 + (texture(u_a, v_uv + d2) + texture(u_a, v_uv - d2)) * W2;
  o1 = texture(u_b, v_uv) * W0 + (texture(u_b, v_uv + d1) + texture(u_b, v_uv - d1)) * W1 + (texture(u_b, v_uv + d2) + texture(u_b, v_uv - d2)) * W2;
}`;
const FS_COMP = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_f0, u_f1, u_bg;
uniform vec2 u_tx;          // field texel
uniform vec3 u_pal[8];
uniform vec4 u_bgMap;       // canvas uv -> bg uv: scale.xy, offset.xy
uniform float u_time, u_gainInv, u_T, u_D, u_N, u_ghost, u_K;
uniform vec4 u_flash;       // xy centre (uv), radius, strength

float hw[8]; float prw, gw;
void fetchW(vec2 uv){
  vec4 a = texture(u_f0, uv), b = texture(u_f1, uv); prw = b.a; gw = b.b;
  hw[1]=a.r; hw[2]=a.g; hw[3]=a.b; hw[4]=a.a; hw[5]=b.r; hw[6]=b.g; hw[7]=0.;
}
// height: different colours press together (no gap) and meet in a thin shallow crease
float creaseW;
vec2 hgt(vec2 uv){
  fetchW(uv);
  float m1 = 0., m2 = 0., ci = 0.;
  for (int k = 1; k < 8; k++){ float v = hw[k]; if (v > m1){ m2 = m1; m1 = v; ci = float(k); } else if (v > m2) m2 = v; }
  creaseW = (1. - smoothstep(0., .3, (m1 - m2) / max(m1, 1e-4))) * smoothstep(0., .15, m2 * u_gainInv);
  return vec2((m1 + m2) * u_gainInv, ci); // no dip → no see-through seam
}
void main(){
  vec2 uv = v_uv;
  vec2 hc = hgt(uv);
  float h = hc.x; int ci = int(hc.y + .5);
  float crease = creaseW;
  float tot = hw[1] + hw[2] + hw[3] + hw[4] + hw[5] + hw[6] + hw[7];
  float prog = clamp(prw / max(tot, 1e-3), 0., 1.);
  float gel = clamp(gw / max(tot, 1e-3), 0., 1.);
  float T = u_T;
  float aa = fwidth(h) * 1.2 + .02;
  float m = smoothstep(T - aa, T + aa, h);
  // colours meet softly (a few px of blend), like two liquids touching — not a hard cut
  vec3 base = vec3(0.); float bw = 0., mx = max(max(max(hw[1], hw[2]), max(hw[3], hw[4])), max(hw[5], hw[6]));
  for (int k = 1; k < 7; k++){ float r = hw[k] / max(mx, 1e-5); float wk = r * r * r; base += u_pal[k] * wk; bw += wk; }
  base = bw > 0. ? base / bw : u_pal[ci];
  bool mud = ci == 6;
  // soft outer glow just outside the surface (gummy candy look)
  if (m < .003) {
    float halo = smoothstep(T * .35, T, h) * (mud ? .0 : .22);
    if (halo < .004 || u_ghost > .5) { o = vec4(0.); return; }
    o = vec4(base * halo, halo); return;
  }
  if (u_ghost > .5) { // preview ghost: same smooth liquid outline, drawn as tinted glass with a bright rim
    float rim = 1. - smoothstep(T, T + .7, h);
    vec3 gc = mix(u_pal[ci], vec3(1.), .45);
    float ga = m * (.3 + .65 * rim) * (.85 + .15 * sin(u_time * 4.));
    o = vec4(gc * ga, ga); return;
  }
  // broad normals (sampled far apart) → one smooth highlight per blob, not a sparkle on every bump
  vec2 e = u_tx * 4.;
  float hl = hgt(uv - vec2(e.x, 0.)).x, hr = hgt(uv + vec2(e.x, 0.)).x;
  float hd = hgt(uv - vec2(0., e.y)).x, hu = hgt(uv + vec2(0., e.y)).x;
  float dome = smoothstep(T, T + u_D, h);
  vec2 g = vec2(hr - hl, hu - hd);
  // slow convection inside the jelly: a soft flow field drifts through the body (꿀렁꿀렁), never touching the outline
  vec2 P = vec2(uv.x, uv.y * u_tx.x / u_tx.y) * 24.;
  float ft = u_time * .35;
  vec2 q = P * .32 + vec2(sin(P.y * .4 + ft) * .9, cos(P.x * .35 - ft * .8) * .9);
  float fl = sin(q.x + ft * .7) * cos(q.y - ft * .5);
  vec2 fg = vec2(cos(q.x + ft * .7) * cos(q.y - ft * .5), -sin(q.x + ft * .7) * sin(q.y - ft * .5));
  float inner = smoothstep(T + u_D * .25, T + u_D * 1.2, h);
  g += fg * .022 * inner;
  vec3 n = normalize(vec3(-g * u_N * (1. - .6 * dome), 1.));
  vec3 L = normalize(vec3(-.5, .65, .6)), V = vec3(0., 0., 1.), Hh = normalize(L + V);
  float diff = clamp(dot(n, L) * .5 + .5, 0., 1.);
  // gummy body: one smooth top→bottom gradient (depth below the top surface, averaged over 6 samples)
  // gummy jelly like the reference: saturated body lit from the upper-left, a brighter translucent band
  // inside the lower-right rim (light passing through), and a crisp glossy highlight on upper-left curves
  float edge = 1. - dome;
  // pillow normal: strong tilt near the silhouette so every blob reads as a rounded dome
  // (gradient of the clamped dome, so deep interiors stay smooth instead of showing every cell bump)
  float dl = smoothstep(T, T + u_D, hl), dr = smoothstep(T, T + u_D, hr), dd = smoothstep(T, T + u_D, hd), du = smoothstep(T, T + u_D, hu);
  vec3 pn = normalize(vec3(-vec2(dr - dl, du - dd) * u_N * 2.2, .5));
  float pdiff = clamp(dot(pn, L), 0., 1.);
  vec3 col = base * (.8 + .32 * pdiff);
  col = mix(col, base * vec3(.78, .78, .84), smoothstep(.2, .9, -pn.y) * edge * .28);       // shaded underside
  float through = smoothstep(.05, .7, -pn.y * .6 + pn.x * .55) * smoothstep(.0, .35, dome) * (1. - smoothstep(.35, .9, dome));
  col = mix(col, mix(base, vec3(1.), .42), through * .5);                                      // light through the jelly
  vec3 Hs = normalize(vec3(-.5, .62, .62));
  float sp = pow(max(dot(pn, Hs), 0.), 46.);
  // break the glint into separate spots (wet jelly), not one continuous plastic tube highlight
  vec2 P2 = vec2(uv.x, uv.y * u_tx.x / u_tx.y) * 24.;
  float spots = sin(P2.x * 1.3 + u_time * .25) * sin(P2.y * 1.1 - P2.x * .4 + u_time * .2);
  sp *= smoothstep(.15, .7, spots);
  col += sp * (mud ? .2 : 1.1);                                                                 // glossy highlight
  col += pow(max(dot(pn, Hs), 0.), 6.) * (mud ? .02 : .07);                                    // soft sheen around it
  col = mix(col, mix(base, vec3(1.), .3), (fl * .5 + .5) * .14 * inner);                  // lighter currents drifting inside
  if (mud) col = mix(col, base, .35);
  float depth = dome;
  col *= 1. - .0 * crease;                                                                     // thin crease where colours meet
  // gentle edge: slightly darker contact rim
  col *= mix(.93, 1., smoothstep(T, T + u_D * .12, h));
  // bodies close to popping breathe a little brighter
  float ready = smoothstep(.6, 1., prog);
  col += base * .16 * ready * (.6 + .4 * sin(u_time * 3.));
  col = mix(col, col * .9 + .05, gel * .5);
  // pop flash
  float fd = length((uv - u_flash.xy) * vec2(1., u_tx.x / u_tx.y));
  col += u_flash.w * smoothstep(u_flash.z, u_flash.z * .4, fd) * .45;
  bool spray = false;
  float a = m * (spray ? .92 : .97);
  o = vec4(col * a, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export function createLiquidRenderer(canvas, { W, viewTop, viewH, hexes }) {
  let gl;
  try { gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false }); } catch { gl = null; }
  if (!gl) return null;
  const floatOk = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  let splat, comp, blur;
  try { splat = program(gl, VS_SPLAT, FS_SPLAT); comp = program(gl, VS_QUAD, FS_COMP); blur = program(gl, VS_QUAD, FS_BLUR); } catch (e) { console.warn(e); return null; }
  const gain = floatOk ? 1 : .3;

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const vbo = gl.createBuffer();
  let cap = 0, data = new Float32Array(0);
  const vaoS = gl.createVertexArray(); gl.bindVertexArray(vaoS);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo); const la = gl.getAttribLocation(splat.p, 'a_p');
  gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 4, gl.FLOAT, false, 16, 0);
  const vaoQ = gl.createVertexArray(); gl.bindVertexArray(vaoQ);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); const lq = gl.getAttribLocation(comp.p, 'a_q');
  gl.enableVertexAttribArray(lq); gl.vertexAttribPointer(lq, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const pal = new Float32Array(24);
  hexes.forEach((h, k) => { if (!h || k > 7) return; for (let j = 0; j < 3; j++) pal[k * 3 + j] = parseInt(h.slice(1 + j * 2, 3 + j * 2), 16) / 255; });

  // field targets
  let fw = 0, fh = 0, fbo = null, t0 = null, t1 = null, fbo2 = null, t2 = null, t3 = null;
  function makeTex(w, h) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    if (floatOk) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function makeFbo(a, b) {
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return f;
  }
  // background texture for refraction
  const bgTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, bgTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 120, 120, 255]));
  let bgMap = [1, 1, 0, 0];
  const look = { T: 0.95, D: 3.2, N: 1.4, B: 1.8, K: .75 };

  function pass(first, count, time, flash, ghost) {
    // 1. splat
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, fw, fh);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(splat.p); gl.bindVertexArray(vaoS);
    gl.uniform2f(splat.u.u_view, W, viewH); gl.uniform1f(splat.u.u_top, viewTop);
    gl.uniform1f(splat.u.u_ppu, fw / W); gl.uniform1f(splat.u.u_gain, gain);
    if (count) gl.drawArrays(gl.POINTS, first, count);
    // 2. separable gaussian blur (H into fbo2, V back into fbo) — smooth, clean surfaces
    gl.disable(gl.BLEND);
    gl.useProgram(blur.p); gl.bindVertexArray(vaoQ);
    gl.uniform1i(blur.u.u_a, 0); gl.uniform1i(blur.u.u_b, 1);
    for (const [dst, a, b, dx, dy] of [[fbo2, t0, t1, look.B / fw, 0], [fbo, t2, t3, 0, look.B / fh]]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b);
      gl.uniform2f(blur.u.u_dir, dx, dy);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // 3. composite over whatever is already on the canvas
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(comp.p); gl.bindVertexArray(vaoQ);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t0); gl.uniform1i(comp.u.u_f0, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, t1); gl.uniform1i(comp.u.u_f1, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bgTex); gl.uniform1i(comp.u.u_bg, 2);
    gl.uniform2f(comp.u.u_tx, 1 / fw, 1 / fh);
    gl.uniform3fv(comp.u.u_pal, pal);
    gl.uniform4fv(comp.u.u_bgMap, bgMap);
    gl.uniform1f(comp.u.u_time, time); gl.uniform1f(comp.u.u_gainInv, 1 / gain);
    gl.uniform4fv(comp.u.u_flash, flash);
    gl.uniform1f(comp.u.u_T, look.T); gl.uniform1f(comp.u.u_D, look.D); gl.uniform1f(comp.u.u_N, look.N); gl.uniform1f(comp.u.u_K, look.K);
    gl.uniform1f(comp.u.u_ghost, ghost);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  return {
    gl, look,
    setBackground(img) {
      gl.bindTexture(gl.TEXTURE_2D, bgTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },
    setBgMap(m) { bgMap = m; },
    setLook(l) { Object.assign(look, l); },
    resize(w, h) {
      canvas.width = w; canvas.height = h;
      const nw = Math.max(2, Math.round(w * .5)), nh = Math.max(2, Math.round(h * .5));
      if (nw === fw && nh === fh) return;
      fw = nw; fh = nh;
      if (fbo) { gl.deleteFramebuffer(fbo); gl.deleteFramebuffer(fbo2); [t0, t1, t2, t3].forEach(t => gl.deleteTexture(t)); }
      t0 = makeTex(fw, fh); t1 = makeTex(fw, fh); t2 = makeTex(fw, fh); t3 = makeTex(fw, fh);
      fbo = makeFbo(t0, t1); fbo2 = makeFbo(t2, t3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    // pts: Float32Array [x, y, colour, radius] * count
    // pts: Float32Array [x, y, colour, radius] * (count + ghostCount); the last ghostCount points are a preview ghost
    draw(pts, count, time, flash = [0, 0, 0, 0], ghostCount = 0) {
      if (!fbo) return;
      const total = count + ghostCount;
      if (total * 4 > cap) { cap = Math.max(total * 4, 4096) * 2; data = new Float32Array(cap); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW); }
      if (total) { gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pts, 0, total * 4); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      pass(0, count, time, flash, 0);
      if (ghostCount) pass(count, ghostCount, time, [0, 0, 0, 0], 1);
    },
  };
}
