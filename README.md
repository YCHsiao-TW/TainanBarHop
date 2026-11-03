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


## 2026-11-03 地圖底圖修正

已移除 CARTO 的 `dark_all` 底圖（現需 API Key），改用 OpenStreetMap 標準底圖，並只針對地圖瓦片做深色視覺處理；不需要任何 API Key。

OpenStreetMap 標準圖磚由社群提供，需遵守 [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)；禁止預先大量下載或離線預抓圖磚，應保留頁面中的來源標示，且不保證無限流量。

若 GitHub 原本已上傳網站，只要將根目錄的 `app.js` 更新成此修正版即可；`index.html`、`styles.css` 無須修改。更新 GitHub Pages 後建議強制重新整理（Mac：Command+Shift+R）。
