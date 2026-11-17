/* 主控制器：状态 / 视图切换 / 属性面板 / 清单导出 / 持久化 */
(function () {
  const SD = (window.SD = window.SD || {});
  const LS_KEY = 'softdesign_v1';
  const LS_SAVE = 'softdesign_saves_v1';   // 命名方案快照列表
  const LS_VER = 2;   // 存档版本：2 = 修正餐边柜朝向（原来背朝外）
  // 预置数据的 id 前缀（重新载入默认户型时可安全清理，不影响自己添加的）
  const SEED_RE = /^(demo|seed)/;

  // ---------- 通用家具库（在你自己的家具之后列出，补齐床/灯/地毯等） ----------
  const SEED_CATALOG = [
    { id: 's1', name: '北欧布艺三人沙发', cat: 'sofa', w: 2.2, d: 0.95, h: 0.85, price: 3299, color: '#b7a99a', mat: 'fabric', img: null },
    { id: 's2', name: '奶油风双人床 1.8m', cat: 'bed', w: 1.85, d: 2.05, h: 1.0, price: 2899, color: '#e8ddcf', mat: 'fabric', img: null },
    { id: 's3', name: '原木餐桌 1.4m', cat: 'table', w: 1.4, d: 0.8, h: 0.75, price: 1899, color: '#c8a27a', mat: 'wood', img: null },
    { id: 's4', name: '休闲单椅', cat: 'chair', w: 0.7, d: 0.75, h: 0.8, price: 699, color: '#7d8c6f', mat: 'fabric', img: null },
    { id: 's5', name: '推拉门衣柜', cat: 'wardrobe', w: 1.8, d: 0.6, h: 2.2, price: 4599, color: '#d9cfc0', mat: 'wood', img: null },
    { id: 's6', name: '岩板茶几', cat: 'table', w: 1.1, d: 0.55, h: 0.42, price: 1299, color: '#4b4b4b', mat: 'metal', img: null },
    { id: 's7', name: '落地灯', cat: 'lamp', w: 0.4, d: 0.4, h: 1.6, price: 399, color: '#e0c98f', mat: 'fabric', img: null },
    { id: 's8', name: '客厅地毯 2.0m', cat: 'rug', w: 2.0, d: 1.4, h: 0.02, price: 459, color: '#c9bfae', mat: 'fabric', img: null },
    { id: 's9', name: '床头柜', cat: 'cabinet', w: 0.5, d: 0.4, h: 0.52, price: 359, color: '#c8a27a', mat: 'wood', img: null },
    { id: 's10', name: '大叶绿植', cat: 'plant', w: 0.6, d: 0.6, h: 1.5, price: 129, color: '#4e7d4e', mat: 'fabric', img: null }
  ];

  const SAMPLE_PLAN = {
    walls: [
      { x1: 0, y1: 0, x2: 8, y2: 0 }, { x1: 8, y1: 0, x2: 8, y2: 6 },
      { x1: 8, y1: 6, x2: 0, y2: 6 }, { x1: 0, y1: 6, x2: 0, y2: 0 },
      { x1: 5, y1: 0, x2: 5, y2: 6 }
    ],
    doors: [
      { x1: 1.2, y1: 0, x2: 2.1, y2: 0 },   // 入户门
      { x1: 5, y1: 3.4, x2: 5, y2: 4.3 }    // 卧室门
    ],
    windows: [
      { x1: 2.5, y1: 6, x2: 4.5, y2: 6 },   // 客厅窗
      { x1: 8, y1: 1.5, x2: 8, y2: 3.2 }    // 卧室窗
    ]
  };

  // 示例样板间家具（首次打开时预载，便于直接看效果）
  const SAMPLE_ITEMS = [
    ['客厅地毯', 'rug', 2.6, 1.9, 0.02, 3.2, 1.9, '#c9bfae', 'fabric', 459, 0],
    ['北欧布艺三人沙发', 'sofa', 2.2, 0.95, 0.85, 3.3, 0.75, '#b7a99a', 'fabric', 3299, 0],
    ['岩板茶几', 'table', 1.1, 0.55, 0.42, 3.2, 2.1, '#4b4b4b', 'metal', 1299, 0],
    ['休闲单椅', 'chair', 0.7, 0.75, 0.8, 4.5, 2.5, '#7d8c6f', 'fabric', 699, 200],
    ['卧室地毯', 'rug', 1.6, 1.2, 0.02, 6.5, 3.3, '#d7cfc2', 'fabric', 299, 0],
    ['奶油风双人床', 'bed', 1.85, 2.05, 1.0, 6.5, 1.35, '#e8ddcf', 'fabric', 2899, 0],
    ['床头柜', 'cabinet', 0.5, 0.4, 0.52, 5.45, 0.45, '#c8a27a', 'wood', 359, 0],
    ['床头柜', 'cabinet', 0.5, 0.4, 0.52, 7.5, 0.45, '#c8a27a', 'wood', 359, 0],
    ['推拉门衣柜', 'wardrobe', 1.8, 0.6, 2.2, 6.6, 5.55, '#d9cfc0', 'wood', 4599, 0],
    ['原木餐桌', 'table', 1.4, 0.8, 0.75, 0.95, 4.3, '#c8a27a', 'wood', 1899, 0],
    ['餐椅', 'chair', 0.45, 0.45, 0.85, 0.95, 3.55, '#8d6e63', 'wood', 429, 180],
    ['餐椅', 'chair', 0.45, 0.45, 0.85, 0.95, 5.05, '#8d6e63', 'wood', 429, 0],
    ['餐椅', 'chair', 0.45, 0.45, 0.85, 1.8, 4.3, '#8d6e63', 'wood', 429, 270],
    ['落地灯', 'lamp', 0.4, 0.4, 1.6, 4.5, 0.6, '#e0c98f', 'fabric', 399, 0],
    ['大叶绿植', 'plant', 0.7, 0.7, 1.5, 0.45, 0.6, '#4e7d4e', 'fabric', 129, 0],
    ['电视柜', 'cabinet', 1.8, 0.4, 0.45, 3.2, 5.6, '#b08d6a', 'wood', 1599, 180]
  ].map((a, i) => ({
    id: 'demo' + i, name: a[0], cat: a[1], w: a[2], d: a[3], h: a[4],
    x: a[5], y: a[6], color: a[7], mat: a[8], price: a[9], rot: a[10], img: null
  }));

  // ---------- 应用 ----------
  const app = {
    plan: { walls: [], doors: [], windows: [] },
    items: [],
    catalog: [],
    underlay: { img: null, ox: 0, oy: 0, s: 100, opacity: 0.45 },
    selectedId: null,
    view: '2d',
    settings: { showDims: true, wallMode: 'solid' },   // showDims: 尺寸/间距标注；wallMode: 3D 墙体显示（solid/fade/hide）

    init() {
      this.load();
      this.editor = new SD.Editor2D(document.getElementById('c2d'), this);
      this.editor.showDims = this.settings.showDims !== false;
      this.scene3d = new SD.Scene3D();
      this.scene3d.showDims = this.settings.showDims !== false;
      this.scene3d.wallMode = this.settings.wallMode || 'solid';
      this.scene3d.init(document.getElementById('c3d'));
      this.catalogUI = new SD.Catalog(this);
      this.catalogUI.render();
      this._bindUI();
      this._syncUnderlayUI();
      this._syncDimsUI();
      this._syncWallUI();
      this._renderSaves();
      this.editor.fit();
      this.editor.render();
      this._updateHint();
      if (this._firstRun) {
        this.save();
        this._toast('已载入你的户型（10.14×12.3m）和 5 件家具 · 拖一拖就能调位置，点「3D 实景查看」看效果');
      }
    },

    // 首次使用 / 点「载入我的户型」：铺上户型图和默认家具
    _seedDefaults() {
      const P = SD.DEFAULT_PLAN;
      if (P) this.plan = JSON.parse(JSON.stringify(P));
      const mine = SD.MY_CATALOG || [];
      this.catalog = JSON.parse(JSON.stringify(mine))
        .concat(JSON.parse(JSON.stringify(SEED_CATALOG)));
      this.items = (SD.DEFAULT_ITEMS || []).map((p, i) => {
        const c = mine.find(x => x.id === p.ref) || {};
        return {
          id: 'seed' + i, name: c.name, cat: c.cat, w: c.w, d: c.d, h: c.h,
          color: c.color, mat: c.mat, price: c.price, img: c.img || null,
          x: p.x, y: p.y, rot: p.rot || 0
        };
      });
      const u = SD.DEFAULT_UNDERLAY;
      if (u) {
        this.underlay = { img: null, ox: u.ox, oy: u.oy, s: u.s, opacity: u.opacity };
        const img = new Image();
        img.onload = () => {
          this.underlay.img = img;
          this._syncUnderlayUI();
          this.editor && this.editor.render();
          this.save();
        };
        img.src = u.src;
      }
    },

    _syncUnderlayUI() {
      const u = this.underlay;
      const sl = document.getElementById('underlayOpacity');
      if (sl) sl.value = Math.round((u.opacity || 0) * 100);
      const cb = document.getElementById('showUnderlay');
      if (cb) cb.checked = (u.opacity || 0) > 0;
      if (u.opacity > 0) this._lastOpacity = u.opacity;
    },

    _toast(msg) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = msg;
      document.getElementById('stage').appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 6500);
    },

    // ----- 数据 -----
    save() {
      try {
        const u = this.underlay;
        localStorage.setItem(LS_KEY, JSON.stringify({
          v: LS_VER,
          plan: this.plan, items: this.items, catalog: this.catalog,
          settings: this.settings,
          underlay: { img: u.img ? u.img.src : null, ox: u.ox, oy: u.oy, s: u.s, opacity: u.opacity }
        }));
      } catch (e) { console.warn('保存失败（可能超容量）', e); }
    },
    load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) {
          // 首次使用：铺上「我的户型」+ 已有家具，打开就能用
          this._seedDefaults();
          this._firstRun = true;
          return;
        }
        const d = JSON.parse(raw);
        if (d.plan) this.plan = d.plan;
        if (d.items) this.items = d.items;
        if (d.catalog && d.catalog.length) this.catalog = d.catalog;
        if (d.settings) Object.assign(this.settings, d.settings);
        // v1 → v2：餐边柜原来 rot=180（背面朝外），修正为正面朝外
        if (!d.v || d.v < 2) {
          this.items.forEach(it => {
            if (/餐边柜/.test(it.name) && it.rot === 180) it.rot = 0;
          });
        }
        if (d.underlay) {
          Object.assign(this.underlay, d.underlay, { img: null });
          if (d.underlay.img) {
            const img = new Image();
            img.onload = () => { this.underlay.img = img; this.editor && this.editor.render(); };
            img.src = d.underlay.img;
          }
        }
      } catch (e) { console.warn('读取存档失败', e); }
    },

    changed(light) {
      this.save();
      if (!light) this.catalogUI && this.catalogUI.render();
      // 3D 模式下调参数也实时刷新，边看边调
      if (this.view === '3d') this.scene3d.update(this.plan, this.items);
      this._updateHint();
    },

    _updateHint() {
      const empty = !this.items.length && !this.plan.walls.length;
      document.getElementById('hint2d').style.display = (empty && this.view === '2d') ? 'block' : 'none';
      document.getElementById('planStats').innerHTML =
        `当前：墙 <b>${this.plan.walls.length}</b> · 门 <b>${this.plan.doors.length}</b> · 窗 <b>${this.plan.windows.length}</b> · 家具 <b>${this.items.length}</b> 件`;
    },

    // ----- 户型图：上传 + 自动识别墙体 -----
    loadPlanImage(file) {
      const E = this.editor;
      document.querySelector('.tab[data-tab=plan]').click();
      this._toast('正在读取户型图…');
      SD.fileToImage(file, 1600, (url, img) => {
        if (!img || !img.width) { this._toast('图片读取失败，换张 JPG/PNG 试试'); return; }
        this.underlay.img = img;
        this._lastOpacity = 0.5;
        this.underlay.opacity = 0.5;
        document.getElementById('underlayOpacity').value = 50;
        const cb = document.getElementById('showUnderlay');
        if (cb) cb.checked = true;
        // 先按 10m 宽摆放（识别成功后会被精确覆盖）
        this.underlay.s = img.width / 10;
        this.underlay.ox = 0;
        this.underlay.oy = 0;
        this.changed(true);
        E.render();
        this.autoTrace(null, false);
      });
    },

    /**
     * 从底图识别墙体
     * @param {number|null} widthM 户型总宽（米）；不传则用上一次的值或 10m
     * @param {boolean} askConfirm 是否覆盖前确认
     */
    autoTrace(widthM, askConfirm) {
      const u = this.underlay, E = this.editor;
      if (!u.img) { this._toast('请先上传户型图'); return; }

      const res = SD.traceWalls(u.img);
      const box = document.getElementById('traceBox');
      const stat = document.getElementById('traceStat');
      if (!res || !res.segments.length) {
        box.style.display = 'block';
        stat.innerHTML = '⚠️ 没识别到墙体 <span>（图片偏糊 / 墙体不是深色线条时，请用「🧱 画墙」手动描）</span>';
        this._toast('没识别到墙体，试试更清晰的户型图');
        return;
      }

      const realItems = this.items.filter(i => !SEED_RE.test(i.id)).length;
      const hasManual = this.plan.doors.length + this.plan.windows.length + realItems > 0;
      if (askConfirm && hasManual &&
        !confirm(`将用识别出的 ${res.segments.length} 段墙替换当前户型（已放的门窗会清空，家具保留），继续？`)) return;

      const bbox = res.bbox;
      const width = widthM || this._traceWidth || 10;
      const ppm = bbox.w / width;                  // 图像素 / 米
      const r = v => Math.round(v * 100) / 100;    // 圆整到 1cm

      const walls = res.segments.map(s => ({
        x1: r((s.x1 - bbox.x0) / ppm), y1: r((s.y1 - bbox.y0) / ppm),
        x2: r((s.x2 - bbox.x0) / ppm), y2: r((s.y2 - bbox.y0) / ppm)
      })).filter(w => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) > 0.15);

      // 底图与墙段用同一比例，保证完全对齐
      u.s = ppm;
      u.ox = -bbox.x0 / ppm;
      u.oy = -bbox.y0 / ppm;

      const droppedDemo = this.items.filter(i => SEED_RE.test(i.id)).length;
      this.items = this.items.filter(i => !SEED_RE.test(i.id));
      this.plan = { walls, doors: [], windows: [] };
      this._traceWidth = width;

      box.style.display = 'block';
      document.getElementById('traceWidth').value = width;
      stat.innerHTML = `✅ 识别到 <b>${walls.length}</b> 段墙 <span>· 户型宽 ${width.toFixed(2)}m</span>`;

      this.changed(true);
      E.fit();
      E.render();
      this._toast(droppedDemo
        ? `已识别 ${walls.length} 段墙，示例家具已清空，可以开始摆场了`
        : `已识别 ${walls.length} 段墙 · 尺寸不准就改「户型总宽」重新识别`);
    },

    // ----- 家具操作 -----
    enterPlaceMode(prod) {
      this.view = '2d'; this._switchView('2d');
      this._setMode('place');
      this.editor.pendingPlace = {
        name: prod.name, cat: prod.cat, w: prod.w, d: prod.d, h: prod.h,
        color: prod.color, mat: prod.mat, img: prod.img, price: prod.price, rot: 0
      };
      this.editor.render();
    },
    placeItem(p, x, y) {
      const it = Object.assign({ id: 'i' + Date.now() + Math.random().toString(36).slice(2, 6), x, y }, p);
      const [fx, fy] = this.editor.findFreeSpot(it, x, y);   // 先找不叠放、不穿墙的空地
      it.x = fx; it.y = fy;
      this.editor._fitPlacement(it);                          // 再做一次贴墙 + 推开校正
      this.items.push(it);
      this.selectItem(this.items[this.items.length - 1].id);
      this._setMode('select'); // 放下后回到选择模式，避免连续误放
      this.changed();
    },
    selectItem(id) {
      this.selectedId = id;
      const p = document.getElementById('itemPanel');
      if (!id) { p.classList.add('hidden'); this.editor.render(); if (this.view === '3d') this.scene3d.setSelected(null); return; }
      const it = this.items.find(i => i.id === id);
      if (!it) return;
      p.classList.remove('hidden');
      document.getElementById('ipName').value = it.name;
      document.getElementById('ipW').value = Math.round(it.w * 100);
      document.getElementById('ipD').value = Math.round(it.d * 100);
      document.getElementById('ipH').value = Math.round(it.h * 100);
      document.getElementById('ipColor').value = it.color;
      document.getElementById('ipMat').value = it.mat;
      document.getElementById('ipRot').value = ((Math.round(it.rot || 0)) % 360 + 360) % 360;
      if (this.view === '3d') this.scene3d.setSelected(id);   // 3D 里同步显示间距
      this.editor.render();
    },

    // 旋转/缩放后防穿墙（自动贴墙）
    _fitWall() {
      const it = this._sel();
      if (!it || !this.editor) return;
      this.editor._fitPlacement(it);   // 贴墙 + 不叠放
      if (this.view === '3d') this.scene3d.setSelected(this.selectedId);
    },

    // 旋转选中家具：deg 为相对角度；同步属性面板角度值
    _rotate(deg) {
      const it = this._sel();
      if (!it) return;
      it.rot = (((it.rot || 0) + deg) % 360 + 360) % 360;
      this._fitWall();
      const ipRot = document.getElementById('ipRot');
      if (document.activeElement !== ipRot) ipRot.value = it.rot;
      this.changed(true);
      this.editor.render();
    },
    deleteItem(id) {
      this.items = this.items.filter(i => i.id !== id);
      if (this.selectedId === id) { this.selectedId = null; document.getElementById('itemPanel').classList.add('hidden'); }
      this.changed();
      this.editor.render();
    },

    // ----- 模式/视图 -----
    _setMode(m) {
      this.editor.mode = m;
      if (m !== 'place') this.editor.pendingPlace = null;
      if (m !== 'wall' && m !== 'calibrate') this.editor.pending = null;
      document.querySelectorAll('#modeGroup .tool-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === m));
      if (m !== 'select') this.selectItem(null);
      this.editor.render();
    },
    _switchView(v) {
      this.view = v;
      document.getElementById('btn2d').classList.toggle('active', v === '2d');
      document.getElementById('btn3d').classList.toggle('active', v === '3d');
      document.getElementById('c2d').classList.toggle('hidden', v !== '2d');
      document.getElementById('c3d').classList.toggle('hidden', v !== '3d');
      document.getElementById('modeGroup').classList.toggle('hidden', v !== '2d');
      document.getElementById('dimGroup').classList.toggle('hidden', false);   // 📐 2D/3D 都可用
      document.getElementById('view3dGroup').classList.toggle('hidden', v !== '3d');
      document.getElementById('wallGroup').classList.toggle('hidden', v !== '3d');
      document.getElementById('hint2d').style.display = 'none';
      document.getElementById('hint3d').classList.toggle('hidden', v !== '3d');
      const badge = document.querySelector('.mode-badge');
      if (badge) badge.style.display = v === '3d' ? 'none' : 'block';
      if (v === '3d') {
        this.scene3d.update(this.plan, this.items);
        this.scene3d.setSelected(this.selectedId);   // 3D 里同步显示选中家具的间距
        this.scene3d.start();
        this._set3dHint(this.scene3d.preset);
        document.querySelectorAll('#view3dGroup .tool-btn').forEach(x =>
          x.classList.toggle('active', x.dataset.preset === this.scene3d.preset));
      } else {
        this.scene3d.stop();
        this.editor.render();
        this._updateHint();
      }
    },

    // ----- UI 绑定 -----
    _bindUI() {
      const E = this.editor;

      document.getElementById('btn2d').addEventListener('click', () => this._switchView('2d'));
      document.getElementById('btnDims').addEventListener('click', () => this._toggleDims());
      document.getElementById('btnWall').addEventListener('click', () => this._cycleWallMode());
      document.getElementById('btn3d').addEventListener('click', () => this._switchView('3d'));
      document.querySelectorAll('#modeGroup .tool-btn').forEach(b =>
        b.addEventListener('click', () => this._setMode(b.dataset.mode)));
      document.querySelectorAll('#view3dGroup .tool-btn').forEach(b =>
        b.addEventListener('click', () => {
          if (b.id === 'btnStill') { this.scene3d.still(); return; }
          this.scene3d.setPreset(b.dataset.preset);
          document.querySelectorAll('#view3dGroup .tool-btn').forEach(x =>
            x.classList.toggle('active', x === b));
          this._set3dHint(b.dataset.preset);
        }));

      // 侧栏 tab
      document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
        document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + t.dataset.tab));
      }));

      // 底图：选择 / 拖拽上传 → 自动识别墙体
      const fileInput = document.getElementById('underlayInput');
      fileInput.addEventListener('change', e => {
        const f = e.target.files && e.target.files[0];
        if (f) this.loadPlanImage(f);
        fileInput.value = '';   // 允许重复选同一张图
      });
      // 拖拽到画布
      const stage = document.getElementById('stage');
      ['dragenter', 'dragover'].forEach(t => stage.addEventListener(t, e => {
        if (!e.dataTransfer) return;
        e.preventDefault();
        document.getElementById('dropZone').classList.add('dragover');
      }));
      ['dragleave', 'drop'].forEach(t => stage.addEventListener(t, e => {
        if (!e.dataTransfer) return;
        e.preventDefault();
        document.getElementById('dropZone').classList.remove('dragover');
      }));
      stage.addEventListener('drop', e => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f && /^image\//.test(f.type)) {
          document.querySelector('.tab[data-tab=plan]').click();
          this.loadPlanImage(f);
        }
      });
      document.getElementById('btnTrace').addEventListener('click', () => {
        const w = parseFloat(document.getElementById('traceWidth').value);
        this.autoTrace(w > 2 ? w : 10, true);
      });
      document.getElementById('traceWidth').addEventListener('change', () => {
        const w = parseFloat(document.getElementById('traceWidth').value);
        if (w > 2) this.autoTrace(w, false);   // 调比例时直接重算，不打断
      });
      document.getElementById('showUnderlay').addEventListener('change', e => {
        const on = e.target.checked;
        this.underlay.opacity = on ? (this._lastOpacity || 0.5) : 0;
        document.getElementById('underlayOpacity').value = Math.round(this.underlay.opacity * 100);
        E.render();
      });
      document.getElementById('underlayOpacity').addEventListener('input', e => {
        const v = e.target.value / 100;
        this.underlay.opacity = v;
        if (v > 0) this._lastOpacity = v;
        const cb = document.getElementById('showUnderlay');
        if (cb) cb.checked = v > 0;
        E.render();
      });

      document.getElementById('btnSample').addEventListener('click', () => {
        if (!confirm('载入「我的户型」：替换当前户型，并恢复默认家具摆放（自己后加的商品和家具会保留）。继续？')) return;
        const keep = this.items.filter(i => !SEED_RE.test(i.id));
        this._seedDefaults();
        this.items = this.items.concat(keep);
        this.selectedId = null;
        document.getElementById('itemPanel').classList.add('hidden');
        this.changed();
        E.fit();
        this._toast('已载入我的户型与默认家具');
      });
      document.getElementById('btnFit').addEventListener('click', () => E.fit());
      document.getElementById('btnClear').addEventListener('click', () => {
        if (!confirm('清空整个方案（户型+家具+商品库）？此操作不可恢复。')) return;
        localStorage.removeItem(LS_KEY);
        location.reload();
      });

      // 属性面板
      const ipBind = (id, fn) => document.getElementById(id).addEventListener('input', fn);
      ipBind('ipName', e => { const it = this._sel(); if (it) { it.name = e.target.value; this.changed(true); E.render(); } });
      ipBind('ipW', e => { const it = this._sel(); if (it) { it.w = Math.max(0.05, (+e.target.value || 0) / 100); this._fitWall(); this.changed(true); E.render(); } });
      ipBind('ipD', e => { const it = this._sel(); if (it) { it.d = Math.max(0.05, (+e.target.value || 0) / 100); this._fitWall(); this.changed(true); E.render(); } });
      ipBind('ipH', e => { const it = this._sel(); if (it) { it.h = Math.max(0.02, (+e.target.value || 0) / 100); this.changed(true); } });
      ipBind('ipColor', e => { const it = this._sel(); if (it) { it.color = e.target.value; this.changed(true); E.render(); } });
      ipBind('ipMat', e => { const it = this._sel(); if (it) { it.mat = e.target.value; this.changed(true); } });
      document.getElementById('ipRotate').addEventListener('click', () => this._rotate(15));
      ipBind('ipRot', e => {
        const it = this._sel(); if (!it) return;
        let v = Math.round(+e.target.value || 0);
        if (e.target.value === '' || v < 0 || v > 359) v = ((v % 360) + 360) % 360;
        it.rot = v;
        this._fitWall();
        this.changed(true);
        E.render();
      });
      document.getElementById('ipRot90').addEventListener('click', () => this._rotate(90));
      document.getElementById('ipRot180').addEventListener('click', () => this._rotate(180));
      document.getElementById('ipDelete').addEventListener('click', () => { if (this.selectedId) this.deleteItem(this.selectedId); });
      document.getElementById('ipClose').addEventListener('click', () => this.selectItem(null));

      // 键盘
      window.addEventListener('keydown', e => {
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
        if (e.code === 'Space') { E.spaceDown = true; e.preventDefault(); }
        const k = e.key.toLowerCase();
        if (this.view === '3d' && e.key === 'Escape') {
          this.scene3d.exitImmersive();
          document.querySelectorAll('#view3dGroup .tool-btn').forEach(x =>
            x.classList.toggle('active', x.dataset.preset === 'walk'));
          this._set3dHint('walk');
          return;
        }
        if (e.key.toLowerCase() === 'm') { this._toggleDims(); return; }   // 2D / 3D 都能开关标注
        if (this.view !== '2d') return;
        if (k === 'v') this._setMode('select');
        else if (k === 'w') this._setMode('wall');
        else if (k === 'd') this._setMode('door');
        else if (k === 'o') this._setMode('window');
        else if (k === 'e') this._setMode('erase');
        else if (k === 'r') {
          if (this._sel()) this._rotate(e.shiftKey ? -15 : 15);
        } else if (k === 'q') {
          if (this._sel()) this._rotate(e.shiftKey ? -90 : 90);
        } else if (k === 't') {
          if (this._sel()) this._rotate(180);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          if (this.selectedId) { e.preventDefault(); this.deleteItem(this.selectedId); }
        } else if (e.key === 'Escape') {
          E.cancel(); this.selectItem(null); this._setMode('select');
        }
      });
      window.addEventListener('keyup', e => { if (e.code === 'Space') E.spaceDown = false; });

      // 清单导出
      document.getElementById('btnExport').addEventListener('click', () => this._exportList());

      // 保存方案（顶栏 + 方案面板）
      const doSave = () => this.saveSnapshot();
      const sb = document.getElementById('btnSave');
      if (sb) sb.addEventListener('click', doSave);
      const sbp = document.getElementById('btnSavePanel');
      if (sbp) sbp.addEventListener('click', doSave);
    },

    _sel() { return this.items.find(i => i.id === this.selectedId); },

    // ----- 命名方案快照：布局确定后存一份，随时载入对比 -----
    _loadSaves() {
      try { return JSON.parse(localStorage.getItem(LS_SAVE) || '[]'); }
      catch (e) { return []; }
    },
    _putSaves(arr) {
      try { localStorage.setItem(LS_SAVE, JSON.stringify(arr)); return true; }
      catch (e) { this._toast('保存失败：浏览器存储空间不足，试试删掉几个旧方案'); return false; }
    },
    saveSnapshot() {
      const defName = '方案 ' + new Date().toLocaleString('zh-CN',
        { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-');
      const name = (prompt('给这个布局方案起个名字：', defName) || '').trim();
      if (!name) return;
      const u = this.underlay;
      const rec = {
        id: 'sv' + Date.now(), name,
        time: Date.now(), count: this.items.length,
        data: {
          plan: JSON.parse(JSON.stringify(this.plan)),
          items: JSON.parse(JSON.stringify(this.items)),
          underlay: { img: u.img ? u.img.src : null, ox: u.ox, oy: u.oy, s: u.s, opacity: u.opacity }
        }
      };
      const arr = this._loadSaves();
      arr.unshift(rec);
      if (this._putSaves(arr)) {
        this._renderSaves();
        this._toast(`已保存方案「${name}」（${rec.count} 件家具），在「🗂 方案」里随时载入`);
      }
    },
    loadSnapshot(id) {
      const rec = this._loadSaves().find(r => r.id === id);
      if (!rec) return;
      const d = rec.data;
      this.plan = JSON.parse(JSON.stringify(d.plan || { walls: [], doors: [], windows: [] }));
      this.items = JSON.parse(JSON.stringify(d.items || []));
      this.selectedId = null;
      document.getElementById('itemPanel').classList.add('hidden');
      const u = d.underlay || {};
      this.underlay = { img: null, ox: u.ox || 0, oy: u.oy || 0, s: u.s || 100, opacity: u.opacity != null ? u.opacity : 0.45 };
      if (u.img) {
        const img = new Image();
        img.onload = () => { this.underlay.img = img; this.editor.render(); };
        img.src = u.img;
      }
      this.changed();
      this.editor.fit();
      this._toast(`已载入方案「${rec.name}」（${rec.count} 件家具）`);
    },
    deleteSnapshot(id) {
      const rec = this._loadSaves().find(r => r.id === id);
      if (!rec) return;
      if (!confirm(`删除方案「${rec.name}」？此操作不可恢复。`)) return;
      this._putSaves(this._loadSaves().filter(r => r.id !== id));
      this._renderSaves();
    },
    _renderSaves() {
      const box = document.getElementById('saveList');
      if (!box) return;
      const arr = this._loadSaves();
      if (!arr.length) {
        box.innerHTML = '<div class="empty-tip">还没有保存过方案<br>布局确定后点上方按钮存一份</div>';
        return;
      }
      box.innerHTML = arr.map(r => `
        <div class="save-item" data-id="${r.id}">
          <div class="save-info">
            <div class="save-name">${r.name}</div>
            <div class="save-meta">${new Date(r.time).toLocaleString('zh-CN')} · ${r.count || '?'} 件家具</div>
          </div>
          <div class="save-ops">
            <button class="mini-btn" data-act="load">载入</button>
            <button class="save-del" data-act="del" title="删除">✕</button>
          </div>
        </div>`).join('');
      box.querySelectorAll('.save-item').forEach(el => {
        el.querySelector('[data-act=load]').addEventListener('click', () => this.loadSnapshot(el.dataset.id));
        el.querySelector('[data-act=del]').addEventListener('click', () => this.deleteSnapshot(el.dataset.id));
      });
    },

    // 显示/隐藏 尺寸与间距标注（2D 和 3D 通用）
    _toggleDims() {
      const on = !(this.settings.showDims !== false);
      this.settings.showDims = on;
      this.editor.showDims = on;
      if (this.scene3d) this.scene3d.setShowDims(on);
      const b = document.getElementById('btnDims');
      if (b) b.classList.toggle('active', on);
      this.editor.render();
      this.save();
      this._toast(on ? '已显示尺寸与到墙净距（选中家具有效）' : '已隐藏尺寸标注');
    },
    _syncDimsUI() {
      const b = document.getElementById('btnDims');
      if (b) b.classList.toggle('active', this.settings.showDims !== false);
    },

    // 3D 墙体显示方式：实心 2.7m 全高 → 近侧墙半透 → 近侧墙隐藏
    _cycleWallMode() {
      const order = ['solid', 'fade', 'hide'];
      const cur = this.settings.wallMode || 'solid';
      const next = order[(order.indexOf(cur) + 1) % order.length];
      this.settings.wallMode = next;
      if (this.scene3d) {
        this.scene3d.wallMode = next;
        if (this.view === '3d') this.scene3d._updateWallCut();
      }
      this._syncWallUI();
      this.save();
      const tip = { solid: '墙体：实心 2.7m 全高', fade: '墙体：挡住视线的近侧墙半透', hide: '墙体：挡住视线的近侧墙隐藏' };
      this._toast(tip[next]);
    },
    _syncWallUI() {
      const b = document.getElementById('btnWall');
      if (!b) return;
      const m = this.settings.wallMode || 'solid';
      b.textContent = m === 'solid' ? '🧱 实心' : m === 'fade' ? '🧱 半透' : '🧱 隐藏';
      b.classList.toggle('active', m !== 'solid');
    },

    // 3D 各视角的操作提示
    _set3dHint(preset) {
      const HINTS = {
        orbit: '🖱️ 左键拖动旋转 · 滚轮缩放 · 右键平移',
        top: '🖱️ 左键拖动平移 · 滚轮缩放',
        walk: '🖱️ 左键拖动环顾 · 滚轮缩放 · 想走动就切「第一人称漫游」',
        pano: '🌐 全景：按住拖动环顾四周 · 滚轮调整视野（广角↔长焦）· Esc 退出',
        fp: '🎮 漫游：WASD / 方向键走动 · 鼠标环顾 · Shift 加速 · Esc 退出'
      };
      const h = document.getElementById('hint3d');
      if (h && HINTS[preset]) h.innerHTML = HINTS[preset];
    },

    // ----- 清单导出 -----
    _exportList() {
      const groups = {};
      this.items.forEach(it => {
        const key = it.name + '|' + it.w + '|' + it.d + '|' + it.h;
        if (!groups[key]) groups[key] = { it, qty: 0 };
        groups[key].qty++;
      });
      const rows = Object.values(groups);
      let total = 0, totalQty = 0;
      const trs = rows.map(({ it, qty }) => {
        const sub = (it.price || 0) * qty;
        total += sub; totalQty += qty;
        return `<tr>
          <td>${it.img ? `<img src="${it.img}" style="width:36px;height:36px;object-fit:cover;border-radius:6px">` : '—'}</td>
          <td>${it.name}</td>
          <td>${SD.CAT_LABEL[it.cat] || it.cat}</td>
          <td>${(it.w * 100).toFixed(0)}×${(it.d * 100).toFixed(0)}×${(it.h * 100).toFixed(0)}</td>
          <td>${qty}</td>
          <td>${it.price ? '¥' + it.price : '—'}</td>
          <td>${it.price ? '¥' + sub.toFixed(2) : '—'}</td>
        </tr>`;
      }).join('');

      const dlg = document.createElement('dialog');
      dlg.id = 'listDialog';
      dlg.innerHTML = `
        <div class="ld-head"><span>🛒 软装采购清单（${totalQty} 件 / ${rows.length} 类）</span><button id="ldClose">✕</button></div>
        <div class="ld-body">
          ${rows.length ? `<table>
            <tr><th>图</th><th>名称</th><th>品类</th><th>宽×深×高(cm)</th><th>数量</th><th>单价</th><th>小计</th></tr>
            ${trs}
          </table>
          <div class="ld-total">合计：¥${total.toFixed(2)}</div>` : '<div class="empty-tip">画布上还没有家具，先去摆放吧</div>'}
        </div>
        <div class="ld-actions">
          <button class="ghost-btn" id="ldCsv">⬇️ 导出 CSV</button>
          <button class="primary-btn" style="width:auto;padding:8px 20px;margin:0" id="ldPrint">🖨️ 打印</button>
        </div>`;
      document.body.appendChild(dlg);
      dlg.showModal();
      dlg.querySelector('#ldClose').addEventListener('click', () => dlg.close());
      dlg.addEventListener('close', () => dlg.remove());
      dlg.querySelector('#ldPrint').addEventListener('click', () => {
        const w = window.open('', '_blank');
        if (!w) { alert('浏览器拦截了新窗口，请允许弹窗后再试'); return; }
        w.document.write(`<html><head><meta charset="utf-8"><title>软装采购清单</title>
          <style>body{font-family:-apple-system,"PingFang SC",sans-serif;padding:24px;color:#1f2937}
          h2{font-size:18px;margin-bottom:4px}.sub{color:#6b7280;font-size:12px;margin-bottom:14px}
          table{width:100%;border-collapse:collapse;font-size:12px}
          th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left}
          th{background:#f8fafc}tfoot td{font-weight:700}</style></head><body>
          <h2>软装采购清单</h2>
          <div class="sub">共 ${totalQty} 件 / ${rows.length} 类 · 导出时间 ${new Date().toLocaleString('zh-CN')}</div>
          <table><thead><tr><th>名称</th><th>品类</th><th>宽×深×高(cm)</th><th>数量</th><th>单价</th><th>小计</th></tr></thead>
          <tbody>${rows.map(({ it, qty }) => `<tr><td>${it.name}</td><td>${SD.CAT_LABEL[it.cat] || it.cat}</td>
            <td>${(it.w * 100).toFixed(0)}×${(it.d * 100).toFixed(0)}×${(it.h * 100).toFixed(0)}</td>
            <td>${qty}</td><td>${it.price ? '¥' + it.price : '—'}</td><td>${it.price ? '¥' + (it.price * qty).toFixed(2) : '—'}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">合计</td><td>${totalQty}</td><td></td><td>¥${total.toFixed(2)}</td></tr></tfoot>
          </table></body></html>`);
        w.document.close();
        setTimeout(() => w.print(), 300);
      });
      dlg.querySelector('#ldCsv').addEventListener('click', () => {
        let csv = '\uFEFF名称,品类,宽(cm),深(cm),高(cm),数量,单价,小计\n';
        rows.forEach(({ it, qty }) => {
          csv += `${it.name},${SD.CAT_LABEL[it.cat] || it.cat},${(it.w * 100).toFixed(0)},${(it.d * 100).toFixed(0)},${(it.h * 100).toFixed(0)},${qty},${it.price || ''},${((it.price || 0) * qty).toFixed(2)}\n`;
        });
        csv += `合计,,,,${totalQty},,${total.toFixed(2)}\n`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = '软装采购清单.csv';
        a.click();
      });
    }
  };

  window.addEventListener('DOMContentLoaded', () => app.init());
  SD.app = app;
})();
