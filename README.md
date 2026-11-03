# 府城微醺地圖 — JS v5.0

重新開發的臺南酒吧巡禮網站，使用原生 JavaScript modules + Canvas 2D 地圖引擎，不再依賴 Leaflet / CARTO / 外部 JavaScript CDN。

## 檔案
- `index.html`：極簡入口（只載入 CSS 和 JavaScript）
- `app.js`：狀態、搜尋、抽籤、民宿/GPS/任意起點、續攤、分享與導航
- `map.js`：自製 Web Mercator 地圖 Canvas 繪圖、拖曳、滑鼠滾輪與觸控縮放
- `data.js`：36 間既有的精選酒吧清單（非實時官方營業名冊）
- `styles.css`：獨立響應式樣式

## GitHub Pages
把上述五個網站檔案 **全部** 放在 `main` 分支的 repo 根目錄。可以保留 README，既有舊版 `app.js`、`styles.css` 會被覆蓋，新增 `map.js`、`data.js`。不要把 ZIP 本身放進 GitHub。

如果 GitHub Pages 已經設為 `main` / `(root)`，提交後會重新部署。

## 重要設計
- 地圖瓦片僅畫在一個 `<canvas>` 內，不會溢出覆蓋手機按鈕、頁首或清單
- 只讀取視窗當前可見的 OSM tile，保留 © OpenStreetMap contributors 歸屬
- 不在啟動時呼叫 Overpass；按「載入公開酒吧點位」才擷取臺南部分區域的 OSM 酒吧名錄。36 間精選酒吧暫只有地址，未驗證座標的店家不會被放上地圖圖釘，以免錯誤定位。
- 外部 OSM 圖磚或 Overpass 中斷時，搜尋、抽籤及 Google Maps 步行導航仍可使用
- 續攤與收藏儲存在目前瀏覽器 localStorage，不會自動跨裝置同步
- 經緯度和地址精度以資料來源為準；36 間精選可能有變動，使用前核對店家

> 飲酒需滿 18 歲。喝酒不開車或騎車，改搭計程車或步行。
