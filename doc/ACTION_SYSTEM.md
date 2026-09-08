# Kingdom 行動システム仕様

更新日: 2026-09-08

仕様状態: Civ6準拠部分確定、特殊Abilityの個別数値は暫定

## 1. 基本方針

Kingdomの行動システムはCivilization VIの方式に準拠します。

全Unitへ共通の「一ターン一行動」を与える方式にはしません。移動力、攻撃回数、チャージ、個別Ability、行動後終了規則を別々に管理します。

WorldMapではPartyが行動主体です。Party内部のUnitが持つSkillやSpellを選択できますが、結果はPartyの行動として処理します。

## 2. Civ6から採用する構造

1. 移動力

   移動可能なUnitは毎ターン固有のMovement Pointsを得ます。地形、道路、河川、乗り物、状態によって進入コストが変わります。

2. 攻撃

   軍事Unitは通常一ターン一回攻撃できます。移動後でも、攻撃可能条件と残り移動力を満たせば攻撃できます。通常攻撃後はそのUnitの行動を終了します。

3. チャージ

   Builder、Great Person等の特殊行動は、毎ターン回復する行動回数ではなく、Unitが保有する有限チャージを消費します。

4. 行動固有コスト

   略奪、建設、昇進、都市建設、Ability等はそれぞれ異なる移動力、チャージ、資源、終了規則を持ちます。

5. 都市行動との分離

   都市Production、Gold等による即時購入、研究、政策変更はUnit行動枠を使いません。

## 3. 行動主体

### 3.1 WorldMap

WorldMap上の行動主体はPartyです。Partyを一つのMapUnitとして扱います。

Partyは次を持ちます。

1. movementMax
2. movementRemaining
3. attacksMax
4. attacksRemaining
5. abilityStates
6. buildCharges
7. reactionCharges
8. activationState
9. hasMoved
10. hasAttacked

従来案の汎用的なactionsRemainingは正規状態から削除します。必要な回数制限は攻撃、Ability、チャージごとに保持します。

### 3.2 Party内部Unit

Party内部Unitは個別にWorldMapを移動しません。ただし、次の情報をPartyへ提供します。

1. 移動制約
2. 攻撃方式
3. SkillとSpell
4. Build Action
5. 探索能力
6. Leader能力
7. Reaction
8. Passive Modifier

人物のSkillを使った場合も、誰が発動したかをGameEventへ記録し、Party側の移動力、攻撃回数、mana、Ability Charge等を消費します。

### 3.3 単独Unit

Party未編成の冒険者、魔物、Settler、Builder等は、memberUnitIdsが一件以下のPartyまたはSinglePartyとして扱います。WorldMap用ルールを二重実装しません。

## 4. ターン開始時リセット

TURN_STARTで次を処理します。

1. movementRemainingをmovementMaxの算出値へ戻す。
2. attacksRemainingをattacksMaxの算出値へ戻す。
3. turnRecharge対象Abilityを回復する。
4. reactionChargesを回復する。
5. hasMovedとhasAttackedをfalseへ戻す。
6. activationStateをREADYへ戻す。
7. 継続不能、気絶、拘束、補給切れ等のModifierを適用する。

有限のbuildCharges、Great Person相当のAbility Charge、消耗品は自動回復しません。

## 5. 移動

移動先タイルへ入るため、原則として進入コスト以上のmovementRemainingが必要です。

進入コストには次を反映します。

1. Terrain
2. Feature
3. River Edge
4. Road
5. Zone of Control
6. Formation
7. 最も遅い必須構成員
8. Transport
9. Supplies
10. Status Effect

通常移動では次の式を使います。

```text
movementRemainingNext =
  movementRemainingCurrent
  - effectiveEntryCost
```

最大移動力そのものより高い進入コストを持つ地形については、進入可能能力を持ち、ターン開始時から移動していない場合に限って全移動力を消費して進入できる例外をRulesetへ定義できます。

敵Zone of Control内から別の敵Zone of Control内へ移動した場合は、原則として残り移動力を失います。ignoreZoneOfControl等のAbilityで例外化できます。

## 6. 標準行動

### 6.1 Move

指定経路に沿って移動します。各Hex進入時にmovementRemainingを消費します。残り移動力があれば続けて移動または別行動を選択できます。

### 6.2 MeleeAttack

攻撃対象のHexへ進入可能で、attacksRemainingが一以上である場合に実行できます。

通常はattacksRemainingを一消費し、攻撃解決後にactivationStateをENDEDとします。勝利して対象Hexへ前進する場合も同じ攻撃内で処理します。

### 6.3 RangedAttack

射程、視線、対象条件を満たす場合に実行できます。通常はattacksRemainingを一消費し、攻撃後にactivationStateをENDEDとします。

追加攻撃、攻撃後移動、移動後射撃禁止等はAbilityで変更します。

### 6.4 Pillage

改善、District、Building相当を略奪します。Civ6準拠の標準値としてMovement Costを3とし、残り移動力が3未満なら残り全量を消費します。

略奪対象を使用不能にし、対象定義に応じたGold、food、mana、回復、その他Yieldを得ます。略奪後にmovementRemainingが残り、他の終了条件に該当しなければ行動を継続できます。

### 6.5 Fortify

現在地で防御態勢を取ってactivationStateをENDEDにします。移動または別行動によってFortify状態を解除します。連続ターン維持による防御BonusをRulesetへ定義できます。

### 6.6 Wait、Skip、Sleep

Waitは同一ターン内のUnit選択順を後回しにし、READYを維持します。

Skipはそのターンの行動を明示的に終了します。

Sleepは敵接近、Damage、資源不足、命令等のWake Conditionまで自動でSkipします。

## 7. 民間・特殊行動

### 7.1 FoundCity

Settler相当のPartyが合法なHexで実行します。都市を即時成立させ、実行UnitまたはPartyを消費します。都市Production枠は使いません。

### 7.2 BuildImprovement

Builder相当のAbilityが、合法なHexでbuildChargesを一消費して改善を即時完成させます。標準ではactivationStateをENDEDにします。

buildChargesが0になったUnitは消費されます。ただし修理等、チャージを消費しないBuild Actionを定義できます。

### 7.3 RepairImprovement

破壊された改善を修理します。標準では一ターンの行動を終了しますが、buildChargesは消費しません。

### 7.4 Promote

必要XPを満たしたPartyまたはUnitがPromotionを選択します。HPの一部を回復し、そのターンの行動を終了します。

Party Promotionと構成員個人のPromotionは別に保存します。

### 7.5 Upgrade

Gold、戦略資源、技術条件を満たす場合、都市等の合法地点で上位Definitionへ更新します。標準ではそのターンの行動を終了します。

### 7.6 ActiveAbility

AbilityDefinitionが次を宣言します。

1. movementCost
2. attackCost
3. chargeCost
4. manaCost
5. goldCost
6. requiredState
7. targetRule
8. endsActivation
9. cooldown
10. rechargeRule

Skill、Spell、探索、罠解除、説得、Recruitment、転移等を同じAbility実行基盤へ載せます。

## 8. Partyへの適用

PartyのmovementMaxは構成員の単純平均ではなく、Formationに参加する最も遅い必須構成員を基準にします。輸送、騎乗、Leader、道路、Spellで補正できます。

PartyのattacksMaxは標準一回です。複数の攻撃役がいても自動的に人数分攻撃できません。連撃Formation、軍師能力、特殊Unit等が明示的にattacksMaxまたは追加攻撃条件を増やします。

Party内部UnitのAbilityを使う場合、そのUnitが気絶、死亡、離脱、後列封鎖等で使用不能なら選択できません。

高いcharismaや軍師能力はPartyParameterを上げられますが、通常は行動回数を直接増やしません。行動回数増加は専用Abilityとして明示します。

## 9. Dungeonへの適用

DungeonでもPartyを一つのCombatUnitとして扱い、同じmovementRemaining、attacksRemaining、AbilityDefinitionを使用します。

WorldMapとの差は次です。

1. 一Hexの距離が短い。
2. Formation Slotと対象選択を詳細表示する。
3. 構成員由来のSkillを多く公開する。
4. Trap、Door、Chest、InteractableへAbilityを使う。
5. Dungeon固有のdungeonMovementModifierを適用する。

Dungeon専用の別Unitコピーや別行動エンジンは作りません。

## 10. 都市・国家行動

次はPartyのactivationStateを消費しません。

1. City Productionの選択とQueue変更
2. Gold、mana等による合法な即時購入
3. Tile購入
4. 市民配置
5. 研究と制度の選択
6. 政策変更
7. 外交提案
8. 人心の維持優先度設定
9. Party編成変更

ただしParty編成変更は、戦闘中、敵Zone of Control内、Dungeon探索中等では禁止または専用コストを要求できます。

## 11. Occupancy

Civ6のOne Unit Per Tileを基礎に、WorldMapの一Hexへ同一陣営の主戦闘Partyを一つだけ配置します。

Civilian、Support、Escortについては、主戦闘Partyへ同行状態として結合できます。同行Entityは独立Tokenとして同一Hexを占有せず、護衛Partyの移動へ追従します。

敵対するParty同士は同一Hexに共存できません。MeleeAttackによる撃破、撤退、占領を解決してから進入します。

## 12. Command

最低限、次を実装します。

1. MoveParty
2. MeleeAttack
3. RangedAttack
4. UseAbility
5. Pillage
6. Fortify
7. WaitParty
8. SkipParty
9. SleepParty
10. FoundCity
11. BuildImprovement
12. RepairImprovement
13. PromoteUnit
14. PromoteParty
15. UpgradeUnit

Commandの合法性判定と実行はHuman、AI、Remote Controllerで共通化します。

## 13. 受入条件

1. Unit種別ごとにmovementMaxが異なる。
2. TURN_STARTで移動力と攻撃回数が一度だけ回復する。
3. 地形進入コスト不足なら移動できない。
4. 移動後も条件を満たせば攻撃できる。
5. 通常攻撃後は行動終了となる。
6. 追加攻撃Abilityがある場合だけ一ターン複数回攻撃できる。
7. Pillageは標準3 Movement、または残り全Movementを消費する。
8. BuildImprovementはチャージを一消費する。
9. buildChargesはTURN_STARTで回復しない。
10. FoundCityはSettler相当Entityを消費する。
11. City Productionと即時購入はParty行動を消費しない。
12. Party内部Unitを個別にWorldMap移動させない。
13. HumanとAIが同じ合法Command一覧を得る。
14. 同じGameStateとCommand列から同じ結果を再現できる。
