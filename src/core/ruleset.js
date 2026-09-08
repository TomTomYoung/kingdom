export const RULESET_VERSION = 'm1.0';

export const RULESET = Object.freeze({
  mapRadius: 3,
  growthFoodBase: 12,
  growthFoodPerPopulation: 6,
  cultureExpansionCost: 10,
  popularSupportCap: 100,
  combat: Object.freeze({ baseDamage: 30, strengthExponent: 0.04, randomMinimum: 0.85, randomMaximum: 1.15, minimumDamage: 1, maximumDamage: 90, moraleDamageRate: 0.25 }),
  unitTypes: Object.freeze({
    warrior: Object.freeze({ scaleClass: 'detachment', maxHp: 100, meleeStrength: 20, rangedStrength: 0, magicStrength: 0, defenseStrength: 18, resistance: 5, armor: 2, range: 1, guardRate: 0, guardCapacity: 0, moraleContribution: 10, commandContribution: 5 }),
  }),
  items: Object.freeze({
    warrior: Object.freeze({ itemId: 'warrior', name: '戦士', category: 'unit', productionCost: 12, purchaseOptions: { gold: 48 } }),
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
