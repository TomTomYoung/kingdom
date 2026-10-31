import { RULESET } from '../core/ruleset.js';
import { selectResearch } from '../core/commands.js';

export const hasResearch = state => state.researchVersion === 1;
export const createResearch = () => ({ currentTechnologyId: null, progressByTechnology: {}, completedTechnologyIds: [] });
const own = (records, id) => typeof id === 'string' && Object.hasOwn(records, id);
const definition = id => own(RULESET.technologies, id) ? RULESET.technologies[id] : null;

// The existing cumulative science is the sole source of funding. No second
// stockpile or per-city research collection is introduced. Spent science remains
// part of that historical total (and of the existing military-power formula).
export function unassignedScience(kingdom) {
  const research = kingdom.research;
  if (!research) return 0;
  const completed = research.completedTechnologyIds.reduce((n, id) => n + RULESET.technologies[id].scienceCost, 0);
  return Math.max(0, kingdom.progress.science - completed - Object.values(research.progressByTechnology).reduce((n, amount) => n + amount, 0));
}

export function researchSelectionError(state, playerId, technologyId) {
  if (!hasResearch(state)) return 'この保存では研究は利用できません。新規開始してください。';
  const kingdom = own(state.kingdoms, playerId) && state.kingdoms[playerId];
  if (!kingdom?.research) return '研究を操作できる王国がありません。';
  if (technologyId === null) return null;
  const tech = definition(technologyId);
  if (!tech) return '不明な研究対象です。';
  if (kingdom.research.completedTechnologyIds.includes(technologyId)) return '研究済みの技術です。';
  const missing = tech.prerequisites.filter(id => !kingdom.research.completedTechnologyIds.includes(id));
  return missing.length ? `前提研究が必要です: ${missing.map(id => RULESET.technologies[id].name).join('、')}` : null;
}

export function itemResearchError(state, playerId, itemId) {
  const required = own(RULESET.items, itemId) && RULESET.items[itemId].requiredTechnology;
  if (!required) return null;
  if (!hasResearch(state)) return 'この施設は研究対応の新規対局で利用できます。';
  return own(state.kingdoms, playerId) && state.kingdoms[playerId].research?.completedTechnologyIds.includes(required)
    ? null : `研究「${RULESET.technologies[required].name}」が必要です。`;
}

export function resolveSelectResearch(state, playerId, technologyId, events) {
  const reason = researchSelectionError(state, playerId, technologyId);
  if (reason) return reason;
  const research = state.kingdoms[playerId].research;
  if (research.currentTechnologyId === technologyId) return '既に同じ研究設定です。';
  research.currentTechnologyId = technologyId;
  events.push({ type: 'ResearchSelected', kingdomId: playerId, technologyId });
  return null;
}

// Called once per kingdom, after all its cities have collected this round.
// Completion does not select another topic or grant a free building. Excess
// funding remains unassigned and is applied at a later round boundary.
export function applyResearch(state, kingdom, events) {
  if (!hasResearch(state) || !kingdom.research.currentTechnologyId) return;
  const research = kingdom.research, technologyId = research.currentTechnologyId;
  const tech = RULESET.technologies[technologyId], old = research.progressByTechnology[technologyId] ?? 0;
  const amount = Math.min(unassignedScience(kingdom), tech.scienceCost - old);
  if (amount <= 0) return;
  const progress = old + amount;
  research.progressByTechnology[technologyId] = progress;
  events.push({ type: 'ResearchProgressed', kingdomId: kingdom.id, technologyId, amount, progress });
  if (progress >= tech.scienceCost) {
    research.completedTechnologyIds.push(technologyId);
    research.progressByTechnology[technologyId] = 0;
    research.currentTechnologyId = null;
    events.push({ type: 'TechnologyCompleted', kingdomId: kingdom.id, technologyId, unlocks: [...tech.unlocks] });
  }
}

export function chooseResearchCommand(state, playerId, commandId) {
  if (!hasResearch(state) || state.kingdoms[playerId]?.research.currentTechnologyId !== null) return null;
  // Fixed order, no future RNG inspection, never replaces a pending research.
  const technologyId = Object.keys(RULESET.technologies).find(id => !researchSelectionError(state, playerId, id));
  return technologyId ? selectResearch(playerId, state.currentTurn, technologyId, commandId) : null;
}

// A read-only display estimate, in full-round starts, not human/AI handoffs.
export function researchForecast(kingdom, state, technologyId = kingdom.research?.currentTechnologyId) {
  const tech = definition(technologyId);
  if (!tech || !hasResearch(state)) return null;
  const progress = kingdom.research.progressByTechnology[technologyId] ?? 0;
  const rate = kingdom.cityIds.reduce((n, id) => n + state.cities[id].yieldSummary.science, 0);
  const remaining = Math.max(0, tech.scienceCost - progress - unassignedScience(kingdom));
  return { progress, cost: tech.scienceCost, rate, turns: remaining === 0 ? 1 : rate > 0 ? Math.max(1, Math.ceil(remaining / rate)) : null };
}

export function validateResearchSave(state) {
  const fail = detail => { throw new Error(`セーブデータが不正です: research.${detail}`); };
  const assert = (ok, detail) => { if (!ok) fail(detail); };
  const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const enabled = Object.hasOwn(state, 'researchVersion');
  if (enabled) assert(state.researchVersion === 1, 'version');
  for (const kingdom of Object.values(state.kingdoms)) {
    if (!enabled) { assert(!Object.hasOwn(kingdom, 'research'), '版なしの研究データ'); continue; }
    const r = kingdom.research;
    assert(record(r), `${kingdom.id}.missing`);
    assert(record(r.progressByTechnology) && Array.isArray(r.completedTechnologyIds), 'structure');
    assert(new Set(r.completedTechnologyIds).size === r.completedTechnologyIds.length, 'duplicate completion');
    let allocated = 0;
    for (const id of r.completedTechnologyIds) {
      const tech = definition(id); assert(tech, 'unknown completion');
      assert(tech.prerequisites.every(p => r.completedTechnologyIds.includes(p)), 'completion prerequisites');
      allocated += tech.scienceCost;
    }
    for (const [id, amount] of Object.entries(r.progressByTechnology)) {
      const tech = definition(id); assert(tech, 'unknown progress');
      assert(Number.isFinite(amount) && amount >= 0 && amount < tech.scienceCost, 'progress bounds');
      assert(!r.completedTechnologyIds.includes(id) || amount === 0, 'completed progress must be zero');
      assert(amount === 0 || tech.prerequisites.every(p => r.completedTechnologyIds.includes(p)), 'progress prerequisites');
      allocated += amount;
    }
    // Decimal yield modifiers can change the last bits when per-topic sums
    // are regrouped. Permit only sub-billionth numerical roundoff, not credit.
    assert(allocated <= kingdom.progress.science + 1e-9, 'science allocated more than collected');
    assert(r.currentTechnologyId === null || !!definition(r.currentTechnologyId), 'current target');
    if (r.currentTechnologyId !== null) assert(!researchSelectionError(state, kingdom.id, r.currentTechnologyId), 'current target prerequisites/completion');
  }
  for (const city of Object.values(state.cities)) {
    // Captured buildings retain their yields, but not their original owner's
    // technology. Capture already clears production and partial work.
    if (!enabled) assert(!city.buildings.some(id => RULESET.items[id].requiredTechnology), 'building without version');
    const orders = [city.production.currentItemId, ...city.production.queue, ...Object.keys(city.production.progressByItem)];
    for (const id of orders) assert(!itemResearchError(state, city.ownerId, id), `${city.id}.locked production`);
  }
  if (!enabled) {
    assert(!state.commandLog.some(c => c.type === 'SelectResearch'), 'command without version');
    assert(!state.eventLog.some(e => ['ResearchSelected', 'ResearchProgressed', 'TechnologyCompleted'].includes(e.type)), 'event without version');
  }
}
