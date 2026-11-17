/* 户型图自动描墙：从图片像素里提取深色粗线，转成水平/垂直墙段 */
(function () {
  const SD = (window.SD = window.SD || {});

  const MAX_EDGE = 1200;   // 分析用缩放尺寸（够用且快）

  // 深灰/黑且低饱和 = 墙体（排除木地板、彩色家具填充）
  function buildMask(img) {
    const sc = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.max(8, Math.round(img.width * sc));
    const h = Math.max(8, Math.round(img.height * sc));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (mx < 135 && mx - mn < 45) mask[p] = 1;
    }
    return { w, h, mask, sc };
  }

  // 沿一个轴扫「连续像素段」，再把相邻行里重叠的段合并成矩形
  function scanAxis(m, vertical, minLen, minThick, maxThick) {
    const { w, h, mask } = m;
    const outer = vertical ? w : h;
    const inner = vertical ? h : w;
    const at = vertical
      ? (o, i) => mask[i * w + o]
      : (o, i) => mask[o * w + i];

    const groups = [];
    for (let o = 0; o < outer; o++) {
      let i = 0;
      while (i < inner) {
        if (!at(o, i)) { i++; continue; }
        const s = i;
        while (i < inner && at(o, i)) i++;
        const e = i;
        if (e - s < minLen) continue;
        // 找可并入的组（相邻行 + 区间重叠）
        let target = null;
        for (let k = groups.length - 1; k >= 0; k--) {
          const g = groups[k];
          if (g.o1 < o - 1) break;          // 组按 o 递增，更早的不用看
          const ov = Math.min(g.s1, e) - Math.max(g.s0, s);
          if (ov > 0.55 * Math.min(e - s, g.s1 - g.s0)) { target = g; break; }
        }
        if (target) {
          target.o1 = o;
          target.s0 = Math.min(target.s0, s);
          target.s1 = Math.max(target.s1, e);
        } else {
          groups.push({ o0: o, o1: o, s0: s, s1: e });
        }
      }
    }

    const rects = [];
    groups.forEach(g => {
      const th = g.o1 - g.o0 + 1;               // 厚度
      const len = g.s1 - g.s0;                  // 长度
      if (th < minThick || th > maxThick) return;
      if (len < minLen || len / th < 2.2) return;
      rects.push(vertical
        ? { x0: g.o0, x1: g.o1 + 1, y0: g.s0, y1: g.s1 }
        : { x0: g.s0, x1: g.s1, y0: g.o0, y1: g.o1 + 1 });
    });
    return rects;
  }

  // 同一直线上的墙段合并（留出门口/窗洞的真实间隙）
  function mergeCollinear(segs, gap) {
    const out = [];
    const byLine = {};
    segs.forEach(s => {
      const horizontal = Math.abs(s.y2 - s.y1) < 1e-6;
      const key = (horizontal ? 'h' : 'v') + Math.round(horizontal ? s.y1 : s.x1);
      (byLine[key] = byLine[key] || []).push(s);
    });
    Object.keys(byLine).forEach(k => {
      const arr = byLine[k].slice().sort((a, b) => {
        const ak = Math.abs(a.y2 - a.y1) < 1e-6 ? a.x1 : a.y1;
        const bk = Math.abs(b.y2 - b.y1) < 1e-6 ? b.x1 : b.y1;
        return ak - bk;
      });
      let cur = null;
      arr.forEach(s => {
        const horizontal = Math.abs(s.y2 - s.y1) < 1e-6;
        const a = horizontal ? s.x1 : s.y1;
        const b = horizontal ? s.x2 : s.y2;
        if (cur && a - cur.b <= gap) { cur.b = Math.max(cur.b, b); return; }
        cur = { horizontal, line: horizontal ? s.y1 : s.x1, a, b };
        out.push(cur);
      });
    });
    return out.map(c => c.horizontal
      ? { x1: c.a, y1: c.line, x2: c.b, y2: c.line }
      : { x1: c.line, y1: c.a, x2: c.line, y2: c.b });
  }

  /**
   * @param {HTMLImageElement} img 已加载的户型图
   * @returns {{segments:Array, bbox:Object, sc:number, thickness:number}}
   *          segments / bbox 均为「原图像素」坐标
   */
  SD.traceWalls = function (img) {
    if (!img || !img.width) return null;
    const m = buildMask(img);
    const minLen = Math.max(26, Math.round(m.w * 0.042));
    const minThick = 4;
    const maxThick = Math.max(18, Math.round(m.w * 0.024));

    const rects = scanAxis(m, false, minLen, minThick, maxThick)
      .concat(scanAxis(m, true, minLen, minThick, maxThick));

    // 矩形 → 中心线墙段（分析尺寸坐标）
    const raw = rects.map(r => {
      if (r.x1 - r.x0 > r.y1 - r.y0) {
        const y = (r.y0 + r.y1) / 2;
        return { x1: r.x0, y1: y, x2: r.x1, y2: y };
      }
      const x = (r.x0 + r.x1) / 2;
      return { x1: x, y1: r.y0, x2: x, y2: r.y1 };
    });

    const merged = mergeCollinear(raw, Math.round(m.w * 0.006));
    // 厚度中位数（用来推断墙厚，也用于过滤）
    const ths = rects.map(r => Math.min(r.x1 - r.x0, r.y1 - r.y0)).sort((a, b) => a - b);
    const thickness = ths.length ? ths[Math.floor(ths.length / 2)] : 0;

    // 回到原图像素
    const k = 1 / m.sc;
    const segments = merged.map(s => ({
      x1: s.x1 * k, y1: s.y1 * k, x2: s.x2 * k, y2: s.y2 * k
    }));

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    segments.forEach(s => {
      x0 = Math.min(x0, s.x1, s.x2); x1 = Math.max(x1, s.x1, s.x2);
      y0 = Math.min(y0, s.y1, s.y2); y1 = Math.max(y1, s.y1, s.y2);
    });
    if (!segments.length) return { segments: [], bbox: null, sc: m.sc, thickness };

    return {
      segments,
      bbox: { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 },
      sc: m.sc,
      thickness: thickness * k
    };
  };
})();
