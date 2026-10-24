# Kingdom 9グリッド・ダメージ配分仕様

更新日: 2026-10-24（現行実装の区分のみ更新。目標仕様は維持）

仕様状態: 基本構造確定、数値係数はCOMBAT_SYSTEM.mdに従う

## 0. 現行実装との区分

本文は目標の配分規則です。2026-10-24時点では最大5Unit・9Slot検証と編集、正面の列ごとの露出、通常・Unit／Slot狙い撃ち・横列・縦列・十字・貫通を実装しています。formationはfront/middle/rearとleft/center/rightを組み合わせたSlotIdからunitIdへの辞書です。対象集合は攻撃開始時の活動中Unitから固定し、空き枠・HP0への再配分や貫通の横列への逸脱は行いません。

護衛指示はParty.guardOrdersへ保存し、割り込み優先・近い枠・ID順で1体を選びます。肩代わりは装甲前Damageから最大70％・残り容量まで、割り込みは反応1を消費し、連鎖しません。範囲・貫通では主対象への1回だけ護衛を解決し、同一Unitの直撃と肩代わりを合算して装甲を1回適用します。新規戦士は率50％・容量50・範囲1。既存セーブのゼロ能力は維持します。

通常攻撃は露出候補の有効な挑発値を優先します。狙い射ちと精密射撃は明示対象を保持し、対象の回避、同じ縦列の前方遮蔽1体、露出挑発1体を命中率へ反映します。狙い射ちの失敗は遮蔽Unitへ配分し、精密射撃の失敗は損害なしです。HP0・stun／break／fear中は護衛・遮蔽・挑発へ参加しません。数式と順序は [RANGED_COMBAT.md](RANGED_COMBAT.md) を正本とします。

予測はRNGを参照しないHP損失範囲、照準枠、命中率、護衛・遮蔽・挑発を表示します。側面・後方露出の内部ヘルパーはありますが、攻撃Commandの方向指定、Role／Stealth／Chain／Allなどの全目標パターンは未実装です。以下は完成時の受入条件です。

## 1. 目的

Party内部の最大5Unitを3×3のFormation Gridへ配置し、攻撃を受けた際の対象選択、庇う、狙撃、貫通、範囲攻撃、Damage配分を決定します。

9グリッドはDamage解決専用です。WorldMapやDungeon内の移動盤面、行動順、射程距離、Movement Costを表しません。Grid内の一マス移動を通常移動として処理しません。

## 2. Grid

Gridは次の9 Slotを持ちます。

```text
FrontLeft    FrontCenter    FrontRight
MiddleLeft   MiddleCenter   MiddleRight
RearLeft     RearCenter     RearRight
```

Partyは最大5Unitなので、常に4Slot以上が空きます。一Unitは一Slotだけを占有します。

基本Roleは次です。

1. Front

   通常の正面攻撃へ最も露出します。Guard、Taunt、Shield、Counterを担当します。

2. Middle

   Frontの後方から近接支援、中距離攻撃、指揮、機動的な庇護を行います。

3. Rear

   遠距離、魔法、回復、軍師等を配置します。FrontとMiddleが健在なら通常攻撃から保護されます。

Left、Center、Rightは列攻撃、側面攻撃、庇護範囲、貫通方向の判定に使います。

## 3. データ

Formation状態は最低限、次を保持します。

1. gridSlots

   SlotIdからunitIdへの対応です。

2. facing

   正面方向です。WorldMapではHex Edge、Dungeonでは入口や敵方向を基準にします。

3. guardLinks

   GuardするUnitと保護対象または保護範囲です。

4. interceptPriority

   複数のGuard候補がいる場合の割込優先度です。

5. targetingVisibility

   攻撃側が把握しているUnit、Role、Slotの情報です。

6. formationIntegrity

   Formationがどの程度維持されているかを表します。

Unit側は必要に応じて次を持ちます。

1. guardRange
2. guardRate
3. interceptChance
4. tauntStrength
5. coverPower
6. targetPriority
7. stealth
8. size
9. evasion
10. damageShareLimit

## 4. 攻撃方向

攻撃はattackVectorを持ちます。

1. Front Attack

   Front Rowを露出面とします。通常攻撃の標準です。

2. Rear Attack

   Rear Rowを露出面とします。奇襲、背後攻撃、包囲等で発生します。

3. Left Flank

   Left Columnを露出面とします。

4. Right Flank

   Right Columnを露出面とします。

5. OverheadまたはArc Attack

   Rowによる保護を部分的または完全に無視します。

6. Internal Attack

   暗殺、裏切り、罠等としてGrid保護を無視または弱めます。

WorldMapで側面・背面を採用する場合はPartyのfacingと攻撃元HexからattackVectorを決めます。簡略モードでは全通常攻撃をFront Attackとして扱えます。

## 5. 通常の対象選択

対象未指定の通常攻撃は次の順で解決します。

1. attackVectorから露出RowまたはColumnを決めます。
2. 生存している最前面Unitを候補にします。
3. TauntやtargetPriorityを適用します。
4. GuardまたはIntercept可能なUnitを評価します。
5. 同順位ならCenter寄り、HP、固定乱数等のRuleset順で一体を選びます。
6. 選ばれたPrimary TargetへDamageを配分します。
7. 貫通、範囲、Guard Shareを追加配分します。

正面通常攻撃ではFront Rowが優先されます。Frontが空または全員戦闘不能ならMiddle、次にRearへ到達します。

Front Rowの一部が空いている場合、その列のMiddleまたはRearが露出するか、隣接Frontが横から保護するかはFormationDefinitionで決めます。

## 6. GuardとTaunt

### 6.1 Guard

Guardは味方へ向かったDamageの全部または一部を引き受けます。

Guard可能条件は次です。

1. Guard Unitが行動可能である。
2. 対象SlotがguardRange内である。
3. Guardを無視するAttack Tagを持たない。
4. damageShareLimitを超えていない。
5. Stun、Break、Fear等でGuard不能になっていない。

Guard Capacity、一回の肩代わり上限、反撃、HP0以後の処理は COMBAT_SYSTEM.md に従います。

Damage配分の基本形は次です。

```text
guardDamage = incomingDamage × effectiveGuardRate
targetDamage = incomingDamage - guardDamage
```

effectiveGuardRateはSkill、Slot距離、Formation、状態、攻撃種別から算出し、0から1へ制限します。

### 6.2 Intercept

InterceptはPrimary TargetそのものをGuard Unitへ置き換えます。成功時はGuard Unitが全Damageと付随効果の対象になります。

複数候補がいる場合はinterceptPriority、Skill Priority、対象との関係、固定Tie Breakの順で決定します。

### 6.3 Taunt

Tauntは対象未指定攻撃のtargetPriorityを高めます。攻撃側が明示的なTargeted Attackを使った場合、Tauntは強制変更ではなくAccuracyまたはResource CostへのPenaltyとして作用します。

## 7. 攻撃側の狙い撃ち

攻撃側はAttack Definitionが許可する場合、UnitまたはSlotを指定できます。

1. Direct Target

   判明しているUnitを直接指定します。

2. Slot Target

   FrontCenter等のSlotを指定します。Unitが移動済みの場合は空振りまたは別処理になります。

3. Role Target

   Leader、Healer、Mage、Ranged等を狙います。

4. Lowest HPまたはMarked Target

   条件に一致するUnitを自動選択します。

Targeted AttackはFront保護を自動的に無視しません。次を使って命中と到達可否を判定します。

1. 攻撃側Accuracy
2. 射程とAttack Tag
3. 対象のRow
4. 間にいるUnitのcoverPower
5. GuardとIntercept
6. 対象のevasion
7. stealthとtargetingVisibility
8. Formation Skill

RearのHealerを狙うことはできますが、FrontとMiddleによるCover、Guard、Accuracy Penaltyを突破する必要があります。Sniper、Arc Shot、Teleport Strike等は専用Tagで一部を無視します。

未発見、Stealth中、正体不明のUnitを名前指定することはできません。攻撃側が持つ情報の範囲でのみTargetを選べます。

## 8. 範囲と貫通

Attack DefinitionはdamagePatternを持ちます。

1. Single

   一UnitだけにDamageを与えます。

2. Row

   指定Rowの占有Unitへ配分します。

3. Column

   指定ColumnをFrontからRearへ攻撃します。

4. Cross

   指定Slotと上下左右へ攻撃します。

5. Adjacent

   指定Slotと周囲8Slotへ攻撃します。

6. All

   Party全体へ攻撃します。

7. Pierce

   Primary Targetを貫通し、同Column後方へ減衰Damageを与えます。

8. Chain

   条件に従って別Unitへ連鎖します。

範囲Damageは対象数で単純等分する方式と、各対象へ倍率を掛ける方式をAttack Definitionごとに選びます。

貫通の基本形は次です。

```text
damageAtDepth = initialDamage × penetrationDecay ^ depth
```

depthは最初に命中したUnitを0とし、後方へ進むたびに一増やします。

## 9. Damage解決順

Damageは次の順で処理します。

1. 攻撃側PartyParameterから基礎Damageを算出します。
2. attackVectorとTargeting Ruleを確定します。
3. targetingVisibilityを検証します。
4. Primary Target候補を決めます。
5. Taunt、Cover、Interceptを解決します。
6. Guard Shareを計算します。
7. Row、Column、Area、Pierce等の追加対象を展開します。
8. 各UnitのDefense、Resistance、Barrierを適用します。
9. Unit HPへDamageを反映します。
10. formationIntegrity、morale、cohesionへ影響を反映します。
11. Downed、Wounded、Dead、Routed等を判定します。
12. 空いたSlotとFormation Bonusを再計算します。

同じ入力から同じ結果になるよう、乱数が必要な場合は戦闘用seed付きRNGを使います。

## 10. 配置変更

通常の配置変更は戦闘外で自由に行えます。

戦闘中の配置変更はReposition Abilityとして扱います。Grid内の移動力は持たせず、Abilityが次を指定します。

1. 移動元Slot
2. 移動先Slot
3. 交換可能か
4. movementCost
5. attackCost
6. manaCost
7. endsActivation
8. 敵Reactionを誘発するか

Push、Pull、Knockback、Kidnap等により、敵が強制的にSlotを変更することもできます。

## 11. Leaderと軍師

Leaderまたは軍師がGrid内のどこにいるかで、指揮効果と狙われやすさが変わります。

Front配置は指揮範囲と人心効果を高められますが、被弾しやすくなります。Rear配置は安全ですが、Formation崩壊、視界不良、通信阻害によってCommand Modifierが低下する場合があります。

Leader狙撃に成功した場合、即座にParty全体を消滅させず、formationIntegrity、morale、loyalty、指揮継承へPenaltyを与えます。

## 12. WorldMapとDungeon

WorldMap戦闘ではGridをDamage配分の内部状態として使用し、必要に応じて簡略表示します。

Dungeon戦闘では同じGridを詳細表示し、対象Slot、Guard対象、範囲Pattern、予測Damageを選択前に表示します。

どちらも同じgridSlotsとDamage Resolverを使います。WorldMap用とDungeon用にPartyやUnitを複製しません。

## 13. 受入条件

1. 最大5Unitを9Slotへ自由配置できる。
2. 一Slotへ複数Unitを配置できない。
3. Grid配置は通常Movement回数を増減させない。
4. 正面通常攻撃はFrontを優先する。
5. Frontが空なら後列が露出する。
6. GuardがDamageの一部を引き受けられる。
7. InterceptがPrimary Targetを置換できる。
8. Tauntが対象未指定攻撃を引きつける。
9. Targeted Attackで攻撃側がUnitまたはSlotを狙える。
10. Rear TargetにはCoverとGuardが作用する。
11. Row、Column、Area、Pierceを同じGridで解決できる。
12. Damage後に空SlotとFormation Bonusが再計算される。
13. WorldMapとDungeonで同じDamage Resolverを使用する。
14. Guard Capacityを超えて肩代わりできない。
15. 前衛がDownedしても後列を自動で前へ詰めない。
16. 同じGameState、Command、RNG状態から同じ配分結果になる。
