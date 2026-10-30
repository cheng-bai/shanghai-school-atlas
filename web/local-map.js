'use strict';
// A single canvas renders the reference geometry, not 150,000 Leaflet layers.
window.AtlasLocalMap = (() => {
  const pending = new Map();
  function loadScript(file, read) {
    const existing = read();
    if (existing) return Promise.resolve(existing);
    if (!pending.has(file)) {
      const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'basemap/' + file;
      script.onload = () => {
        const result = read();
        if (result) resolve(result);
        else { script.remove(); reject(new Error('Invalid basemap part')); }
      };
      script.onerror = () => { script.remove(); reject(new Error('Basemap download failed')); };
      document.head.append(script);
      }).finally(() => pending.delete(file));
      pending.set(file, promise);
    }
    return pending.get(file);
  }
  async function addPart(data, part) {
    const features = await loadScript(part.file, () => window.ATLAS_BASEMAP_PARTS?.[part.zoom]);
    if (!data.loadedParts.has(part.zoom)) {
      for (const feature of features) data.features.push(feature);
      data.loadedParts.add(part.zoom);
    }
  }
  async function load() {
    const data = await loadScript('manifest.js?v=2', () => window.SHANGHAI_BASEMAP);
    data.loadedParts ||= new Set();
    await addPart(data, data.parts.find(part => part.zoom === 10));
    return data;
  }
  function decode(feature) {
    if (feature.world) return feature.world;
    if (Array.isArray(feature[7])) {
      feature.world = feature[7].map(text => decode({7:text}));
      return feature.world;
    }
    const text = feature[7], points = [];
    let i = 0, lon = 0, lat = 0;
    function value() {
      let result = 0, shift = 0, digit;
      do { digit = text.charCodeAt(i++) - 63; result |= (digit & 31) << shift; shift += 5; } while (digit >= 32);
      return result & 1 ? ~(result >> 1) : result >> 1;
    }
    while (i < text.length) {
      lon += value(); lat += value();
      const sin = Math.sin(lat / 100000 * Math.PI / 180);
      points.push([(lon / 100000 + 180) / 360, .5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)]);
    }
    feature.world = points;
    return points;
  }
  function create(data, onStatus = () => {}) {
    const styles = [
      {color:'#ddd9cd', width:1.4}, {color:'#c5c5b9', width:1.8},
      {color:'#dbbd87', width:2.3}, {color:'#d4a66a', width:3},
      {color:'#c8e0e3', width:0}, {color:'#b0cfd6', width:1.5}
    ];
    let groups;
    const zoomGroups = new Map();
    function regroup() {
      groups = Array.from({length:7}, () => []);
      data.features.forEach(f => groups[f[0]].push(f));
      groups.forEach(group => group.sort((a,b) => a[8]-b[8]));
      zoomGroups.clear();
    }
    function groupsAt(zoom) {
      const key = Math.floor(zoom);
      if (!zoomGroups.has(key)) zoomGroups.set(key, groups.map(group => group.filter(f => f[1] <= key)));
      return zoomGroups.get(key);
    }
    regroup();
    return new (L.Layer.extend({
      onAdd(map) {
        this._map = map;
        this.active = true;
        this.requests = new Set();
        this.failed = new Set();
        this.canvas = L.DomUtil.create('canvas', 'atlas-local-basemap');
        this.canvas.style.pointerEvents = 'none';
        map.getPane('tilePane').append(this.canvas);
        map.attributionControl.addAttribution('底图 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> / Geofabrik · ODbL');
        map.on('moveend zoomend resize', this.schedule, this);
        this.draw();
      },
      onRemove(map) {
        this.active = false;
        map.off('moveend zoomend resize', this.schedule, this);
        cancelAnimationFrame(this.frame);
        this.canvas.remove();
        map.attributionControl.removeAttribution('底图 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> / Geofabrik · ODbL');
      },
      schedule() {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => this.draw());
      },
      ensureDetails(zoom) {
        const required = data.parts.filter(part => part.zoom <= Math.max(10, Math.floor(zoom)));
        const missing = required.filter(part => !data.loadedParts.has(part.zoom));
        const hasFailure = missing.some(part => this.failed.has(part.zoom));
        const status = hasFailure ? '自带底图已显示，但部分道路细节未能加载；点击重新加载重试。' : missing.length ? '自带底图已显示，正在加载当前缩放的道路细节…' : '自带参考底图 · 道路/水系/地名 · 数据截至 2026-10-29 · 非导航地图，不需外部瓦片服务。';
        if (status !== this.status) { this.status = status; onStatus(status); }
        for (const part of missing) {
          if (this.requests.has(part.zoom) || this.failed.has(part.zoom)) continue;
          this.requests.add(part.zoom);
          addPart(data, part).then(() => {
            if (this.active) { regroup(); this.schedule(); }
          }).catch(() => {
            if (this.active) { this.failed.add(part.zoom); this.schedule(); }
          }).finally(() => this.requests.delete(part.zoom));
        }
        return missing.length === 0;
      },
      draw() {
        const map = this._map, zoom = map.getZoom(), size = map.getSize();
        const detailReady = this.ensureDetails(zoom);
        const visibleGroups = groupsAt(zoom);
        const pad = 100, width = size.x + 2 * pad, height = size.y + 2 * pad;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = this.canvas, ctx = canvas.getContext('2d');
        const pixelWidth = Math.floor(width * dpr), pixelHeight = Math.floor(height * dpr);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth; canvas.height = pixelHeight;
        }
        canvas.style.width = width+'px'; canvas.style.height = height+'px';
        L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([-pad, -pad]));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#f2f1e9'; ctx.fillRect(0, 0, width, height);
        const bounds = map.getBounds().pad(.3), scale = 256 * Math.pow(2, zoom);
        const west=bounds.getWest(), east=bounds.getEast(), south=bounds.getSouth(), north=bounds.getNorth();
        const origin = map.project(map.getCenter(), zoom).subtract(size.divideBy(2)).subtract([pad, pad]);
        const labels = [], occupied = [];
        const inView = f => f[5] >= west && f[3] <= east && f[6] >= south && f[4] <= north;
        const pixel = p => [p[0]*scale-origin.x, p[1]*scale-origin.y];
        const label = (text, x, y, large=false) => {
          if (!text || x < pad || y < pad || x > width-pad || y > height-pad) return;
          ctx.font = (large ? '600 13px' : '11px')+' sans-serif';
          const w = ctx.measureText(text).width+10, h = large ? 20 : 16;
          const box = [x-w/2, y-h/2, x+w/2, y+h/2];
          if (occupied.some(b => box[0]<b[2] && box[2]>b[0] && box[1]<b[3] && box[3]>b[1])) return;
          occupied.push(box); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 3; ctx.strokeStyle = '#f7f6ee'; ctx.strokeText(text, x, y);
          ctx.fillStyle = large ? '#576359' : '#707568'; ctx.fillText(text, x, y);
        };
        for (const kind of [4, 5, 0, 1, 2, 3]) {
          const style = styles[kind];
          ctx.strokeStyle = style.color; ctx.fillStyle = style.color;
          ctx.lineWidth = style.width * (zoom >= 14 ? 1.2 : 1); ctx.lineJoin = 'round';
          for (const f of visibleGroups[kind]) {
            if (!inView(f)) continue;
            const rings = kind === 4 ? decode(f) : [decode(f)];
            const wantsLabel = kind !== 4 && zoom >= (kind === 0 ? 16 : 13) && f[2] >= 0;
            let best = 0, position;
            ctx.beginPath();
            for (const ring of rings) {
              let previousX, previousY;
              for (const point of ring) {
                const x = point[0]*scale-origin.x, y = point[1]*scale-origin.y;
                if (previousX !== undefined) {
                  ctx.lineTo(x,y);
                  if (wantsLabel) {
                    const length = (x-previousX)**2 + (y-previousY)**2;
                    if (length > best) { best=length; position=[(x+previousX)/2,(y+previousY)/2]; }
                  }
                } else ctx.moveTo(x,y);
                previousX = x; previousY = y;
              }
              if (kind === 4) ctx.closePath();
            }
            if (kind === 4) ctx.fill('evenodd');
            else ctx.stroke();
            if (best>6400) labels.push([data.names[f[2]], ...position]);
          }
        }
        for (const f of visibleGroups[6]) if (inView(f)) label(data.names[f[2]], ...pixel(decode(f)[0]), true);
        for (const item of labels.reverse()) label(...item);
        canvas.dataset.drawn = 'true';
        canvas.dataset.zoomReady = String(detailReady);
      }
    }))();
  }
  return {load, create};
})();
