#!/usr/bin/env node
/*
 * Auditoría de navegación: carga el NavigationSystem real del juego con un map.json
 * y comprueba que todos los puntos, estaciones, mesas y rutas de patrulla son alcanzables
 * desde la posición inicial del encargado (perfil staff) y desde la entrada (perfil guest).
 *
 * Uso:  node tools/nav_audit.js [--brand popeyes] [ruta/a/map.json]   (por defecto src/data/map.json, marca bk)
 *       Con --brand se aplica la parte "map" de src/data/brands.json igual que hace el juego (BK.applyBrand).
 * Sale con código 1 si hay rutas rotas o puntos que caen lejos de suelo transitable.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const bi = args.indexOf('--brand'), brand = bi >= 0 ? args.splice(bi, 2)[1] : 'bk';
const fileArg = args.find((a) => !a.startsWith('--'));
const mapPath = path.resolve(fileArg || path.join(root, 'src/data/map.json'));
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
if (brand !== 'bk') {
  const brands = JSON.parse(fs.readFileSync(path.join(root, 'src/data/brands.json'), 'utf8'));
  const b = brands[brand];
  if (!b) throw new Error('Marca desconocida: ' + brand);
  Object.keys(b.map || {}).forEach((k) => { map[k] = JSON.parse(JSON.stringify(b.map[k])); });
}

const ctx = { window: {}, console };
ctx.window.window = ctx.window;
vm.createContext(ctx);
vm.runInContext('window.BK = {};', ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'src/systems/NavigationSystem.js'), 'utf8'), ctx);
const nav = new ctx.window.BK.NavigationSystem(map, 1.5, brand);
nav.setDoorOpen(true);

const P = (a) => ({ x: a[0], y: a[1] });
const staffFrom = map.player ? { x: map.player.x, y: map.player.y } : { x: 330, y: 520 };
const guestFrom = P(map.points.guestSpawn);
const SNAP_WARN = 14; // px: más lejos que esto, el destino real no coincide con el punto pedido

const targets = [];
const add = (kind, label, pt) => targets.push({ kind, label, pt });
const pts = map.points;
const staffPts = ['viscosity', 'chickenTemp', 'checkKitchen', 'criticalFactors', 'checkHall', 'checkRestroom', 'mainDoor', 'productPrep', 'friesPrep', 'assembly',
  'cleanEquipment', 'cleanDining', 'exteriorReview', 'startEquipment', 'windowPay', 'windowDeliver', 'deliveryHatch', 'backDoor', 'trashArea', 'storageDrop'];
staffPts.forEach((k) => { if (pts[k]) add('staff', 'points.' + k, P(pts[k])); });
Object.entries(map.stations).forEach(([k, s]) => add('staff', 'stations.' + k, P(s.pos)));
Object.entries(map.kitchenWander).forEach(([k, arr]) => arr.forEach((p, i) => add('staff', 'kitchenWander.' + k + '[' + i + ']', P(p))));
map.hallPatrol.forEach((p, i) => add('staff', 'hallPatrol[' + i + ']', P(p)));
['kiosk1', 'kiosk2', 'pickup', 'guestExit', 'riderWait', 'riderWait2'].forEach((k) => { if (pts[k]) add('guest', 'points.' + k, P(pts[k])); });
pts.counterSlots.forEach((p, i) => add('guest', 'counterSlots[' + i + ']', P(p)));
pts.tableWaitSpots.forEach((p, i) => add('guest', 'tableWaitSpots[' + i + ']', P(p)));
// Cajas del camión de proveedor: el personal debe poder ir de la descarga al almacén
((map.spots && map.spots.boxes) || []).forEach((b, i) => add('staff', 'spots.boxes[' + i + ']', b));
map.tables.forEach((t) => t.seats.forEach((s, i) => add('guest', 'tables.' + t.id + '.seat' + i, { x: s[0], y: s[1] })));
// Los repartidores entran desde riderSpawn
const riderFrom = pts.riderSpawn ? P(pts.riderSpawn) : guestFrom;

let broken = 0, warn = 0;
const rows = [];
for (const t of targets) {
  const from = t.label.startsWith('points.rider') ? riderFrom : (t.kind === 'staff' ? staffFrom : guestFrom);
  const r = nav.findPath(t.kind, from, t.pt);
  const near = nav.nearestWalkable(t.kind, t.pt.x, t.pt.y, 60);
  const snap = near ? Math.hypot(near.x - t.pt.x, near.y - t.pt.y) : Infinity;
  const len = r.reachable ? Math.round(nav.pathLength(r.path, from)) : 0;
  const end = r.reachable && r.path.length ? r.path[r.path.length - 1] : null;
  const arrives = end && Math.hypot(end.x - t.pt.x, end.y - t.pt.y) < 1; // el tramo final llega al punto exacto
  let status = 'OK';
  if (!r.reachable) { status = 'ROTA'; broken++; } else if (snap > SNAP_WARN && !arrives) { status = 'LEJOS'; warn++; }
  else if (snap > SNAP_WARN) status = 'TRAMO_FINAL';
  rows.push({ status, kind: t.kind, label: t.label, x: t.pt.x, y: t.pt.y, snap: Math.round(snap * 10) / 10, len });
}

// Anchura mínima de paso: celdas transitables con menos de N celdas libres a cada lado en horizontal y vertical
function narrowCells(kind, minCells) {
  let n = 0;
  for (let y = 0; y < nav.H; y++) for (let x = 0; x < nav.W; x++) {
    if (!nav.walkable(kind, x, y)) continue;
    let h = 1, v = 1;
    for (let d = 1; d <= minCells && nav.walkable(kind, x - d, y); d++) h++;
    for (let d = 1; d <= minCells && nav.walkable(kind, x + d, y); d++) h++;
    for (let d = 1; d <= minCells && nav.walkable(kind, x, y - d); d++) v++;
    for (let d = 1; d <= minCells && nav.walkable(kind, x, y + d); d++) v++;
    if (h < minCells && v < minCells) n++;
  }
  return n;
}

// Rutas operativas completas: caja del camión -> almacén (productPrep) y acceso de empleados -> cada puesto
const drop = map.points.productPrep ? P(map.points.productPrep) : null;
((map.spots && map.spots.boxes) || []).forEach((b, i) => {
  if (!drop) return;
  const r = nav.findPath('staff', b, drop);
  if (!r.reachable) { broken++; rows.push({ status: 'ROTA', kind: 'staff', label: 'caja ' + i + ' -> productPrep', x: b.x, y: b.y, snap: 0, len: 0 }); }
});
const door = (map.zones || []).find((z) => z.id === 'staffDoor');
if (door) {
  const dc = { x: (door.rect[0] + door.rect[2]) / 2, y: (door.rect[1] + door.rect[3]) / 2 };
  Object.entries(map.stations).forEach(([k, st]) => {
    const r = nav.findPath('staff', dc, P(st.pos));
    if (!r.reachable) { broken++; rows.push({ status: 'ROTA', kind: 'staff', label: 'staffDoor -> ' + k, x: dc.x, y: dc.y, snap: 0, len: 0 }); }
  });
  console.log('Acceso de empleados', JSON.stringify(dc), '-> todos los puestos comprobados');
}
const bad = rows.filter((r) => r.status === 'ROTA' || r.status === 'LEJOS');
console.log('Destinos alcanzados con tramo final (asientos/puestos dentro de mobiliario):', rows.filter((r) => r.status === 'TRAMO_FINAL').length);
console.log('Marca:', brand, '| Mapa:', path.relative(root, mapPath), '| celda', nav.cell, 'px |', nav.W + 'x' + nav.H);
console.log('Destinos comprobados:', rows.length, '| rutas rotas:', broken, '| destinos lejos del suelo:', warn);
console.log('Celdas estrechas (<4 celdas = 16 px) staff:', narrowCells('staff', 4), '| guest:', narrowCells('guest', 4));
if (bad.length) console.table(bad);
if (process.argv.includes('--all')) console.table(rows);
process.exit(broken || warn ? 1 : 0);
