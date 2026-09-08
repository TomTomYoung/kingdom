export function createKingdom(id = 'kingdom-1', name = '黎明王国', cityIds = ['city-1'], controllerType = 'human') {
  return {
    id, name, controllerType, cityIds, unitIds: [],
    stockpiles: { gold: 100, mana: 0, popularSupport: 30 },
    progress: { science: 0, culture: 0 },
    humanResources: { native: 1, military: 0, governance: 1, specialists: 0, heroes: 0, affiliates: 0, migrants: 0 },
    institutions: 1, supportIncome: 1, supportUpkeep: 0,
    derived: { militaryPower: 0, governanceCapacity: 0, governanceLoad: 0 },
  };
}

export function updateDerivedCapabilities(kingdom, state) {
  const cities = kingdom.cityIds.map((id) => state.cities[id]);
  const production = cities.reduce((sum, city) => sum + city.yieldSummary.production, 0);
  const buildings = cities.reduce((sum, city) => sum + city.buildings.length, 0);
  const population = cities.reduce((sum, city) => sum + city.population, 0);
  const territory = Object.values(state.world.tiles).filter((tile) => tile.ownerId === kingdom.id).length;
  kingdom.derived.militaryPower = Math.floor(kingdom.progress.science / 5) + production + Math.floor(kingdom.stockpiles.gold / 25) + Math.floor(kingdom.stockpiles.mana / 5) + kingdom.humanResources.military * 2 + kingdom.unitIds.length * 4;
  kingdom.derived.governanceCapacity = Math.floor(kingdom.progress.culture / 5) + kingdom.institutions * 3 + kingdom.humanResources.governance * 2 + buildings;
  kingdom.derived.governanceLoad = territory + cities.length * 2 + population + buildings;
}
