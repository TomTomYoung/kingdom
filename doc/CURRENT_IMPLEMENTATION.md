# Kingdom 現行実装仕様

確認・更新日: 2026-10-17

開始基準: main / f59804d8b6dfad75704bfa40024e148dee03391b。2026-10-17の素材接続差分を反映しています。

## 1. 範囲と現在地

現在の実装はM1の都市運営ループと、M2のParty作成・移動・基本戦闘です。画面から使える範囲とcore APIだけの範囲を分けて記録します。「内部実装済み」は目標仕様の全受入条件を満たした意味ではありません。

目標仕様は [SPECIFICATION.md](./SPECIFICATION.md)、未修正課題と検証結果は [STATUS.md](./STATUS.md)、次作業は [HANDOFF.md](./HANDOFF.md) を参照してください。旧Phaser版は [LEGACY_IMPLEMENTATION.md](./LEGACY_IMPLEMENTATION.md) に保存しています。

## 2. 実行環境と構成

エントリーは [index.html](../index.html) です。標準Canvas 2DとDOMを使い、PhaserやCDNを読み込みません。外部npm依存、ビルド工程、バックエンドはありません。

assets/には既存27点と追加SE3点があります。画像17点、SE11点、地上BGM1曲をUIへ接続しました。戦闘BGMは戦闘UI待ちです。AssetStoreがmanifestの採用パスから画像を取得し、読み込めなければ地形色・城文字・部隊記号で継続します。画像は整数倍・等方拡大、音声はWeb Audioでユーザー操作後に開始します。初期ミュート、主音量・設定保存、非表示停止、連打制限、BGM切替時の遅延読込取消があります。tools/assets/は制作専用でゲーム実行時の依存ではありません。[ASSET_AUDIT.md](ASSET_AUDIT.md) が最新台帳です。

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
6. tests: game、hex、party、combat、assets、audioの6ファイル
7. legacy/index.html: 旧Phaser版。現行起動経路では使いません。

## 3. UIから使える機能

固定seed 117で、一王国kingdom-1、一都市city-1を生成します。初期人口は2、開始時備蓄はGold 100、人心30、mana 0です。画面初期化時にStartTurnを実行するため、表示される備蓄は第1ターンの収支反映後です。初期UnitとPartyはありません。

画面には王領地図、国庫と研究・文化進捗、軍事力・統治力と負荷、都市人口とYield、食料と領土文化、都市生産、Party、ターン終了、セーブ・ロード・新規開始があります。

戦士とモニュメントの生産・Gold購入、未所有の合法タイル購入、首都にいる未編成Unit最大5体のParty化、Party選択と隣接Hexへの1歩移動を操作できます。

Party選択中のタイルクリックは移動として処理されます。解除ボタン、同Partyの再クリック、Escで領土購入へ戻れます。合法な隣接移動先は点線、所有地は金枠で表示し、カーソル下の地形・費用・拒否理由を表示します。ロード・新規開始では選択を解除します。複数王国切替、戦闘、3×3配置編集、生産キュー編集、JSONファイル入出力のUIはありません。カメラ移動、ズーム、旧版の文章イベント窓も移植されていません。

## 4. GameStateとCommand

GameStateはschemaVersion 1、rulesetVersion m1.0です。主な実キーはphase、world、turnOrder、activePlayerId、activePlayerIndex、kingdoms、cities、units、parties、rng、nextIds、commandLog、eventLogです。目標文書のcurrentPhase、worldMap、playerSlots等と同名とは限りません。

RuleSystem.execute(original, command)は成功時に複製したstateとeventsを返し、検証で拒否した場合は元stateを返します。commandIdの重複、playerId、手番、turnを共通検証します。全payloadのスキーマ検証や全Command共通のphase検証は未完成です。

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

Dungeon・World Resolution、勝利判定、オートセーブ、自然HP回復、継続Status Effectの解決はありません。敗北Partyにも行動値が回復する問題はSTATUSのK-01を参照してください。

## 6. マップ・領土

半径3のpointy-top Hexマップで、全37タイルです。平原、草原、森林、丘陵、霊脈からseed付きで地形を選び、外周には確率でVoidを置きます。連続地形生成はまだなく、目標の連続性ある地形とは異なります。

初期領土は中心と隣接6タイルです。所有者はTile.ownerIdを正本とします。文化取得・Gold購入の候補は自国領のいずれかに隣接する未所有・非VoidのHexです。都市別の所属範囲や最大取得半径はありません。

文化取得コストは1タイル10です。候補評価は地形Yield合計×3－都市中心からの距離で、同点は領土用RNGで選びます。蓄積が十分なら同じ開始処理で複数取得します。候補がなければ文化進捗を残します。

Gold価格は20＋中心からの距離×5＋地形Yield合計×2です。Gold購入はlocalCultureProgressを消費しません。Party未選択時、タイルへカーソルを合わせると購入価格を表示します。

Hex.round、neighbor、distance、range、正規化Edge keyがあります。riverEdgesは空配列で、河川・道路・ZoCの効果はありません。経路はCommandへ渡す形で、現行版にA*や到達範囲探索はありません。

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

SetFormationは9Slotへの全構成Unitの一度ずつの配置を検証します。編成時の占有・生存検証、解散・分割・合流、Leader手動変更、敵隣接時の編成制限、配置編集UIはありません。

Partyは移動力2、攻撃回数1で初期化されます。最も遅い構成員から移動力を計算する処理はありません。移動コストは平原・草原・霊脈1、森林・丘陵2です。指定経路の全段階で隣接性・非Void・他Party占有・必要移動力を検証し、成功時に所属Unitのlocationも更新します。

Unitにはcharges、abilityStates、loyalty、supportUpkeep、statusEffects等の保存欄がありますが、対応するAbilityや忠誠システムが使えるわけではありません。

## 10. 基本戦闘（core APIのみ）

AttackPartyは敵Partyへのmelee／rangedを扱います。通常UIに敵王国や攻撃操作はなく、テスト・API用の基盤です。

Party戦闘力は戦闘可能Unitの対象能力の算術平均×(0.5＋cohesion/200)です。Leader、Formation、補給、地形等を含む目標PartyParameterの完全な集約ではありません。

基礎Damageは30×exp(0.04×戦闘力差)×seed乱数0.85〜1.15を1〜90へ制限して丸め、対象Unitのarmorを引き、最低1を適用します。選択順はfront→middle→rear、各行内はcenter→left→rightで、最初の戦闘可能Unit一体へ適用します。空いた列だけの後方露出や複数UnitへのDamage配分はありません。

攻撃側は攻撃回数1を消費し、移動力0・activationState endedになります。近接では生き残った防御Partyが反撃し、遠隔には標準反撃がありません。射線・攻撃能力の所持・撃破後前進の検証は未完成です。

HP0ではscaleClassがindividualならdowned、それ以外は一律shatteredです。現行定義はdetachmentのwarriorだけで、他scaleClassの完全な状態遷移は未実装です。

Damageに応じてmoraleを下げ、Leader喪失時は生存UnitのcommandContribution降順・ID昇順で継承者を選び、追加でmoraleを10下げます。継承者がいなければPartyをdefeatedにします。morale 0の撤退、Command Check、回復、捕虜、Lootはありません。

Guard容量の保存・ターン回復はありますが、Guard／Intercept／Taunt／Targeted Attack／範囲・貫通の解決はありません。

## 11. セーブと検証範囲

serializeGameState／restoreGameStateでJSON化・復元します。UIはlocalStorageのkingdom-m1-save一枠を使用します。旧M1セーブへのParty・turnOrder・戦闘フィールド等の補完がありますが、任意の破損セーブへの網羅的検証ではありません。

2026-10-17: 素材接続を実装し、Node標準32テスト、全JS構文、30素材の整合性・復号、実UIを使うDOM/Canvas操作検証に成功しました。実ブラウザのCSS描画・音声再生と人による聴取は未確認です。 保存に失敗しても進行を継続でき、不正ロードは元のstateへ戻します。K-09の完全なセーブスキーマ検証を実装した意味ではありません。詳細は[検証記録](ASSET_INTEGRATION_QA.md)。

## 12. 2026-10-16再調査の結果

基準コミットのsrc・index.html・package.json・testsを読み直し、上記の実装範囲を確認しました。`npm test` は23件成功、`npm run check` は成功、srcとtestsの全23 JavaScriptファイルの `node --check` も成功しました。

既存テストに含まれない一時診断では、敗北Partyの次ターン移動、同一Hexでの重複Party作成、遠隔能力0の遠隔攻撃、購入Commandのphase検証漏れ・cityId欠落例外、同一王国の複数都市による作業タイル重複が再現しました。詳細と受入条件はSTATUS・HANDOFFを参照してください。既存テスト成功だけでM2完了とは判断できません。
