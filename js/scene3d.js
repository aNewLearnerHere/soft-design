/* 3D 实景场景：房间 + 家具 + 光影 */
(function () {
  const T = THREE;
  const SD = (window.SD = window.SD || {});
  const WALL_H = 2.7, WALL_T = 0.2;   // 层高 2.7m（与户型图一致）
  const CUT_H = 1.35; // 环视时的剖切墙高（娃娃屋视角，方便看清室内）

  // 程序化木地板纹理（无需外部贴图）
  function woodTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#c3a074'; x.fillRect(0, 0, 512, 512);
    const plankH = 64;
    for (let i = 0; i < 8; i++) {
      const y = i * plankH;
      const off = (i % 2) * 130;
      for (let px = -260; px < 512 + 260; px += 200) {
        const k = 0.9 + Math.random() * 0.18;
        x.fillStyle = `rgb(${Math.round(196 * k)},${Math.round(160 * k)},${Math.round(116 * k)})`;
        x.fillRect(px + off, y, 197, plankH - 2);
        x.strokeStyle = 'rgba(120,88,55,.10)'; x.lineWidth = 1;
        for (let g = 0; g < 5; g++) {
          const yy = y + Math.random() * (plankH - 4);
          x.beginPath();
          x.moveTo(px + off, yy);
          x.bezierCurveTo(px + off + 70, yy + (Math.random() - 0.5) * 6,
            px + off + 130, yy + (Math.random() - 0.5) * 6, px + off + 197, yy);
          x.stroke();
        }
      }
      x.fillStyle = 'rgba(95,70,45,.28)';
      x.fillRect(0, y + plankH - 2, 512, 2);
    }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.encoding = T.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  }

  // 程序化织物纹理（地毯/布艺）
  const _fabricCache = {};
  function fabricTexture(baseHex) {
    if (_fabricCache[baseHex]) return _fabricCache[baseHex];
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = baseHex; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2600; i++) {
      x.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      x.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
      x.fillStyle = `rgba(0,0,0,${Math.random() * 0.045})`;
      x.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
    }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(3, 3);
    t.encoding = T.sRGBEncoding;
    _fabricCache[baseHex] = t;
    return t;
  }

  SD.fabricTexture = fabricTexture;

  class Scene3D {
    constructor() {
      this.ready = false;
      this.preset = 'orbit';
      this.showDims = true;    // 选中家具时在地面画尺寸 + 到墙净距
      this._selId = null;
    }
    init(container) {
      this.container = container;
      // 开启色彩管理，避免 sRGB 输出时颜色被二次 gamma 校正导致发白
      if (T.ColorManagement) {
        if ('legacyMode' in T.ColorManagement) T.ColorManagement.legacyMode = false;
        else T.ColorManagement.enabled = true;
      }
      this.renderer = new T.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
      this.renderer.outputEncoding = T.sRGBEncoding;
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.92;
      container.innerHTML = '';
      container.appendChild(this.renderer.domElement);

      this.scene = new T.Scene();
      this.scene.background = new T.Color(0xdfe7ef);
      this.scene.fog = new T.Fog(0xdfe7ef, 30, 90);

      this.camera = new T.PerspectiveCamera(55, 1, 0.05, 200);
      this.camera.position.set(6, 5, 7);
      this.camera.rotation.order = 'YXZ';   // 漫游/全景模式用 yaw-pitch 控制

      this.controls = new T.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.02;

      // 环境反射贴图（给皮质/金属/木面一点真实反光）
      try {
        const pmrem = new T.PMREMGenerator(this.renderer);
        const envSc = new T.Scene();
        envSc.background = new T.Color(0x8fa8bd);
        const mkGlow = (color, x, y, z, s) => {
          const p = new T.Mesh(new T.PlaneGeometry(s, s * 0.7), new T.MeshBasicMaterial({ color, side: T.DoubleSide }));
          p.position.set(x, y, z);
          p.lookAt(0, 1, 0);
          envSc.add(p);
        };
        mkGlow(0xfff2dd, -6, 5, -5, 7);   // 暖色主光源方向
        mkGlow(0xeaf2ff, 6, 4, 4, 6);     // 冷色补光方向
        this._envTex = pmrem.fromScene(envSc, 0.03).texture;
        this.scene.environment = this._envTex;
        pmrem.dispose();
      } catch (e) { console.warn('环境贴图生成失败', e); }

      // 漫游/全景模式的输入监听
      this._bindImmersive();

      this.root = new T.Group();
      this.scene.add(this.root);

      this._resize();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(container);
      this._loop = this._loop.bind(this);
      this._running = false;
    }

    _resize() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      // 画布尺寸变了，环视重新取景，避免户型缩成一小块
      clearTimeout(this._refitT);
      this._refitT = setTimeout(() => {
        if (this.preset === 'orbit' && this.center && this.bbox) {
          this._fitView(new T.Vector3(0.5, 1.15, 0.56).normalize(), 0.55);
        }
      }, 150);
    }

    _loop() {
      if (!this._running) return;
      requestAnimationFrame(this._loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - (this._t || now)) / 1000);
      this._t = now;
      const immersive = this.preset === 'fp' || this.preset === 'pano';
      if (!immersive) this.controls.update();
      if (this.preset === 'fp') this._fpStep(dt);
      this._updateWallCut();
      this._scaleLabels();
      this.renderer.render(this.scene, this.camera);
    }

    start() { if (!this._running) { this._running = true; this._loop(); } }
    stop() { this._running = false; this._exitImmersive(); }

    // ---------- 场景重建 ----------
    update(plan, items) {
      this._last = { plan, items };
      this._plan = plan;
      this._items = items;
      this.disposeGroup(this.root);
      SD.lampLightCount = 0;
      this.wallH = WALL_H;              // 墙体真实层高 2.7m（环视靠「自动隐藏挡住视线的墙」看室内）
      this._wallGroups = [];

      const walls = plan.walls || [];
      // 范围
      let minX = -5, maxX = 5, minZ = -4, maxZ = 4;
      if (walls.length) {
        minX = Math.min(...walls.flatMap(w => [w.x1, w.x2])) - 0.3;
        maxX = Math.max(...walls.flatMap(w => [w.x1, w.x2])) + 0.3;
        minZ = Math.min(...walls.flatMap(w => [w.y1, w.y2])) - 0.3;
        maxZ = Math.max(...walls.flatMap(w => [w.y1, w.y2])) + 0.3;
      }
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      const spanX = maxX - minX, spanZ = maxZ - minZ;

      // 地面（程序化木纹）
      const floorTex = woodTexture();
      floorTex.repeat.set(Math.max(1, spanX / 3), Math.max(1, spanZ / 3));
      const floorM = new T.MeshStandardMaterial({ map: floorTex, roughness: 0.62, metalness: 0 });
      const floor = new T.Mesh(new T.BoxGeometry(spanX, 0.08, spanZ), floorM);
      floor.position.set(cx, -0.04, cz);
      floor.receiveShadow = true;
      this.root.add(floor);

      // 阴影承接面（户外）
      const shadowCatcher = new T.Mesh(new T.PlaneGeometry(120, 120), new T.ShadowMaterial({ opacity: 0.18 }));
      shadowCatcher.rotation.x = -Math.PI / 2;
      shadowCatcher.position.y = -0.08;
      shadowCatcher.receiveShadow = true;
      this.root.add(shadowCatcher);

      // 墙体
      const wallM = new T.MeshStandardMaterial({ color: 0xe0d7c5, roughness: 0.95 });
      const glassM = new T.MeshStandardMaterial({ color: 0xbcd8e8, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.35 });
      const woodM = new T.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.6 });
      const baseM = new T.MeshStandardMaterial({ color: 0xfaf7f2, roughness: 0.55 });
      walls.forEach(w => this._buildWall(w, wallM, glassM, woodM, plan, baseM));

      // 灯光
      const hemi = new T.HemisphereLight(0xfdfdff, 0x8b7f70, 0.5);
      this.root.add(hemi);
      const amb = new T.AmbientLight(0xffffff, 0.12);
      this.root.add(amb);
      const dir = new T.DirectionalLight(0xfff0d8, 0.95);
      dir.position.set(cx + spanX * 0.45, 9, cz + spanZ * 0.4);
      dir.target.position.set(cx, 0, cz);
      dir.castShadow = true;
      dir.shadow.mapSize.set(2048, 2048);
      const s = Math.max(spanX, spanZ) * 0.75;
      dir.shadow.camera.left = -s; dir.shadow.camera.right = s;
      dir.shadow.camera.top = s; dir.shadow.camera.bottom = -s;
      dir.shadow.camera.far = 40;
      dir.shadow.bias = -0.0004;
      dir.shadow.normalBias = 0.02;
      this.root.add(dir);
      this.root.add(dir.target);
      // 冷色补光（对侧，柔化暗部，无阴影）
      const fill = new T.DirectionalLight(0xdfe8ff, 0.3);
      fill.position.set(cx - spanX * 0.5, 6, cz - spanZ * 0.45);
      fill.target.position.set(cx, 0, cz);
      this.root.add(fill);
      this.root.add(fill.target);

      // 家具
      (items || []).forEach(it => {
        try {
          const g = SD.buildFurniture(it);
          this.root.add(g);
        } catch (e) { console.warn('家具构建失败', it.name, e); }
      });

      // 环境反射强度：不要太亮，只给材质一点光泽
      this.root.traverse(o => {
        const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        ms.forEach(m => { if (m.isMeshStandardMaterial && m.envMapIntensity === undefined) m.envMapIntensity = 0.5; });
      });

      this.center = new T.Vector3(cx, 0, cz);
      this.span = Math.max(spanX, spanZ);
      this.bbox = { minX, maxX, minZ, maxZ };
      this.setPreset(this.preset);
      this._refreshDims();
    }

    // ---------- 3D 间距标注（选中家具时显示） ----------
    setSelected(id) { this._selId = id; this._refreshDims(); }
    setShowDims(on) { this.showDims = on; this._refreshDims(); }

    _refreshDims() {
      if (this._dims) { this.root.remove(this._dims); this.disposeGroup(this._dims); }
      this._dims = new T.Group();
      this._labels = [];
      this.root.add(this._dims);
      if (!this.showDims || !this._last || !this.bbox) return;
      const it = (this._last.items || []).find(i => i.id === this._selId);
      if (it) this._buildDims(it);
    }

    // 尺寸文字气泡（Sprite，永远面向相机）
    _dimLabel(text, color) {
      const c = document.createElement('canvas');
      const m = c.getContext('2d');
      m.font = '700 34px "PingFang SC", sans-serif';
      const tw = m.measureText(text).width;
      c.width = Math.ceil(tw + 52); c.height = 60;
      const x = c.getContext('2d');
      x.font = '700 34px "PingFang SC", sans-serif';
      x.beginPath();
      if (x.roundRect) x.roundRect(2, 2, c.width - 4, 56, 28); else x.rect(2, 2, c.width - 4, 56);
      x.fillStyle = 'rgba(255,255,255,.96)'; x.fill();
      x.strokeStyle = color; x.lineWidth = 3.5; x.stroke();
      x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(text, c.width / 2, 31);
      const tex = new T.CanvasTexture(c);
      tex.encoding = T.sRGBEncoding;
      tex.anisotropy = 4;
      const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
      sp.renderOrder = 12;
      const h = 0.26;                                     // 气泡实际高度（米）
      sp.scale.set(h * c.width / c.height, h, 1);
      sp.userData = { ar: c.width / c.height, base: h };
      this._labels.push(sp);
      return sp;
    }

    // 让标注气泡在屏幕上保持相近大小：随相机距离缩放
    _scaleLabels() {
      if (!this._labels || !this._labels.length) return;
      this._labels.forEach(sp => {
        const d = this.camera.position.distanceTo(sp.position);
        const h = Math.max(0.13, Math.min(1.9, d * 0.042));
        sp.scale.set(h * sp.userData.ar, h, 1);
      });
    }

    _buildDims(it) {
      const walls = (this._plan && this._plan.walls) || [];
      const HALF_WALL = WALL_T / 2;
      const Y = 0.03;                                     // 画在地面上方一点，避免和地板 z-fighting
      const a = (it.rot || 0) * Math.PI / 180;
      const ux = Math.cos(a), uy = Math.sin(a), vx = -Math.sin(a), vy = Math.cos(a);
      const loc2w = (lx, ly) => [it.x + lx * ux + ly * vx, it.y + lx * uy + ly * vy];
      const hw = it.w / 2, hd = it.d / 2;
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(p => loc2w(p[0], p[1]));
      const xs = corners.map(p => p[0]), zs = corners.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const hx = (maxX - minX) / 2, hz = (maxZ - minZ) / 2;
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

      // 射线找墙（与 2D 同一套数学：平面 x,y ≡ 3D x,z）
      const ray = (px, pz, dx, dz) => {
        let best = Infinity;
        walls.forEach(w => {
          const abx = w.x2 - w.x1, abz = w.y2 - w.y1;
          const den = dx * abz - dz * abx;
          if (Math.abs(den) < 1e-9) return;
          const apx = w.x1 - px, apz = w.y1 - pz;
          const t = (apx * abz - apz * abx) / den;
          const u = (apx * dz - apz * dx) / den;
          if (t > 0.02 && u >= -0.001 && u <= 1.001 && t < best) best = t;
        });
        return best;
      };
      const fmt = v => (v < 0.995 ? Math.round(v * 100) + 'cm' : v.toFixed(2) + 'm');
      const dashedLine = (x1, z1, x2, z2, color) => {
        const g = new T.BufferGeometry().setFromPoints([
          new T.Vector3(x1, Y, z1), new T.Vector3(x2, Y, z2)]);
        const l = new T.Line(g, new T.LineDashedMaterial({
          color, dashSize: 0.1, gapSize: 0.07, transparent: true, opacity: 0.95,
          depthTest: false, depthWrite: false
        }));
        l.renderOrder = 11;
        l.computeLineDistances();
        this._dims.add(l);
      };

      // 家具在屏幕上太小就不画自身尺寸，免得标注糊成一团
      const pxW = this.container.clientWidth, pxH = this.container.clientHeight;
      const ps = corners.map(([wx2, wz2]) => {
        const v = new T.Vector3(wx2, 0, wz2).project(this.camera);
        return [v.x * pxW / 2, v.y * pxH / 2];
      });
      const sw = (Math.max(...ps.map(q => q[0])) - Math.min(...ps.map(q => q[0]))) / 2;
      const sh = (Math.max(...ps.map(q => q[1])) - Math.min(...ps.map(q => q[1]))) / 2;

      let sp = null;
      // 1) 自身宽 / 深：画在家具足迹内侧（屏幕太小就省略，到墙净距照旧显示）
      if (Math.max(sw, sh) >= 100) {
        const iw = Math.min(0.16, it.d * 0.16);
        let [ax, az] = loc2w(-hw + 0.08, -hd + iw), [bx, bz] = loc2w(hw - 0.08, -hd + iw);
        dashedLine(ax, az, bx, bz, 0x4f46e5);
        sp = this._dimLabel(it.w.toFixed(2) + 'm', '#4f46e5');
        sp.position.set(ax + (bx - ax) * 0.72, 0.16, az + (bz - az) * 0.72);
        this._dims.add(sp);
        const id2 = Math.min(0.24, it.w * 0.3);
        [ax, az] = loc2w(-hw + id2, -hd + 0.08); [bx, bz] = loc2w(-hw + id2, hd - 0.08);
        dashedLine(ax, az, bx, bz, 0x4f46e5);
        sp = this._dimLabel(it.d.toFixed(2) + 'm', '#4f46e5');
        sp.position.set(ax + (bx - ax) * 0.28, 0.16, az + (bz - az) * 0.28);
        this._dims.add(sp);
      }

      // 2) 到四面墙的净距
      const sides = [
        { dx: -1, dz: 0, half: hx }, { dx: 1, dz: 0, half: hx },
        { dx: 0, dz: -1, half: hz }, { dx: 0, dz: 1, half: hz }
      ];
      sides.forEach(sd => {
        const t = ray(cx, cz, sd.dx, sd.dz);
        if (!isFinite(t)) return;
        const gap = t - sd.half - HALF_WALL;
        if (gap > 6) return;                      // 太远不标
        const touching = gap < 0.05;
        const col = touching ? 0x0f766e : 0x0284c7;
        const cssCol = touching ? '#0f766e' : '#0284c7';
        const ex = cx + sd.dx * sd.half, ez = cz + sd.dz * sd.half;
        if (touching) {
          // 「贴墙」气泡放在家具边外侧一点点
          sp = this._dimLabel('贴墙', cssCol);
          sp.position.set(ex + sd.dx * 0.42, 0.16, ez + sd.dz * 0.42);
          this._dims.add(sp);
          return;
        }
        const reach = gap;
        const wx2 = ex + sd.dx * reach, wz2 = ez + sd.dz * reach;
        dashedLine(ex, ez, wx2, wz2, col);
        // 淡蓝色间距带
        const along = sd.dx === 0 ? [1, 0] : [0, 1];
        const bw = Math.min(hx, hz) * 0.6;
        const g = new T.BufferGeometry().setFromPoints([
          new T.Vector3(ex + along[0] * bw, Y, ez + along[1] * bw),
          new T.Vector3(ex - along[0] * bw, Y, ez - along[1] * bw),
          new T.Vector3(wx2 - along[0] * bw, Y, wz2 - along[1] * bw),
          new T.Vector3(wx2 + along[0] * bw, Y, wz2 + along[1] * bw),
          new T.Vector3(ex + along[0] * bw, Y, ez + along[1] * bw)
        ]);
        const band = new T.Mesh(g, new T.MeshBasicMaterial({
          color: 0x0284c7, transparent: true, opacity: 0.12, side: T.DoubleSide,
          depthWrite: false, depthTest: false
        }));
        band.renderOrder = 10;
        this._dims.add(band);
        // 数值气泡放在线中段、偏出间距带
        // 气泡放在靠墙那一端（4 个方向的标注自然分开，不会挤在中间）
        const ox = wx2 - sd.dx * 0.3 + (sd.dx === 0 ? 0.34 : 0);
        const oz = wz2 - sd.dz * 0.3 + (sd.dz === 0 ? 0.34 : 0);
        sp = this._dimLabel(fmt(gap), cssCol);
        sp.position.set(ox, 0.16, oz);
        this._dims.add(sp);
      });

      // 3) 与其他家具的净距：两框之间最近点连线（最近 3 件、间距 1.5m 内才标），琥珀色区分于到墙蓝
      const items = this._items || [];
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      const near = items.filter(o => o !== it && o.cat !== 'rug').map(o => {
        const b = (o.rot || 0) * Math.PI / 180, ohw = o.w / 2, ohd = o.d / 2;
        const oux = Math.cos(b), ouy = Math.sin(b), ovx = -Math.sin(b), ovy = Math.cos(b);
        const ocs = [[-ohw, -ohd], [ohw, -ohd], [ohw, ohd], [-ohw, ohd]].map(p =>
          [o.x + p[0] * oux + p[1] * ovx, o.y + p[0] * ouy + p[1] * ovy]);
        const oxs = ocs.map(p => p[0]), ozs = ocs.map(p => p[1]);
        return {
          minX: Math.min(...oxs), maxX: Math.max(...oxs),
          minZ: Math.min(...ozs), maxZ: Math.max(...ozs)
        };
      }).map(b => {
        const gx = Math.max(0, Math.max(minX, b.minX) - Math.min(maxX, b.maxX));
        const gz = Math.max(0, Math.max(minZ, b.minZ) - Math.min(maxZ, b.maxZ));
        return { b, gap: Math.hypot(gx, gz), overlap: gx > 0 && gz > 0 };
      }).filter(r => !r.overlap && r.gap < 1.5).sort((p, q) => p.gap - q.gap).slice(0, 3);
      near.forEach(r => {
        const b = r.b, bcx = (b.minX + b.maxX) / 2, bcz = (b.minZ + b.maxZ) / 2;
        const w1 = [clamp(bcx, minX, maxX), clamp(bcz, minZ, maxZ)];
        const w2 = [clamp(cx, b.minX, b.maxX), clamp(cz, b.minZ, b.maxZ)];
        dashedLine(w1[0], w1[1], w2[0], w2[1], 0xd97706);
        const touching = r.gap < 0.05;
        const mx = (w1[0] + w2[0]) / 2, mz = (w1[1] + w2[1]) / 2;
        sp = this._dimLabel(touching ? '贴着' : fmt(r.gap), touching ? '#b45309' : '#d97706');
        sp.position.set(mx, 0.16, mz);
        this._dims.add(sp);
      });
    }

    _buildWall(w, wallM, glassM, woodM, plan, baseM) {
      const dx = w.x2 - w.x1, dz = w.y2 - w.y1;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) return;
      const ux = dx / len, uz = dz / len;
      const ang = Math.atan2(dz, dx);

      const grp = new T.Group();
      // 以墙「起点」为局部原点：addSeg 用的是 0..len 的局部坐标
      grp.position.set(w.x1, 0, w.y1);
      grp.rotation.y = -ang;

      // 收集该墙上的门/窗（投影到墙面局部坐标）
      const openings = [];
      const all = (plan.doors || []).map(o => ({ ...o, type: 'door' }))
        .concat((plan.windows || []).map(o => ({ ...o, type: 'window' })));
      all.forEach(o => {
        const mx = (o.x1 + o.x2) / 2, mz = (o.y1 + o.y2) / 2;
        const t = (mx - w.x1) * ux + (mz - w.y1) * uz;      // 沿墙参数
        const perp = Math.abs(-(mx - w.x1) * uz + (mz - w.y1) * ux); // 垂距
        if (perp > 0.35 || t < -0.5 || t > len + 0.5) return;
        const oLen = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 0.9;
        const half = Math.min(oLen / 2, len / 2 - 0.05);
        openings.push({ a: Math.max(t - half, 0), b: Math.min(t + half, len), type: o.type });
      });
      openings.sort((p, q) => p.a - q.b || p.a - q.a);

      const addSeg = (a, b, y0, y1, m) => {
        y1 = Math.min(y1, this.wallH);
        if (b - a < 0.02 || y1 - y0 < 0.02) return;
        const ms = new T.Mesh(new T.BoxGeometry(b - a, y1 - y0, WALL_T), m);
        ms.position.set((a + b) / 2, (y0 + y1) / 2, 0);
        ms.castShadow = true; ms.receiveShadow = true;
        grp.add(ms);
        // 墙体外轮廓线：白墙白背景容易糊成一片，有线才看得出这是墙
        if (m === wallM) {
          if (!this._edgeM) {
            this._edgeM = new T.LineBasicMaterial({ color: 0x8d8778, transparent: true, opacity: 0.7 });
          }
          const eg = new T.LineSegments(new T.EdgesGeometry(ms.geometry, 25), this._edgeM.clone());
          eg.position.copy(ms.position);
          eg.renderOrder = 2;
          grp.add(eg);
        }
        // 踢脚线（仅落地墙段），两侧各一条
        if (y0 < 0.001 && baseM) {
          [-1, 1].forEach(s => {
            const bb = new T.Mesh(new T.BoxGeometry(b - a, 0.085, 0.016), baseM);
            bb.position.set((a + b) / 2, 0.0425, s * (WALL_T / 2 + 0.008));
            bb.receiveShadow = true;
            grp.add(bb);
          });
        }
      };

      let cur = 0;
      openings.forEach(op => {
        addSeg(cur, op.a, 0, WALL_H, wallM); // 开口前实墙
        if (op.type === 'door') {
          addSeg(op.a, op.b, 2.05, WALL_H, wallM);              // 门楣
          addSeg(op.a, op.b, 0, 0.02, woodM);                   // 门槛
        } else {
          addSeg(op.a, op.b, 0, 0.9, wallM);                    // 窗下墙
          addSeg(op.a, op.b, 2.3, WALL_H, wallM);               // 窗上墙
          addSeg(op.a + 0.04, op.b - 0.04, 0.92, 2.28, glassM); // 玻璃
          addSeg(op.a, op.b, 0.88, 0.94, woodM);                // 窗框横档
        }
        cur = op.b;
      });
      addSeg(cur, len, 0, WALL_H, wallM);

      grp.userData.wallMid = [(w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2];
      (this._wallGroups || (this._wallGroups = [])).push(grp);
      this.root.add(grp);
    }

    // 环视时对挡在镜头与房间之间的近侧墙做处理，墙始终是真实 2.7m 全高：
    // solid = 全部实心（默认，俯视角度本就能看进屋）／fade = 近侧墙半透／hide = 近侧墙隐藏
    _updateWallCut() {
      const gs = this._wallGroups || [];
      if (!gs.length) return;
      const mode = this.wallMode || 'solid';
      const orbit = this.preset === 'orbit';
      const c = this.center || new T.Vector3();
      const cam = this.camera.position;
      const cdx = cam.x - c.x, cdz = cam.z - c.z;
      const cl = Math.hypot(cdx, cdz) || 1;
      gs.forEach(g => {
        let state = 0;
        if (orbit && mode !== 'solid') {
          const m = g.userData.wallMid;
          if (m) {
            const vx = m[0] - c.x, vz = m[1] - c.z;
            const vl = Math.hypot(vx, vz) || 1;
            const dot = (vx / vl) * (cdx / cl) + (vz / vl) * (cdz / cl);
            if (dot > 0.34) state = mode === 'hide' ? 2 : 1;
          }
        }
        this._fadeWall(g, state);
      });
    }

    // 墙体状态：0 实心 / 1 半透 / 2 隐藏（材质按组懒克隆，避免共享材质互相影响）
    _fadeWall(g, state) {
      if (g.userData.wallState === state) return;
      g.userData.wallState = state;
      g.visible = state !== 2;
      const fade = state === 1;
      g.traverse(o => {
        if (o.isLineSegments) {
          if (!o.userData.mBase) { o.userData.mBase = o.material; o.userData.mSoft = o.material.clone(); }
          o.material = fade ? o.userData.mSoft : o.userData.mBase;
          o.material.opacity = fade ? 0.45 : 0.7;
          return;
        }
        if (!o.isMesh || !o.material) return;
        if (!o.userData.mBase) {
          const base = o.material;
          const soft = base.clone();
          soft.transparent = true;
          soft.opacity = 0.28;
          soft.depthWrite = false;
          o.userData.mBase = base;
          o.userData.mSoft = soft;
          o.userData.cast0 = o.castShadow;
        }
        o.material = fade ? o.userData.mSoft : o.userData.mBase;
        o.castShadow = fade ? false : o.userData.cast0;   // 半透时不投影
      });
    }

    // ---------- 视角 ----------
    // 全屋最开阔的点（离所有墙最远），作为无门时的走入起点
    _openSpot() {
      const b = this.bbox, walls = (this._plan && this._plan.walls) || [];
      if (!b || !walls.length) return null;
      const distSeg = (px, pz, w) => {
        const dx = w.x2 - w.x1, dz = w.y2 - w.y1;
        const L2 = dx * dx + dz * dz;
        let t = L2 > 0 ? ((px - w.x1) * dx + (pz - w.y1) * dz) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (w.x1 + t * dx), pz - (w.y1 + t * dz));
      };
      let best = null;
      for (let x = b.minX + 0.5; x <= b.maxX - 0.5; x += 0.4) {
        for (let z = b.minZ + 0.5; z <= b.maxZ - 0.5; z += 0.4) {
          let m = Infinity;
          for (const w of walls) {
            const d = distSeg(x, z, w);
            if (d < m) m = d;
            if (m < 0.5) break;
          }
          if (m > 0.5 && (!best || m > best.clear)) best = { x, z, clear: m };
        }
      }
      return best;
    }

    // 按包围盒把整个户型「装进」画面：迭代投影校正距离，保证不切边也不留大片空白
    _fitView(dir, targetY) {
      const b = this.bbox, c = this.center;
      if (!b) return;
      const H = Math.max(0.5, this.wallH || 1.45);   // 用当前实际墙高（俯视时是 2.7m）
      const pts = [];
      [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]].forEach(([x, z]) => {
        pts.push(new T.Vector3(x, 0, z), new T.Vector3(x, H, z));
      });
      const target = new T.Vector3(c.x, targetY, c.z);
      const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 4);
      let dist = span * 1.6 + 2;
      const right = new T.Vector3(), up = new T.Vector3(), fwd = new T.Vector3();
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < 4; i++) {
          this.camera.position.copy(target).addScaledVector(dir, dist);
          this.camera.lookAt(target);
          this.camera.updateMatrixWorld();
          this.camera.updateProjectionMatrix();
          let mx = 0, my = 0;
          pts.forEach(p => {
            const v = p.clone().project(this.camera);
            mx = Math.max(mx, Math.abs(v.x)); my = Math.max(my, Math.abs(v.y));
          });
          const over = Math.max(mx, my) / 0.94;   // 目标：占满 94% 画面
          if (Math.abs(over - 1) < 0.03) break;
          dist *= over;
        }
        // 把投影包围盒居中（否则透视下户型会偏在一角，四周留大片空白）
        this.camera.position.copy(target).addScaledVector(dir, dist);
        this.camera.lookAt(target);
        this.camera.updateMatrixWorld();
        this.camera.updateProjectionMatrix();
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        pts.forEach(p => {
          const v = p.clone().project(this.camera);
          x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
          y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
        });
        const nx = (x0 + x1) / 2, ny = (y0 + y1) / 2;
        if (Math.abs(nx) < 0.01 && Math.abs(ny) < 0.01) break;
        this.camera.matrixWorld.extractBasis(right, up, fwd);
        const halfH = Math.tan(this.camera.fov * Math.PI / 360) * dist;
        const halfW = halfH * this.camera.aspect;
        target.addScaledVector(right, nx * halfW).addScaledVector(up, ny * halfH);
      }
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.controls.target.copy(target);
      this.controls.update();
    }

    // 最佳观察机位：离家具够远、不贴墙、视线不被墙挡（不走门洞看半个房间）
    _viewSpot() {
      const b = this.bbox, c = this.center;
      if (!b) return null;
      const its = ((this._last && this._last.items) || []).filter(i => i.cat !== 'rug');
      let tx = c.x, tz = c.z;
      if (its.length) {
        tx = its.reduce((s, i) => s + i.x, 0) / its.length;
        tz = its.reduce((s, i) => s + i.y, 0) / its.length;
      }
      const walls = (this._plan && this._plan.walls) || [];
      const distSeg = (px, pz, w) => {
        const dx = w.x2 - w.x1, dz = w.y2 - w.y1, L2 = dx * dx + dz * dz;
        let t = L2 > 0 ? ((px - w.x1) * dx + (pz - w.y1) * dz) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (w.x1 + t * dx), pz - (w.y1 + t * dz));
      };
      const clearOf = (x, z) => {
        let m = Infinity;
        for (const w of walls) { const d = distSeg(x, z, w); if (d < m) m = d; if (m < 0.6) break; }
        return m;
      };
      const segCross = (ax, az, bx, bz, cx2, cz2, dx2, dz2) => {
        const d1 = (bx - ax) * (cz2 - az) - (bz - az) * (cx2 - ax);
        const d2 = (bx - ax) * (dz2 - az) - (bz - az) * (dx2 - ax);
        const d3 = (dx2 - cx2) * (az - cz2) - (dz2 - cz2) * (ax - cx2);
        const d4 = (dx2 - cx2) * (bz - cz2) - (dz2 - cz2) * (bx - cx2);
        return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
      };
      const hasSight = (x, z) => !walls.some(w => segCross(x, z, tx, tz, w.x1, w.y1, w.x2, w.y2));
      const nearWallEnd = (x, z) => {
        const sd = (px, pz, ax, az, bx, bz) => {
          const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
          let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
          t = Math.max(0, Math.min(1, t));
          return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
        };
        return walls.some(w => sd(w.x1, w.y1, x, z, tx, tz) < 0.6 || sd(w.x2, w.y2, x, z, tx, tz) < 0.6);
      };
      let best = null;
      // 站在这个点能看到多少件家具的「正面」（尺寸大、离得近的权重更高）
      const visScore = (x, z) => {
        let s = 0;
        for (const it of its) {
          const a = -(it.rot || 0) * Math.PI / 180;
          const fx = Math.sin(a), fz = Math.cos(a);
          const dx = x - it.x, dz = z - it.y;
          const d = Math.hypot(dx, dz) || 1;
          const dot = (dx / d) * fx + (dz / d) * fz;
          if (dot > 0) s += dot * Math.max(it.w, it.d) / (1 + d * 0.8);
        }
        return s;
      };
      const clearOfItems = (x, z) => {
        let m = Infinity;
        for (const it of its) {
          const r = Math.max(it.w, it.d) / 2;
          m = Math.min(m, Math.hypot(x - it.x, z - it.y) - r);
        }
        return m;
      };
      for (let x = b.minX + 0.7; x <= b.maxX - 0.7; x += 0.3) {
        for (let z = b.minZ + 0.7; z <= b.maxZ - 0.7; z += 0.3) {
          const clear = clearOf(x, z);
          if (clear < 0.8) continue;                       // 不贴墙
          const fClear = clearOfItems(x, z);
          if (fClear < 0.5) continue;                      // 不站在家具里
          if (Math.hypot(x - tx, z - tz) < 1.5) continue;
          if (!hasSight(x, z)) continue;
          const vis = visScore(x, z);
          if (vis < 0.2) continue;                         // 至少能看清家具正面
          const throughDoor = nearWallEnd(x, z);
          const dist = Math.hypot(x - tx, z - tz);
          const score = (vis + Math.min(clear, 1.5) * 0.4 + Math.min(fClear, 1.5) * 0.3
            + Math.min(dist, 4) * 0.35) * (throughDoor ? 0.3 : 1);
          if (!best || score > best.score) best = { x, z, score };
        }
      }
      if (!best) return null;
      return { x: best.x, z: best.z, tx, tz };
    }

    setPreset(p) {
      const prev = this.preset;
      this.preset = p;
      if (!this.center) return;
      if (p !== 'fp' && p !== 'pano') this._exitImmersive();
      // 环视=剖切矮墙，走入/俯视/漫游/全景=全高墙：墙体高度变化时重建
      if ((prev === 'orbit') !== (p === 'orbit') && this._last) {
        this.update(this._last.plan, this._last.items);
        return;
      }
      if (p === 'fp' || p === 'pano') { this._setupImmersive(p); return; }
      const c = this.center, span = this.span || 8;
      const b = this.bbox || { minX: c.x - 4, maxX: c.x + 4, minZ: c.z - 4, maxZ: c.z + 4 };
      const depth = b.maxZ - b.minZ, width = b.maxX - b.minX;
      this.controls.target.set(c.x, p === 'walk' ? 1.35 : 1.2, c.z);
      if (p === 'top') {
        this._fitView(new T.Vector3(0, 1, 0.02).normalize(), 0);
      } else if (p === 'walk') {
        const v = this._viewSpot();
        if (v) {
          this.camera.position.set(v.x, 1.58, v.z);
          this.controls.target.set(v.tx, 1.05, v.tz);
        } else {
          this.camera.position.set(b.minX + width * 0.28, 1.58, Math.max(b.minZ + depth * 0.3, b.maxZ - 1.2));
          this.controls.target.set(c.x, 1.05, c.z);
        }
      } else { // orbit 娃娃屋视角：按户型包围盒自动取景，户型多大都能充满画面
        this._fitView(new T.Vector3(0.5, 1.15, 0.56).normalize(), 0.55);
      }
      this.controls.update();
    }

    // ---------- 沉浸模式：第一人称漫游 / 720° 全景 ----------
    _bindImmersive() {
      const el = this.renderer.domElement;
      this._keys = {};
      this._locked = false;
      // 指针锁定状态
      document.addEventListener('pointerlockchange', () => {
        this._locked = document.pointerLockElement === el;
      });
      // 按住拖动环顾（全景模式 / 漫游的指针锁定降级）
      el.addEventListener('mousedown', e => {
        if ((this.preset === 'fp' && !this._locked) || this.preset === 'pano') {
          this._drag = { x: e.clientX, y: e.clientY };
        }
      });
      window.addEventListener('mouseup', () => { this._drag = null; });
      window.addEventListener('mousemove', e => {
        if (this.preset === 'fp' && this._locked) {
          this._look(e.movementX || 0, e.movementY || 0, 0.0024);
        } else if (this._drag && (this.preset === 'fp' || this.preset === 'pano')) {
          const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
          this._drag = { x: e.clientX, y: e.clientY };
          this._look(dx, dy, 0.0035);
        }
      });
      // 全景模式：滚轮调整视野（广角 ↔ 长焦）
      el.addEventListener('wheel', e => {
        if (this.preset !== 'pano') return;
        e.preventDefault();
        this.camera.fov = Math.min(100, Math.max(40, this.camera.fov + e.deltaY * 0.04));
        this.camera.updateProjectionMatrix();
      }, { passive: false });
      // 漫游键位
      window.addEventListener('keydown', e => { if (this.preset === 'fp') this._keys[e.code] = true; });
      window.addEventListener('keyup', e => { if (this.preset === 'fp') this._keys[e.code] = false; });
    }

    _look(dx, dy, k) {
      this._yaw = (this._yaw || 0) - dx * k;
      this._pitch = Math.max(-1.45, Math.min(1.45, (this._pitch || 0) - dy * k));
      this.camera.rotation.set(this._pitch, this._yaw, 0);
    }

    _setupImmersive(p) {
      this.controls.enabled = false;
      this._keys = {};
      this.camera.fov = 62;
      this.camera.updateProjectionMatrix();
      // 站到最佳观察点，面向家具重心
      const v = this._viewSpot();
      const spot = v ? null : this._openSpot();
      const px = v ? v.x : (spot ? spot.x : this.center.x);
      const pz = v ? v.z : (spot ? spot.z : this.center.z);
      const its = ((this._last && this._last.items) || []).filter(i => i.cat !== 'rug');
      let tx = v ? v.tx : this.center.x, tz = v ? v.tz : this.center.z;
      if (!v && its.length) {
        tx = its.reduce((s, i) => s + i.x, 0) / its.length;
        tz = its.reduce((s, i) => s + i.y, 0) / its.length;
      }
      this.camera.position.set(px, 1.6, pz);
      this._yaw = Math.atan2(-(tx - px), -(tz - pz));
      this._pitch = Math.atan2(1.05 - 1.6, Math.max(0.5, Math.hypot(tx - px, tz - pz)));
      this.camera.rotation.set(this._pitch, this._yaw, 0);
      if (p === 'fp') {
        const el = this.renderer.domElement;
        if (el.requestPointerLock) { try { el.requestPointerLock(); } catch (e) { /* 降级为拖动 */ } }
      }
    }

    _exitImmersive() {
      if (this.camera.fov !== 55) {
        this.camera.fov = 55;
        this.camera.updateProjectionMatrix();
      }
      this.controls.enabled = true;
      this._keys = {};
      this._drag = null;
      if (document.pointerLockElement) document.exitPointerLock();
    }

    exitImmersive() {
      if (this.preset === 'fp' || this.preset === 'pano') this.setPreset('walk');
    }

    // 漫游移动 + 碰撞（墙、家具）
    _fpStep(dt) {
      const k = this._keys || {};
      const sp = (k.ShiftLeft || k.ShiftRight) ? 3.4 : 1.9;
      let fz = 0, fx = 0;
      if (k.KeyW || k.ArrowUp) fz += 1;
      if (k.KeyS || k.ArrowDown) fz -= 1;
      if (k.KeyA || k.ArrowLeft) fx -= 1;
      if (k.KeyD || k.ArrowRight) fx += 1;
      if (fx || fz) {
        let mx = fz * -Math.sin(this._yaw) + fx * Math.cos(this._yaw);
        let mz = fz * -Math.cos(this._yaw) + fx * Math.sin(this._yaw);
        const l = Math.hypot(mx, mz);
        mx /= l; mz /= l;
        const p = this._collide(this.camera.position.x + mx * sp * dt, this.camera.position.z + mz * sp * dt);
        this.camera.position.x = p.x;
        this.camera.position.z = p.z;
      }
      this.camera.position.y = 1.6;
      this.camera.rotation.set(this._pitch || 0, this._yaw || 0, 0);
    }

    _collide(x, z) {
      const b = this.bbox;
      if (!b) return { x, z };
      const m = 0.32, R = 0.22;
      let nx = Math.min(b.maxX - m, Math.max(b.minX + m, x));
      let nz = Math.min(b.maxZ - m, Math.max(b.minZ + m, z));
      // 墙（线段 + 厚度/人体半径）
      ((this._plan && this._plan.walls) || []).forEach(w => {
        const dx = w.x2 - w.x1, dz = w.y2 - w.y1, L2 = dx * dx + dz * dz;
        let t = L2 > 0 ? ((nx - w.x1) * dx + (nz - w.y1) * dz) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = w.x1 + t * dx, cz = w.y1 + t * dz;
        const ddx = nx - cx, ddz = nz - cz;
        const d = Math.hypot(ddx, ddz);
        const minD = WALL_T / 2 + R;
        if (d < minD) {
          if (d > 1e-4) { nx = cx + ddx / d * minD; nz = cz + ddz / d * minD; }
          else nx += minD;
        }
      });
      // 家具（圆形近似，地毯除外）
      ((this._last && this._last.items) || []).forEach(it => {
        if (it.cat === 'rug') return;
        const r = Math.max(it.w, it.d) / 2 + R;
        const dx = nx - it.x, dz = nz - it.y;
        const d = Math.hypot(dx, dz);
        if (d < r && d > 1e-4) { nx = it.x + dx / d * r; nz = it.y + dz / d * r; }
      });
      return { x: nx, z: nz };
    }

    // ---------- 高清出图 ----------
    still() {
      const pr = this.renderer.getPixelRatio();
      this.renderer.setPixelRatio(Math.min(3, (window.devicePixelRatio || 1) * 2));
      this._resize();
      this.renderer.render(this.scene, this.camera);
      const url = this.renderer.domElement.toDataURL('image/png');
      this.renderer.setPixelRatio(pr);
      this._resize();
      const a = document.createElement('a');
      a.href = url;
      a.download = '软装效果图.png';
      a.click();
    }

    disposeGroup(g) {
      g.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
        }
      });
      while (g.children.length) g.remove(g.children[0]);
    }
  }

  SD.Scene3D = Scene3D;
})();
