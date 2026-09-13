# Kingdom Party・Formation仕様

更新日: 2026-09-13（実装状況と文書整合性を再確認）

## 0. 現行実装との区分

本文は目標モデルです。現行実装は [CURRENT_IMPLEMENTATION.md](./CURRENT_IMPLEMENTATION.md)、未修正課題は [STATUS.md](./STATUS.md) を参照してください。コード確認基準はmain / e0dcb3fc2e6162547d7499fdd913aaaa0b9f10c7です。

CreateParty、SetFormation、MovePartyとAttackPartyを実装しています。作成Commandは同じ場所の自国未編成Unitを1〜5体に制限します。実キーはid、unitIds、formation、movementMaximum、attacksMaximumで、本文のpartyId／memberUnitIds等と同名ではありません。

UIは首都の未編成UnitからのParty作成、選択、1歩移動までです。3×3配置編集、メンバー選択編集、戦闘、分割・合流・解散、手動Leader設定、Inventory／Supplies／Expeditionは未実装です。

最大移動力は固定2、攻撃回数は1です。能力集約は平均×cohesionのみで、Leader・軍師・Formation・loyalty・補給などによる目標の相乗効果は未実装です。作成時の占有制約と敗北Partyの移動制約にも未修正課題があります。

## 1. 定義

Partyは最大5名のUnitを束ねて移動、補給、探索、戦闘する永続的な運用単位であり、それ自体を一つのUnitとして扱います。FormationはParty内部のUnit配置、役割、指揮関係です。最大5Unitを3×3 Gridへ置き、対象選択とDamage配分に使用します。

## 2. 階層

1. Unit

   人物、小隊、兵器、魔物などの最小運用単位です。Individual、Detachment、Construct、Monster、SwarmのscaleClassを持ちます。

2. Party

   Unitの集合、指揮官、Inventory、Supplies、移動状態を持ちます。

3. Formation

   構成員をFront、Middle、RearとLeft、Center、Rightからなる9Slotへ割り当てます。GridはDamage配分専用です。

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

FormationDefinitionはformationId、gridSlots、allowedRoles、requiredRoles、minMembers、maxMembers、statModifiers、targetingRules、damagePatterns、guardRules、movementModifier、retreatModifier、supplyModifier、manaCost、commandCost、prerequisitesを持ちます。

3×3 GridはDamage解決だけに使用します。Grid内距離をWorldMap Movement、Dungeon Movement、射程、行動順として扱いません。

## 7. Damage Grid

GridはFrontLeft、FrontCenter、FrontRight、MiddleLeft、MiddleCenter、MiddleRight、RearLeft、RearCenter、RearRightの9Slotです。最大5Unitを任意に配置します。

Frontは通常攻撃を優先して受けます。GuardはDamageの一部を肩代わりし、InterceptはPrimary Targetを自分へ変更し、Tauntは対象未指定攻撃を引きつけます。

攻撃側はAttack Definitionが許可する場合、Unit、Slot、Roleを指定できます。後列を直接狙う場合もCover、Guard、Accuracy、Evasion、Stealthを解決します。

Row、Column、Cross、Adjacent、All、Pierce、ChainのDamage Patternを同じGrid上で処理します。詳細は DAMAGE_GRID.md を参照してください。

## 8. 移動と維持

WorldMapのParty movementは構成Unit、Formation、地形、道路、輸送、Suppliesから算出します。初期規則では最も遅い必須Unitを基準にします。

全Party共通のactionsRemainingは持たせません。通常攻撃は一ターン一回、移動はmovementRemainingの範囲、建設と特殊能力は個別ChargeとAbilityDefinitionに従います。通常攻撃後は行動終了とし、追加攻撃や攻撃後移動は専用Abilityで許可します。

PartyはUnitごとのgold upkeep、Supplies、必要に応じてmanaと人心維持費を消費します。人心維持費は所属人物の野心、希少性、価値観、遠征環境、Leaderとの相性から算出します。Leaderのcharisma、戦勝、十分な補給、約束履行は維持費またはloyalty低下を軽減します。大規模Partyと高度FormationはCommand CapacityとGovernanceCapacityを要求します。

## 9. 戦闘

地上戦ではParty対Partyを基本とし、Partyを単一CombatUnitとして解決します。戦闘規則の正本は COMBAT_SYSTEM.md です。PartyParameterは構成員の能力を集約した後、Leader、軍師、charisma、Formation、役割充足、相性、士気、loyalty、補給、mana支援のModifierを適用します。このため、算出結果は構成Unitパラメータの単純合計を上回ることも下回ることもあります。Dungeon戦では同じPartyをSlotへ展開し、UnitごとのSkill、対象、位置、状態を詳細に扱います。

地上用とDungeon用に同じUnitを複製してはいけません。行動規則は ACTION_SYSTEM.md を参照してください。

## 10. 後続バランス調整

最大5Unit・9Slot・共有Resolverという主要な構造は確定済みです。BaseAggregationの具体式や実装上の詳細は残るため、現行の平均値を最終仕様とせず、次の数値を実装テスト後に調整します。

1. scaleClass混成時のcommandCost
2. Formationごとの具体的Modifier
3. 戦闘中RepositionのAbility Cost
4. Formation解禁に必要なscience、culture、institution、訓練値
5. 援軍参加時の次ターンPenalty
6. CriticalからDeadへ至る確率と救命難度
