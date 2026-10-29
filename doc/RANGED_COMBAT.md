# 遠隔・照準・範囲攻撃の現行仕様

確認・更新日: 2026-10-24。開始基準: main / f3ca8a5ee0f7e9619ec8e7fa5ccd6ec4344fe1cb。

## 適用範囲とUnit

正面からの公開配置に対する攻撃です。[目標Damage Grid](DAMAGE_GRID.md)の全条件を実装した意味ではありません。操作は[戦闘操作](COMBAT_OPERATIONS.md)、能力・生産費は[Ruleset](../src/core/ruleset.js)を参照してください。

「遠隔部隊の二国対戦」は各国5体（戦士2・弓兵2・弩砲1）。戦士は前中央・前左、弓兵は中中央・後左、弩砲は後右に配置し、前左の戦士が前中央を肩代わりします。従来duelの各国戦士3体は保持します。

| Unit | Production | Gold | 近接 | 遠隔 | 防御 | 装甲 | 射程 | Accuracy | Evasion | Taunt | Cover |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 戦士 | 12 | 48 | 20 | 0 | 18 | 2 | 1 | 1 | 0 | 0.15 | 0.25 |
| 弓兵 | 18 | 72 | 10 | 22 | 12 | 1 | 2 | 0.9 | 0.05 | 0 | 0.1 |
| 弩砲 | 28 | 112 | 8 | 25 | 10 | 2 | 3 | 0.85 | 0 | 0 | 0 |

弓兵はdetachment、弩砲はconstruct。新兵種にGuard能力はありません。新規戦士は率50％・容量50・縦横距離1を維持します。旧保存の欠落する射撃関連確率はaccuracy 1／他0で補完し、既存値とGuard率・容量0を維持します。画像は「弓」「弩」のバッジ、音は既存戦闘音です。専用画像・射撃SEは未制作です。

## 攻撃定義

定義は[combat-attacks.js](../src/systems/combat-attacks.js)に固定し、倍率等をCommandから指定できません。

| attackId | 表示名 | 担当 | 照準 | 配分・失敗 |
| --- | --- | --- | --- | --- |
| normal | 通常攻撃 | 近接、または射程内の遠隔Unit | 自動 | 1倍、命中 |
| aimed | 狙い射ち | 射程内の弓兵 | UnitかSlot | 1倍、失敗時はCoverへ命中。Coverなしなら被害なし |
| precise | 精密射撃 | 射程内の弓兵 | UnitかSlot | 1倍、命中率+0.05。失敗時は被害なし |
| row | 横列への一斉射撃 | 射程内の弓兵 | front／middle／rear | 各対象0.5倍 |
| column | 縦列砲撃 | 射程内の弩砲 | left／center／right | 各対象0.65倍 |
| area | 十字砲撃 | 射程内の弩砲 | 中心Slot | 中心と縦横隣接の各対象0.5倍 |
| pierce | 貫通射撃 | 射程内の弩砲 | left／center／right | 生存対象を前から1、0.6、0.36倍 |

通常以外はranged専用。WorldMapのHex距離で射程を検証し、各定義を実行できる兵種で、自分の射程が届く生存・active Unitだけを攻撃力へ集約します。弩砲の射程3で弓兵の射程2を延ばしません。

## Commandと照準

`commands.attackParty(playerId, turn, attackerId, defenderId, attackType, commandId, targeting)`と`HumanController.attackParty(state, attackerId, defenderId, attackType, targeting)`がtargetingをpayloadへ渡します。旧呼び出しは通常攻撃を維持します。

```js
{ attackId: 'normal' }
{ attackId: 'aimed', targetUnitId: 'unit-8' }
{ attackId: 'precise', targetSlot: 'middle-center' }
{ attackId: 'row', targetRow: 'rear' }
{ attackId: 'column', targetColumn: 'center' }
{ attackId: 'area', targetSlot: 'middle-center' }
{ attackId: 'pierce', targetColumn: 'left' }
```

UnitとSlot指定は排他的です。敵Partyに属する生存・active Unit、またはそのUnitが入るSlotだけを狙えます。狙い射ち・精密射撃は空き枠を拒否します。十字は中心が空でも範囲内に生存対象があれば合法です。範囲全体に対象がいなければ拒否します。行・列・Slotの不正値、未知定義、余分なキー、nullや配列等の不正payloadは拒否し、状態・RNG・資源・ID・ログを保持します。

通常攻撃は各列の最初の生存Unitを露出候補とし、機能中のTauntが強い順、同率なら従来の前寄り・中央・左・右順で選びます。明示照準はTauntで別Unitへ強制変更しません。

## 命中・Cover・Taunt

狙い射ち・精密射撃の命中率は、参加射手の平均accuracy＋定義補正－対象evasion－CoverのcoverPower－露出TauntのtauntStrengthを0〜1へ制限します。

Coverは対象と同じ列の前方にいる、生存・active・coverPower>0の最初の1体。Tauntは対象以外の露出候補で最も強い1体、同率はID順です。stun／break／fearのUnitはCover・Taunt・Guardに使いません。これらの状態を付与するAbilityは未実装です。

狙い撃ちでは基礎Damageの乱数、次に命中乱数を1回ずつ消費します。命中率0／1でも順序は同じです。失敗でも攻撃回数を消費して行動終了します。通常・範囲・貫通には命中乱数を追加しません。

## 配分と護衛

基礎Damageは `round(clamp(30 * exp(0.04 * (attack - defense)) * random(0.85, 1.15), 1, 90))`。Party能力は参加Unitの平均×`(0.5 + cohesion / 200)`です。攻撃ごとに基礎Damageを1回求め、各倍率を掛けて切り捨てます。

範囲の生存対象は解決前に固定します。横列は中央・左・右、縦列・貫通は前・中・後、十字は中心優先、中心が空なら周囲のFormation Slot順で主対象を決めます。斜めの枠は十字に含めません。貫通深度は生存対象数で数え、空き枠・HP0を飛ばし、他列に溢れません。

Guard／Interceptは主対象への配分だけに1回適用します。狙い射ちがCoverへ外れた場合はそのCoverが護衛対象です。その他の範囲対象は元の集合を維持します。直撃と肩代わり・割り込みをUnitごとに合算してから、そのUnitのarmorを1回だけ引きます。合算が正なら最低被害1、配分0なら被害なしです。実HP損失は残りHPまでです。

例: 基礎Damage30の前列一斉射撃では前中央と前左が各15。前左が中央の50％を肩代わりすると、中央へ8、前左へ15+7=22を配分し、各armor2を引いてHP損失6と20です。Guard容量は7消費。割り込みなら中央0、前左30−2=28で、反応1を使います。

処理後は攻撃回数1消費・移動力0・行動終了。遠隔に標準反撃はなく、近接は生き残った敵Partyが通常反撃します。空き枠を詰めず、指揮官喪失時の継承と全員戦闘不能時の敗北を解決します。

## 予測・保存・敗北

予測はRNGを読みも更新もせず、起こり得る整数Damage・命中失敗・護衛・HP0・近接反撃の分岐を試算します。両軍のUnit別HP損失範囲、命中率、主対象、範囲Slot、Cover／Taunt／Guard／Interceptを返します。将来の乱数を確定値として表示しません。公開状態の予測で、霧や隠された能力は未実装です。

K-10: active Partyだけが地図を占有します。敗北Party・Unit・HP・位置・配置は記録として保存し、駒描画・占有から除外します。撃破地点へ進入・通過・新部隊作成が可能です。保存は同座標の敗北記録を許可し、生存Unitを含む偽のdefeated Partyを拒否します。自動前進・回復・復活・捕虜・Loot・勝利判定はありません。

保存はaccuracy／evasion／tauntStrength／coverPowerの0〜1有限値とstatusEffectsの文字列・type/id識別子を検証します。不正なオブジェクトを文字列へ強制変換しません。

検証: [戦闘テスト](../tests/ranged-combat.test.js)、[占有テスト](../tests/defeated-occupancy.test.js)、[遠隔ブラウザQA](../assets/qa/browser-ranged-2026-10-24.json)、[従来操作と敗北QA](../assets/qa/browser-grid-2026-10-24.json)。側面・背面攻撃、射線・地形Cover、汎用Ability、AI、勝利、Dungeonは後続です。都市別作業は[CITY_MANAGEMENT.md](CITY_MANAGEMENT.md)で対応しました。
