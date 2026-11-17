/* 参数化家具 3D 模型生成器：按真实长宽高 + 颜色 + 材质构建 */
(function () {
  const T = THREE;
  const SD = (window.SD = window.SD || {});

  // ---------- 基础工具 ----------
  function mat(color, type) {
    const P = {
      fabric:  { roughness: 0.95, metalness: 0 },
      leather: { roughness: 0.42, metalness: 0.05 },
      wood:    { roughness: 0.6,  metalness: 0 },
      metal:   { roughness: 0.32, metalness: 0.85 }
    };
    const p = P[type] || P.fabric;
    const m = new T.MeshStandardMaterial(Object.assign({ color }, p));
    // 布艺加程序化织物纹理，增强真实质感
    if ((type === 'fabric' || !type) && SD.fabricTexture) {
      try {
        const tex = SD.fabricTexture(color);
        m.map = tex;
        m.color = new T.Color(0xffffff);
      } catch (e) { /* 忽略纹理失败 */ }
    }
    return m;
  }
  function shade(hex, f) {
    const c = new T.Color(hex);
    const hsl = {}; c.getHSL(hsl);
    hsl.l = Math.min(1, Math.max(0, hsl.l * f));
    c.setHSL(hsl.h, hsl.s, hsl.l);
    return '#' + c.getHexString();
  }
  function mesh(geo, m) {
    const ms = new T.Mesh(geo, m);
    ms.castShadow = true; ms.receiveShadow = true;
    return ms;
  }
  function box(w, h, d, m) { return mesh(new T.BoxGeometry(w, h, d), m); }
  function cyl(rt, rb, h, m, seg) { return mesh(new T.CylinderGeometry(rt, rb, h, seg || 20), m); }
  // 放置：x,z 平移 y 为底部离地高度（盒子中心 = y + h/2）
  function put(m, x, y, z) { m.position.set(x, y, z); return m; }

  // ---------- 商品图贴面：把商品图贴到模型的脸/台面，纹理细节与实物一致 ----------
  const _photoImgs = {};   // src -> {img, ok, cbs}
  function photoImg(src) {
    let e = _photoImgs[src];
    if (!e) {
      e = _photoImgs[src] = { img: new Image(), ok: false, cbs: [] };
      e.img.onload = () => { e.ok = true; e.cbs.forEach(f => f()); e.cbs = []; };
      e.img.src = src;
    }
    return e;
  }
  // 抠掉影棚背景：四边泛洪 + 只保留主体（去掉尺寸标注/绿条标题）→ 返回主体包围盒
  function matte(canvas) {
    const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d');
    let id;
    try { id = ctx.getImageData(0, 0, w, h); } catch (e) { return null; }
    const p = id.data, n = w * h;

    // 背景色：取四边像素的众数（对顶部横幅不敏感）
    const bins = {};
    const quant = (i) => ((p[i * 4] >> 4) << 8) | ((p[i * 4 + 1] >> 4) << 4) | (p[i * 4 + 2] >> 4);
    const sample = (i) => { const k = quant(i); (bins[k] = bins[k] || { c: 0, r: 0, g: 0, b: 0 }); const o = bins[k]; o.c++; o.r += p[i * 4]; o.g += p[i * 4 + 1]; o.b += p[i * 4 + 2]; };
    for (let x = 0; x < w; x += 2) { sample(x); sample((h - 1) * w + x); }
    for (let y = 0; y < h; y += 2) { sample(y * w); sample(y * w + w - 1); }
    let bestBin = null;
    Object.values(bins).forEach(o => { if (!bestBin || o.c > bestBin.c) bestBin = o; });
    if (!bestBin) return null;
    const br = bestBin.r / bestBin.c, bgc = bestBin.g / bestBin.c, bb = bestBin.b / bestBin.c;

    const near = (i) => {
      const dr = p[i * 4] - br, dg = p[i * 4 + 1] - bgc, db = p[i * 4 + 2] - bb;
      if (dr * dr + dg * dg + db * db < 2000) return true;
      const mn = Math.min(p[i * 4], p[i * 4 + 1], p[i * 4 + 2]);
      const mx = Math.max(p[i * 4], p[i * 4 + 1], p[i * 4 + 2]);
      return mn > 236 && mx - mn < 12;      // 纯白/极浅色也当背景
    };
    const alpha = new Uint8Array(n).fill(1);
    const stack = [];
    for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop();
      if (!alpha[i] || !near(i)) continue;
      alpha[i] = 0;
      const x = i % w, y = (i - x) / w;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - w);
      if (y < h - 1) stack.push(i + w);
    }
    // 连通块：只留最大的主体（连同 ≥25% 的附属块），去掉标注文字/横幅
    const seen = new Uint8Array(n), comps = [];
    for (let i = 0; i < n; i++) {
      if (!alpha[i] || seen[i]) continue;
      const comp = [i]; seen[i] = 1;
      let minX = w, maxX = 0, minY = h, maxY = 0;
      for (let k = 0; k < comp.length; k++) {
        const j = comp[k], x = j % w, y = (j - x) / w;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0) { const jj = j - 1; if (alpha[jj] && !seen[jj]) { seen[jj] = 1; comp.push(jj); } }
        if (x < w - 1) { const jj = j + 1; if (alpha[jj] && !seen[jj]) { seen[jj] = 1; comp.push(jj); } }
        if (y > 0) { const jj = j - w; if (alpha[jj] && !seen[jj]) { seen[jj] = 1; comp.push(jj); } }
        if (y < h - 1) { const jj = j + w; if (alpha[jj] && !seen[jj]) { seen[jj] = 1; comp.push(jj); } }
      }
      comps.push({ px: comp, area: comp.length, minX, maxX, minY, maxY });
    }
    if (!comps.length) return null;
    comps.sort((a, b) => b.area - a.area);
    const keep = comps.filter((c, i) => i === 0 || c.area > comps[0].area * 0.25);
    const keepSet = new Set();
    keep.forEach(c => c.px.forEach(j => keepSet.add(j)));
    for (let i = 0; i < n; i++) p[i * 4 + 3] = keepSet.has(i) ? 255 : 0;
    ctx.putImageData(id, 0, 0);
    const bx = Math.min(...keep.map(c => c.minX)), by = Math.min(...keep.map(c => c.minY));
    const ex = Math.max(...keep.map(c => c.maxX)), ey = Math.max(...keep.map(c => c.maxY));
    return { x: bx, y: by, w: Math.max(1, ex - bx + 1), h: Math.max(1, ey - by + 1) };
  }

  // 生成贴面材质：抠图 → 只取商品主体 → 按面的比例填满（细节、颜色与实物一致）
  const _photoTexCache = {};   // src|尺寸 -> CanvasTexture（避免每次重建都重新抠图）
  function photoMat(src, maxW, maxH) {
    const e = photoImg(src);
    const cw = 512, ch = Math.max(64, Math.round(512 * maxH / maxW));
    const key = src + '|' + cw + 'x' + ch;
    const m = new T.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.78, metalness: 0.02,
      transparent: true, opacity: 0, alphaTest: 0.4,
      polygonOffset: true, polygonOffsetFactor: -2
    });
    const apply = () => {
      if (!e.ok || !e.img.width) return;
      if (_photoTexCache[key]) {
        m.map = _photoTexCache[key];
        m.opacity = 1;
        m.needsUpdate = true;
        return;
      }
      // 1) 原图按比例画进工作画布（长边 640），便于抠图
      const ar0 = e.img.width / e.img.height;
      const ww = ar0 >= 1 ? 640 : Math.round(640 * ar0);
      const wh = ar0 >= 1 ? Math.round(640 / ar0) : 640;
      const A = document.createElement('canvas');
      A.width = ww; A.height = wh;
      A.getContext('2d').drawImage(e.img, 0, 0, ww, wh);
      const box = matte(A);
      // 2) 取主体区域，按面的比例铺满（cover），不拉伸变形
      const B = document.createElement('canvas');
      B.width = cw; B.height = ch;
      const bx2 = B.getContext('2d');
      const srcX = box ? box.x : 0, srcY = box ? box.y : 0;
      const srcW = box ? box.w : ww, srcH = box ? box.h : wh;
      const faceAr = cw / ch, srcAr = srcW / srcH;
      let sw = srcW, sh = srcH;
      if (srcAr > faceAr) sw = srcH * faceAr;      // 主体更宽：左右裁
      else sh = srcW / faceAr;                     // 主体更高：上下裁
      bx2.drawImage(A, srcX + (srcW - sw) / 2, srcY + (srcH - sh) / 2, sw, sh, 0, 0, cw, ch);
      const t = new T.CanvasTexture(B);
      t.encoding = T.sRGBEncoding;
      t.anisotropy = 4;
      _photoTexCache[key] = t;
      m.map = t;
      m.opacity = 1;
      m.needsUpdate = true;
    };
    if (e.ok) apply(); else e.cbs.push(apply);
    return m;
  }
  // 正立面贴面：位于 z 处的竖直平面（模型局部坐标，正面朝 +z）
  function decalFront(it, maxW, maxH, cy, z) {
    if (!it.img) return null;
    const p = mesh(new T.PlaneGeometry(maxW, maxH), photoMat(it.img, maxW, maxH));
    p.castShadow = false;
    p.position.set(0, cy, z);
    return p;
  }
  // ---------- 各品类构建器（w宽 x深 d，h高，单位米，y向上，原点在底部中心） ----------
  const B = {};

  B.sofa = function (it) {
    const g = new T.Group();
    const { w, d, h } = it;
    const main = mat(it.color, it.mat);
    const dark = mat(shade(it.color, 0.82), it.mat);
    const legM = mat('#5d4037', 'wood');
    const legH = 0.09;
    // 底座
    g.add(put(box(w * 0.96, 0.3, d * 0.82, main), 0, legH + 0.15, d * 0.06));
    // 靠背
    const backH = Math.max(0.35, h - legH - 0.3);
    g.add(put(box(w * 0.96, backH, 0.22, main), 0, legH + 0.3 + backH / 2, -d / 2 + 0.13));
    // 扶手
    const armH = Math.min(h * 0.55, legH + 0.3 + backH * 0.7);
    const armD = d * 0.85;
    g.add(put(box(0.2, armH - legH, armD, dark), -(w / 2 - 0.1), legH + (armH - legH) / 2, 0));
    g.add(put(box(0.2, armH - legH, armD, dark), w / 2 - 0.1, legH + (armH - legH) / 2, 0));
    // 坐垫
    const n = Math.max(1, Math.round(w / 0.8));
    const cw = (w * 0.96 - 0.44) / n;
    for (let i = 0; i < n; i++) {
      const x = -(w * 0.96 - 0.44) / 2 + cw / 2 + i * cw;
      g.add(put(box(cw - 0.04, 0.15, d * 0.55, mat(shade(it.color, 1.08), it.mat)), x, legH + 0.375, d * 0.12));
      // 靠背软包（略后倾）
      const bc = box(cw - 0.06, Math.min(0.42, backH * 0.8), 0.16, mat(shade(it.color, 1.05), it.mat));
      bc.rotation.x = -0.12;
      g.add(put(bc, x, legH + 0.3 + Math.min(0.42, backH * 0.8) / 2, -d / 2 + 0.3));
    }
    // 脚
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      g.add(put(cyl(0.025, 0.02, legH, legM, 10), sx * (w / 2 - 0.12), legH / 2, sz * (d / 2 - 0.12)));
    });
    // 商品图贴面（正面）
    const sd1 = decalFront(it, w * 0.98, h * 0.97, h * 0.485, d * 0.47 + 0.02);
    if (sd1) g.add(sd1);
    return g;
  };

  B.bed = function (it) {
    const g = new T.Group();
    const { w, d, h } = it;
    const main = mat(it.color, it.mat);
    const frameM = mat(shade(it.color, 0.7), 'wood');
    // 床架
    g.add(put(box(w, 0.22, d, frameM), 0, 0.11, 0));
    // 床垫
    g.add(put(box(w - 0.06, 0.22, d - 0.2, mat('#f5f0e8', 'fabric')), 0, 0.33, 0.06));
    // 床头板
    const hbH = Math.max(0.5, h - 0.44);
    g.add(put(box(w, hbH, 0.09, main), 0, 0.22 + hbH / 2, -d / 2 + 0.05));
    // 枕头
    const pw = Math.min(0.55, w / 2 - 0.1);
    [-1, 1].forEach(s => {
      if (w < 1.1 && s === 1) return;
      const p = box(pw, 0.11, 0.35, mat('#ffffff', 'fabric'));
      p.rotation.x = -0.25;
      g.add(put(p, s * (w / 4), 0.55, -d / 2 + 0.38));
    });
    // 被子
    g.add(put(box(w - 0.04, 0.09, d * 0.55, mat(shade(it.color, 0.88), it.mat)), 0, 0.48, d * 0.18));
    return g;
  };

  B.table = function (it) {
    const g = new T.Group();
    const { w, d, h } = it;
    const topM = mat(it.color, it.mat === 'fabric' ? 'wood' : it.mat);
    const legM = mat(shade(it.color, 0.75), 'wood');
    g.add(put(box(w, 0.05, d, topM), 0, h - 0.025, 0));
    const ix = Math.max(0.06, w / 2 - 0.09), iz = Math.max(0.06, d / 2 - 0.09);
    [[-ix, -iz], [ix, -iz], [-ix, iz], [ix, iz]].forEach(([x, z]) => {
      g.add(put(box(0.06, h - 0.05, 0.06, legM), x, (h - 0.05) / 2, z));
    });
    return g;
  };

  B.chair = function (it) {
    const g = new T.Group();
    const { w, d, h } = it;
    const main = mat(it.color, it.mat);
    const seatH = Math.min(0.46, h * 0.55);
    g.add(put(box(w, 0.06, d, main), 0, seatH, 0));
    const ix = Math.max(0.04, w / 2 - 0.05), iz = Math.max(0.04, d / 2 - 0.05);
    const legM = mat(shade(it.color, 0.7), it.mat === 'metal' ? 'metal' : 'wood');
    [[-ix, -iz], [ix, -iz], [-ix, iz], [ix, iz]].forEach(([x, z]) => {
      g.add(put(box(0.035, seatH, 0.035, legM), x, seatH / 2, z));
    });
    if (h > seatH + 0.15) {
      const bh = h - seatH - 0.06;
      g.add(put(box(w, bh, 0.05, main), 0, seatH + 0.03 + bh / 2, -d / 2 + 0.03));
    }
    // 商品图贴面（正面）
    const cd1 = decalFront(it, w * 0.98, h * 0.95, h * 0.475, d / 2 + 0.015);
    if (cd1) g.add(cd1);
    return g;
  };

  B.wardrobe = function (it) {
    const g = new T.Group();
    const { w, d, h } = it;
    const main = mat(it.color, it.mat);
    g.add(put(box(w, h, d, main), 0, h / 2, 0));
    // 双开门缝与把手
    const doorM = mat(shade(it.color, 1.1), it.mat);
    [-1, 1].forEach(s => {
      g.add(put(box(w / 2 - 0.025, h - 0.08, 0.02, doorM), s * (w / 4 + 0.01), h / 2, d / 2 + 0.011));
      const hd = cyl(0.011, 0.011, Math.min(0.3, h * 0.2), mat('#9e9e9e', 'metal'), 10);
      g.add(put(hd, s * 0.05, h * 0.52, d / 2 + 0.035));
    });
    // 商品图贴面（柜门正面）
    const wd1 = decalFront(it, w * 0.92, h * 0.86, h / 2, d / 2 + 0.033);
    if (wd1) g.add(wd1);
    return g;
  };

  B.cabinet = function (it) {
    const g = new T.Group();
    const { w, d, h } = it;
    const main = mat(it.color, it.mat);
    const legH = Math.min(0.12, h * 0.2);
    g.add(put(box(w, h - legH, d, main), 0, legH + (h - legH) / 2, 0));
    // 抽屉线 + 把手
    const rows = h > 0.7 ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      const ry = legH + (h - legH) * (r + 0.5) / rows;
      g.add(put(box(w - 0.04, (h - legH) / rows - 0.025, 0.015, mat(shade(it.color, 1.08), it.mat)), 0, ry, d / 2 + 0.008));
      g.add(put(box(Math.min(0.24, w * 0.3), 0.018, 0.02, mat('#8d8d8d', 'metal')), 0, ry, d / 2 + 0.025));
    }
    const legM = mat(shade(it.color, 0.7), 'wood');
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      g.add(put(box(0.04, legH, 0.04, legM), sx * (w / 2 - 0.06), legH / 2, sz * (d / 2 - 0.06)));
    });
    // 商品图贴面（抽屉正面）
    const cb1 = decalFront(it, w * 0.94, (h - legH) * 0.92, legH + (h - legH) / 2, d / 2 + 0.036);
    if (cb1) g.add(cb1);
    return g;
  };

  B.shelf = function (it) {
    const g = new T.Group();
    const { w, d, h } = it;
    const main = mat(it.color, it.mat === 'fabric' ? 'wood' : it.mat);
    const th = 0.028;
    g.add(put(box(th, h, d, main), -(w / 2 - th / 2), h / 2, 0));
    g.add(put(box(th, h, d, main), w / 2 - th / 2, h / 2, 0));
    g.add(put(box(w - th * 2, th, d, main), 0, h - th / 2, 0));
    g.add(put(box(w - th * 2, th, d, main), 0, th / 2, 0));
    g.add(put(box(w - th * 2, h - th, 0.014, mat(shade(it.color, 0.85), 'wood')), 0, h / 2, -d / 2 + 0.008));
    const n = Math.max(1, Math.round(h / 0.38) - 1);
    for (let i = 1; i <= n; i++) {
      const y = (h - th) * i / (n + 1);
      g.add(put(box(w - th * 2, th, d - 0.02, main), 0, y, 0.01));
    }
    // 商品图贴面（正面）
    const sh1 = decalFront(it, w * 0.92, h * 0.92, h / 2, d / 2 + 0.02);
    if (sh1) g.add(sh1);
    return g;
  };

  B.lamp = function (it) {
    const g = new T.Group();
    const { w, d, h } = it;
    const r = Math.min(w, d) / 2;
    const metalM = mat('#37474f', 'metal');
    g.add(put(cyl(r * 0.8, r, 0.03, metalM), 0, 0.015, 0));
    g.add(put(cyl(0.014, 0.014, h - 0.42, metalM, 12), 0, (h - 0.42) / 2 + 0.03, 0));
    const shadeM = new T.MeshStandardMaterial({ color: it.color, roughness: 0.9, emissive: it.color, emissiveIntensity: 0.25, side: T.DoubleSide });
    const sh = mesh(new T.CylinderGeometry(r * 0.75, r, 0.34, 24, 1, true), shadeM);
    sh.castShadow = false;
    g.add(put(sh, 0, h - 0.19, 0));
    if (SD.lampLightCount < 6) {
      const pl = new T.PointLight(new T.Color(it.color), 0.5, 3.5);
      pl.position.set(0, h - 0.3, 0);
      g.add(pl);
      SD.lampLightCount++;
    }
    return g;
  };

  B.rug = function (it) {
    const g = new T.Group();
    const { w, d } = it;
    const m = mat(it.color, 'fabric');
    m.roughness = 1;
    const r1 = box(w, 0.016, d, m); r1.castShadow = false;
    g.add(put(r1, 0, 0.008, 0));
    const r2 = box(w * 0.82, 0.018, d * 0.82, mat(shade(it.color, 1.15), 'fabric'));
    r2.castShadow = false;
    g.add(put(r2, 0, 0.009, 0));
    return g;
  };

  B.plant = function (it) {
    const g = new T.Group();
    const { w, d, h } = it;
    const r = Math.min(w, d) / 2;
    g.add(put(cyl(r * 0.75, r * 0.55, h * 0.28, mat('#b5593b', 'wood')), 0, h * 0.14, 0));
    g.add(put(cyl(0.02, 0.025, h * 0.4, mat('#6d4c41', 'wood'), 8), 0, h * 0.28 + h * 0.2, 0));
    const leafM = mat(shade(it.color, 0.9), 'fabric');
    for (let i = 0; i < 4; i++) {
      const s = mesh(new T.SphereGeometry(r * (0.75 - i * 0.09), 14, 12), leafM);
      g.add(put(s, (Math.random() - 0.5) * r * 0.5, h * (0.62 + i * 0.09), (Math.random() - 0.5) * r * 0.5));
    }
    return g;
  };

  B.other = function (it) {
    const g = new T.Group();
    const { w, d, h } = it;
    g.add(put(box(w, h, d, mat(it.color, it.mat)), 0, h / 2, 0));
    g.add(put(box(w * 1.01, h * 0.06, d * 1.01, mat(shade(it.color, 0.85), it.mat)), 0, h * 0.97, 0));
    const od1 = decalFront(it, w * 0.94, h * 0.9, h / 2, d / 2 + 0.02);
    if (od1) g.add(od1);
    return g;
  };

  SD.buildFurniture = function (item) {
    SD.lampLightCount = SD.lampLightCount || 0;
    const fn = B[item.cat] || B.other;
    const g = fn(item);
    g.rotation.y = -(item.rot || 0) * Math.PI / 180;
    g.position.set(item.x, 0, item.y);
    return g;
  };

  SD.FURNITURE_ICONS = {
    sofa: '🛋️', bed: '🛏️', table: '🍽️', chair: '🪑', wardrobe: '🚪',
    cabinet: '🗄️', shelf: '📚', lamp: '💡', rug: '🧶', plant: '🪴', other: '📦'
  };
})();
