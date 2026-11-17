/* 商品库：录入 / 列表 / 本地存储 */
(function () {
  const SD = (window.SD = window.SD || {});

  const CAT_LABEL = {
    sofa: '沙发', bed: '床', table: '桌/几', chair: '椅', wardrobe: '衣柜',
    cabinet: '柜类', shelf: '书架', lamp: '灯具', rug: '地毯', plant: '绿植', other: '其他'
  };
  SD.CAT_LABEL = CAT_LABEL;

  class Catalog {
    constructor(app) {
      this.app = app;
      this.$list = document.getElementById('catalogList');
      this.$form = document.getElementById('productForm');
      this.$search = document.getElementById('catalogSearch');
      this.editingImg = null;
      this._bind();
    }

    _bind() {
      document.getElementById('btnAddProduct').addEventListener('click', () => {
        this.$form.classList.toggle('hidden');
        if (!this.$form.classList.contains('hidden')) this.$form.name.focus();
      });
      document.getElementById('btnCancelProduct').addEventListener('click', () => {
        this.$form.classList.add('hidden');
        this.$form.reset();
        this.editingImg = null;
        document.getElementById('formPreview').classList.add('hidden');
      });

      this.$form.img.addEventListener('change', e => {
        const f = e.target.files[0];
        if (!f) return;
        SD.fileToImage(f, 400, (url, img) => {
          this.editingImg = url;
          const pv = document.getElementById('formPreview');
          pv.innerHTML = `<img src="${url}">`;
          pv.classList.remove('hidden');
          const c = SD.extractColor(img);
          if (c) this.$form.color.value = c; // 自动提取主色
        });
      });

      this.$form.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(this.$form);
        const cm = v => Math.max(1, parseFloat(v) || 0) / 100; // cm → m
        const item = {
          id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6),
          name: fd.get('name').trim(),
          cat: fd.get('cat'),
          w: cm(fd.get('w')), d: cm(fd.get('d')), h: cm(fd.get('h')),
          price: parseFloat(fd.get('price')) || 0,
          color: fd.get('color'),
          mat: fd.get('mat'),
          img: this.editingImg
        };
        this.app.catalog.push(item);
        this.app.changed();
        this.render();
        this.$form.reset();
        this.editingImg = null;
        document.getElementById('formPreview').classList.add('hidden');
        this.$form.classList.add('hidden');
      });

      this.$search.addEventListener('input', () => this.render());
    }

    render() {
      const kw = (this.$search.value || '').trim().toLowerCase();
      const list = this.app.catalog.filter(p => !kw || p.name.toLowerCase().includes(kw));
      this.$list.innerHTML = '';
      if (!list.length) {
        this.$list.innerHTML = '<div class="empty-tip">还没有商品<br>点上方「＋添加商品」录入淘宝商品参数</div>';
        return;
      }
      list.forEach(p => {
        const el = document.createElement('div');
        el.className = 'prod-item';
        el.innerHTML = `
          <div class="prod-thumb">${p.img ? `<img src="${p.img}">` : (SD.FURNITURE_ICONS[p.cat] || '📦')}</div>
          <div class="prod-info">
            <div class="prod-name">${esc(p.name)}</div>
            <div class="prod-meta">${CAT_LABEL[p.cat] || p.cat} · ${(p.w * 100).toFixed(0)}×${(p.d * 100).toFixed(0)}×${(p.h * 100).toFixed(0)}cm${p.price ? ' · ¥' + p.price : ''}</div>
          </div>
          <button class="prod-del" title="删除商品">✕</button>`;
        el.querySelector('.prod-del').addEventListener('click', e => {
          e.stopPropagation();
          if (confirm(`删除商品「${p.name}」？`)) {
            this.app.catalog = this.app.catalog.filter(x => x.id !== p.id);
            this.app.changed();
            this.render();
          }
        });
        el.addEventListener('click', () => {
          document.querySelectorAll('.prod-item.selected').forEach(x => x.classList.remove('selected'));
          el.classList.add('selected');
          this.app.enterPlaceMode(p);
        });
        this.$list.appendChild(el);
      });
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  SD.Catalog = Catalog;
})();
