# Civilization VI 準拠点の調査記録

更新日: 2026-09-08

## 1. 目的

Kingdom の「Civ6準拠」は、Civilization VI の数値やコンテンツを複製する意味ではありません。帝国運営の基本責務を整理し、Kingdom独自のダンジョン探索と矛盾しない実装モデルへ変換するための参照です。

## 2. 確認した要点

### 2.1 都市生産と即時購入は別経路

Civilization VI の公式マニュアルでは、都市でGoldを支払いUnitやBuildingを購入すると即時に建設されることが説明されています。一方、通常生産は都市が得るProductionを生産対象へターンごとに投入する仕組みです。

Kingdomでは次のように採用します。

1. Productionは都市ローカルの毎ターン産出です。
2. Productionは選択中Projectのprogressへ投入します。
3. Gold、Faith等による購入は全purchaseCostを払う即時取得です。
4. 通貨で残Productionだけを埋める標準機能にはしません。
5. 途中までのProductionは返金やGold換算をしません。

### 2.2 都市が生産主体

Civ6では都市がUnit、Building、District、Wonder、Projectを生産します。Builderのタイル改善やSettlerの都市建設はユニット行動です。

Kingdomでも、都市生産と盤上ユニット行動を別システムにします。

### 2.3 領土拡張は文化とGoldの二経路

Civ型では都市文化による自然な国境拡張と、Goldで指定タイルを即時購入する経路があります。

Kingdomでは localCultureProgress による自動取得と、Goldによる選択取得を併存させます。Gold購入で文化進捗は消費しません。

### 2.4 ユニット行動は移動ポイントを基礎にする

Civilopediaでは、移動可能ユニットは毎ターンMovement pointsを受け取り、タイル進入、攻撃、略奪などで消費し、地形が進入コストを決めると説明されています。

Kingdomでは movementRemaining、actionsRemaining、charges を分離します。ユニットごとに値と消費規則を変えます。

### 2.5 Districtによる都市の非スタック化

Civilization VI は都市機能の一部を周辺ヘックスのDistrictとして配置し、位置と隣接関係を都市計画へ組み込みます。

Kingdomでも将来的にDistrictを地上タイルへ配置します。ただし、最初の生産ループでは City Center と Building だけで成立させ、District は後続導入します。

### 2.6 ソロとマルチ

Civilization VI は人間とAIが参加するターン制4Xで、マルチプレイでは複数のターン方式が使われます。

Kingdomでは王国と操作主体を分離し、Kingdom.controllerType に Human または AI を割り当てます。最初はSequentialを正本とし、Simultaneousは権威状態と競合解決を実装してから追加します。

## 3. Kingdom独自拡張

次はCiv6準拠ではなく、Kingdom独自仕様です。

1. WorldMap上のDungeon Site
2. 世界ターンと同期するDungeon action
3. Expedition編成
4. carried lootとsecured loot
5. ダンジョン由来の研究、装備、王国Modifier
6. Dungeon勝利
7. 王国とダンジョンの相互投資

## 4. 意図的に簡略化する点

1. 初期版の市民配置は自動です。
2. District、宗教、外交、観光、偉人は最初の垂直スライスから外します。
3. AIは決定論的な評価関数から始めます。
4. マルチプレイはSequentialから始めます。
5. ダンジョンは初期版では一入口一遠征隊です。
6. 数値、時代、技術名、文明固有能力はKingdom独自データとします。

## 5. 参照資料

1. [Civilization VI Official Manual](https://downloads.2kgames.com/civilization/vi/manuals/eu/CIV_VI_25TH_ONLINE_MANUAL_ENG.pdf)

   GoldによるUnit、Buildingの即時購入、Movement、都市その他の基本操作を確認する一次資料です。

2. [Movement Points - Civilization VI Civilopedia](https://www.civilopedia.net/en-US/gathering-storm/concepts/movement_1/)

   Movement pointsが移動、攻撃、略奪等で消費され、地形が移動コストへ影響することを確認しました。

3. [Sid Meier's Civilization VI Official Site](https://civilization.2k.com/civ-vi/)

   Civilization VI が帝国を発展させるターン制ストラテジーであるという全体像の参照です。

4. [Civilization VI - Wikipedia](https://en.wikipedia.org/wiki/Civilization_VI)

   4X、勝利条件、人間とAI、都市、Districtを含む概観の補助資料です。

## 6. 実装時の注意

「Civ6と同じ」とだけコメントして挙動を省略しないでください。採用する挙動は SPECIFICATION.md と Ruleset に明記します。Civ6の更新差、DLC差、例外的能力をそのまま一般規則として扱わず、Kingdomとして必要な規則だけを定義します。


## 7. Civ6からの重要な分岐

1. Religion、Culture、Scienceの独立勝利を設けません。
2. religionとcultureはGovernanceCapacity、領土維持、人材獲得、占領統合へ使います。
3. manaを王国資源として追加します。
4. PartyをWorldMapの運用単位とします。
5. FormationでParty内部の配置、役割、被害分配を扱います。
6. foodからnativeHumanResourcesを生みます。
7. religionとcultureにより国外Affiliate、移民、専門家、英雄候補を獲得できます。
8. 成長経路は最終的に軍事力、統治力、Dungeon攻略へ接続します。


## 8. 行動システムの準拠内容

Civ6では移動可能Unitが毎ターン固有のMovement Pointsを持ち、タイル進入、攻撃、略奪等に使用します。Terrainが進入コストを決めます。

Kingdomでも全Unit共通の一行動制を採用せず、movementRemaining、attacksRemaining、有限Charge、Ability固有コストを分離します。

通常攻撃は一ターン一回かつ攻撃後終了を標準とします。移動後攻撃は可能です。追加攻撃、攻撃後移動、移動後射撃禁止等はUnitまたはParty Abilityで明示します。

Civ6のPillageは3 Movement、または保有Movementが3未満なら残り全量を消費します。Kingdomもこれを標準値にします。

Builder相当Unitは有限buildChargesを持ち、改善建設で一Chargeを消費します。改善は都市Productionを待たず即時完成します。修理は標準でChargeを消費しません。

都市Production、GoldによるUnit・Building購入、Tile購入はUnit行動と別系統です。Kingdomもこの分離を維持します。

Civ6のFormationは護衛、Corps、Armyを含みますが、KingdomのFormationはParty内部のFront、Center、Rear、Support、Reserve配置を意味します。この名称差は意図的な独自分岐です。

詳細な採用規則は ACTION_SYSTEM.md を正本とします。

参照:

1. https://www.civilopedia.net/en-US/gathering-storm/concepts/movement_1/
2. https://www.civilopedia.net/en-US/gathering-storm/concepts/combat_5/
3. https://www.civilopedia.net/en-US/gathering-storm/concepts/combat_12/
4. https://www.civilopedia.net/en-US/gathering-storm/concepts/combat_13/
5. https://www.civilopedia.net/en-US/gathering-storm/units/unit_builder/
6. https://www.civilopedia.net/en-US/gathering-storm/concepts/gold_3/
