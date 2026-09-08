# Kingdom 開発ハンドオフ

更新日: 2026-09-08

目標: Civilization VI 型帝国運営とダンジョン探索

次の作業: M1 単一都市のCiv型ループ

## 1. 最重要方針

現行コードへ機能を継ぎ足す前に、GameStateを正本とする構造へ移します。

Phaser object、CharacterLayer.characters、BuildingLayer.buildingsをゲーム状態の正本にしてはいけません。人間入力、AI、将来のマルチプレイは、同じCommandとRuleSystemを使います。

最初からCiv6全機能を実装しません。単一都市、単一人間王国、固定マップで生産と購入を一巡させ、その後に地上4X、ダンジョン、マルチプレイを順に載せます。

## 2. 今回追加された設計境界

1. MilitaryPowerはscience、production、gold、mana、Unit、Party、兵站から算出します。
2. GovernanceCapacityはreligion、culture、制度、統治人材から算出します。
3. foodは都市人口とnativeHumanResourcesを生みます。
4. religionとcultureは国外Affiliate、移民、専門家、英雄候補を引き寄せます。
5. Religion、Culture、Scienceの独立勝利はありません。
6. WorldMapの基本移動単位はPartyです。
7. FormationはParty内部の配置であり、別Unitではありません。
8. AIとHumanは同じParty、Formation、Resource Ruleを使います。

詳細は RESOURCE_MODEL.md と PARTY_FORMATION.md を参照してください。

## 3. M1の範囲

M1で実装するのは次です。

1. 固定seedの小型六角形マップ
2. 人間王国一つ
3. 都市一つ
4. food、production、gold、science、mana、religion、cultureと人的資源Pool
5. Warrior一種類
6. Monument一種類
7. MilitaryPowerとGovernanceCapacityの派生計算
8. Productionによる複数ターン生産
8. Goldによる即時購入
9. Cultureによる自然領土拡張
10. Goldによる指定タイル購入
11. ターン開始時処理
12. セーブ可能なGameState
13. 最低限の単体テスト

ダンジョン、戦闘AI、オンライン通信、District、宗教、外交はM1へ入れません。

## 4. 実装順序

### 3.1 最小のテスト環境

index.html一枚のまま作業を続けず、ES Modulesとテストを導入します。大規模なUI刷新は後回しにします。

推奨構成は次です。

1. src/core/game-state.js
2. src/core/ruleset.js
3. src/core/commands.js
4. src/core/turn-engine.js
5. src/core/rng.js
6. src/models/kingdom.js
7. src/models/city.js
8. src/models/unit.js
9. src/world/hex.js
10. src/world/world-map.js
11. src/systems/yield-system.js
12. src/systems/production-system.js
13. src/systems/territory-system.js
14. src/ui/game-scene.js
15. tests

ビルドツールはVite、テストはVitest程度で十分です。依存を増やしたくない場合も、coreはDOMとPhaserから独立したES Moduleにしてください。

### 3.2 Hexを先に固定

1. Hexをimmutableなvalue objectにします。
2. key生成を一箇所にします。
3. cubeRoundを実装します。
4. neighbor、distance、rangeをテストします。
5. river edgeは正規化された共有EdgeKeyで管理します。
6. 固定seed RNGを追加します。

### 3.3 GameStateとCommand

最低限、次のCommandを作ります。

1. StartTurn
2. SetCityProduction
3. PurchaseCityItem
4. PurchaseTile
5. EndTurn

RuleSystemはCommandを検証し、成功時だけGameStateを更新してGameEventを返します。UIは成功可否をRuleSystemへ問い合わせ、理由を表示します。

### 3.4 都市Yield

Cityへ workedTiles と yieldSummary を持たせます。M1では市民配置を自動化します。

ターン開始時に次を固定順で処理します。

1. タイルYield集計
2. foodStorage更新と人口成長
3. productionProgress更新
4. gold備蓄更新
5. scienceとculture進捗更新
6. 領土文化進捗更新
7. 完成イベント処理

表示値と内部値に差が出ないよう、YieldBreakdownを返してください。

### 3.5 Production

ProductionItemDefinitionへ次を持たせます。

1. itemId
2. category
3. productionCost
4. purchaseOptions
5. prerequisites
6. placementRule
7. onComplete

CityProductionStateへ currentItemId、queue、progressByItem を持たせます。

必要なテストは次です。

1. Production不足なら未完成
2. Cost到達で一回だけ完成
3. Overflowが次項目へ入る
4. Queueが空ならOverflowを保持しない
5. 項目切替でprogressを保持
6. Gold購入で即時完成
7. Gold不足なら状態不変
8. 即時購入で既存progressを返金しない
9. 購入不可対象を拒否

### 3.6 Territory

Cultureによる自動拡張とGold購入を別Commandにします。

自動拡張候補は次の条件を満たします。

1. 都市領土に隣接
2. ownerIdがnull
3. Voidではない
4. 飛び地にならない
5. 他都市の占有規則に違反しない

候補評価は資源、Yield、都市からの距離を使い、同点はseed付きRNGで決めます。Gold購入時は候補と価格をUIに表示します。

## 5. Controller設計

KingdomとControllerを分離します。

1. HumanController

   UI入力からCommandを生成します。

2. AIController

   GameStateから合法Command一覧を取得し、評価して選びます。

3. RemoteController

   将来のマルチプレイ入力をCommandとして受けます。

4. ReplayController

   CommandLogを再生します。

M1ではHumanControllerだけ実装しますが、GameStateにHuman専用プロパティを埋め込まないでください。

## 6. M1受入条件

1. 同じseedで同じマップを生成できる。
2. ページ読込時にConsole errorがない。
3. ターン開始時に都市Yieldが一回だけ集計される。
4. City production 5、Warrior cost 12なら3回目のターン開始時に完成する。
5. 完成時の余剰Productionが次のQueue項目へ入る。
6. Gold全額を払うと対象を即時取得できる。
7. Gold購入が途中Productionを値引きしない。
8. Culture進捗到達時に合法タイルを一つ自動取得する。
9. Goldで合法タイルを一つ指定購入できる。
10. 他国領、Void、非隣接タイルを購入できない。
11. currentTurnが一周につき一回だけ増える。
12. GameStateをJSONへ保存し、同じ状態へ復元できる。
13. coreのテストがPhaserなしで実行できる。

## 7. M2 地上4X

M1完了後に次を追加します。

1. 複数王国とPlayerSlot
2. AIController
3. Unit移動力と行動回数
4. Partyの作成、分割、合流
5. Formation Slotと編成Modifier
6. Warrior Partyによる地上戦闘
5. Settlerによる都市建設
6. Builder chargeによる改善
7. Scienceによる技術
8. 蛮族
9. Domination仮勝利

ソロでは敵王国スロットをAIへ割り当てます。ローカルマルチでは同じスロットをHumanへ変更します。

## 8. M3 ダンジョン

地上4XのターンとUnit Commandが安定してから、次を追加します。

1. WorldMap上のDungeon Site
2. EnterDungeon Command
3. DungeonStateとExpeditionState
4. 地上Hexを再利用した一階層
5. MoveInDungeon、AttackInDungeon、OpenChest、Retreat
6. dungeonActionsのターン開始リセット
7. carried loot
8. ExitDungeonによるsecured loot化
9. 全滅時の損失
10. 王国のdungeonMaterials、mana、人材へ還元

地上とダンジョンで別のUnitコピーを作らず、同じunitIdのmodeとlocationを切り替えます。

## 9. マルチプレイへの備え

1. 乱数は必ずseed付きRNGから取得します。
2. Date.now、Math.randomをゲームルール内で使いません。
3. CommandへcommandId、playerId、turn、phaseを持たせます。
4. GameEventをログへ保存します。
5. UI座標ではなくHex keyとentityIdをCommandへ入れます。
6. 同じ初期状態とCommand列から同じ結果を再現できるようにします。
7. AIもCommandLogへ残します。

## 10. 現行コードからの移行

再利用候補は Hex、Layout、カメラ操作、イベント窓、描画方法の試作です。

置換対象は Player.resources、CharacterLayer.characters、Player.units、BuildingLayer.buildings、再帰的updateGameState、Math.random依存です。

移行中は旧 index.html を legacy/index.html へ退避するか、main上で動作比較できる状態を保ってください。旧コードを削除するコミットと新しいcore導入を同時に行わないでください。

## 11. 文書更新規則

1. ゲーム規則を変えたら SPECIFICATION.md を更新します。
2. Civ6との差を変えたら CIV6_REFERENCE.md を更新します。
3. 実装段階が変わったら STATUS.md を更新します。
4. 次作業と受入条件が変わったら HANDOFF.md を更新します。
5. 未確定事項を確定したら、決定日と理由をコミットメッセージまたはDecision Logへ残します。
