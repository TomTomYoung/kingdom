# Kingdom 目標仕様

更新日: 2026-09-08

仕様状態: 基本構造確定、数値バランスと一部マルチプレイ規則は暫定

## 1. ゲームの定義

Kingdom は、Civilization VI 型の地上帝国運営と、部隊単位のダンジョン探索を一つのターン進行へ統合するストラテジーゲームです。

地上では都市建設、領土拡張、資源産出、生産、研究、外交、戦争を扱います。ダンジョンでは探索、戦闘、罠、宝物、ボス、撤退判断を扱います。ダンジョンで得た遺物、技術、資源、人材は帝国運営へ戻り、帝国の生産力と研究力は遠征隊の装備と補充を支えます。

Civilization VI を完全複製するのではなく、都市生産、領土、ユニット行動、複数勝利条件という骨格を準拠対象とします。ダンジョン探索との接続に必要な部分は Kingdom 独自仕様とします。

## 2. ゲームモード

### 2.1 ソロプレイ

一人の人間プレイヤーが一王国を操作します。敵対王国はAIが操作します。中立勢力、蛮族、ダンジョン勢力もAIまたは規則ベースで処理します。

### 2.2 マルチプレイ

王国スロットごとに Human または AI の ControllerType を設定します。一つの対局に人間王国とAI王国を混在できます。

初期実装はローカルの順次ターン方式とします。オンライン化する場合は、次のターン方式をルール設定として選べる設計にします。

1. Sequential

   人間を含む全王国が固定順で行動します。再現性とデバッグを優先する標準方式です。

2. Simultaneous

   人間プレイヤーが同時入力し、ターン終了時にサーバーまたはホストが確定処理します。競合解決規則が必要なため、MVP後に実装します。

3. Dynamic

   平時は同時、戦争当事国など競合する勢力は順次処理します。将来候補であり、初期実装範囲外です。

### 2.3 Sandbox

勝敗を無効化し、マップシード、地形比率、AI数、AI思考傾向、資源倍率、ダンジョン数、イベント率を設定して観察できるモードです。通常ゲームと同じエンジンを使用します。

## 3. ゲーム状態の正本

ゲームの全状態は GameState を正本とします。Phaserの表示オブジェクトは GameState の投影であり、ゲームルールを保持しません。

GameState は最低限、次を保持します。

1. rulesetVersion
2. seed と乱数ストリーム状態
3. currentTurn
4. currentPhase
5. playerSlots
6. kingdoms
7. worldMap
8. cities
9. units
10. improvements
11. districts
12. technologies と civics
13. dungeons
14. expeditions
15. events
16. victoryState

状態変更は Command を RuleSystem が検証、実行して行います。UI、AI、マルチプレイ入力はいずれも同じ Command を発行します。AIだけが別ルールで直接状態を書き換えることは禁止します。

## 4. ターン進行

### 4.1 基本順序

一つの世界ターンを次の順序で処理します。

1. TURN_START

   前ターンからの継続効果、維持費、資源収集、都市生産、研究、文化圏拡張候補、人口成長、ユニット回復、移動力と行動回数のリセットを解決します。

2. PLAYER_PHASES

   各王国の Controller が行動します。Human は入力待ち、AI は同じ合法手集合から行動を選びます。

3. DUNGEON_RESOLUTION

   各王国フェーズ中に入力された遠征行動の結果を確定します。順次ターンでは王国フェーズ内で即時解決しても構いませんが、ルール上の解決点は記録します。

4. WORLD_RESOLUTION

   戦闘後処理、占領、外交、イベント、死亡、建設完了後の派生効果を確定します。

5. TURN_END

   終了判定、勝利判定、ログ確定、オートセーブを行い、currentTurn を一回だけ増やします。

6. 次の TURN_START

### 4.2 ターン開始時の資源処理

ユーザーが確認する画面上では、ターン開始直後に収入と進捗が反映された状態を表示します。内部処理順は固定し、再現可能にします。

標準順は次です。

1. 維持費と前ターン効果
2. タイルと建物の産出集計
3. 都市の食料、成長
4. 都市の生産進捗
5. 王国の gold、faith 等の備蓄
6. science、culture の研究進捗
7. 領土文化進捗
8. 完成、解禁、成長イベント
9. ユニット状態リセット

同じターン開始処理内で発生した解禁を、そのターンから使用可能にします。

## 5. 資源モデル

Civ型の Yield と Stockpile と Progress を区別します。

### 5.1 都市ローカル

1. food

   都市ごとに蓄積し、人口成長へ使います。

2. production

   国庫へ貯めず、その都市が選択している生産対象の productionProgress へ毎ターン投入します。

3. localCulture

   都市文化圏の自然拡張へ使います。

### 5.2 王国共通備蓄

1. gold

   ユニット、建物、タイルその他の即時購入、維持費、外交へ使います。

2. faith

   宗教系対象、特定ユニット、固有対象の即時購入へ使います。初期MVPでは無効でもデータ構造は予約します。

3. strategicResources

   鉄などの戦略資源です。対象の生産条件、購入条件、維持費に使います。

4. dungeonMaterials

   魔石、遺物片など、ダンジョン由来の帝国資源です。装備、生産、研究、封印解除へ使います。

### 5.3 王国共通進捗

1. science

   選択中の技術へ毎ターン加算します。

2. culture

   選択中の社会制度へ毎ターン加算します。

ScienceとCultureは通常の国庫通貨のように任意対象を即時購入する資源ではありません。対象進捗として扱います。

## 6. 都市生産

### 6.1 標準生産

各都市は productionPerTurn、productionQueue、currentProject を持ちます。生産対象は Unit、Building、District、Wonder、Project に分類します。

ターン開始時、都市の productionPerTurn を currentProject.productionProgress へ加算します。productionProgress が productionCost 以上になれば完成します。

完成時の超過productionは、同じ都市の次のキュー項目へ繰り越します。キューが空なら次ターンまで未割当として保持せず、原則として失われます。将来の政策や能力がこの規則を変更できます。

生産対象を切り替えた場合、既存の progress は対象ごとに保持します。陳腐化、都市喪失、明示キャンセル時の処理は対象定義に従います。

### 6.2 即時購入

purchaseCurrency と purchaseCost が定義された対象は、王国が必要額を全額保有していれば即時完成できます。標準通貨は gold または faith です。ダンジョン固有対象は dungeonMaterials を要求できます。

即時購入は、残りproductionだけを通貨で埋める処理ではありません。対象の全purchaseCostを支払う独立した取得経路です。途中まで蓄積した productionProgress は返金または通貨換算しません。

District、Wonder、特殊Projectなど、原則購入不可の対象を定義できます。能力、政策、総督相当の効果により購入可能化しても構いません。

### 6.3 生産とユニット行動の分離

都市のUnit、Building、District生産は都市キューを使います。Builderによるタイル改善はユニット行動であり、都市キューとは別です。Settlerによる都市建設もユニット行動です。

## 7. 都市と領土

### 7.1 都市

都市は cityId、ownerId、centerHex、population、foodStorage、productionPerTurn、productionQueue、workedTiles、districts、buildings、localCultureProgress を持ちます。

市民は所有タイルへ配置され、そのタイルのYieldを都市へ与えます。初期MVPでは自動配置のみとし、後に手動配置を追加できます。

### 7.2 都市建設

Settler が合法な地上タイルで FoundCity を実行すると、新しい都市が成立し、Settler は消費されます。都市間最低距離、地形制限、占有、外交条件を Ruleset で検証します。

### 7.3 領土拡張

領土拡張は二経路です。

1. 文化による自然拡張

   都市の localCultureProgress が次のタイル取得コストへ到達すると、合法な隣接タイルを一つ取得します。初期MVPでは候補評価に基づく自動選択とします。

2. Goldによる即時購入

   プレイヤーが都市に隣接する合法タイルを選び、表示された全Goldコストを払って即時取得します。

Gold購入は文化進捗を消費またはリセットしません。他国領は通常購入できず、戦争、外交、イベントなど別ルールで移転します。飛び地取得は原則禁止します。

## 8. ユニット

### 8.1 共通データ

Unit は最低限、次を持ちます。

1. unitId
2. ownerId
3. unitTypeId
4. location
5. domain
6. hp と maxHp
7. movementMax と movementRemaining
8. actionsMax と actionsRemaining
9. combatStrength
10. rangedStrength と range
11. charges
12. promotions
13. statusEffects
14. mode
15. expeditionId

### 8.2 行動回数

移動力と行動回数は別に管理します。値はユニット種別、昇進、状態、装備によって変わります。

タイル進入は地形、道路、河川、状態に応じた movement を消費します。攻撃、略奪、改善、ダンジョン進入などは Command 定義に従って movement、action、charge のいずれかまたは複数を消費します。

ユニット種別ごとの例は次です。

1. Warrior

   movement 2、attack action 1

2. Scout

   movement 3、explore action 1、地形軽減を持ち得ます。

3. Builder

   movement 2、build charge 3。改善実行時にchargeを1消費し、0で消滅します。

4. Settler

   movement 2、FoundCity action 1。都市建設後に消滅します。

5. Expedition Party

   地上movementとダンジョン用actionを持ち、編成、装備、負傷を管理します。

数値は暫定です。ActionDefinition のデータとして変更可能にします。

## 9. 戦闘

地上戦とダンジョン戦は同じ CombatResolver を使い、地形、装備、状態、陣営関係による Modifier を追加します。

初期仕様は、攻撃側戦闘力と防御側戦闘力の差から相互ダメージを計算する方式です。近接攻撃は原則反撃あり、遠距離攻撃は原則反撃なしとします。

一タイルには各陣営につき、軍事ユニット一体と支援または民間ユニット一体までを基本とします。詳細なスタック規則は Ruleset 化します。

都市占領、敗走、包囲、経験値、昇進は段階導入します。

## 10. AI

AIは Human と同じ GameState を読み、同じ合法Commandを発行します。AI専用の直接資源付与や規則無視は行いません。

難易度補正が必要な場合は Ruleset の明示的Modifierとして設定し、ログとUIから確認可能にします。

AIは次の層に分けます。

1. GrandStrategy

   勝利方針、拡張、ダンジョン重視度を決めます。

2. Empire

   都市生産、研究、経済、外交を決めます。

3. Operational

   戦争、遠征隊編成、ダンジョン攻略目標を決めます。

4. Tactical

   個々のユニットの移動、攻撃、撤退を決めます。

初期MVPでは評価関数と優先順位による決定論的AIから始めます。

## 11. ダンジョン探索

### 11.1 地上との接続

ダンジョン入口は WorldMap 上の Site として生成またはイベント配置されます。Scout、Hero、Expedition Partyなど、進入能力を持つユニットが入口で EnterDungeon を実行します。

進入したユニットは地上盤面上で expedition 状態となり、通常移動と地上戦の対象から外れます。入口封鎖、救援、強制退出などは別規則で扱います。

### 11.2 ターン同期

ダンジョン探索は世界ターンと同期します。一つの世界ターンにつき、各遠征隊は unit 定義に基づく dungeonActions を得ます。

Human は自王国のフェーズ中に地上とダンジョンの双方を操作し、必要な遠征行動を終えてからターンを終了します。AI王国は同じ遠征CommandをAIが選びます。

ダンジョン中だけ世界時間を無期限停止する仕様にはしません。探索を続ける間も敵王国の生産、研究、侵攻は進みます。これが帝国運営と探索の主要な緊張関係になります。

### 11.3 ダンジョン状態

Dungeon は最低限、次を持ちます。

1. dungeonId
2. entranceHex
3. seed
4. depth と floors
5. threatLevel
6. discoveryState
7. floorMaps
8. encounters
9. traps
10. lootTables
11. bossState
12. completionState
13. occupants

Dungeon floor は部屋と通路、またはヘックスマップで表現できますが、最初の実装は地上と同じヘックス座標系を再利用します。

### 11.4 遠征と戦利品

Expedition は partyUnits、inventory、supplies、position、visibility、retreatRoute、status を持ちます。

戦利品は carried と secured を区別します。

1. carried

   ダンジョン内で保持している未確保品です。全滅、撤退失敗、特定イベントで失う可能性があります。

2. secured

   地上へ帰還または安全地点へ搬送し、王国資源、装備、遺物として確定したものです。

この区別により、深く進むほど報酬が増える一方、喪失リスクも増えます。

### 11.5 ダンジョンの帝国効果

ダンジョンから次を獲得できます。

1. dungeonMaterials
2. 装備
3. 遺物
4. 技術またはEureka相当の進捗
5. 英雄、捕虜、人材
6. 地上施設の解禁
7. 一時的または恒久的な王国Modifier
8. 勝利条件に関わる重要品

帝国側からは遠征隊へ装備、生産物、補給、研究解禁を提供します。

### 11.6 競合

初期実装では一つのダンジョンに同時に入れる遠征隊を一隊とし、占有状態を明示します。複数王国が同一ダンジョンへ同時侵入する共有インスタンスは、マルチプレイ競合解決とPvP規則が必要なため後続仕様とします。

## 12. イベント

イベントはターン制の Command 解決です。リアルタイムの時計や自動進行はありません。

選択必須イベントが発生した場合、対象プレイヤーは回答するまで EndTurn できません。順次ターンでは対象プレイヤーの入力だけをイベントへ限定します。

同時ターンでは他プレイヤーのローカル入力を止めません。ただし共有状態へ影響する結果は Resolution barrier で確定し、先着入力による不公平を避けます。

イベント定義は trigger、conditions、target、pages、choices、effects、once、cooldown、visibility を持ちます。

## 13. 研究と社会制度

王国は同時に技術一件と社会制度一件を選択できます。ターン開始時に science と culture のYieldをそれぞれ進捗へ加算します。

技術、社会制度はユニット、建物、District、改善、政策、ダンジョン攻略能力を解禁します。特定条件の達成でEurekaまたはInspiration相当の進捗ボーナスを得られます。

## 14. 勝敗

Civ型の複数勝利条件とダンジョン固有勝利を併存させます。実装候補は次です。

1. Domination

   全敵王国の首都を支配します。

2. Science

   最終技術と大規模Projectを完成させます。

3. Culture

   文化的影響力の条件を満たします。

4. Dungeon

   最深層ボスを倒し、指定された重要遺物を確保し、王国Projectを完成させます。

5. Score

   最大ターン到達時に総合得点を比較します。

初期プレイ可能版は Domination と Dungeon の二条件を優先します。具体的な最終条件とゲーム長は未確定です。

## 15. マップ

地上はポイントトップ型六角形マップです。地形は連続性のある生成器で作り、独立一様ランダム配置は使用しません。

WorldMap は次を扱います。

1. terrain
2. feature
3. elevation
4. resource
5. riverEdge
6. road
7. improvement
8. district
9. ownerId
10. visibility
11. dungeonSite

マップ、ダンジョン、AI、イベントの乱数ストリームを分離し、同じseedとCommand列から同じ結果を再現できるようにします。

## 16. セーブとマルチプレイ

セーブは GameState と Ruleset のバージョン、全乱数状態、CommandLog をJSONで保存します。初期は localStorage とJSONエクスポートを使います。

オンラインマルチプレイではホストまたはサーバーを権威状態とします。クライアントはCommandを送信し、確定GameStateまたは差分を受け取ります。表示オブジェクトを同期対象にしません。

切断プレイヤーを一時的にAIへ引き継ぐ Controller 交換を可能にします。

## 17. 未確定事項

次は実装前または該当マイルストーン開始前に確定します。

1. 時代区分とゲーム全体の標準ターン数
2. 勝利条件の具体値
3. 技術、社会制度、宗教、外交の初期収録範囲
4. 同時ターンでの競合優先規則
5. ダンジョンの一階あたりの大きさと標準深度
6. 遠征隊の編成人数
7. 補給切れ、全滅、撤退時の損失
8. 同一ダンジョンへの複数勢力侵入
9. 世界マップとダンジョンの戦闘式を完全共通化する範囲
10. Civ型の時代発展をそのまま採用するか、ファンタジー独自段階に置換するか

未確定事項は Ruleset で変更可能な構造にし、コード内へ固定値として埋め込まないでください。
