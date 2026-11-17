/* 自动提取商品图主色调 */
(function () {
  const SD = (window.SD = window.SD || {});

  // imgEl: HTMLImageElement；返回 '#rrggbb'
  SD.extractColor = function (imgEl) {
    const N = 64;
    const cv = document.createElement('canvas');
    cv.width = N; cv.height = N;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgEl, 0, 0, N, N);
    let data;
    try { data = ctx.getImageData(0, 0, N, N).data; } catch (e) { return null; }

    // 量化到 4bit/通道 分桶，饱和色加权（避免黑白灰背景主导）
    const buckets = {};
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 125) continue;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      // 跳过近白/近黑像素（多为背景）
      if (max > 245 && sat < 0.08) continue;
      if (max < 25) continue;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const w = 1 + sat * 2;
      if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, w: 0, n: 0 };
      const bk = buckets[key];
      bk.r += r * w; bk.g += g * w; bk.b += b * w; bk.w += w; bk.n++;
    }
    let best = null;
    for (const k in buckets) {
      const bk = buckets[k];
      // 像素数与饱和度加成综合评分
      const score = bk.w * (bk.n > 40 ? 1.5 : 1);
      if (!best || score > best.score) best = { bk, score };
    }
    if (!best) return null;
    const r = Math.round(best.bk.r / best.bk.w);
    const g = Math.round(best.bk.g / best.bk.w);
    const b = Math.round(best.bk.b / best.bk.w);
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  };

  // 文件 → 压缩 dataURL（最长边 maxEdge），回调 (dataURL, imgEl)
  SD.fileToImage = function (file, maxEdge, cb) {
    const reader = new FileReader();
    reader.onerror = function () { cb(null, null); };
    reader.onload = function (e) {
      const img = new Image();
      img.onerror = function () { cb(null, null); };
      img.onload = function () {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        if (scale >= 1) { cb(img.src, img); return; }
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const url = cv.toDataURL('image/jpeg', 0.86);
        // 关键：必须等新图 onload 后再回调，否则 img.width 仍为 0（底图画不出来）
        const i2 = new Image();
        i2.onload = function () { cb(url, i2); };
        i2.onerror = function () { cb(url, img); };
        i2.src = url;
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  // 图片 dataURL → 主色
  SD.dataUrlToColor = function (dataUrl, cb) {
    const img = new Image();
    img.onload = function () { cb(SD.extractColor(img)); };
    img.src = dataUrl;
  };
})();
