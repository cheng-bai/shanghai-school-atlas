"""Build the redistributable Shanghai reference basemap (requires pyshp).

Usage: python3 scripts/build_basemap.py /path/to/shanghai-free.shp.zip
The public OSM tile server is never queried. Coordinates remain WGS84.
"""
import collections
import hashlib
import json
import math
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def simplify(points, tolerance=0.00004):
    if len(points) < 3:
        return points
    ax, ay = points[0]
    bx, by = points[-1]
    dx, dy = bx-ax, by-ay
    denom = dx*dx+dy*dy
    best, index = tolerance*tolerance, None
    for i, (x, y) in enumerate(points[1:-1], 1):
        t = max(0, min(1, ((x-ax)*dx+(y-ay)*dy)/denom)) if denom else 0
        d = (x-ax-t*dx)**2+(y-ay-t*dy)**2
        if d > best:
            best, index = d, i
    if index is None:
        return [points[0], points[-1]]
    return simplify(points[:index+1], tolerance)[:-1]+simplify(points[index:], tolerance)

def encode(points):
    result, previous = [], [0, 0]
    for point in points:
        for axis in range(2):
            value = round(point[axis]*100000)
            delta = value-previous[axis]
            previous[axis] = value
            delta = ~(delta << 1) if delta < 0 else delta << 1
            while delta >= 32:
                result.append(chr((32 | (delta & 31))+63))
                delta >>= 5
            result.append(chr(delta+63))
    return ''.join(result)

def build(archive):
    import shapefile
    z = zipfile.ZipFile(archive)
    names, name_ids, features, counts = [], {}, [], collections.Counter()
    def name_id(name):
        if not name:
            return -1
        if name not in name_ids:
            name_ids[name] = len(names)
            names.append(name)
        return name_ids[name]
    layers = ['water_a', 'waterways', 'roads', 'places']
    for layer in layers:
        base = 'gis_osm_'+layer+'_free_1'
        r = shapefile.Reader(shp=z.open(base+'.shp'), dbf=z.open(base+'.dbf'), shx=z.open(base+'.shx'))
        for item in r.iterShapeRecords():
            record, shape = item.record, item.shape
            kind = record['fclass']
            if layer == 'roads':
                if kind.startswith(('motorway', 'trunk')):
                    style, zoom = 3, 9
                elif kind.startswith(('primary', 'secondary')):
                    style, zoom = 2, 11
                elif kind.startswith('tertiary'):
                    style, zoom = 1, 12
                elif kind in ('residential', 'unclassified', 'living_street'):
                    style, zoom = 0, 14
                else:
                    continue
            elif layer == 'water_a':
                if kind not in ('water', 'riverbank', 'reservoir', 'dock'):
                    continue
                style, zoom = 4, 9 if kind == 'riverbank' else 12
            elif layer == 'waterways':
                if kind not in ('river', 'canal'):
                    continue
                style, zoom = 5, 11 if kind == 'river' else 13
            else:
                if kind not in ('city', 'town', 'suburb') or not record['name']:
                    continue
                style, zoom = 6, 10 if kind == 'city' else 13
            parts = list(shape.parts)+[len(shape.points)] if shape.parts else [0, len(shape.points)]
            rings = [simplify(shape.points[a:b]) for a, b in zip(parts, parts[1:])]
            segments = [shape.points] if layer == 'water_a' else rings
            for segment in segments:
                points = segment
                if not points:
                    continue
                xs, ys = zip(*points)
                features.append([style, zoom, name_id(record['name']),
                                 *[round(v, 5) for v in (min(xs), min(ys), max(xs), max(ys))], [encode(ring) for ring in rings] if layer == 'water_a' else encode(points)])
                counts[str(style)] += 1
    meta = {'source': 'https://download.geofabrik.de/asia/china/shanghai-latest-free.shp.zip',
            'license': 'ODbL-1.0', 'coordinates': 'WGS84',
            'sourceReadme': z.read('README').decode(),
            'sourceSha256': hashlib.sha256(Path(archive).read_bytes()).hexdigest(),
            'layers': dict(counts), 'simplifyDegrees': 0.00004}
    output = ROOT/'web/basemap/shanghai.js'
    output.write_text('window.SHANGHAI_BASEMAP='+json.dumps({'meta': meta, 'names': names, 'features': features}, ensure_ascii=False, separators=(',', ':'))+';\n')
    print(json.dumps({'output': str(output), 'bytes': output.stat().st_size, 'features': len(features), 'layers': dict(counts)}, ensure_ascii=False))

if __name__ == '__main__':
    build(sys.argv[1])
