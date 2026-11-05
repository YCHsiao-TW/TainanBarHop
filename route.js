/*
 * 續攤路線排序（純前端，直線距離）。
 * 用法：sortRoute(start, stops) → 依序的 stops 陣列。
 * 演算法：最近鄰（nearest neighbor）從起點出發，再用 2-opt 做局部改善。
 * 直線距離只是估算，實際步行距離會較長；這裡的結果只代表「大致順路」。
 * 沒有座標的店會被放到最後，並以 unlocated 陣列回傳，不會參與排序。
 */

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const hasXY = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

function pathLength(start, order) {
  let total = 0, prev = start;
  for (const p of order) { total += haversineKm(prev, p); prev = p; }
  return total;
}

export function sortRoute(start, stops) {
  const located = stops.filter(hasXY);
  const unlocated = stops.filter(s => !hasXY(s));
  if (!hasXY(start) || located.length === 0) {
    return { route: located, unlocated, totalKm: pathLength(start, located) };
  }

  // 1) 最近鄰
  const remaining = [...located];
  const route = [];
  let cur = start;
  while (remaining.length) {
    let bestI = 0, bestD = Infinity;
    remaining.forEach((p, i) => {
      const d = haversineKm(cur, p);
      if (d < bestD) { bestD = d; bestI = i; }
    });
    cur = remaining.splice(bestI, 1)[0];
    route.push(cur);
  }

  // 2) 2-opt 局部改善（只改中間段，起點固定）
  let improved = true, guard = 0;
  while (improved && guard++ < 100) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const cand = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
        if (pathLength(start, cand) + 1e-9 < pathLength(start, route)) {
          route.splice(0, route.length, ...cand);
          improved = true;
        }
      }
    }
  }

  return { route, unlocated, totalKm: pathLength(start, route) };
}
