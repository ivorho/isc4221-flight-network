// U.S. Flight Network Explorer — ISC 4221C Lab 7B
// Loads the JSON files written by export_web_data.py and runs the lab algorithms in the browser.

const state = {
  airports: {},      // code -> {code, name, city, lat, lon, degree, component}
  edges: [],
  adj: {},           // code -> [neighbor codes]
  sortedCodes: [],   // alphabetical, sorted once on load (merge sort)
  markers: {},       // code -> Leaflet circle marker
  components: [],
};

// ---------- algorithms (ports of the Python functions) ----------

// merge sort; before(x, y) is true when x should come first (same as part2.merge_sort)
function mergeSort(items, before) {
  if (items.length <= 1) return items.slice();
  const mid = Math.floor(items.length / 2);
  const left = mergeSort(items.slice(0, mid), before);
  const right = mergeSort(items.slice(mid), before);
  const out = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (before(right[j], left[i])) out.push(right[j++]);
    else out.push(left[i++]);
  }
  while (i < left.length) out.push(left[i++]);
  while (j < right.length) out.push(right[j++]);
  return out;
}

// binary search; one comparison = one probe of sortedCodes[mid] (same as part3.find_airport)
function findAirport(sortedCodes, code) {
  let low = 0, high = sortedCodes.length - 1, comparisons = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    comparisons++;
    if (sortedCodes[mid] === code) return { index: mid, comparisons };
    if (sortedCodes[mid] < code) low = mid + 1;
    else high = mid - 1;
  }
  return { index: -1, comparisons };
}

// Haversine distance in km, R = 6371 (same as part2.haversine)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371.0, rad = Math.PI / 180;
  const p1 = lat1 * rad, p2 = lat2 * rad;
  const dp = p2 - p1, dl = (lon2 - lon1) * rad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestAirports(code, k) {
  const a = state.airports[code];
  const pairs = [];
  for (const c of state.sortedCodes) {
    const b = state.airports[c];
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    if (d > 0) pairs.push([c, d]);
  }
  return mergeSort(pairs, (x, y) => x[1] < y[1]).slice(0, k);
}

// Connection algorithm (same as part4.path_exists). One iteration moves every airport in `new`
// to `used` and moves their untouched neighbors into the next `new` set.
function pathExists(origin, destination) {
  if (origin === destination) return { found: true, iterations: 0, reached: new Set([origin]) };
  const used = new Set();
  let current = new Set([origin]);
  const untouched = new Set(state.sortedCodes);
  untouched.delete(origin);
  let iterations = 0;
  while (current.size > 0) {
    iterations++;
    const next = new Set();
    for (const s of current) {
      for (const t of state.adj[s]) {
        if (t === destination) {
          const reached = new Set([...used, ...current, ...next, t]);
          return { found: true, iterations, reached };
        }
        if (untouched.has(t)) {
          untouched.delete(t);
          next.add(t);
        }
      }
    }
    for (const s of current) used.add(s);
    current = next;
  }
  return { found: false, iterations, reached: used };
}

// ---------- map ----------

const COLORS = ["#e9d8a6", "#d9b25f", "#c6803c", "#9b3b3b", "#5c1a2b"];
const BREAKS = [5, 20, 60, 100];           // degree 1–5, 6–20, 21–60, 61–100, 101+
function colorFor(deg) {
  let i = 0;
  while (i < BREAKS.length && deg > BREAKS[i]) i++;
  return COLORS[i];
}
const radiusFor = deg => 2.5 + Math.sqrt(deg) * 1.1;

let map, routeLayer, highlightLayer;

function initMap() {
  map = L.map("map", { preferCanvas: true, worldCopyJump: false }).setView([42, -110], 3);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
    maxZoom: 16,
  }).addTo(map);

  const renderer = L.canvas({ padding: 0.5 });
  routeLayer = L.layerGroup().addTo(map);
  for (const [a, b] of state.edges) {
    const A = state.airports[a], B = state.airports[b];
    L.polyline([[A.lat, A.lon], [B.lat, B.lon]], {
      renderer, color: "#782f40", weight: 0.7, opacity: 0.12, interactive: false,
    }).addTo(routeLayer);
  }
  highlightLayer = L.layerGroup().addTo(map);

  // draw small airports first so hubs sit on top
  const byDegree = mergeSort(state.sortedCodes, (x, y) => state.airports[x].degree < state.airports[y].degree);
  for (const code of byDegree) {
    const ap = state.airports[code];
    const m = L.circleMarker([ap.lat, ap.lon], {
      renderer, radius: radiusFor(ap.degree), fillColor: colorFor(ap.degree),
      color: "#3a2a2e", weight: 0.6, fillOpacity: 0.9,
    }).addTo(map);
    m.bindTooltip(`<b>${ap.code}</b> ${ap.city} · degree ${ap.degree}`);
    m.on("click", () => selectAirport(code, false));
    state.markers[code] = m;
  }
  addLegend();
}

function addLegend() {
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    const labels = ["1–5", "6–20", "21–60", "61–100", "101+"];
    const sample = [3, 12, 40, 80, 150];
    let html = "<b>Airport degree</b>";
    for (let i = 0; i < COLORS.length; i++) {
      const r = radiusFor(sample[i]);
      html += `<div class="item"><span class="dot" style="width:${2 * r}px;height:${2 * r}px;background:${COLORS[i]}"></span>${labels[i]}</div>`;
    }
    html += `<div class="item"><span class="line" style="background:#782f40;opacity:.35"></span>route (edge)</div>`;
    html += `<div class="item"><span class="line" style="background:#1f6fb2"></span>selected routes</div>`;
    html += `<div class="item"><span class="dot" style="width:10px;height:10px;background:#2b8a3e"></span>reached / highlighted</div>`;
    div.innerHTML = html;
    return div;
  };
  legend.addTo(map);
}

function clearHighlight() {
  highlightLayer.clearLayers();
}

function ring(code, color, r) {
  const ap = state.airports[code];
  return L.circleMarker([ap.lat, ap.lon], {
    radius: r || radiusFor(ap.degree) + 3, color, weight: 2.5, fill: false, interactive: false,
  });
}

// select an airport: highlight its routes on the map and show it in panel B
function selectAirport(code, fly) {
  clearHighlight();
  const ap = state.airports[code];
  for (const nb of state.adj[code]) {
    const b = state.airports[nb];
    L.polyline([[ap.lat, ap.lon], [b.lat, b.lon]], { color: "#1f6fb2", weight: 2, opacity: 0.85, interactive: false })
      .addTo(highlightLayer);
  }
  ring(code, "#1f6fb2", radiusFor(ap.degree) + 5).addTo(highlightLayer);
  if (fly) map.flyTo([ap.lat, ap.lon], Math.max(map.getZoom(), 5), { duration: 0.6 });
  document.getElementById("lookupInput").value = code;
  showLookup(code);
}

// ---------- panel B ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function showLookup(raw) {
  const out = document.getElementById("lookupResult");
  const code = raw.trim().toUpperCase();
  if (!code) {
    out.innerHTML = '<p class="muted">Type a three-letter code first.</p>';
    return null;
  }
  const { index, comparisons } = findAirport(state.sortedCodes, code);
  if (index === -1) {
    out.innerHTML = `<p class="notfound">"${escapeHtml(code)}" is not an airport in this network.</p>
      <p class="muted">Binary search: ${comparisons} comparisons over ${state.sortedCodes.length} sorted codes.</p>`;
    return null;
  }
  const ap = state.airports[code];
  const dests = mergeSort(state.adj[code], (x, y) => x < y);
  const near = nearestAirports(code, 5);
  out.innerHTML = `
    <dl>
      <dt>Airport</dt><dd><b>${ap.code}</b> · ${escapeHtml(ap.name)}</dd>
      <dt>City</dt><dd>${escapeHtml(ap.city)}</dd>
      <dt>Degree</dt><dd>${ap.degree}</dd>
      <dt>Binary search</dt><dd>found at index ${index} in ${comparisons} comparisons</dd>
    </dl>
    <h3>Direct destinations (${dests.length})</h3>
    <div class="chips">${dests.map(d => `<span class="chip" title="${escapeHtml(state.airports[d].city)}">${d}</span>`).join("")}</div>
    <h3>5 nearest airports in the network</h3>
    <table class="near">${near.map(([c, d]) =>
      `<tr><td><b>${c}</b></td><td>${escapeHtml(state.airports[c].city)}</td><td>${d.toFixed(1)} km</td></tr>`).join("")}</table>`;
  return code;
}

function onLookup(e) {
  e.preventDefault();
  const raw = document.getElementById("lookupInput").value;
  const code = showLookup(raw);
  if (code) {
    // select on the map without re-running the lookup text
    clearHighlight();
    const ap = state.airports[code];
    for (const nb of state.adj[code]) {
      const b = state.airports[nb];
      L.polyline([[ap.lat, ap.lon], [b.lat, b.lon]], { color: "#1f6fb2", weight: 2, opacity: 0.85, interactive: false })
        .addTo(highlightLayer);
    }
    ring(code, "#1f6fb2", radiusFor(ap.degree) + 5).addTo(highlightLayer);
    map.flyTo([ap.lat, ap.lon], Math.max(map.getZoom(), 5), { duration: 0.6 });
  }
}

// ---------- panel C ----------

function buildSummary(summary, hubs) {
  document.getElementById("sAirports").textContent = summary.n_airports;
  document.getElementById("sEdges").textContent = summary.n_edges;
  document.getElementById("sComps").textContent = summary.n_components;

  const list = document.getElementById("compList");
  state.components.forEach((comp, i) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const preview = comp.length <= 6 ? comp.join(", ") : "includes TLH, ATL, SEA, ANC, HNL, …";
    btn.innerHTML = `<b>Component ${i + 1}</b>: ${comp.length} airports <span class="muted">(${preview})</span>`;
    btn.addEventListener("click", () => highlightComponent(i));
    li.appendChild(btn);
    list.appendChild(li);
  });

  const chart = document.getElementById("hubChart");
  const maxDeg = hubs[0].degree;
  for (const h of hubs) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bar";
    row.title = `${h.code} · ${state.airports[h.code].city} · degree ${h.degree}`;
    row.innerHTML = `<span class="code">${h.code}</span>
      <span class="track"><span class="fill" style="width:${(100 * h.degree / maxDeg).toFixed(1)}%;display:block"></span></span>
      <span class="val">${h.degree}</span>`;
    row.addEventListener("click", () => selectAirport(h.code, true));
    chart.appendChild(row);
  }
}

function highlightComponent(i) {
  clearHighlight();
  const comp = state.components[i];
  for (const c of comp) ring(c, "#2b8a3e", comp.length <= 10 ? 9 : undefined).addTo(highlightLayer);
  const bounds = L.latLngBounds(comp.map(c => [state.airports[c].lat, state.airports[c].lon]));
  map.flyToBounds(bounds.pad(comp.length <= 10 ? 1.5 : 0.05), { duration: 0.6, maxZoom: 8 });
}

// ---------- panel D ----------

function buildChecker() {
  const fromSel = document.getElementById("fromSel");
  const toSel = document.getElementById("toSel");
  for (const sel of [fromSel, toSel]) {
    for (const c of state.sortedCodes) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = `${c} – ${state.airports[c].city}`;
      sel.appendChild(opt);
    }
  }
  fromSel.value = "TLH";
  toSel.value = "SEA";
  document.getElementById("checkBtn").addEventListener("click", runCheck);
}

function runCheck() {
  const a = document.getElementById("fromSel").value;
  const b = document.getElementById("toSel").value;
  const res = pathExists(a, b);            // runs the connection algorithm now, in the browser
  const out = document.getElementById("checkResult");
  if (res.found) {
    out.innerHTML = `<p class="answer yes">Path exists</p>
      <dl><dt>Iterations</dt><dd>${res.iterations}</dd>
      <dt>Fewest flights</dt><dd>${res.iterations}</dd>
      <dt>Airports reached</dt><dd>${res.reached.size}</dd></dl>`;
  } else {
    out.innerHTML = `<p class="answer no">No path</p>
      <dl><dt>Iterations</dt><dd>${res.iterations}</dd>
      <dt>Airports reached</dt><dd>${res.reached.size} of ${state.sortedCodes.length}</dd></dl>
      <p class="muted">${b} is not in the same connected component as ${a}.</p>`;
  }
  clearHighlight();
  for (const c of res.reached) ring(c, "#2b8a3e", 4).addTo(highlightLayer);
  ring(a, "#1f6fb2", 10).addTo(highlightLayer);
  ring(b, "#c92a2a", 10).addTo(highlightLayer);
}

// ---------- start ----------

async function loadJSON(name) {
  const r = await fetch(`data/${name}`);
  if (!r.ok) throw new Error(`could not load data/${name} (${r.status})`);
  return r.json();
}

async function main() {
  const [airports, edges, hubs, components, summary] = await Promise.all(
    ["airports.json", "edges.json", "hubs.json", "components.json", "summary.json"].map(loadJSON));
  for (const ap of airports) {
    state.airports[ap.code] = ap;
    state.adj[ap.code] = [];
  }
  state.edges = edges;
  for (const [a, b] of edges) {
    state.adj[a].push(b);
    state.adj[b].push(a);
  }
  state.components = components;
  // sort once when the data loads (Part 3), then every lookup is a binary search
  state.sortedCodes = mergeSort(airports.map(a => a.code), (x, y) => x < y);

  initMap();
  buildSummary(summary, hubs);
  buildChecker();
  document.getElementById("lookupForm").addEventListener("submit", onLookup);
}

main().catch(err => {
  document.getElementById("lookupResult").innerHTML = `<p class="notfound">${escapeHtml(err.message)}</p>`;
});
