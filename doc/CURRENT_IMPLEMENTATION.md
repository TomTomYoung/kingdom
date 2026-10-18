# Kingdom 現行実装仕様

確認・更新日: 2026-10-18

開始基準: main / 6303da9319711786e9313476a1b5ab927e31caa3。第3段階まで反映済みの状態から、保存検証と音声取得を修正しました。

2026-10-18 引き継ぎ: main / 6303da9319711786e9313476a1b5ab927e31caa3 と前回の全ファイルが一致することを確認。K-09の保存構造・参照整合性検証と、音声fetchの呼出し先修正を追加しました。Node標準56テスト、全52 JavaScriptファイルの構文検査、30素材の整合性・復号、Chromium 153で通常時・全音声HTTP 404時の実操作に成功しました。PC幅1440pxと390pxで表示を確認。音声は実AudioContextの復号・再生開始・停止を確認し、人による聴取と利用端末での再確認は未実施です。 [検証記録](ASSET_INTEGRATION_QA.md)。

## 1. 範囲と現在地

現在の実装はM1の都市運営ループと、M2のParty作成・移動・基本戦闘です。画面から使える範囲とcore APIだけの範囲を分けて記録します。「内部実装済み」は目標仕様の全受入条件を満たした意味ではありません。

目標仕様は [SPECIFICATION.md](./SPECIFICATION.md)、未修正課題と検証結果は [STATUS.md](./STATUS.md)、次作業は [HANDOFF.md](./HANDOFF.md) を参照してください。旧Phaser版は [LEGACY_IMPLEMENTATION.md](./LEGACY_IMPLEMENTATION.md) に保存しています。

## 2. 実行環境と構成

エントリーは [index.html](../index.html) です。標準Canvas 2DとDOMを使い、PhaserやCDNを読み込みません。外部npm依存、ビルド工程、バックエンドはありません。

assets/には既存27点と追加SE3点があります。画像17点、SE11点、地上BGM1曲をUIへ接続しました。戦闘BGMは戦闘UI待ちです。AssetStoreがmanifestの採用パスから画像を取得し、読み込めなければ地形色・城文字・部隊記号で継続します。画像は整数倍・等方拡大、音声はWeb Audioでユーザー操作後に開始します。初期ミュート、主音量・設定保存、非表示停止、連打制限、BGM切替時の遅延読込取消があります。WAV/OggのHTTP失敗・デコード失敗・8秒タイムアウト時は、src/audioに同梱した採用音符13件と固定版AIMusicからPCMを合成します。Workerが使えなければ同じ合成器で処理します。全13件の再合成WAVは制作時のWAVのSHA-256と一致します。音声設定の再読み込みでキャッシュを消して再試行できます。tools/assets/は制作専用でゲーム実行時の依存ではありません。[ASSET_AUDIT.md](ASSET_AUDIT.md) が最新台帳です。

リポジトリルートで次を実行し、http://localhost:4173/ を開きます。

```sh
npm run dev
```

このコマンドはPython 3のHTTPサーバーを使います。代替の静的HTTPサーバーでも構いません。HTML・モジュール・素材のURLを相対解決するため、サブディレクトリへの静的配信にも対応します。ES Modulesとfetchを使うためHTMLの直接オープンは標準起動手順にしません。外部Webフォントの取得依存はなく、端末のフォントを使用します。

検証用コマンドは次です。

```sh
npm test
npm run check
```

テストはNode.js標準のnode:testです。Vite、Vitestは導入されていません。確認環境はNode.js v24.19.0、npm 11.9.0、Python 3.12.14です。最低対応バージョンの宣言はまだありません。

1. src/core: GameState、Ruleset、Command、RuleSystem、ターン、HumanController、RNG
2. src/models: Kingdom、City、Unit、Party
3. src/world: Hex座標、共通Edge key、固定seedマップ
4. src/systems: Yield、生産、領土、移動、戦闘
5. src/ui: Canvas描画とDOM入力
6. src/uiにはmap-camera・map-view・inspectionによる表示専用状態もあります。カメラと選択をGameStateへ混入しません。
7. src/audio: 採用音符・固定版AIMusicのPCM合成とWorker
8. tests: ゲーム・素材・音声・Worker・Command・地図操作検証の10ファイル
9. legacy/index.html: 旧Phaser版。現行起動経路では使いません。

## 3. UIから使える機能

固定seed 117で、一王国kingdom-1、一都市city-1を生成します。初期人口は2、開始時備蓄はGold 100、人心30、mana 0です。画面初期化時にStartTurnを実行するため、表示される備蓄は第1ターンの収支反映後です。通常の新規開始では戦士1体を含む部隊1を首都に配置し、選択済みで始まります。初期戦士にGold消費はありません。coreのcreateInitialGameStateはstartingPartyオプションでこのセットアップを選び、既存テスト用の空の開始も保持します。

画面には王領地図、国庫と研究・文化進捗、軍事力・統治力と負荷、都市人口とYield、食料と領土文化、都市生産、Party、ターン終了、セーブ・ロード・新規開始があります。

戦士とモニュメントの生産・Gold購入、未所有の合法タイル購入、選択セルの未編成Unitを1〜5体指定してParty化し、現在の移動力で到達できるセルまで経路移動できます。待機Unitも地図に表示され、一覧と地図の両方から選択できます。

左クリックはセル・駒の詳細確認です。クリックだけでは移動・購入を実行しません。部隊選択後に目的地を選び「ここへ移動」、または目的地を右クリックすると移動します。領土はセル詳細の購入ボタンで購入します。到達可能セルの点線、経路と消費移動力、所有地の金枠を表示します。解除ボタン・Escで部隊とUnitを解除し、ロードでも解除、新規開始では初期部隊を選択します。セル詳細は座標・地形・所有・都市・基本産出・移動費・駐留一覧、Unit詳細はHP・状態・近接/遠隔・防御/装甲・射程・所属・配置・指揮者・部隊行動値を表示します。Party欄の3×3配置で、Unitを選んで空き枠へ移動・他Unitと交換できます。指揮者とHPを表示し、変更はSetFormationを通します。複数王国切替、戦闘、生産キュー編集、JSONファイル入出力のUIはありません。ドラッグ・矢印キーによるカメラ移動、1/2/3倍の等方整数ズーム、クリックで移動する全体図、首都・選択Unitへのフォーカス、部隊の順送りがあります。旧版の文章イベント窓は未移植です。操作は[MAP_OPERATIONS.md](MAP_OPERATIONS.md)を参照してください。

## 4. GameStateとCommand

GameStateはschemaVersion 1、rulesetVersion m1.0です。主な実キーはphase、world、turnOrder、activePlayerId、activePlayerIndex、kingdoms、cities、units、parties、rng、nextIds、commandLog、eventLogです。目標文書のcurrentPhase、worldMap、playerSlots等と同名とは限りません。

RuleSystem.execute(original, command)は成功時に複製したstateとeventsを返し、検証で拒否した場合は元stateを返します。commandIdの重複、playerId、手番、turnを共通検証します。全9Commandの種別・phase・必須payload・配列と辞書の型を事前検証し、参照先・所有者を処理前に確認します。拒否時は元stateと空eventsを返し、RNG・資源・ID・ログを変更しません。破損GameStateそのものの検証はK-09として別途残っています。

現在のCommandは9種類です。

1. StartTurn
2. SetCityProduction
3. PurchaseCityItem
4. PurchaseTile
5. EndTurn
6. CreateParty
7. SetFormation
8. MoveParty
9. AttackParty（attackTypeはmeleeまたはranged）

HumanControllerは上記のCommandを生成します。AIController、RemoteController、ReplayController、合法手一覧APIはありません。

addKingdomは別王国とその都市を追加できるセットアップ用関数です。Command経由のFoundCityや同一王国内の複数都市運営、プレイヤー設定画面ではありません。

## 5. ターン

全王国がturnOrderに従って順次行動します。EndTurnで次の王国へ移り、一巡したときだけcurrentTurnを1増やして全王国の開始処理を実行します。lastProcessedTurnで収支の重複処理を防ぎます。

processTurnStartの現行順序は次です。

1. 王国人心の維持費支払いと収入加算
2. 都市Yieldの計算
3. foodStorage加算と最大1回の人口成長
4. 都市Production投入と完成・overflow処理
5. Gold・mana備蓄、science・culture進捗への加算
6. localCultureProgress加算と自然領土取得
7. Partyの移動力、攻撃回数、reactionCharges、行動状態とUnitのGuard容量の回復
8. 軍事力・統治力・統治負荷の再計算

Dungeon・World Resolution、勝利判定、オートセーブ、自然HP回復、継続Status Effectの解決はありません。敗北Partyや戦闘可能構成員がいないPartyの移動・攻撃・reactionChargesは0、activationStateはendedのままです。UnitのGuard容量は戦闘可能な構成員だけ回復します。

## 6. マップ・領土

新規開始は半径10のpointy-top Hexマップで、全331タイルです。既存セーブのworldを再生成しないため、半径3・37セルの旧セーブはそのまま続けられます。平原、草原、森林、丘陵、霊脈からseed付きで地形を選び、外周には確率でVoidを置きます。連続地形生成はまだなく、目標の連続性ある地形とは異なります。

初期領土は中心と隣接6タイルです。所有者はTile.ownerIdを正本とします。文化取得・Gold購入の候補は自国領のいずれかに隣接する未所有・非VoidのHexです。都市別の所属範囲や最大取得半径はありません。

文化取得コストは1タイル10です。候補評価は地形Yield合計×3－都市中心からの距離で、同点は領土用RNGで選びます。蓄積が十分なら同じ開始処理で複数取得します。候補がなければ文化進捗を残します。

Gold価格は20＋中心からの距離×5＋地形Yield合計×2です。Gold購入はlocalCultureProgressを消費しません。部隊選択の有無にかかわらず、セル詳細で購入価格を確認して購入します。

Hex.round、neighbor、distance、range、正規化Edge keyがあります。riverEdgesは空配列で、河川・道路・ZoCの効果はありません。移動力内の到達範囲をDijkstraで探索し、validatePartyPathと同じ地形費・Void・占有・部隊状態の検証を使います。選択した最小コスト経路をMovePartyへ渡し、表示側でGameStateを移動しません。次ターン以降へ続く自動移動予約はありません。

## 7. Yield・人口・生産

Yieldはfood、production、gold、science、mana、religion、cultureです。市民配置は自国の全非Void所有タイルを評価して人口数だけ選びます。都市中心にfood 2、production 1、gold 2、science 1、culture 1を固定加算し、モニュメントはculture 2を加算します。

都市のlastYieldBreakdownにタイル・建物・中心・合計を保存します。UIは合計Yieldを表示し、完全な内訳表示はありません。食料成長閾値は12＋現在人口×6で、成長時にpopulationとhumanResources.nativeを1増やします。

Productionは都市ローカルです。currentItemId、queue、progressByItemを持ち、費用到達時に完成、余剰を次キューへ投入し、キューが空なら余剰を捨てます。対象切替で途中進捗を保持します。

生産可能な定義はwarrior（Production 12／Gold 48）とmonument（Production 20／Gold 80）のみです。Unitは都市中心へ生成されます。Gold購入は全額即時払いで、生産進捗を減額・返金しません。

建設済み建物の重複購入は拒否しますが、生産キュー側の重複建設や、進行中の同建物を購入した後のキュー整理はありません。建物配列は重複させずとも、生産力を使って完了イベントを出し得ます。

## 8. 人心・派生能力・人的資源

Kingdom.stockpilesはgold、mana、popularSupport、progressはscience、cultureです。宗教Yieldは集計されますが備蓄も進捗もなく、現在の統治力計算へ接続されていません。manaの消費先や技術の解禁処理もありません。

人心は王国の固定supportIncome（初期1）とsupportUpkeep（初期0）だけを処理します。支払額は収入加算前の保有量と維持費の小さい方で、その後に収入を加えて上限100へ制限します。人物別維持費集計、supportDebt、loyalty変化、募集はありません。

派生計算はsrc/models/kingdom.jsにあります。現行式は次です。

```text
militaryPower =
  floor(scienceProgress / 5) + totalCityProduction
  + floor(gold / 25) + floor(mana / 5)
  + militaryHumanResources * 2 + ownedUnitCount * 4

governanceCapacity =
  floor(cultureProgress / 5) + institutions * 3
  + governanceHumanResources * 2 + buildingCount

governanceLoad =
  ownedTileCount + cityCount * 2 + totalPopulation + buildingCount
```

Capacity不足のPenaltyやUnitの徴募・登用はありません。人的資源はnative、military、governance、specialists、heroes、affiliates、migrantsのフィールドを持ちますが、現在自動増加するのは人口成長時のnativeだけです。数値係数の一部はRulesetでなくコードに固定されています。

## 9. Party・Formation・移動

CreatePartyは同じ場所の自国未所属Unitを1〜5体まとめます。実キーはid、unitIds、formation、movementMaximum、attacksMaximumです。formationはfront/middle/rearとleft/center/rightを組み合わせたSlotIdからunitIdへの辞書です。初期配置はfront-left、front-center、front-right、middle-left、middle-centerの順です。

SetFormationは9Slotへの全構成Unitの一度ずつの配置を検証します。作成時に既存の非Voidタイル・他Party非占有・UnitのHPとactive状態を検証します。敗北・全員戦闘不能のPartyは移動と配置変更を拒否します。3×3配置編集UIは実装済みです。解散・分割・合流、Leader手動変更、敵隣接時の編成制限はありません。

Partyは移動力2、攻撃回数1で初期化されます。最も遅い構成員から移動力を計算する処理はありません。移動コストは平原・草原・霊脈1、森林・丘陵2です。指定経路の全段階で隣接性・非Void・他Party占有・必要移動力を検証し、成功時に所属Unitのlocationも更新します。

Unitにはcharges、abilityStates、loyalty、supportUpkeep、statusEffects等の保存欄がありますが、対応するAbilityや忠誠システムが使えるわけではありません。

## 10. 基本戦闘（core APIのみ）

AttackPartyは敵Partyへのmelee／rangedを扱います。通常UIに敵王国や攻撃操作はなく、テスト・API用の基盤です。

Party戦闘力は戦闘可能Unitの対象能力の算術平均×(0.5＋cohesion/200)です。Leader、Formation、補給、地形等を含む目標PartyParameterの完全な集約ではありません。

基礎Damageは30×exp(0.04×戦闘力差)×seed乱数0.85〜1.15を1〜90へ制限して丸め、対象Unitのarmorを引き、最低1を適用します。選択順はfront→middle→rear、各行内はcenter→left→rightで、最初の戦闘可能Unit一体へ適用します。空いた列だけの後方露出や複数UnitへのDamage配分はありません。

攻撃側は攻撃回数1を消費し、移動力0・activationState endedになります。近接では生き残った防御Partyが反撃し、遠隔には標準反撃がありません。遠隔攻撃は生存・active・rangedStrength>0かつ自分の射程が届くUnitを必要とし、そのUnitだけから遠隔戦闘力を計算します。無能力・戦闘不能Unitで射程を延ばせません。射線・撃破後前進は未実装です。

HP0ではscaleClassがindividualならdowned、それ以外は一律shatteredです。現行定義はdetachmentのwarriorだけで、他scaleClassの完全な状態遷移は未実装です。

Damageに応じてmoraleを下げ、Leader喪失時は生存UnitのcommandContribution降順・ID昇順で継承者を選び、追加でmoraleを10下げます。継承者がいなければPartyをdefeatedにします。morale 0の撤退、Command Check、回復、捕虜、Lootはありません。

Guard容量の保存・ターン回復はありますが、Guard／Intercept／Taunt／Targeted Attack／範囲・貫通の解決はありません。

## 11. セーブと検証範囲

serializeGameState／restoreGameStateでJSON化・復元します。UIはlocalStorageのkingdom-m1-save一枠を使用します。save-validation.jsで必須構造・数値範囲・地形と都市・所属の双方向参照・3×3配置・次ID・手番・RNGを検証し、復元成功後だけstateを置換します。既知M1のParty・turnOrder・戦闘フィールドの欠落を補完し、旧37セルを再生成せず維持します。nullや不明参照を既定値で隠さず、未知版を拒否します。失敗時は現在の対局・選択・カメラ倍率を維持します。

2026-10-17 第2段階: Node標準44テスト、全45 JavaScriptファイルの構文検査、30素材の整合性・復号に成功しました。実UIのDOM/Canvas検証では3×3配置の移動・交換・保存復元、全音声ファイルがHTTP 404の場合の再合成、再試行後のBGM重複防止を確認しました。実ブラウザのCSS・音声出力と人による聴取は未確認です。 保存に失敗しても進行を継続でき、不正ロードは元のstateへ戻します。この第2段階時点ではK-09は未実装でした。2026-10-18の対応は本節冒頭とSTATUSを参照してください。詳細は[検証記録](ASSET_INTEGRATION_QA.md)。

## 12. 2026-10-16再調査の結果

基準コミットのsrc・index.html・package.json・testsを読み直し、上記の実装範囲を確認しました。`npm test` は23件成功、`npm run check` は成功、srcとtestsの全23 JavaScriptファイルの `node --check` も成功しました。

既存テストに含まれない一時診断では、敗北Partyの次ターン移動、同一Hexでの重複Party作成、遠隔能力0の遠隔攻撃、購入Commandのphase検証漏れ・cityId欠落例外、同一王国の複数都市による作業タイル重複が再現しました。詳細と受入条件はSTATUS・HANDOFFを参照してください。既存テスト成功だけでM2完了とは判断できません。
