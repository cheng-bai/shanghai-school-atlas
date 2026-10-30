# 上海自带参考底图

此目录的 `manifest.js` 与五个 `zoom*.js` 是可下载、可再处理的简化 OpenStreetMap 数据库，按 **ODbL 1.0** 发布；不覆盖学校/校区数据库或网站代码的权利归属。

- 原始数据：© OpenStreetMap contributors，由 Geofabrik 提供上海 shapefile 提取。
- 下载来源：https://download.geofabrik.de/asia/china/shanghai-latest-free.shp.zip
- 本次对应的固定日期包：https://download.geofabrik.de/asia/china/shanghai-261029-free.shp.zip （与下载包 MD5 核对一致：`2fda307e448a0073531654857192b534`）。
- 来源说明页：https://download.geofabrik.de/asia/china/shanghai.html
- 原始数据截至：2026-10-29T21:21:26Z；本次下载/生成：2026-10-30。
- 授名与版权：https://www.openstreetmap.org/copyright
- 许可证全文：https://opendatacommons.org/licenses/odbl/1-0/
- 原始 ZIP 的 SHA256、原始 README 与图层数量保留在 `manifest.js` 的 `meta` 内。

本层使用 WGS84 经纬度，客户端按 Web Mercator 绘制。保留主要公路、部分生活道路、河流/水面和部分地名，省略建筑、兴趣点、部分小路；道路按缩放级别显示，几何以 0.00004 度容差简化，再以 1e-5 度量化。水面保留多边形内部环。该层不是权威行政区划图、导航地图或门牌查询服务，数据可能过时或缺漏，不能据此确定法定边界、通行条件或精确距离。

生成：安装小型纯 Python 包 `pyshp` 后，运行 `python3 scripts/build_basemap.py /path/to/shanghai-free.shp.zip`。按原始缩放级别分包并保留原始要素顺序，几何没有因分包而进一步简化。每次更新底图时，同步递增 `web/local-map.js` 中的 `manifest.js` 版本参数及 `index.html` 中的 `local-map.js` 版本参数，避免浏览器读取旧清单。不要从 OSM 公共瓦片服务预抓取图块。底图数据库的公开衍生/再分发应继续遵守 ODbL。

先加载名录和 10 级概览，再根据当前缩放级别从本站加载其他数据包，之后由浏览器按 HTTP 缓存策略复用；打开特定校区或分享链接时，可能立即加载多个包。全部数据合计约 11.6 MB 原始 JS（服务端压缩后更小），不是每次都要下载全部数据。此实现不承诺网站首次断网可打开，也不提供整站离线安装；下载完整 `web/` 文件夹后，本层可在 `file://` 直接使用。某个细节包加载失败时，概览仍可用，点击“重新加载”可重试。
