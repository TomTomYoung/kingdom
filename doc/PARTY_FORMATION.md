# Kingdom Party・Formation仕様

更新日: 2026-09-08

## 1. 定義

Partyは複数Unitを束ねて移動、補給、探索、戦闘する永続的な運用単位です。FormationはParty内部のUnit配置、役割、指揮関係です。

## 2. 階層

1. Unit

   人物、小隊、兵器、魔物などの最小運用単位です。

2. Party

   Unitの集合、指揮官、Inventory、Supplies、移動状態を持ちます。

3. Formation

   構成員をFront、Center、Rear、Support、Reserveへ割り当てます。

WorldMapではPartyを一つのTokenとして扱い、戦闘またはDungeonでFormationを展開します。

## 3. Partyデータ

partyId、ownerId、partyType、leaderUnitId、memberUnitIds、formationId、location、mode、movementRemaining、actionsRemaining、commandCapacity、supplies、inventory、carriedLoot、morale、statusEffects、expeditionIdを持ちます。

## 4. Party操作

CreateParty、DisbandParty、AddUnitToParty、RemoveUnitFromParty、SplitParty、MergeParties、SetLeader、SetFormation、MoveParty、EnterDungeon、ExitDungeon、ResupplyPartyをCommandとして実装します。

## 5. Party種別

1. Army Party
2. Expedition Party
3. Scout Party
4. Convoy Party
5. Religious Mission
6. Cultural Mission

種別ごとに許可Unit、行動、維持、Formation、目的をRulesetで変えます。

## 6. Formation

FormationDefinitionはformationId、slotLayout、allowedRoles、requiredRoles、minMembers、maxMembers、statModifiers、targetingRules、damageDistribution、movementModifier、retreatModifier、supplyModifier、manaCost、commandCost、prerequisitesを持ちます。

## 7. Slot

1. Front
2. Center
3. Rear
4. Support
5. Reserve

Formationによって後列保護、遠距離攻撃、魔法増幅、罠発見、運搬、攻城、撤退、被害分配が変わります。

## 8. 移動と維持

WorldMapのParty movementは構成Unit、Formation、地形、道路、輸送、Suppliesから算出します。初期規則では最も遅い必須Unitを基準にします。

PartyはUnitごとのgold upkeep、Supplies、必要に応じてmanaを消費します。大規模Partyと高度FormationはCommand CapacityとGovernanceCapacityを要求します。

## 9. 戦闘

地上戦ではParty対Partyを基本とし、Formation効果を集約します。Dungeon戦では同じPartyをSlotへ展開し、UnitごとのSkill、対象、位置、状態を詳細に扱います。

地上用とDungeon用に同じUnitを複製してはいけません。

## 10. 未確定事項

1. Partyの標準人数
2. ArmyとExpeditionの最大人数差
3. Unitが個人か小隊か
4. Slotの二次元配置
5. 戦闘中のFormation変更コスト
6. Leader死亡時の処理
7. 複数Partyによる共同戦闘
8. 同一タイルのParty上限
9. 捕虜、負傷者、予備兵
10. Formation習得条件
