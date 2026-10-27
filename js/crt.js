// An old TV for Quest's pictures: the scene is drawn small, in pixels, then shown through this screen,
// with scanlines, a glow around lights and fire, a color grille and a slight curve to the glass.
// Michael tuned it himself: scanlines 80, glow 60, curve 20, color grille 80.
export const TV = { scan: .8, glow: .6, curve: .2, grille: .8, aber: .6, vig: .52, flick: .5 };

const VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;uv.y=1.-uv.y;gl_Position=vec4(p,0.,1.);}';
const FS = `precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform vec2 src;uniform float curve,scan,glow,grille,aber,flick,vig,time;
vec3 at(vec2 q){return texture2D(tex,(floor(q*src)+.5)/src).rgb;}
vec3 soft(vec2 q){vec2 f=fract(q*src)-.5;vec2 b=(floor(q*src)+.5)/src;return mix(texture2D(tex,b).rgb,texture2D(tex,b+vec2(sign(f.x)/src.x,0.)).rgb,abs(f.x)*.35*scan);}
void main(){
  vec2 p=uv*2.-1.;vec2 o=abs(p.yx)/vec2(5.5,4.5);p+=p*o*o*curve*2.2;vec2 q=p*.5+.5;
  if(q.x<0.||q.y<0.||q.x>1.||q.y>1.){gl_FragColor=vec4(0.,0.,0.,1.);return;}
  vec3 col;float a=aber/src.x;col.r=soft(q+vec2(a,0.)).r;col.g=soft(q).g;col.b=soft(q-vec2(a,0.)).b;
  vec3 bl=vec3(0.);for(int i=-2;i<=2;i++)for(int j=-2;j<=2;j++){vec3 s=at(q+vec2(float(i),float(j))*1.6/src);float l=max(s.r,max(s.g,s.b));bl+=s*smoothstep(.62,1.,l)*clamp(.35+(s.r-s.b)*1.6,0.,1.);}
  col+=bl/25.*glow*2.4;
  col*=mix(1.,.62+.38*sin(fract(q.y*src.y)*3.14159),scan);
  float m=mod(gl_FragCoord.x,3.);vec3 mk=m<1.?vec3(1.,.72,.72):m<2.?vec3(.72,1.,.72):vec3(.72,.72,1.);col*=mix(vec3(1.),mk*1.18,grille);
  vec2 v=q*(1.-q.yx);col*=mix(1.,pow(v.x*v.y*16.,.22),vig);
  col*=1.+flick*.03*sin(time*55.);
  col=mix(col,col*col*(3.-2.*col),.12*scan);
  gl_FragColor=vec4(col,1.);}`;

const screens = new Map();
/** The screen for a picture of w x h pixels, made once and reused: browsers only allow a few WebGL screens at a time. */
export function screen(key, w, h, label) {
  let s = screens.get(key); if (s && s.w === w && s.h === h) return s;
  const cv = document.createElement('canvas'), k = 3; cv.width = w * k; cv.height = h * k; cv.className = 'crt'; cv.setAttribute('role', 'img');
  const gl = cv.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
  s = { cv, w, h, label };
  if (!gl) { const x = cv.getContext('2d'); s.show = src => { x.imageSmoothingEnabled = false; x.drawImage(src, 0, 0, cv.width, cv.height); }; }
  else {
    const sh = (type, txt) => { const o = gl.createShader(type); gl.shaderSource(o, txt); gl.compileShader(o); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(n => gl.texParameteri(gl.TEXTURE_2D, n, gl.NEAREST));
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(n => gl.texParameteri(gl.TEXTURE_2D, n, gl.CLAMP_TO_EDGE));
    const U = n => gl.getUniformLocation(pr, n);
    gl.uniform2f(U('src'), w, h);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    s.show = src => {
      gl.viewport(0, 0, cv.width, cv.height); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      for (const [n, v] of Object.entries(TV)) gl.uniform1f(U(n), n === 'flick' && still ? 0 : v);
      gl.uniform1f(U('time'), performance.now() / 1000); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  }
  screens.set(key, s); return s;
}
/** Put the screen in place of a placeholder element (keeps its aria label). */
export function mount(s, holder, label) {
  if (!holder) return; s.cv.setAttribute('aria-label', label || s.label || '');
  if (s.cv.parentNode !== holder) { holder.textContent = ''; holder.appendChild(s.cv); }
}
