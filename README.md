# 府城微醺地圖 (Tainan Bar Hop)

可直接部署到 GitHub Pages 的網頁。主要互動功能由 **JavaScript**（`app.js`）實作，不是 Java。

## 試玩方式

雙擊 `index.html` 或於終端機進入資料夾執行 `python3 -m http.server 8000`，瀏覽 `http://localhost:8000`。

## 內容

- `index.html`：網頁結構
- `styles.css`：網站視覺設計與手機版排版
- `app.js`：搜尋、篩選、隨機抽酒吧、定位、續攤排序、導航、OSM/Overpass 地圖資料

地圖需要連線讀取 Leaflet、底圖及 OSM，位置搜尋需要 Nominatim。精選酒吧清單和 Google Maps 導航為備援功能。

目前是未公開部署的測試版，尚無法保證臺南所有酒吧都被 OSM 收錄。用戶應以店家最新公告確認營業。喝酒不開車。
