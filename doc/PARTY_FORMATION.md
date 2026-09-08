# Kingdom Party・Formation仕様

更新日: 2026-09-08

## 1. 定義

Partyは最大5名のUnitを束ねて移動、補給、探索、戦闘する永続的な運用単位であり、それ自体を一つのUnitとして扱います。FormationはParty内部のUnit配置、役割、指揮関係です。

## 2. 階層

1. Unit

   人物、小隊、兵器、魔物などの最小運用単位です。

2. Party

   Unitの集合、指揮官、Inventory、Supplies、移動状態を持ちます。

3. Formation

   構成員をFront、Center、Rear、Support、Reserveへ割り当てます。

WorldMapではPartyを一つのTokenとして扱い、戦闘またはDungeonでFormationを展開します。

## 3. Partyデータ

partyId、ownerId、partyType、leaderUnitId、memberUnitIds、formationId、location、mode、movementMax、movementRemaining、attacksMax、attacksRemaining、abilityStates、buildCharges、reactionCharges、activationState、commandCapacity、supplies、inventory、carriedLoot、morale、loyalty、supportUpkeep、statusEffects、expeditionIdを持ちます。memberUnitIdsは0から5件とし、6件目の加入を拒否します。

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

全Party共通のactionsRemainingは持たせません。通常攻撃は一ターン一回、移動はmovementRemainingの範囲、建設と特殊能力は個別ChargeとAbilityDefinitionに従います。通常攻撃後は行動終了とし、追加攻撃や攻撃後移動は専用Abilityで許可します。

PartyはUnitごとのgold upkeep、Supplies、必要に応じてmanaと人心維持費を消費します。人心維持費は所属人物の野心、希少性、価値観、遠征環境、Leaderとの相性から算出します。Leaderのcharisma、戦勝、十分な補給、約束履行は維持費またはloyalty低下を軽減します。大規模Partyと高度FormationはCommand CapacityとGovernanceCapacityを要求します。

## 9. 戦闘

地上戦ではParty対Partyを基本とし、Partyを単一CombatUnitとして解決します。PartyParameterは構成員の能力を集約した後、Leader、軍師、charisma、Formation、役割充足、相性、士気、loyalty、補給、mana支援のModifierを適用します。このため、算出結果は構成Unitパラメータの単純合計を上回ることも下回ることもあります。Dungeon戦では同じPartyをSlotへ展開し、UnitごとのSkill、対象、位置、状態を詳細に扱います。

地上用とDungeon用に同じUnitを複製してはいけません。行動規則は ACTION_SYSTEM.md を参照してください。

## 10. 未確定事項

2. ArmyとExpeditionの最大人数差
3. Unitが個人か小隊か
4. Slotの二次元配置
5. 戦闘中のFormation変更コスト
6. Leader死亡時の処理
7. 複数Partyによる共同戦闘
8. 同一タイルのParty上限
9. 捕虜、負傷者、予備兵
10. Formation習得条件
