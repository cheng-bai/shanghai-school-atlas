'use strict';
// A single canvas renders the reference geometry, not 150,000 Leaflet layers.
window.AtlasLocalMap = (() => {
  let pending;
  function load() {
    if (window.SHANGHAI_BASEMAP) return Promise.resolve(window.SHANGHAI_BASEMAP);
    if (!pending) pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'basemap/shanghai.js?v=1';
      script.onload = () => {
        if (window.SHANGHAI_BASEMAP) resolve(window.SHANGHAI_BASEMAP);
        else { script.remove(); pending = null; reject(new Error('Invalid basemap')); }
      };
      script.onerror = () => { script.remove(); pending = null; reject(new Error('Basemap download failed')); };
      document.head.append(script);
    });
    return pending;
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
  function create(data) {
    const styles = [
      {color:'#ddd9cd', width:1.4}, {color:'#c5c5b9', width:1.8},
      {color:'#dbbd87', width:2.3}, {color:'#d4a66a', width:3},
      {color:'#c8e0e3', width:0}, {color:'#b0cfd6', width:1.5}
    ];
    const groups = Array.from({length:7}, () => []);
    data.features.forEach(f => groups[f[0]].push(f));
    return new (L.Layer.extend({
      onAdd(map) {
        this._map = map;
        this.canvas = L.DomUtil.create('canvas', 'atlas-local-basemap');
        this.canvas.style.pointerEvents = 'none';
        map.getPane('tilePane').append(this.canvas);
        map.attributionControl.addAttribution('底图 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> / Geofabrik · ODbL');
        map.on('moveend zoomend resize', this.schedule, this);
        this.draw();
      },
      onRemove(map) {
        map.off('moveend zoomend resize', this.schedule, this);
        cancelAnimationFrame(this.frame);
        this.canvas.remove();
        map.attributionControl.removeAttribution('底图 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> / Geofabrik · ODbL');
      },
      schedule() {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => this.draw());
      },
      draw() {
        const map = this._map, zoom = map.getZoom(), size = map.getSize();
        const pad = 100, width = size.x + 2 * pad, height = size.y + 2 * pad;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = this.canvas, ctx = canvas.getContext('2d');
        canvas.width = width * dpr; canvas.height = height * dpr;
        canvas.style.width = width+'px'; canvas.style.height = height+'px';
        L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([-pad, -pad]));
        ctx.scale(dpr, dpr); ctx.fillStyle = '#f2f1e9'; ctx.fillRect(0, 0, width, height);
        const bounds = map.getBounds().pad(.3), scale = 256 * Math.pow(2, zoom);
        const origin = map.project(map.getCenter(), zoom).subtract(size.divideBy(2)).subtract([pad, pad]);
        const labels = [], occupied = [];
        const inView = f => f[1] <= zoom && f[5] >= bounds.getWest() && f[3] <= bounds.getEast() && f[6] >= bounds.getSouth() && f[4] <= bounds.getNorth();
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
          for (const f of groups[kind]) {
            if (!inView(f)) continue;
            const rings = kind === 4 ? decode(f) : [decode(f)];
            ctx.beginPath();
            for (const ring of rings) {
              ring.map(pixel).forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
              if (kind === 4) ctx.closePath();
            }
            if (kind === 4) ctx.fill('evenodd');
            else ctx.stroke();
            const points = kind === 4 ? [] : decode(f).map(pixel);
            if (zoom >= (kind === 0 ? 16 : 13) && f[2] >= 0 && points.length > 1) {
              let best = 0, position;
              for (let i=1; i<points.length; i++) {
                const a=points[i-1], b=points[i], length=Math.hypot(a[0]-b[0],a[1]-b[1]);
                if (length>best) { best=length; position=[(a[0]+b[0])/2,(a[1]+b[1])/2]; }
              }
              if (best>80) labels.push([data.names[f[2]], ...position]);
            }
          }
        }
        for (const f of groups[6]) if (inView(f)) label(data.names[f[2]], ...pixel(decode(f)[0]), true);
        for (const item of labels.reverse()) label(...item);
        canvas.dataset.drawn = 'true';
      }
    }))();
  }
  return {load, create};
})();
