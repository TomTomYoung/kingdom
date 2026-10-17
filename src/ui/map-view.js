import { Hex } from '../world/hex.js';
import { RULESET } from '../core/ruleset.js';
import { MapCamera, HEX_SIZE, hexPosition } from './map-camera.js';

function hexPath(ctx, x, y, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30), px = x + size * Math.cos(angle), py = y + size * Math.sin(angle);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

export class MapView {
  constructor(canvas, minimap, assets, { onInspect, onMove, onHover, onCameraChange }) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.minimap = minimap; this.assets = assets;
    this.camera = new MapCamera(); this.onCameraChange = onCameraChange;
    this.markers = []; this.options = {}; this.suppressClick = false;
    canvas.onclick = (event) => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      const hit = this.hitAt(event); if (hit.tile) onInspect(hit);
    };
    canvas.oncontextmenu = (event) => { event.preventDefault(); const hit = this.hitAt(event); if (hit.tile) onMove(hit.tile.key); };
    canvas.onpointerdown = (event) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      this.suppressClick = false;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cameraX: this.camera.x, cameraY: this.camera.y, moved: false };
      try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Synthetic events do not own a pointer. */ }
      canvas.focus({ preventScroll: true });
    };
    canvas.onpointermove = (event) => {
      if (this.drag && this.drag.id === event.pointerId) {
        const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
        if (Math.hypot(dx, dy) > 6) this.drag.moved = true;
        if (this.drag.moved) {
          this.camera.x = this.drag.cameraX - dx / this.camera.zoom; this.camera.y = this.drag.cameraY - dy / this.camera.zoom;
          canvas.classList.add('dragging'); this.draw(); return;
        }
      }
      onHover(this.hitAt(event).tile?.key ?? null);
    };
    canvas.onpointerup = (event) => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      this.suppressClick = this.drag.moved; this.drag = null; canvas.classList.remove('dragging');
      try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* Already released. */ }
    };
    canvas.onpointercancel = () => { this.drag = null; this.suppressClick = true; canvas.classList.remove('dragging'); };
    canvas.onpointerleave = () => { if (!this.drag) onHover(null); };
    canvas.addEventListener('wheel', (event) => {
      if (event.ctrlKey || !event.deltaY) return;
      event.preventDefault(); const rect = canvas.getBoundingClientRect();
      this.zoomBy(event.deltaY < 0 ? 1 : -1, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }, { passive: false });
    canvas.onkeydown = (event) => {
      const delta = { ArrowLeft: [-100, 0], ArrowRight: [100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100] }[event.key];
      if (!delta) return;
      event.preventDefault(); this.camera.x += delta[0] / this.camera.zoom; this.camera.y += delta[1] / this.camera.zoom; this.draw();
    };
    minimap.onclick = (event) => {
      if (!this.miniLayout) return;
      const rect = minimap.getBoundingClientRect(), layout = this.miniLayout;
      this.camera.x = ((event.clientX - rect.left) * minimap.width / rect.width - minimap.width / 2) / layout.scale;
      this.camera.y = ((event.clientY - rect.top) * minimap.height / rect.height - minimap.height / 2) / layout.scale;
      this.draw();
    };
  }

  setState(state, options) { this.state = state; this.options = options; this.draw(); }
  focus(key) { if (this.state?.world.tiles[key]) { this.camera.centerOn(this.state.world.tiles[key]); this.draw(); } }
  zoomBy(delta, anchor) {
    const rect = this.canvas.getBoundingClientRect(); this.camera.setZoom(this.camera.zoom + delta, rect.width, rect.height, anchor); this.draw();
  }
  hitAt(event) {
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const marker = [...this.markers].reverse().find((m) => Math.abs(m.x - x) <= 23 * this.camera.zoom && y >= m.y - 24 * this.camera.zoom && y <= m.y + 30 * this.camera.zoom);
    const key = marker?.location ?? this.camera.hexAt(x, y, rect.width, rect.height).key;
    return { tile: this.state?.world.tiles[key] ?? null, marker };
  }
  draw() {
    if (!this.state) return;
    const { canvas, ctx, camera, state, assets } = this, rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;
    const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
    if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height); ctx.imageSmoothingEnabled = false;
    camera.clamp(state.world.radius, rect.width, rect.height);
    const scale = camera.zoom, size = HEX_SIZE * scale, project = (hex) => camera.project(hex, rect.width, rect.height);
    const visible = (p) => p.x > -size * 2 && p.y > -size * 2 && p.x < rect.width + size * 2 && p.y < rect.height + size * 2;
    const { selectedPartyId, selectedUnitId, selectedTileKey, hoveredKey, reachable = new Map(), candidates = new Set(), playerId } = this.options;
    for (const tile of Object.values(state.world.tiles)) {
      const p = project(tile); if (!visible(p)) continue;
      hexPath(ctx, p.x, p.y, size - 2);
      ctx.fillStyle = RULESET.terrain[tile.terrainId].color; ctx.globalAlpha = assets.images.has(`terrain-${tile.terrainId}`) ? 0.18 : 1; ctx.fill(); ctx.globalAlpha = 1;
      assets.draw(ctx, `terrain-${tile.terrainId}`, p.x, p.y, scale);
      hexPath(ctx, p.x, p.y, size - 2);
      const canMove = reachable.has(tile.key);
      ctx.strokeStyle = canMove ? '#9de4df' : tile.ownerId ? '#e2c472' : candidates.has(tile.key) ? '#8b9868' : '#37453e'; ctx.lineWidth = canMove || tile.ownerId ? 2 : 1;
      ctx.setLineDash(canMove ? [5, 3] : []); ctx.stroke(); ctx.setLineDash([]);
      if (tile.key === selectedTileKey || tile.key === hoveredKey) { ctx.strokeStyle = tile.key === selectedTileKey ? '#ffffff' : '#fff1be'; ctx.lineWidth = tile.key === selectedTileKey ? 3 : 2; ctx.stroke(); }
      if (tile.cityId) {
        if (!assets.draw(ctx, 'building-city', p.x, p.y - 11 * scale, scale)) { ctx.fillStyle = '#ffe2a0'; ctx.font = `${24 * scale}px serif`; ctx.textAlign = 'center'; ctx.fillText('城', p.x, p.y); }
        if (state.cities[tile.cityId]?.buildings.includes('monument')) assets.draw(ctx, 'building-monument', p.x + 17 * scale, p.y - 8 * scale, scale);
      }
    }
    const route = reachable.get(hoveredKey) ?? reachable.get(selectedTileKey);
    if (route && state.parties[selectedPartyId]) {
      ctx.beginPath(); const keys = [state.parties[selectedPartyId].location, ...route.path];
      keys.forEach((key, index) => { const p = project(state.world.tiles[key]); if (index) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.strokeStyle = '#e9f6b5'; ctx.lineWidth = 3; ctx.setLineDash([7, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    this.markers = [];
    const waiting = new Map();
    for (const unit of Object.values(state.units).filter((u) => !u.partyId)) {
      const key = `${unit.location}:${unit.ownerId}`;
      if (!waiting.has(key)) waiting.set(key, []); waiting.get(key).push(unit);
    }
    const drawMarker = (marker, units, ownerId, badge, active, offset) => {
      const tile = state.world.tiles[marker.location]; if (!tile) return;
      const p = project(tile); if (!visible(p)) return;
      const x = p.x + offset * scale, y = p.y + (tile.cityId ? 12 : 0) * scale;
      const selected = marker.kind === 'party' ? marker.id === selectedPartyId : units.some((u) => u.id === selectedUnitId);
      ctx.beginPath(); ctx.ellipse(x, y + 19 * scale, 22 * scale, 8 * scale, 0, 0, Math.PI * 2);
      ctx.fillStyle = ownerId === playerId ? (marker.kind === 'unit' ? '#6c5941' : '#355c69') : '#803f47'; ctx.fill();
      ctx.strokeStyle = selected ? '#fff1b5' : '#a3b8ac'; ctx.lineWidth = selected ? 3 : 1; ctx.stroke(); ctx.globalAlpha = active ? 1 : 0.45;
      if (!assets.draw(ctx, `unit-${units[0]?.typeId ?? 'warrior'}`, x, y, scale)) { ctx.fillStyle = '#bd9262'; ctx.fillRect(x - 10 * scale, y - 10 * scale, 20 * scale, 20 * scale); }
      ctx.globalAlpha = 1; ctx.fillStyle = '#101d1b'; ctx.fillRect(x + 4 * scale, y + 8 * scale, 27 * scale, 17 * scale);
      ctx.fillStyle = '#fff0c9'; ctx.font = `700 ${11 * scale}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(badge, x + 17 * scale, y + 17 * scale);
      const hp = units.reduce((sum, u) => sum + u.currentHp, 0), maximum = units.reduce((sum, u) => sum + u.maxHp, 0);
      ctx.fillStyle = '#111b19'; ctx.fillRect(x - 18 * scale, y + 28 * scale, 36 * scale, 4 * scale);
      ctx.fillStyle = '#a3c77c'; ctx.fillRect(x - 18 * scale, y + 28 * scale, 36 * scale * Math.max(0, Math.min(1, hp / (maximum || 1))), 4 * scale);
      this.markers.push({ ...marker, x, y, unitIds: units.map((u) => u.id) });
    };
    for (const party of Object.values(state.parties)) {
      const others = [...waiting.values()].some((units) => units[0].location === party.location);
      drawMarker({ kind: 'party', id: party.id, location: party.location }, party.unitIds.map((id) => state.units[id]).filter(Boolean), party.ownerId, String(party.unitIds.length), party.status === 'active', others || state.world.tiles[party.location]?.cityId ? -18 : 0);
    }
    for (const units of waiting.values()) drawMarker({ kind: 'unit', id: units[0].id, location: units[0].location }, units, units[0].ownerId, `待${units.length}`, units.some((u) => u.currentHp > 0 && u.status === 'active'), 18);
    canvas._layout = { size, center: { x: rect.width / 2 - camera.x * scale, y: rect.height / 2 - camera.y * scale } };
    this.drawMinimap(rect.width, rect.height); this.onCameraChange?.(camera);
  }
  drawMinimap(width, height) {
    const { minimap, state, camera } = this, ctx = minimap.getContext('2d');
    const scale = Math.min(minimap.width / ((state.world.radius + 1) * Math.sqrt(3) * HEX_SIZE * 2), minimap.height / ((state.world.radius * 1.5 + 1.5) * HEX_SIZE * 2));
    ctx.clearRect(0, 0, minimap.width, minimap.height);
    for (const tile of Object.values(state.world.tiles)) {
      const p = hexPosition(tile), x = minimap.width / 2 + p.x * scale, y = minimap.height / 2 + p.y * scale;
      hexPath(ctx, x, y, HEX_SIZE * scale); ctx.fillStyle = tile.ownerId ? '#cab36c' : RULESET.terrain[tile.terrainId].color; ctx.fill();
    }
    for (const unit of Object.values(state.units)) { const tile = state.world.tiles[unit.location]; if (!tile) continue; const p = hexPosition(tile); ctx.fillStyle = '#fff'; ctx.fillRect(minimap.width / 2 + p.x * scale - 2, minimap.height / 2 + p.y * scale - 2, 4, 4); }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(minimap.width / 2 + (camera.x - width / (2 * camera.zoom)) * scale, minimap.height / 2 + (camera.y - height / (2 * camera.zoom)) * scale, width / camera.zoom * scale, height / camera.zoom * scale);
    this.miniLayout = { scale };
  }
}
