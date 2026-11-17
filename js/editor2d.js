/* 2D 户型编辑器：画墙/门窗/家具摆放/底图标定 */
(function () {
  const SD = (window.SD = window.SD || {});

  const MODE_HINT = {
    select: '🖱️ 拖动移动 · R 旋转 · Q 90° · T 180° · M 间距标注 · Delete 删除',
    wall: '🧱 点击起点，再点击终点连续画墙，Esc 结束',
    door: '🚪 在墙体上点击放置门（宽0.9m）',
    window: '🪟 在墙体上点击放置窗（宽1.2m）',
    erase: '🗑️ 点击要删除的墙 / 门 / 窗 / 家具',
    place: '📦 点击画布放置家具',
    calibrate: '📏 在底图已知长度线段上点两端'
  };

  class Editor2D {
    constructor(canvas, app) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.app = app;
      this.mode = 'select';
      this.zoom = 80;          // px / 米
      this.panX = 60; this.panY = 60;
      this.pending = null;     // 画墙起点 / 标定第一点
      this.mouse = null;       // 当前世界坐标
      this.spaceDown = false;
      this.showDims = true;    // 选中家具时显示尺寸 + 到墙净距
      this._bind();
      this._resize();
      new ResizeObserver(() => { this._resize(); this.render(); }).observe(canvas.parentElement);
    }

    // ---------- 坐标 ----------
    w2s(x, y) { return [x * this.zoom + this.panX, y * this.zoom + this.panY]; }
    s2w(sx, sy) { return [(sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom]; }

    _resize() {
      const p = this.c.parentElement;
      const dpr = window.devicePixelRatio || 1;
      this.w = p.clientWidth; this.h = p.clientHeight;
      this.c.width = this.w * dpr; this.c.height = this.h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    fit() {
      const pts = [];
      this.app.plan.walls.forEach(w => pts.push([w.x1, w.y1], [w.x2, w.y2]));
      this.app.items.forEach(i => pts.push([i.x, i.y]));
      if (!pts.length) {
        // 还没有墙和家具时，按底图范围取景
        const u = this.app.underlay;
        if (u.img && u.s) pts.push([u.ox, u.oy], [u.ox + u.img.width / u.s, u.oy + u.img.height / u.s]);
      }
      if (!pts.length) { this.zoom = 80; this.panX = 60; this.panY = 60; this.render(); return; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
      const pad = 60;
      const zw = (this.w - pad * 2) / Math.max(1, x1 - x0 + 1);
      const zh = (this.h - pad * 2) / Math.max(1, y1 - y0 + 1);
      this.zoom = Math.min(300, Math.max(20, Math.min(zw, zh)));
      this.panX = pad - x0 * this.zoom + (this.w - pad * 2 - (x1 - x0) * this.zoom) / 2;
      this.panY = pad - y0 * this.zoom + (this.h - pad * 2 - (y1 - y0) * this.zoom) / 2;
      this.render();
    }

    // ---------- 交互 ----------
    _bind() {
      const c = this.c;
      c.addEventListener('wheel', e => {
        e.preventDefault();
        const [wx, wy] = this.s2w(e.offsetX, e.offsetY);
        const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.zoom = Math.min(400, Math.max(15, this.zoom * f));
        this.panX = e.offsetX - wx * this.zoom;
        this.panY = e.offsetY - wy * this.zoom;
        this.render();
      }, { passive: false });

      c.addEventListener('pointerdown', e => this._down(e));
      c.addEventListener('pointermove', e => this._move(e));
      window.addEventListener('pointerup', e => this._up(e));
      c.addEventListener('dblclick', e => e.preventDefault());
      c.addEventListener('contextmenu', e => e.preventDefault());
    }

    _down(e) {
      try { this.c.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件可能无有效 pointerId */ }
      const [wx, wy] = this.s2w(e.offsetX, e.offsetY);
      this.mouse = [wx, wy];
      const plan = this.app.plan;

      if (e.button === 1 || e.button === 2 || this.spaceDown || (e.button === 0 && this.mode === 'select' && !this._hitItem(wx, wy) && !e.shiftKey)) {
        // 平移；选择模式点空白同时取消选中
        if (e.button === 0 && this.mode === 'select' && !this.spaceDown) this.app.selectItem(null);
        this.panning = { sx: e.offsetX, sy: e.offsetY, px: this.panX, py: this.panY };
        return;
      }
      if (e.button !== 0) return;

      const snap = v => Math.round(v * 20) / 20; // 5cm 吸附

      switch (this.mode) {
        case 'select': {
          const it = this._hitItem(wx, wy);
          this.app.selectItem(it ? it.id : null);
          if (it) this.dragging = { id: it.id, dx: it.x - snap(wx), dy: it.y - snap(wy) };
          break;
        }
        case 'wall': {
          const px = snap(wx), py = snap(wy);
          if (!this.pending) {
            this.pending = { x: px, y: py };
          } else {
            const a = this.pending;
            if (Math.hypot(px - a.x, py - a.y) > 0.1) {
              plan.walls.push({ x1: a.x, y1: a.y, x2: px, y2: py });
              this.pending = { x: px, y: py }; // 连笔画墙：以终点为新起点
              this.app.changed();
            }
          }
          break;
        }
        case 'door': case 'window': {
          const hit = this._hitWall(wx, wy);
          if (hit) {
            const { wall, t } = hit;
            const ux = (wall.x2 - wall.x1), uy = (wall.y2 - wall.y1);
            const len = Math.hypot(ux, uy);
            const halfW = (this.mode === 'door' ? 0.9 : 1.2) / 2;
            const tt = Math.min(Math.max(t, halfW / len), 1 - halfW / len);
            const cxp = wall.x1 + ux * tt, cyp = wall.y1 + uy * tt;
            const hx = (ux / len) * halfW, hy = (uy / len) * halfW;
            const arr = this.mode === 'door' ? plan.doors : plan.windows;
            arr.push({ x1: cxp - hx, y1: cyp - hy, x2: cxp + hx, y2: cyp + hy });
            this.app.changed();
          }
          break;
        }
        case 'erase': {
          const it = this._hitItem(wx, wy);
          if (it) { this.app.deleteItem(it.id); break; }
          const hitO = this._hitOpening(wx, wy);
          if (hitO) {
            const arr = hitO.type === 'door' ? plan.doors : plan.windows;
            arr.splice(arr.indexOf(hitO.o), 1);
            this.app.changed();
            break;
          }
          const hitW = this._hitWall(wx, wy);
          if (hitW) {
            plan.walls.splice(plan.walls.indexOf(hitW.wall), 1);
            this.app.changed();
          }
          break;
        }
        case 'place': {
          const cat = this.pendingPlace;
          if (cat) { this.app.placeItem(cat, snap(wx), snap(wy)); }
          break;
        }
        case 'calibrate': {
          const u = this.app.underlay;
          if (!u.img) { this.app._toast('请先在「📐 户型」面板上传户型图'); break; }
          if (!this.pending) {
            this.pending = { x1: wx, y1: wy };
          } else {
            const p1 = this.pending;
            const dWorld = Math.hypot(wx - p1.x1, wy - p1.y1);
            this.pending = null;
            if (dWorld < 0.05) break;
            const real = parseFloat(prompt('这两点之间的真实距离是多少米？（如 3.6）', '3.6'));
            if (real > 0) {
              // 底图上这段距离的像素 = dWorld * u.s（图px/米），据此重设比例
              const sOld = u.s;
              const sNew = (dWorld * sOld) / real;
              // 锚定第一个点击点：换算新左上角偏移
              const ix = (p1.x1 - u.ox) * sOld, iy = (p1.y1 - u.oy) * sOld;
              u.ox = p1.x1 - ix / sNew;
              u.oy = p1.y1 - iy / sNew;
              u.s = sNew;
              // 已画的墙/门窗与家具按同一比例缩放，保持与底图对齐
              const f = sNew / sOld;
              if (Math.abs(f - 1) > 0.002) {
                const ax = p1.x1, ay = p1.y1;
                const sx = x => ax + (x - ax) * f, sy = y => ay + (y - ay) * f;
                this.app.plan.walls.forEach(w => {
                  const a = sx(w.x1), b = sy(w.y1), c2 = sx(w.x2), d2 = sy(w.y2);
                  w.x1 = a; w.y1 = b; w.x2 = c2; w.y2 = d2;
                });
                ['doors', 'windows'].forEach(k => this.app.plan[k].forEach(o => {
                  const a = sx(o.x1), b = sy(o.y1), c2 = sx(o.x2), d2 = sy(o.y2);
                  o.x1 = a; o.y1 = b; o.x2 = c2; o.y2 = d2;
                }));
                this.app.items.forEach(i => { i.x = sx(i.x); i.y = sy(i.y); });
              }
              this.app.changed();
              this.app._toast(`比例已设为 ${sNew.toFixed(0)} px/米，户型已按新比例对齐`);
            }
          }
          break;
        }
      }
      this.render();
    }

    _move(e) {
      const [wx, wy] = this.s2w(e.offsetX, e.offsetY);
      this.mouse = [wx, wy];
      if (this.panning) {
        this.panX = this.panning.px + (e.offsetX - this.panning.sx);
        this.panY = this.panning.py + (e.offsetY - this.panning.sy);
        this.render();
        return;
      }
      if (this.dragging) {
        const it = this.app.items.find(i => i.id === this.dragging.id);
        if (it) {
          const snap = v => Math.round(v * 20) / 20;
          this._moveItemTo(it, snap(wx) + this.dragging.dx, snap(wy) + this.dragging.dy);
          this.draggingMoved = true;
          this.app.changed(true); // 轻量更新（不重渲染侧栏）
        }
      }
      this.render();
    }

    _up() {
      this.panning = null;
      if (this.dragging && this.draggingMoved) {
        this.draggingMoved = false;
        this.app.changed(); // 拖动结束：完整保存+刷新
      }
      this.dragging = null;
    }

    cancel() {
      this.pending = null;
      this.pendingPlace = null;
      document.querySelectorAll('.prod-item.selected').forEach(el => el.classList.remove('selected'));
      this.render();
    }

    // ---------- 命中检测 ----------
    _hitItem(wx, wy) {
      const arr = this.app.items;
      for (let i = arr.length - 1; i >= 0; i--) {
        const it = arr[i];
        const r = -(it.rot || 0) * Math.PI / 180;
        const dx = wx - it.x, dy = wy - it.y;
        const lx = dx * Math.cos(r) - dy * Math.sin(r);
        const ly = dx * Math.sin(r) + dy * Math.cos(r);
        if (Math.abs(lx) <= it.w / 2 && Math.abs(ly) <= it.d / 2) return it;
      }
      return null;
    }
    _distToSeg(px, py, w) {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) return Math.hypot(px - w.x1, py - w.y1);
      let t = ((px - w.x1) * dx + (py - w.y1) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (w.x1 + dx * t), py - (w.y1 + dy * t));
    }
    _hitWall(wx, wy) {
      let best = null;
      this.app.plan.walls.forEach(w => {
        const d = this._distToSeg(wx, wy, w);
        const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
        if (d < 0.2 && len > 0.1) {
          const t = ((wx - w.x1) * (w.x2 - w.x1) + (wy - w.y1) * (w.y2 - w.y1)) /
            Math.pow(len, 2);
          if (!best || d < best.d) best = { wall: w, d, t };
        }
      });
      return best;
    }
    _hitOpening(wx, wy) {
      const plan = this.app.plan;
      for (const type of ['doors', 'windows']) {
        for (const o of plan[type]) {
          if (this._distToSeg(wx, wy, o) < 0.25) return { o, type: type === 'doors' ? 'door' : 'window' };
        }
      }
      return null;
    }

    // ---------- 渲染 ----------
    render() {
      const ctx = this.ctx, W = this.w, H = this.h;
      if (!W) return;
      ctx.clearRect(0, 0, W, H);
      const app = this.app, plan = app.plan;

      // 网格：0.5m 细线 + 1m 主线（缩小时自动放粗，避免糊成一片）
      const z = this.zoom;
      const minor = z >= 55 ? 0.5 : z >= 24 ? 1 : 5;
      const major = minor === 0.5 ? 1 : minor * 2;
      const [gx0, gy0] = this.s2w(0, 0);
      const [gx1, gy1] = this.s2w(W, H);
      const gridLayer = (st, color, lw) => {
        ctx.strokeStyle = color; ctx.lineWidth = lw;
        ctx.beginPath();
        let n = 0;
        const x0 = Math.ceil(gx0 / st) * st;
        for (let x = x0; x < gx1 && n < 600; x += st, n++) {
          const s = this.w2s(x, 0)[0];
          ctx.moveTo(s, 0); ctx.lineTo(s, H);
        }
        n = 0;
        const y0 = Math.ceil(gy0 / st) * st;
        for (let y = y0; y < gy1 && n < 600; y += st, n++) {
          const s = this.w2s(0, y)[1];
          ctx.moveTo(0, s); ctx.lineTo(W, s);
        }
        ctx.stroke();
      };
      if (minor < major) gridLayer(minor, 'rgba(148,163,184,.16)', 1);
      gridLayer(major, 'rgba(148,163,184,.34)', 1);

      // 底图
      const u = app.underlay;
      if (u.img) {
        ctx.save();
        ctx.globalAlpha = u.opacity;
        const [sx, sy] = this.w2s(u.ox, u.oy);
        ctx.drawImage(u.img, sx, sy, u.img.width / u.s * this.zoom, u.img.height / u.s * this.zoom);
        ctx.restore();
      }

      // 墙
      ctx.lineCap = 'round';
      const wallWpx = Math.max(4, 0.24 * this.zoom);
      plan.walls.forEach(w => {
        const [x1, y1] = this.w2s(w.x1, w.y1), [x2, y2] = this.w2s(w.x2, w.y2);
        ctx.strokeStyle = '#37474f'; ctx.lineWidth = wallWpx;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = '#90a4ae'; ctx.lineWidth = Math.max(1, wallWpx * 0.3);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      });

      // 门/窗
      const drawOpening = (o, isDoor) => {
        const [x1, y1] = this.w2s(o.x1, o.y1), [x2, y2] = this.w2s(o.x2, o.y2);
        const len = Math.hypot(x2 - x1, y2 - y1);
        const ang = Math.atan2(y2 - y1, x2 - x1);
        ctx.save();
        ctx.translate((x1 + x2) / 2, (y1 + y2) / 2);
        ctx.rotate(ang);
        if (isDoor) {
          ctx.fillStyle = '#fafafa';
          ctx.fillRect(-len / 2 - 1, -wallWpx / 2 - 1, len + 2, wallWpx + 2);
          ctx.strokeStyle = '#1565c0'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(-len / 2, -len); ctx.stroke();
          ctx.beginPath(); ctx.arc(-len / 2, 0, len, -Math.PI / 2, 0); ctx.stroke();
        } else {
          ctx.fillStyle = '#e3f2fd';
          ctx.fillRect(-len / 2, -wallWpx / 2, len, wallWpx);
          ctx.strokeStyle = '#0277bd'; ctx.lineWidth = 1.5;
          ctx.strokeRect(-len / 2, -wallWpx / 2, len, wallWpx);
          ctx.beginPath();
          ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0);
          ctx.stroke();
        }
        ctx.restore();
      };
      plan.doors.forEach(o => drawOpening(o, true));
      plan.windows.forEach(o => drawOpening(o, false));

      // 家具
      app.items.forEach(it => this._drawItem(it));

      // 选中家具：自身尺寸 + 到四面墙的净距
      if (this.showDims) {
        const sel = app.items.find(i => i.id === app.selectedId);
        if (sel) this._drawDims(sel);
      }

      // 画墙预览
      if (this.mode === 'wall' && this.pending && this.mouse) {
        const a = this.pending;
        const [x1, y1] = this.w2s(a.x, a.y);
        const [x2, y2] = this.w2s(this.mouse[0], this.mouse[1]);
        ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = wallWpx; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.globalAlpha = 1;
        const d = Math.hypot(this.mouse[0] - a.x, this.mouse[1] - a.y);
        if (d > 0.05) {
          ctx.fillStyle = '#4f46e5'; ctx.font = '600 12px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(d.toFixed(2) + 'm', (x1 + x2) / 2, (y1 + y2) / 2 - wallWpx);
        }
      }

      // 标定预览
      if (this.mode === 'calibrate' && this.pending && this.mouse) {
        const p = this.pending;
        const [x1, y1] = this.w2s(p.x1, p.y1);
        const [x2, y2] = this.w2s(this.mouse[0], this.mouse[1]);
        ctx.strokeStyle = '#e11d48'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.setLineDash([]);
      }

      // 放置幽灵
      if (this.mode === 'place' && this.pendingPlace && this.mouse) {
        const [mx, my] = this.w2s(...this.mouse);
        const it = this.pendingPlace;
        ctx.save();
        ctx.translate(mx, my); ctx.rotate((it.rot || 0) * Math.PI / 180);
        ctx.globalAlpha = 0.6;
        this._drawTop(it, it.w * this.zoom, it.d * this.zoom);
        ctx.restore();
      }

      // 米制刻度尺
      this._drawRuler();

      // 模式提示角标
      if (!this.badge || this.badgeText !== this.mode) {
        if (this.badge) this.badge.remove();
        this.badge = document.createElement('div');
        this.badge.className = 'mode-badge';
        this.badgeText = this.mode;
        this.c.parentElement.appendChild(this.badge);
      }
      this.badge.textContent = MODE_HINT[this.mode] || '';
      this.badge.style.display = (this.app.view === '2d' &&
        !(this.mode === 'select' && !app.items.length && !plan.walls.length)) ? 'block' : 'none';
    }

    // ---------- 尺寸 / 间距标注 ----------
    // 家具自身坐标（原点在中心，+y 为正面）→ 世界坐标
    _loc2w(it, lx, ly) {
      const a = (it.rot || 0) * Math.PI / 180;
      const ux = Math.cos(a), uy = Math.sin(a), vx = -Math.sin(a), vy = Math.cos(a);
      return [it.x + lx * ux + ly * vx, it.y + lx * uy + ly * vy];
    }

    // 家具旋转后的外接框
    _itemAABB(it) {
      const hw = it.w / 2, hd = it.d / 2;
      const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, ly]) => this._loc2w(it, lx, ly));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }

    // 假想位置 (x,y) 处的旋转外接框
    _aabbAt(it, x, y) {
      const a = (it.rot || 0) * Math.PI / 180, hw = it.w / 2, hd = it.d / 2;
      const ux = Math.cos(a), uy = Math.sin(a), vx = -Math.sin(a), vy = Math.cos(a);
      const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, ly]) =>
        [x + lx * ux + ly * vx, y + lx * uy + ly * vy]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }

    // 在 (x,y) 处是否与其他家具重叠（地毯 rug 可叠放，不参与碰撞）
    _hitsOther(it, x, y) {
      const a = this._aabbAt(it, x, y), PAD = 0.012;
      return this.app.items.some(o => {
        if (o === it || o.cat === 'rug') return false;
        const b = this._itemAABB(o);
        return a.minX < b.maxX - PAD && a.maxX > b.minX + PAD &&
               a.minY < b.maxY - PAD && a.maxY > b.minY + PAD;
      });
    }

    // 放置综合校正：先贴墙，再把与家具的重叠沿最小轴推开（推完再贴一次墙）
    _fitPlacement(it) {
      this.constrainItem(it);
      for (let k = 0; k < 6; k++) {
        const a = this._itemAABB(it);
        let worst = null, worstPen = 0;
        for (const o of this.app.items) {
          if (o === it || o.cat === 'rug') continue;
          const b = this._itemAABB(o);
          const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
          const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
          if (ox > 0.012 && oy > 0.012 && Math.min(ox, oy) > worstPen) {
            worstPen = Math.min(ox, oy);
            worst = { b, ox, oy };
          }
        }
        if (!worst) return;
        const dxm = (a.minX + a.maxX) / 2 - (worst.b.minX + worst.b.maxX) / 2;
        const dym = (a.minY + a.maxY) / 2 - (worst.b.minY + worst.b.maxY) / 2;
        if (worst.ox < worst.oy) it.x += (dxm >= 0 ? 1 : -1) * (worst.ox + 0.01);
        else it.y += (dym >= 0 ? 1 : -1) * (worst.oy + 0.01);
        this.constrainItem(it);
      }
    }

    // 直线路径是否会穿过某段墙（采样 AABB 与墙矩形求交；放置/找位用）
    _pathCrossesWall(it, x0, y0, x1, y1) {
      const walls = (this.app.plan.walls || []).filter(w =>
        Math.hypot(w.x2 - w.x1, w.y2 - w.y1) > 0.15);
      if (!walls.length) return false;
      const a0 = this._aabbAt(it, x0, y0);
      const hx = (a0.maxX - a0.minX) / 2, hy = (a0.maxY - a0.minY) / 2;
      const d = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(d / 0.04));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        const cx = px, cy = py;
        for (const w of walls) {
          const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
          const len = Math.hypot(dx, dy);
          const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
          const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
          const projU = (cx - mx) * ux + (cy - my) * uy;
          const projN = (cx - mx) * nx + (cy - my) * ny;
          const rU = hx * Math.abs(ux) + hy * Math.abs(uy);
          const rN = hx * Math.abs(nx) + hy * Math.abs(ny);
          if ((len / 2 + rU) - Math.abs(projU) > 0 && (0.12 + rN) - Math.abs(projN) > 0) return true;
        }
      }
      return false;
    }

    // 为新放置的家具找一块不叠放、不穿墙的空地：先原位，不行就环形向外找
    findFreeSpot(it, x, y) {
      const ox = it.x, oy = it.y;
      const probe = (px, py) => {
        it.x = px; it.y = py;
        this.constrainItem(it);
        if (!this._hitsOther(it, it.x, it.y) &&
            !this._pathCrossesWall(it, ox, oy, it.x, it.y)) return true;
        it.x = ox; it.y = oy;
        return false;
      };
      if (probe(x, y)) return [it.x, it.y];
      for (let r = 0.15; r <= 1.65; r += 0.15) {
        for (let k = 0; k < 12; k++) {
          const a = k * Math.PI / 6 + (r * 7 % 2 ? 0.26 : 0);
          if (probe(x + Math.cos(a) * r, y + Math.sin(a) * r)) return [it.x, it.y];
        }
      }
      it.x = ox; it.y = oy;
      return [x, y];   // 周围全满：按原位放，之后由 _fitPlacement 推开
    }

    // 分小步移到目标点：每步都做防穿墙 + 防叠放，快速拖动也不会一步跨过墙体或压上别的家具
    _moveItemTo(it, nx, ny) {
      const STEP = 0.05;
      for (let k = 0; k < 160; k++) {
        const dx = nx - it.x, dy = ny - it.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.004) break;
        const s = Math.min(STEP, d);
        const ox = it.x, oy = it.y;
        it.x += dx / d * s;
        it.y += dy / d * s;
        this.constrainItem(it);
        if (this._hitsOther(it, it.x, it.y)) {   // 撞上别的家具：退回这一步并停下
          it.x = ox; it.y = oy;
          break;
        }
      }
    }

    // ---------- 防穿墙：家具外接框与墙体（0.24m 厚）相交时，沿墙法线推到「贴墙」 ----------
    constrainItem(it) {
      const walls = (this.app.plan.walls || []).filter(w =>
        Math.hypot(w.x2 - w.x1, w.y2 - w.y1) > 0.15);
      if (!walls.length) return;
      const HW = 0.12;      // 墙半厚
      const EPS = 0.006;    // 贴墙后留 6mm 缝，视觉上正好贴住
      for (let k = 0; k < 3; k++) {         // 角落处可能要推两次才稳定
        const a = this._itemAABB(it);
        const hx = (a.maxX - a.minX) / 2, hy = (a.maxY - a.minY) / 2;
        const cx = (a.minX + a.maxX) / 2, cy = (a.minY + a.maxY) / 2;
        let fixed = false;
        for (const w of walls) {
          const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
          const len = Math.hypot(dx, dy);
          const ux = dx / len, uy = dy / len;      // 沿墙方向
          const nx = -uy, ny = ux;                 // 墙法线
          const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
          const projU = (cx - mx) * ux + (cy - my) * uy;
          const projN = (cx - mx) * nx + (cy - my) * ny;
          // 家具外接框在两个方向上的投影半径
          const rU = hx * Math.abs(ux) + hy * Math.abs(uy);
          const rN = hx * Math.abs(nx) + hy * Math.abs(ny);
          const oU = (len / 2 + rU) - Math.abs(projU);   // 沿墙方向的重叠量
          const oN = (HW + rN) - Math.abs(projN);        // 法线方向的重叠量（>0 即穿墙）
          if (oU <= 0 || oN <= 0) continue;
          // 往家具中心所在的那一侧推出去，直到贴墙
          const s = projN >= 0 ? 1 : -1;
          it.x += nx * s * (oN + EPS);
          it.y += ny * s * (oN + EPS);
          fixed = true;
        }
        if (!fixed) break;
      }
    }

    // 沿 (dx,dy) 射线找最近的墙，返回墙体中心线距离（米）
    _castRay(px, py, dx, dy) {
      let best = Infinity;
      (this.app.plan.walls || []).forEach(w => {
        const abx = w.x2 - w.x1, aby = w.y2 - w.y1;
        const den = dx * aby - dy * abx;
        if (Math.abs(den) < 1e-9) return;                 // 平行
        const apx = w.x1 - px, apy = w.y1 - py;
        const t = (apx * aby - apy * abx) / den;
        const u = (apx * dy - apy * dx) / den;
        if (t > 0.02 && u >= -0.001 && u <= 1.001 && t < best) best = t;
      });
      return best;
    }

    // 数值气泡
    _pill(text, cx, cy, color) {
      const ctx = this.ctx;
      ctx.font = '700 10.5px ui-sans-serif, system-ui, -apple-system, sans-serif';
      const tw = ctx.measureText(text).width;
      const w = tw + 11, h = 15;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 7.5);
      else ctx.rect(cx - w / 2, cy - h / 2, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.97)'; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, cx, cy + 0.5);
      ctx.textBaseline = 'alphabetic';
    }

    // 屏幕坐标尺寸线：虚线 + 两端短划 + 中间数值
    _dimLine(x1, y1, x2, y2, text, color) {
      const ctx = this.ctx;
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 2) return;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const nx = Math.sin(ang), ny = -Math.cos(ang);      // 法线方向
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
      [[x1, y1], [x2, y2]].forEach(([px, py]) => {
        ctx.beginPath();
        ctx.moveTo(px - nx * 4.5, py - ny * 4.5);
        ctx.lineTo(px + nx * 4.5, py + ny * 4.5);
        ctx.stroke();
      });
      ctx.restore();
      if (len > 34) this._pill(text, (x1 + x2) / 2, (y1 + y2) / 2, color);
      else this._pill(text, x2 + nx * 15, y2 + ny * 15, color);
    }

    _drawDims(it) {
      const ctx = this.ctx, z = this.zoom;
      const a = this._itemAABB(it);
      const halfWall = 0.12;                       // 2D 墙宽 0.24m，净距算到墙面
      const fmt = v => (v < 0.995 ? Math.round(v * 100) + 'cm' : v.toFixed(2) + 'm');

      // 1) 自身宽 / 深：画在家具内侧（跟着旋转），避免和外侧到墙净距撞在一起
      const hw = it.w / 2, hd = it.d / 2;
      const iw = Math.min(11, it.w * z * 0.16) / z;      // 上内缩
      const id = Math.min(20, it.d * z * 0.3) / z;       // 左内缩
      let [ax, ay] = this._loc2w(it, -hw + 6 / z, -hd + iw);
      let [bx, by] = this._loc2w(it, hw - 6 / z, -hd + iw);
      let [sx1, sy1] = this.w2s(ax, ay), [sx2, sy2] = this.w2s(bx, by);
      if (it.w * z > 58) this._dimLine(sx1, sy1, sx2, sy2, it.w.toFixed(2) + 'm', '#4f46e5');
      [ax, ay] = this._loc2w(it, -hw + id, -hd + 6 / z);
      [bx, by] = this._loc2w(it, -hw + id, hd - 6 / z);
      [sx1, sy1] = this.w2s(ax, ay); [sx2, sy2] = this.w2s(bx, by);
      if (it.d * z > 42) this._dimLine(sx1, sy1, sx2, sy2, it.d.toFixed(2) + 'm', '#4f46e5');

      // 2) 到四面墙的净距：从中心朝四个方向打射线，减去自身半宽与墙半厚
      const cxx = it.x, cyy = it.y;
      const halfW = (a.maxX - a.minX) / 2, halfH = (a.maxY - a.minY) / 2;
      const sides = [
        { dx: -1, dy: 0, half: halfW, e0: [a.minX, a.minY], e1: [a.minX, a.maxY] },
        { dx: 1, dy: 0, half: halfW, e0: [a.maxX, a.minY], e1: [a.maxX, a.maxY] },
        { dx: 0, dy: -1, half: halfH, e0: [a.minX, a.minY], e1: [a.maxX, a.minY] },
        { dx: 0, dy: 1, half: halfH, e0: [a.minX, a.maxY], e1: [a.maxX, a.maxY] }
      ];
      sides.forEach(sd => {
        const t = this._castRay(cxx, cyy, sd.dx, sd.dy);     // 中心 → 墙中心线
        if (!isFinite(t)) return;
        const gap = t - sd.half - halfWall;                  // 家具边 → 墙面
        if (gap > 6) return;                                 // 太远不标，避免满屏数字
        const touching = gap < 0.05;
        const reach = Math.max(0, gap);
        const ex = cxx + sd.dx * sd.half, ey = cyy + sd.dy * sd.half;
        const [p1x, p1y] = this.w2s(ex, ey);
        const [p2x, p2y] = this.w2s(ex + sd.dx * reach, ey + sd.dy * reach);
        const col = touching ? '#0f766e' : '#0284c7';
        if (touching) {
          // 「贴墙」气泡沿边偏移，避开内侧的宽/深标注
          const halfAlong = sd.dx === 0 ? halfW : halfH;
          const along = Math.min(0.6, halfAlong * 0.7);
          const qx0 = ex + sd.dx * 0.16 - sd.dy * along;
          const qy0 = ey + sd.dy * 0.16 + sd.dx * along;
          const [qx, qy] = this.w2s(qx0, qy0);
          this._pill('贴墙', qx, qy, col);
          return;
        }
        // 间距带：把这段空隙涂一层淡蓝，面积感更直观
        const q = [[sd.e0[0], sd.e0[1]], [sd.e1[0], sd.e1[1]],
          [sd.e1[0] + sd.dx * reach, sd.e1[1] + sd.dy * reach],
          [sd.e0[0] + sd.dx * reach, sd.e0[1] + sd.dy * reach]].map(pt => this.w2s(pt[0], pt[1]));
        ctx.beginPath();
        ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[1][0], q[1][1]);
        ctx.lineTo(q[2][0], q[2][1]); ctx.lineTo(q[3][0], q[3][1]);
        ctx.closePath();
        ctx.fillStyle = 'rgba(2,132,199,.09)'; ctx.fill();
        this._dimLine(p1x, p1y, p2x, p2y, fmt(gap), col);
      });

      // 3) 与其他家具的净距：两框之间最近点连线（最近 3 件、间距 1.5m 内才标）
      const acx = (a.minX + a.maxX) / 2, acy = (a.minY + a.maxY) / 2;
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      const near = this.app.items.filter(o => o !== it && o.cat !== 'rug').map(o => {
        const b = this._itemAABB(o);
        const gx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
        const gy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
        return { b, gap: Math.hypot(gx, gy), overlap: gx > 0 && gy > 0 };
      }).filter(r => !r.overlap && r.gap < 1.5).sort((p, q) => p.gap - q.gap).slice(0, 3);
      near.forEach(r => {
        const b = r.b, bcx = (b.minX + b.maxX) / 2, bcy = (b.minY + b.maxY) / 2;
        // a 上离 b 中心最近的点 ↔ b 上离 a 中心最近的点，正好是两框之间的间隙段
        const w1 = this.w2s(clamp(bcx, a.minX, a.maxX), clamp(bcy, a.minY, a.maxY));
        const w2 = this.w2s(clamp(acx, b.minX, b.maxX), clamp(acy, b.minY, b.maxY));
        const touching = r.gap < 0.05;
        this._dimLine(w1[0], w1[1], w2[0], w2[1],
          touching ? '贴着' : fmt(r.gap), touching ? '#b45309' : '#d97706');
      });
    }

    // 米制刻度尺：顶部 + 左侧
    _drawRuler() {
      const ctx = this.ctx, W = this.w, H = this.h;
      if (!W || !H) return;
      const R = 22, z = this.zoom;
      const step = z >= 90 ? 0.5 : z >= 40 ? 1 : z >= 16 ? 2 : 5;
      const every = (step * z < 34) ? 2 : 1;        // 太密就隔一个标数字

      ctx.save();
      ctx.fillStyle = 'rgba(252,253,255,.95)';
      ctx.fillRect(0, 0, W, R);
      ctx.fillRect(0, 0, R, H);
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, R - 0.5); ctx.lineTo(W, R - 0.5);
      ctx.moveTo(R - 0.5, 0); ctx.lineTo(R - 0.5, H);
      ctx.stroke();

      const [gx0] = this.s2w(0, 0), [gx1] = this.s2w(W, 0);
      const [, gy0] = this.s2w(0, 0), [, gy1] = this.s2w(0, H);
      ctx.font = '9px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#8494a6';

      // 顶部
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      let idx = 0;
      for (let x = Math.ceil(gx0 / step) * step; x < gx1 && idx < 600; x += step, idx++) {
        const s = this.w2s(x, 0)[0];
        const maj = Math.round(x / step) % every === 0;
        ctx.strokeStyle = maj ? '#b3c0cf' : '#dde5ee';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(s, R - (maj ? 10 : 5)); ctx.lineTo(s, R - 1); ctx.stroke();
        if (maj && s > 14 && s < W - 14) ctx.fillText(String(+x.toFixed(2)), s, R - 12);
      }
      // 左侧
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      idx = 0;
      for (let y = Math.ceil(gy0 / step) * step; y < gy1 && idx < 600; y += step, idx++) {
        const s = this.w2s(0, y)[1];
        const maj = Math.round(y / step) % every === 0;
        ctx.strokeStyle = maj ? '#b3c0cf' : '#dde5ee';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(R - (maj ? 10 : 5), s); ctx.lineTo(R - 1, s); ctx.stroke();
        if (maj && s > 12 && s < H - 12) {
          ctx.save();
          ctx.fillText(String(+y.toFixed(2)), 2, s - 6);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    _shade(hex, f) {
      // f<1 变深，>1 变浅
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) return hex;
      const n = parseInt(m[1], 16);
      const c = v => Math.max(0, Math.min(255, Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f)));
      return '#' + [c(n >> 16 & 255), c(n >> 8 & 255), c(n & 255)]
        .map(v => v.toString(16).padStart(2, '0')).join('');
    }

    // 局部坐标圆角矩形：x,y 为左上角（局部），fill/stroke 可为 null
    _rr(x, y, ww, hh, r, fill, stroke, lw) {
      const ctx = this.ctx;
      r = Math.max(0, Math.min(r, ww / 2, hh / 2));
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, ww, hh, r) : ctx.rect(x, y, ww, hh);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
    }

    // 按品类画俯视示意图（在已 translate/rotate 的局部坐标里，正面朝 +y）
    _drawTop(it, w, d) {
      const ctx = this.ctx;
      const z = this.zoom;
      const base = it.color, dark = this._shade(base, 0.6),
        light = this._shade(base, 1.28), lighter = this._shade(base, 1.46);

      switch (it.cat) {
        case 'sofa': {
          // 扶手 + 靠背 + 分坐垫
          const armT = Math.min(w * 0.16, d * 0.32), backT = Math.min(d * 0.3, d * 0.45);
          this._rr(-w / 2, -d / 2, armT, d, Math.min(5, armT / 2), dark);
          this._rr(w / 2 - armT, -d / 2, armT, d, Math.min(5, armT / 2), dark);
          this._rr(-w / 2 + armT, -d / 2, w - armT * 2, backT, 4, dark);
          this._rr(-w / 2 + armT, -d / 2 + backT, w - armT * 2, d - backT, 4, light);
          const n = Math.max(1, Math.round(w / (0.75 * z)) - 1);   // 每 ~0.75m 一道座垫缝
          ctx.strokeStyle = dark; ctx.lineWidth = 1;
          for (let i = 1; i <= n; i++) {
            const sx = -w / 2 + armT + (w - armT * 2) * i / (n + 1);
            ctx.beginPath(); ctx.moveTo(sx, -d / 2 + backT + 2); ctx.lineTo(sx, d / 2 - 2); ctx.stroke();
          }
          break;
        }
        case 'bed': {
          // 床垫 + 被子 + 两个枕头
          const pilT = Math.min(d * 0.24, 0.5 * z);
          this._rr(-w / 2 + 1, -d / 2 + 1, w - 2, d - 2, 6, lighter, dark, 1.5);
          this._rr(-w / 2 + 4, -d / 2 + pilT, w - 8, d - pilT - 6, 8, base);
          const pw = (w - 14) / 2, ph = pilT * 0.6;
          this._rr(-w / 2 + 7, -d / 2 + 5, pw, ph, ph * 0.42, '#f4f1ea', dark, 1);
          this._rr(w / 2 - 7 - pw, -d / 2 + 5, pw, ph, ph * 0.42, '#f4f1ea', dark, 1);
          ctx.strokeStyle = dark; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;   // 被子翻折线
          ctx.beginPath(); ctx.moveTo(-w / 2 + 4, -d / 2 + pilT + 2); ctx.lineTo(w / 2 - 4, -d / 2 + pilT + 2); ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case 'table': {
          this._rr(-w / 2, -d / 2, w, d, 6, base, dark, 1.5);
          // 台面 + 一圈内框，读作「桌面」而不是「柜体」
          const ins = Math.min(6, Math.min(w, d) * 0.1);
          this._rr(-w / 2 + ins, -d / 2 + ins, w - ins * 2, d - ins * 2, 4, null, dark, 1.4);
          break;
        }
        case 'chair': {
          // 靠背 + 座面
          const backT = Math.min(d * 0.22, 0.1 * z);
          this._rr(-w / 2, -d / 2, w, backT, 4, dark);
          this._rr(-w / 2 + 2, -d / 2 + backT + 1, w - 4, d - backT - 3, 6, light, dark, 1);
          break;
        }
        case 'wardrobe': {
          this._rr(-w / 2, -d / 2, w, d, 4, base, dark, 1.5);
          ctx.strokeStyle = dark; ctx.lineWidth = 1.2;       // 双开门缝 + 拉手
          ctx.beginPath(); ctx.moveTo(0, -d / 2 + 3); ctx.lineTo(0, d / 2 - 3); ctx.stroke();
          ctx.fillStyle = dark;
          ctx.beginPath(); ctx.arc(-4, 0, 2.2, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(4, 0, 2.2, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'cabinet': {
          this._rr(-w / 2, -d / 2, w, d, 4, base, dark, 1.5);
          ctx.strokeStyle = dark; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, -d / 2 + 2); ctx.lineTo(0, d / 2 - 2); ctx.stroke();
          ctx.fillStyle = dark;
          ctx.beginPath(); ctx.arc(-3, 0, 1.8, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(3, 0, 1.8, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'shelf': case 'bookshelf': {
          // 后部开放格 + 前部卡座（对应「开放格+卡座」的书柜）
          const back = d * 0.34;
          this._rr(-w / 2, -d / 2, w, d, 3, base, dark, 1.5);
          const n = Math.max(2, Math.round(w / (0.3 * z)));   // 竖向格
          ctx.strokeStyle = light; ctx.lineWidth = 1.1;
          for (let i = 1; i < n; i++) {
            const sx2 = -w / 2 + w * i / n;
            ctx.beginPath(); ctx.moveTo(sx2, -d / 2 + 2); ctx.lineTo(sx2, -d / 2 + back); ctx.stroke();
          }
          this._rr(-w / 2 + 2, -d / 2 + back, w - 4, d - back - 2, 4, light, dark, 1.1);  // 卡座垫
          break;
        }
        case 'rug': {
          ctx.globalAlpha = 0.55;
          this._rr(-w / 2, -d / 2, w, d, 5, base);
          ctx.globalAlpha = 1;
          ctx.setLineDash([6, 4]);
          this._rr(-w / 2 + 2, -d / 2 + 2, w - 4, d - 4, 4, null, dark, 1.2);
          this._rr(-w / 2 + 8, -d / 2 + 8, w - 16, d - 16, 3, null, dark, 1);
          ctx.setLineDash([]);
          return;   // 地毯不画朝向线
        }
        case 'lamp': {
          const r = Math.min(w, d) / 2 - 2;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fillStyle = base; ctx.fill();
          ctx.strokeStyle = dark; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
          ctx.strokeStyle = light; ctx.stroke();
          break;
        }
        case 'plant': {
          // 叶冠 + 花盆
          const r = Math.min(w, d) / 2 - 3;
          ctx.beginPath(); ctx.arc(0, -d * 0.06, r, 0, Math.PI * 2);
          ctx.fillStyle = base; ctx.fill();
          ctx.strokeStyle = dark; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.strokeStyle = light; ctx.lineWidth = 1;
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
            ctx.beginPath();
            ctx.moveTo(0, -d * 0.06);
            ctx.lineTo(Math.cos(a) * r * 0.75, -d * 0.06 + Math.sin(a) * r * 0.75);
            ctx.stroke();
          }
          this._rr(-w * 0.2, d * 0.3, w * 0.4, Math.max(5, d * 0.18), 2, dark);
          return;
        }
        default: {
          // 未知品类：普通圆角块 + 图标
          this._rr(-w / 2, -d / 2, w, d, Math.min(8, w / 4, d / 4), base, 'rgba(0,0,0,.35)', 1);
          if (z > 30) {
            ctx.font = `${Math.min(16, w / 3, d / 3)}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(0,0,0,.55)';
            ctx.fillText(SD.FURNITURE_ICONS[it.cat] || '📦', 0, 0);
          }
          return;
        }
      }
      // 朝向线（正面）：仅对形状本身不含朝向信息的品类补充
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 3, d / 2 - 4); ctx.lineTo(w / 2 - 3, d / 2 - 4);
      ctx.stroke();
    }

    _drawItem(it) {
      const ctx = this.ctx;
      const [x, y] = this.w2s(it.x, it.y);
      const w = it.w * this.zoom, d = it.d * this.zoom;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((it.rot || 0) * Math.PI / 180);
      // 阴影底
      ctx.fillStyle = 'rgba(0,0,0,.08)';
      ctx.beginPath();
      this._roundRect(3, 4, -w / 2, -d / 2, w, d, 4);
      ctx.fill();
      // 按品类画俯视示意图
      this._drawTop(it, w, d);
      ctx.restore();
      // 标签：缩小看全图时显示品类短名（不重叠），放大后显示完整商品名
      const bb = this._itemAABB(it);
      const lx2 = this.w2s(it.x, 0)[0], ly2 = this.w2s(0, bb.maxY)[1];
      if (this.zoom > 22) {
        const SHORT = {
          sofa: '沙发', bed: '床', table: '桌', chair: '椅', wardrobe: '衣柜',
          cabinet: '柜', shelf: '书柜', bookshelf: '书柜', lamp: '灯', rug: '地毯',
          plant: '绿植', other: '家具'
        };
        const full = this.zoom > 78;
        const txt = full ? it.name : (SHORT[it.cat] || it.name.slice(0, 4));
        ctx.font = full ? '10.5px sans-serif' : '9.5px sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)';   // 白描边保证在任何底图上可读
        ctx.strokeText(txt, lx2, ly2 + 12);
        ctx.fillStyle = '#475569';
        ctx.fillText(txt, lx2, ly2 + 12);
        if (full) {
          ctx.font = '9.5px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.8)';
          const dim = `${it.w.toFixed(2)}×${it.d.toFixed(2)}m`;
          ctx.strokeText(dim, lx2, ly2 + 24);
          ctx.fillStyle = '#94a3b8';
          ctx.fillText(dim, lx2, ly2 + 24);
        }
      }
      // 选中框
      if (this.app.selectedId === it.id) {
        ctx.save();
        ctx.translate(x, y); ctx.rotate((it.rot || 0) * Math.PI / 180);
        ctx.strokeStyle = '#4f46e5'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.6;
        ctx.strokeRect(-w / 2 - 4, -d / 2 - 4, w + 8, d + 8);
        ctx.restore();
        ctx.setLineDash([]);
      }
    }
    _roundRect(sx, sy, x, y, w, h, r) {
      const ctx = this.ctx;
      r = Math.min(r, w / 2, h / 2);
      ctx.roundRect ? ctx.roundRect(x + sx, y + sy, w, h, r)
        : ctx.rect(x + sx, y + sy, w, h);
    }
  }

  SD.Editor2D = Editor2D;
})();
