# Kingdom 進捗と既知の課題

確認・更新日: 2026-10-16

コード基準: main / 21826414ea238468ff9b7c2ddaaf47cd012c1f80（2026-09-13、Wiki追加後のmain）。調査時点のブランチはmainのみ、open PR・open issueは各0件です。

## 1. 現在地

M1の単一都市運営ループは実装済み、M2はParty・移動・基本戦闘の途中です。PartyとFormationを一律に未実装とは扱いません。

UIからは都市生産・購入、自然領土拡張・タイル購入、Party作成・選択・1歩移動、ターン終了、localStorageセーブ・ロードを操作できます。

内部APIには複数王国の順次ターン、任意経路移動、SetFormation、AttackPartyがあります。複数王国設定・切替、配置編集、戦闘のUIはありません。

現行の詳細は [CURRENT_IMPLEMENTATION.md](./CURRENT_IMPLEMENTATION.md)、次作業は [HANDOFF.md](./HANDOFF.md) です。旧Phaser版のP0不具合と再利用候補は [LEGACY_IMPLEMENTATION.md](./LEGACY_IMPLEMENTATION.md) に移しました。

前回までの素材制作では初回27点を生成済みです。AIPaintの画像17点、AIMusicのSE8点・BGM2曲を原稿・ジョブと共に保存しました。前回の制作記録では画像目視と全点のファイル検査・音声解析を実施済みです。今回これらの素材検査は再実施していません。聴取とゲームへの画像・音声接続は未実施で、M2の実装進捗とは分けて扱います。[ASSET_LIST.md](./ASSET_LIST.md) と [ASSET_PREVIEW.md](./ASSET_PREVIEW.md) を参照してください。

## 2. マイルストーン

### M0 仕様再編

設計文書を整備済みです。最大5Unit、3×3 Damage Grid、Partyを一つの戦闘単位とすること、移動・攻撃・有限Chargeの分離は決定済みです。目標文書の受入条件は実装完了の宣言ではありません。

### M1 単一都市のCiv型ループ

基本機能は実装済みです。GameState／Command化、固定seed、都市Yield、人口成長、生産キュー、全額Gold購入、文化・Goldの二経路領土取得、派生能力、保存があります。

未完の品質課題は本書の既知課題に残します。ブラウザQA、キュー編集UI、購入価格の事前表示、セーブ破損対応まで完了した意味ではありません。

### M2 地上4X垂直スライス

部分実装です。

1. 複数王国: addKingdomと順次手番処理を実装。設定・切替UI、AIは未実装。
2. 複数都市: City辞書とcityIdsは存在。同一王国内の都市別市民配置・領土管理、FoundCityは未実装。
3. Unit: warrior一種類のみ。Settler、Builder、蛮族、技術解禁は未実装。
4. Party: 最大5Unitの作成、3×3配置検証、地形移動と占有検証を実装。分割・合流・解散・自由なメンバー編集は未実装。
5. 戦闘: 単体Damage、近接反撃、遠隔反撃なし、HP0、Leader継承、全員戦闘不能時の敗北を実装。戦闘UI、Guard、狙撃、範囲・貫通、撤退・回復・Lootは未実装。
6. 行動: Party移動力・攻撃回数・ターン回復を実装。有限ChargeとAbilityは保存欄のみで、実行基盤は未実装。
7. 資源: mana備蓄、science・culture進捗、軍事力・統治力・負荷の暫定計算あり。宗教Yieldの統治力接続、mana消費、研究解禁、負荷Penaltyは未実装。
8. 人心: 王国単位の固定収入・維持費処理あり。NPC募集、個別維持費・債務、loyalty変動、国外人材は未実装。
9. 勝利判定: Dominationを含め未実装。

### M3 ダンジョン垂直スライス

未着手です。Site、DungeonState、Expedition、階層生成、罠・宝箱・撤退、carried／secured loot、王国への還元はありません。行動はACTION_SYSTEMの共有モデルを使う方針です。

### M4 統合ゲーム

未着手です。複数階層、ボス、装備・研究との接続、選択式イベント、Dungeon勝利を扱います。M1の基本セーブは既にあるため、ここでの保存課題は追加システムを含む保存・移行・復元です。

### M5 マルチプレイ

未着手です。coreの順次手番は存在しますが、ローカル複数人UI、権威状態・通信、RemoteController、切断時AI引継ぎ、同時ターン競合解決はありません。

## 3. 現行の未修正課題

優先度は次作業の目安です。P1はゲーム状態・ルールの整合性、P2は操作性・拡張時の制約を示します。ここに列挙した問題は今回修正していません。

### 追加診断で再現した課題

2026-09-13の診断に加え、2026-10-16にも基準コミットのcoreへローカルの一時診断を実行し、以下5件を再現しました。既存23テストへ追加したわけではありません。

1. K-01 / P1: 全滅Partyが次ターンに移動できる。敵をHP0でdefeatedにし、一巡後にMovePartyすると成功しました。turn-engineが敗北Partyの行動値も回復し、movement-systemがstatus・戦闘可能構成員を検証しません。
2. K-02 / P1: 同じHexに複数Partyを作れる。同じ都市中心の別UnitからCreatePartyを続けて発行すると両方成功しました。移動時には占有を拒否しますが、作成時の占有検証がありません。
3. K-03 / P1: 遠隔能力0のwarriorが遠隔攻撃できる。seed 77で隣接敵へrangedを発行し、HP100→88を確認しました。rangedStrengthや攻撃方式の所持を検証せず、反撃を回避できます。
4. K-04 / P1: PurchaseCityItemはPLAYER_ACTION以外でも成功し、cityId省略ではTypeErrorが発生します。全Commandのphase・必須payload検証を統一する必要があります。
5. K-05 / P2: 同一王国にCityを二つ置くと同じworkedTilesを両都市が選びます。都市別管理でなく王国全領土から選ぶためです。複数都市を実装済みとして扱わないでください。

### コード上で確認した制約・要対応箇所

1. K-06 / P2: Party選択解除がなく、選択後はクリックが移動に固定され領土購入へ戻れません。ロード・新規開始でもselectedPartyIdを初期化していません。src/ui/main.jsの静的確認で、ブラウザ実操作は未検証です。
2. K-07 / P2: UIとHumanControllerがkingdom-1／city-1固定で、別王国へ手番が移るとその王国を操作できません。
3. K-08 / P2: 建設済み建物の生産選択・再キュー投入を拒否しません。建物は重複登録されなくてもProduction消費と完了イベントが起こり得ます。
4. K-09 / P2: JSONセーブの検証はバージョン確認と一部既定値補完のみです。必須フィールド・参照整合性・破損入力・旧中間版の移行保証が不足しています。
5. K-10 / P2: 敗北Partyが盤上に残り、移動の占有判定がstatusを区別しません。死傷者・捕虜・撤退・片付けと撃破後進入の規則に接続が必要です。

## 4. テストと確認範囲

2026-10-16、Node.js v24.19.0／npm 11.9.0で実行しました。

```sh
npm test
npm run check
```

npm testは23件成功、失敗0件でした。

1. tests/game.test.js: 12件。seed、ターン、Productionとoverflow、購入、領土、人心、セーブ、複数王国の手番、M1セーブ補完。
2. tests/hex.test.js: 2件。cube round、neighbor、distance、range、共通Edge key。
3. tests/party.test.js: 4件。最大人数・所属、3×3配置、移動、拒否時の状態保持。
4. tests/combat.test.js: 5件。近接・遠隔、射程等の拒否、HP0と行動回復、Leader継承。

npm run checkはsrc/ui/main.jsの構文チェックに成功しました。srcとtests内の全JavaScriptファイルにもnode --checkを実行し、すべて成功しました。

専用Yield単体テスト、全受入条件、全scaleClass、Guard、loyalty、AI、Dungeon、UI E2Eの網羅はありません。テスト名が示す内容と実際のassert範囲も区別します。GitHub Actionsの設定はリポジトリ内にありません。

今回はブラウザでの実操作・描画確認を実施していません。テスト成功は既知課題の解消やM2完了を意味しません。

## 5. 前回（2026-09-13）の文書整備記録

旧調査を保存したままCURRENT_IMPLEMENTATIONを現行ES Modules版へ書き換え、実装状況・UI到達範囲・未実装を分離しました。STATUSとHANDOFFのM1再導入指示、Party未実装扱い、旧版P0の混在を解消しました。

目標仕様は実装の簡略化へ合わせて縮小しません。目標文書には現行との差を明記し、既に確定した5Unit・9Slot等を未確定事項から外しました。

## 6. 2026-10-16の引き継ぎ記録

K-01は敗北状態のまま移動Commandが成功、K-02は同じ `0,0,0` に二Party、K-03はseed 77で遠隔攻撃成功・対象HP88、K-04はTURN_END中の購入成功とcityId欠落のTypeError、K-05は二都市が同じ二つのworkedTilesを選択する結果でした。K-06〜K-10は該当コードを再確認しましたが、ブラウザ実操作による再現ではありません。

次回の最初の実装単位はHANDOFF §4.1の状態・行動検証です。Guard／Damage Gridや戦闘UIの追加より先に既知の状態不整合へ回帰テストを追加する方針を維持します。本更新は文書のみで、既知課題は未修正です。
