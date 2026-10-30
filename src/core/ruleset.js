export const RULESET_VERSION = 'm1.0';

export const RULESET = Object.freeze({
  mapRadius: 10,
  partyRecovery: Object.freeze({ fieldHp: 20, cityHp: 30, threatRange: 1, aiRestHpRatio: 0.5 }),
  cityDefense: Object.freeze({ maximumHp: 100, wallHp: 60, strength: 20, recoveryHp: 10, recoveryWallHp: 5, capturedHp: 25, ballistaWallBonus: 0.5, counterStrength: 20, counterattacksPerRound: 1 }),
  aiRecruitment: Object.freeze({ maxCombatUnits: 15, goldReserve: 24, purchasesPerCityPerTurn: 1, composition: Object.freeze({ warrior: 2, archer: 2, ballista: 1 }) }),
  aiCityDefense: Object.freeze({ minimumCombatUnits: 5, threatRange: 3 }),
  founding: Object.freeze({ minimumCityDistance: 4, minimumMovement: 1, initialPopulation: 1, terrainIds: Object.freeze(['plains', 'grassland', 'forest', 'hills', 'arcane']) }),
  growthFoodBase: 12,
  growthFoodPerPopulation: 6,
  cultureExpansionCost: 10,
  popularSupportCap: 100,
  combat: Object.freeze({ baseDamage: 30, strengthExponent: 0.04, randomMinimum: 0.85, randomMaximum: 1.15, minimumDamage: 1, maximumDamage: 90, moraleDamageRate: 0.25 }),
  unitTypes: Object.freeze({
    settler: Object.freeze({ civilian: true, scaleClass: 'detachment', maxHp: 100, meleeStrength: 0, rangedStrength: 0, magicStrength: 0, defenseStrength: 5, resistance: 0, armor: 0, range: 0, guardRate: 0, guardCapacity: 0, guardRange: 0, moraleContribution: 0, commandContribution: 0, accuracy: 1, evasion: 0, tauntStrength: 0, coverPower: 0 }),
    warrior: Object.freeze({ scaleClass: 'detachment', maxHp: 100, meleeStrength: 20, rangedStrength: 0, magicStrength: 0, defenseStrength: 18, resistance: 5, armor: 2, range: 1, guardRate: 0.5, guardCapacity: 50, guardRange: 1, moraleContribution: 10, commandContribution: 5, accuracy: 1, evasion: 0, tauntStrength: 0.15, coverPower: 0.25 }),
    archer: Object.freeze({ scaleClass: 'detachment', maxHp: 100, meleeStrength: 10, rangedStrength: 22, magicStrength: 0, defenseStrength: 12, resistance: 5, armor: 1, range: 2, guardRate: 0, guardCapacity: 0, guardRange: 0, moraleContribution: 8, commandContribution: 3, accuracy: 0.9, evasion: 0.05, tauntStrength: 0, coverPower: 0.1 }),
    ballista: Object.freeze({ scaleClass: 'construct', maxHp: 100, meleeStrength: 8, rangedStrength: 25, magicStrength: 0, defenseStrength: 10, resistance: 3, armor: 2, range: 3, guardRate: 0, guardCapacity: 0, guardRange: 0, moraleContribution: 6, commandContribution: 2, accuracy: 0.85, evasion: 0, tauntStrength: 0, coverPower: 0 }),
  }),
  items: Object.freeze({
    settler: Object.freeze({ itemId: 'settler', name: '開拓者', category: 'unit', productionCost: 30, purchaseOptions: { gold: 120 } }),
    warrior: Object.freeze({ itemId: 'warrior', name: '戦士', category: 'unit', productionCost: 12, purchaseOptions: { gold: 48 } }),
    archer: Object.freeze({ itemId: 'archer', name: '弓兵', category: 'unit', productionCost: 18, purchaseOptions: { gold: 72 } }),
    ballista: Object.freeze({ itemId: 'ballista', name: '弩砲', category: 'unit', productionCost: 28, purchaseOptions: { gold: 112 } }),
    walls: Object.freeze({ itemId: 'walls', name: '城壁', category: 'building', productionCost: 30, purchaseOptions: { gold: 120 } }),
    monument: Object.freeze({ itemId: 'monument', name: 'モニュメント', category: 'building', productionCost: 20, purchaseOptions: { gold: 80 } }),
  }),
  terrain: Object.freeze({
    plains: { name: '平原', color: '#9aad62', yields: { food: 1, production: 2, gold: 0, science: 0, mana: 0, religion: 0, culture: 0 } },
    grassland: { name: '草原', color: '#5d9b58', yields: { food: 2, production: 1, gold: 0, science: 0, mana: 0, religion: 0, culture: 0 } },
    forest: { name: '森林', color: '#34734c', yields: { food: 1, production: 2, gold: 0, science: 0, mana: 0, religion: 0, culture: 1 } },
    hills: { name: '丘陵', color: '#a27b52', yields: { food: 0, production: 3, gold: 1, science: 0, mana: 0, religion: 0, culture: 0 } },
    arcane: { name: '霊脈', color: '#7655aa', yields: { food: 1, production: 0, gold: 0, science: 1, mana: 2, religion: 1, culture: 0 } },
    void: { name: '虚無', color: '#20202b', yields: { food: 0, production: 0, gold: 0, science: 0, mana: 0, religion: 0, culture: 0 } },
  }),
});
