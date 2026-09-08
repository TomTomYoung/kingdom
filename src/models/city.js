export function createCity(ownerId, centerHex, id = 'city-1', name = '暁都') {
  return {
    id, ownerId, name, centerHex, population: 2, foodStorage: 0,
    workedTiles: [], yieldSummary: { food: 0, production: 0, gold: 0, science: 0, mana: 0, religion: 0, culture: 0 },
    lastYieldBreakdown: { tiles: [], buildings: [], total: {} }, yieldModifiers: {},
    production: { currentItemId: null, queue: [], progressByItem: {} },
    buildings: [], localCultureProgress: 0,
  };
}
