# Kingdom 戦闘システム仕様

更新日: 2026-10-17（第2段階の実装状況を反映）

仕様状態: 基本構造確定、バランス係数はRulesetで調整可能

## 0. 現行実装との区分

本文は目標仕様です。現行差分の詳細は [CURRENT_IMPLEMENTATION.md](./CURRENT_IMPLEMENTATION.md)、未修正課題は [STATUS.md](./STATUS.md) に記録します。開始基準はmain / a9e66eaad5290c366c96eeacd07b1fce497b5dee。第2段階の差分を含みます。

現在はsrc/systems/combat-system.jsのcore APIで、melee／rangedの単体Damage、seed乱数、armor減算、近接反撃、HP0、morale減少、Leader継承を処理します。44テスト中6件がcombat.test.jsです。通常画面に攻撃UIと敵王国セットアップはありません。

戦闘力は生存Unit能力の平均×cohesion補正のみです。対象はfront→middle→rear、各行center→left→rightの最初の一体です。全目標Modifierや列単位露出を実装したものではありません。

HP0はindividualのみdowned、それ以外は一律shatteredです。継承はcommandContribution降順・ID昇順で選び、継承者なしならdefeatedです。successorPriority、Command Check、morale 0の撤退、回復、死傷者・捕虜・Loot、Construct／Monster等の固有遷移は未実装です。

Guard容量は保存・回復だけで、Guard、Intercept、Taunt、Cover、狙撃、範囲・貫通、Resistance／Barrier、Spell、Status Effect、援軍、戦闘予測は未実装です。遠隔能力0の攻撃は拒否するよう修正済みです。遠隔戦闘力は対象へ届く戦闘可能Unitだけを集約します。

## 1. 基本原則

戦闘はParty対Partyを基本とします。PartyParameterから攻撃結果を計算し、3×3 Damage Gridで最大5UnitへDamageを配分します。

WorldMap戦闘とDungeon戦闘は同じUnit、Party、HP、Combat Resolverを使います。表示と操作の詳細度だけを変えます。

## 2. Unitの尺度

Unitは一つの戦闘要素であり、scaleClassを持ちます。

1. Individual

   英雄、冒険者、指揮官等の個人です。

2. Detachment

   歩兵隊、弓兵隊、騎兵隊等の部隊です。

3. Construct

   攻城兵器、ゴーレム、魔導機械等です。

4. Monster

   単体で戦闘要素となる魔物です。

5. Swarm

   小型魔物群、召喚群、群体等です。

Expedition PartyはIndividual中心、Army PartyはDetachment中心です。英雄や指揮官をArmy Partyへ加える混成も許可します。Party最大枠はscaleClassにかかわらず5とし、規模差はcommandCost、supplies、upkeep、Formation条件へ反映します。

## 3. パラメータ

UnitはmaxHp、currentHp、meleeStrength、rangedStrength、magicStrength、defenseStrength、resistance、range、accuracy、evasion、armor、moraleContribution、commandContribution、scaleClass、statusEffectsを持ちます。標準maxHpは100です。

Partyは構成UnitからattackStrength、defenseStrength、rangedStrength、magicStrength、morale、cohesion、formationIntegrity、commandQuality、supplyModifier、activeAbilitiesを算出します。

PartyPowerの基本構造は次です。

```text
PartyPower =
  BaseAggregation
  × FormationModifier
  × CommandModifier
  × CohesionModifier
  × SupplyModifier
  × TerrainModifier
  + AbilityBonus
```

各乗算Modifierの通常範囲は0.5から1.5、総合倍率は原則0.25から2.0へ制限します。

## 4. 基礎Damage

Civ6型の戦闘力差による指数倍率を採用します。

```text
StrengthDifference = AttackStrength - DefenseStrength

RawDamage =
  30
  × exp(0.04 × StrengthDifference)
  × RandomModifier
  × SkillModifier
```

RandomModifierの標準範囲は0.85から1.15です。戦闘用seed付きRNGから取得します。

通常攻撃の基礎Damageは1から90へ制限します。Execute、即死、Boss Mechanic等だけが専用Tagで上限を変更できます。Armor、Resistance、Barrier、Guardは対象Unitへの配分後に適用します。

## 5. 命中

通常のMelee AttackとRanged Attackは合法な対象へ原則命中します。恒常的なMiss判定は設けません。

完全回避はDodge、Illusion、Stealth、Parry、Blink、Invulnerable、Targeted AttackのAccuracy失敗等、明示的なAbilityまたは状態だけで発生します。

AccuracyとEvasionは後列狙撃、Cover越し射撃、Stealth対象、特殊部位攻撃へ使います。

## 6. 反撃

Melee Attackでは攻撃側がDamageを与え、防御側が戦闘可能なら同じ解決内で反撃Damageを与えます。標準反撃はreactionChargesを消費しません。

防御側がDowned、反撃不能状態、射程外、または攻撃がnoCounter Tagを持つ場合は反撃しません。Ranged Attackと通常Spellにも標準反撃はありません。

Counter Stance、Opportunity Attack、Guard Counter、Intercept Attackは別のReactionとしてreactionChargesを消費します。

## 7. 3×3 Damage Grid

Gridの詳細は DAMAGE_GRID.md を正本とします。

GridはPrimary Target、Guard、Intercept、Taunt、Cover、範囲、貫通、狙撃にだけ使います。移動距離、行動順、攻撃回数には使いません。

正面通常攻撃はFrontを優先します。前列が空いても自動で前へ詰めず、その列の後方Unitを露出させます。

## 8. Guard制限

UnitはguardCapacityMaxとguardCapacityRemainingを持ちます。

```text
guardCapacityMax =
  maxHp × 0.5
  + shieldCapacity
  + abilityBonus
```

guardCapacityRemainingはTURN_STARTで回復し、肩代わりしたDamageと同量を消費します。一回の標準Guard上限は元Damageの70％です。完全Guardは専用Abilityだけが可能です。

InterceptはPrimary Targetを自分へ置き換え、通常reactionChargesを一消費します。

複数候補は、専属Guard、interceptPriority、Ability Priority、Relationship、Slot距離、entityId昇順で一体を選びます。一つの攻撃にGuardを連鎖適用しません。

## 9. Targeted Attack

Attack Definitionが許可する場合、攻撃側はUnit、Slot、Role、Marked Target等を指定できます。

後列TargetにはAccuracy、Cover、Guard、Intercept、Evasion、Stealth、targetingVisibilityを適用します。

狙い撃ち失敗時はAttack Tagで処理します。

1. Precise

   Missになります。

2. Projectile

   Coverした前衛または遮蔽物へ命中します。

3. Area

   指定Slot周辺へ着弾します。

4. Homing

   条件を満たす別Targetへ補正されます。

未発見またはStealth中のUnitを名前指定できません。

## 10. HP0と戦闘後状態

HPが0以下になったUnitは即座に戦闘能力を失います。

1. Downed

   生存していますが戦闘不能です。

2. Wounded

   戦闘後も負傷Penaltyが残ります。

3. Critical

   救命、死亡、後遺症判定の対象です。

4. Dead

   完全喪失です。

5. Captured

   敵Factionに確保されています。

6. Missing

   所在不明となり、捜索やNPC Eventの対象です。

7. Escaped

   単独で安全地点へ撤退します。

8. Routed

   士気崩壊で統制を失って撤退します。

Named Characterは標準ではHP0でDownedになります。lethal、execute、disintegrate等のTag、救命失敗、重大なCritical EventによってDeadになります。

DetachmentとSwarmはHP0でShatteredとなり、生存者、捕虜、再編可能人員へ分解できます。

## 11. morale、cohesion、loyalty

三つを0から100の別Parameterとして保持します。

1. morale

   現在の戦闘継続意思です。Damage、恐怖、Leader喪失、包囲、味方Downで低下し、戦闘外で比較的早く回復します。

2. cohesion

   Party内部の連携度です。訓練、固定編成、相性、Formation適性で増え、頻繁な入替、価値観対立、補給不足で低下します。

3. loyalty

   王国、Leader、Partyへ付き従う意思です。人心、待遇、約束、思想、戦果によって長期的に変化します。

loyaltyが高くてもmoraleが0なら撤退します。cohesionが低ければPartyParameterとGuard連携が低下します。

## 12. 状態異常

Unit StatusはPoison、Bleed、Burn、Stun、Silence、Sleep、Charm、Bind、Mark、Stealth等です。

Party StatusはSurrounded、Disorganized、SupplyShortage、FormationBroken、Retreating、Ambushed、Inspired等です。

Unit Statusは対象Unitへ、Party StatusはPartyParameter、行動、Formation全体へ作用します。

## 13. Party敗北

次のいずれかで敗北です。

1. 全戦闘参加Unitが戦闘不能、死亡、逃走、潰走状態になった。
2. moraleが0になり、撤退または降伏判定に失敗した。
3. Leader喪失後のCommand Checkに失敗し、継承者もいない。
4. Formation崩壊後のRetreat Checkに失敗した。
5. Controllerが撤退または降伏を選択した。
6. Scenario固有条件を満たした。

敗北はParty消滅と同義ではありません。撤退、捕虜、散開、行方不明、壊滅、降伏へ分岐します。

## 14. Leader継承

PartyはsuccessorPriorityを持ちます。

Leaderが戦闘不能になった場合、優先順位が最も高い行動可能Unitが継承します。継承時のCommand Checkに失敗するとformationIntegrity、morale、Command Modifierが低下します。

継承者がいなければPartyはDisorganizedとなり、撤退または降伏を優先します。

## 15. 複数Party戦

各Partyは独立した3×3 Grid、morale、cohesion、Leader、行動状態を維持します。巨大Gridへ統合しません。

MVPでは、戦闘地点へ隣接し、参加可能で、未行動またはreactionChargesを持つPartyが援軍参加できます。Reactionで参加したPartyは次の自ターンにMovementまたはAttack Penaltyを受けます。

MVPの通常攻撃はFront Attackです。Left、Right、Rear AttackはAmbush、Surround、Flank Ability、Teleport、Dungeon機構等でのみ発生します。

## 16. 逐次再計算

一回のAttack後にcurrentHp、戦闘不能、空Slot、Guard可能Unit、formationIntegrity、morale、Leader、PartyParameter、勝敗を即時再計算します。

同一ターンの次の攻撃は再計算後の状態を参照します。

## 17. 回復

標準自然回復は次です。

1. 自国City内

   TURN_STARTに最大HPの20％を回復します。

2. 自国領内で休息

   TURN_STARTに最大HPの10％を回復します。

3. 中立安全地帯またはCamp

   TURN_STARTに最大HPの5％を回復します。

4. 敵隣接、敵領内、戦闘継続中

   自然回復しません。

5. Dungeon内

   自然回復しません。Camp Action、Healer、Spell、Item等を必要とします。

Wounded、Critical、Curse、Poison等は自然回復を制限できます。

## 18. 負傷者の運搬

DownedまたはCriticalなUnitはParty枠を使い続け、movementMax、supplies消費、Guard能力へPenaltyを与えます。

Carrier、Wagon、Mount、Teleport、Medical Ability等で軽減できます。

置き去りにしたUnitは戦場支配、地形、敵Faction、経過ターンに応じてMissing、Captured、Dead、Rescuedへ遷移します。

## 19. Loot

戦場を最終支配した陣営が回収権を得ます。

Gold、Equipment、Strategic Resource、mana Material、Monster Material、Relic、Prisoner、Body、Intelligence、Quest Itemを回収できます。

持ち帰れる量はParty Inventory、Carrier Capacity、撤退状態、追撃、Loot契約で制限します。分配契約違反はloyalty、popularSupport、reputationを低下させます。

## 20. 戦闘予測

攻撃前に、把握可能な範囲で予測総Damage、Primary Target、Guard候補、反撃Damage、範囲対象、Downed可能性、morale変化、Formation変化を表示します。

Stealth、未確認Ability、Trap、未知Monster Traitは具体値を隠し、不確定幅またはUnknownとして表示します。

## 21. 解決順

一回のAttackは次の順で処理します。

1. Command合法性
2. AttackStrengthとDefenseStrength
3. 基礎Damage
4. attackVectorとTargeting
5. Primary Target
6. Cover、Taunt、Intercept、Guard
7. Area、Row、Column、Pierce、Chain
8. 対象別Armor、Resistance、Barrier
9. Unit HP
10. Melee反撃
11. Unit StatusとParty Status
12. moraleとformationIntegrity
13. Leader継承
14. PartyParameter再計算
15. 敗北、撤退、捕虜、Loot
16. GameEvent記録

## 22. 受入条件

1. 全scaleClassを同じResolverで扱える。
2. 同戦闘力なら平均Damageが約30になる。
3. 通常攻撃は原則命中する。
4. Meleeでは合法なら反撃が発生する。
5. Rangedと通常Spellでは標準反撃が発生しない。
6. Named Characterは標準でHP0からDownedになる。
7. morale、cohesion、loyaltyを別保存する。
8. Guard Capacityを超えて肩代わりできない。
9. 前衛Down後も自動で前へ詰まらない。
10. 複数Guard候補を決定論的に解決する。
11. Targeted Attack失敗処理がAttack Tagで変わる。
12. 複数Partyが独立Gridで共同戦闘できる。
13. 攻撃ごとにFormationとPartyParameterを再計算する。
14. 敵隣接中とDungeon内では自然回復しない。
15. Downed UnitがParty枠と運搬負荷を発生させる。
16. 戦闘予測がGuardと反撃を含む。
17. 同じGameState、Command、RNG状態から同じ結果になる。
