# Kingdom 資源・軍事力・統治力仕様

更新日: 2026-09-08

## 1. 三層構造

Kingdomの資源体系は、軍事力、統治力、人的資源の三層で捉えます。MilitaryPowerとGovernanceCapacityは支払う単一資源ではなく、Yield、備蓄、施設、Unit、人員、制度から算出します。

## 2. MilitaryPower

1. scienceがUnit、装備、魔法、Formation、兵站を解禁します。
2. productionがそれらを製造します。
3. goldが即時取得、維持、雇用、補給、開発加速を担います。
4. manaが魔法Unit、Spell、魔導装備、Dungeon機構を動かします。
5. militaryHumanResourcesがUnit、Party、指揮官として配置されます。
6. LogisticsCapacityが遠方での継戦期間を決めます。

どれか一つだけ高くても最大軍事力は発揮できません。

## 3. GovernanceCapacity

GovernanceCapacityはreligion、culture、institutions、governanceHumanResources、統治施設から算出します。

GovernanceLoadは領土、都市、District、Building、人口、Party、占領地、未統合人口、遠隔地から発生します。

Capacity不足は段階的に、維持費上昇、Yield低下、命令遅延、補給悪化、離反、反乱、領土喪失を発生させます。

## 4. 人的資源

HumanResourceは総人口と同一ではありません。

1. nativePopulation
2. manpower
3. specialistPool
4. governancePool
5. heroPool
6. externalAffiliatePool
7. migrantPool

人材にはoriginKingdomId、residenceKingdomId、cultureId、religionId、loyalty、profession、statusを持たせます。

## 5. food

foodは都市人口を成長させます。人口が教育、徴募、職業訓練、宗教組織、文化制度を経てHumanPoolへ移ります。

緊急徴兵は即時性を持つ代わりに、生産、食料、忠誠、将来成長へPenaltyを与えます。

## 6. religion

religionは信徒共同体、正統性、結束、奉仕組織を形成します。GovernanceCapacity、士気、占領地統合、国外Affiliate、宗教的人材、RelicとDungeon作用へ使います。独立勝利はありません。

## 7. culture

cultureは制度、言語、教育、威信、生活様式への求心力です。GovernanceCapacity、領土維持、専門家や英雄のAttraction、占領地統合、Formationと制度の解禁へ使います。独立勝利はありません。

## 8. 国外人材獲得

国外人材はExposure、Affiliation、Availability、Recruitment、Integrationの段階を通ります。

他国居住のまま信徒や文化的支持者となる場合と、自国へ移住する場合を分けます。相手国は政策、文化、宗教、国境、諜報、融和によって抵抗できます。

## 9. mana

manaは魔力地形、Dungeon、魔石、魔法施設、Unit能力、Relic、儀式から得ます。

Spell、魔法Unitの生産と維持、魔導装備、召喚、Dungeon封印、転移、探知、魔法研究、Formation支援へ使います。初期段階ではKingdomStockpileとします。

## 10. 実装原則

1. 資源キーは英語名に統一します。
2. CapacityとLoadの内訳をUIへ表示します。
3. HumanResourceの発生、移動、登用をGameEventへ残します。
4. AIは人間と同じ資源と人材規則を使います。
5. 難易度補正は明示的Modifierにします。
6. religion、culture、scienceを勝利ゲージにしません。
7. 数式と係数はRulesetへ置きます。
