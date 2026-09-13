# Kingdom 旧Phaser版の実装調査（保存資料）

この文書は、目標仕様を「Civilization VI 型帝国運営＋ダンジョン探索」へ再編する前の実装調査を保存したものです。

調査対象: 旧 index.html、コミット 297199396d27a88392dbe9423e96fb7388f30593

現在のコード保存先: [legacy/index.html](../legacy/index.html)。以下の「現行」は旧調査時点を指します。現在のES Modules版は [CURRENT_IMPLEMENTATION.md](./CURRENT_IMPLEMENTATION.md) を参照してください。

今後の規範仕様は SPECIFICATION.md を参照してください。

旧調査日: 2026-09-08

保存資料への整理日: 2026-09-13

対象: main ブランチ、HEAD 297199396d27a88392dbe9423e96fb7388f30593

## 1. この文書の範囲

この文書は、index.html に実装されている現行プロトタイプを仕様として記録したものです。将来構想を確定する企画書ではありません。コード上に型や処理の骨格だけがある機能も含むため、実際に操作可能かどうかは STATUS.md を参照してください。

## 2. プロジェクト概要

ブラウザで動作する、ポイントトップ型六角形グリッドのターン制ストラテジーです。地形から資源を得て人口を増やし、領土、ユニット、建物を拡張する方向の試作になっています。外部ビルド工程はなく、HTML、CSS、JavaScript が index.html 一枚に収録されています。

## 3. 実行環境

1. ブラウザで index.html を開きます。
2. Phaser 3.55.2 を cdnjs から読み込みます。
3. ゲーム描画領域は 800 × 600 ピクセルです。
4. Phaser.AUTO により WebGL または Canvas が選択されます。
5. サーバー、データベース、保存機能、ビルドツール、パッケージ管理はありません。
6. CDNへ接続できない環境では起動しません。

## 4. 画面と操作

画面中央に六角形マップを表示し、左上にターン、プレイヤー、資源、人口を表示します。左側に領土拡張、ユニット作成、建物建設の選択肢があり、右上付近にターン終了があります。

操作として実装されている入口は次のとおりです。

1. 左クリックでタイルまたはユニットを選択します。
2. 右クリックまたは選択後の左クリックで、到達可能範囲内への移動を試みます。
3. マウスドラッグでカメラをスクロールします。
4. マウスホイールでズームします。
5. Space キーまたはターン終了表示でプレイヤーフェーズを終了します。
6. マウス位置の q、r、s 座標を画面下部に表示します。
7. ランダムイベント発生時は HTML のイベント窓を表示し、前ページ、次ページ、閉じるを操作できます。

ズーム値には上下限が設定されていません。ブラウザの右クリックメニュー抑止も実装されていません。

## 5. マップ仕様

座標はキューブ座標 q、r、s を使い、原則として q + r + s = 0 を保ちます。ポイントトップ型レイアウトです。

mapSize は 11、実プレイ領域の最大絶対座標は 5です。外周一層は Void タイルとして生成されます。地形は Plain、Hill、Grassland、Forest から一様ランダムに選ばれます。シード固定はありません。

地形の現行データは次のとおりです。

1. Plain: 表示名は平原、food 1、移動コスト 1
2. Hill: 表示名は丘陵、gold 1、移動コスト 2
3. Grassland: 表示名は草原、food 1、移動コスト 1
4. Forest: 表示名は森林、wood 1、移動コスト 2
5. Void: 外周用、移動コスト Infinity

地形色は Grassland が黄緑、Forest が緑、Hill が茶、その他が灰色です。Plain は専用分岐がないため灰色になります。Sea 用の青色分岐はありますが、Sea データはありません。

川または壁を各辺10%で生成しようとする処理があります。川は移動コスト +2、壁は +1000 の想定です。ただし現行実装では生成した辺情報がタイルに保存されず、実ゲームには反映されません。

## 6. プレイヤーと領土

プレイヤーは3人作られ、IDは 0、1、2 です。開始地点は次の3座標です。

1. 0, 0, 0
2. 5, -5, 0
3. -5, 5, 0

各プレイヤーは首都を中心とする半径2相当の領土を初期取得します。領土取得時に Tile.owner へプレイヤーIDを記録します。領土の所有色や境界線は描画されません。また、開始地点同士の距離に対して初期領土が大きく、重複タイルは後に処理されたプレイヤーの owner で上書きされる一方、各プレイヤーの territory 配列には残ります。

## 7. 資源と人口

プレイヤーの基本資源は food、production、gold、science で、初期値はいずれも0です。地形データに現れる wood は、収集時に動的にプレイヤー資源へ追加されます。resourcesJSON に religion と初期 value がありますが、Player 初期化には反映されません。

ターン開始時、全プレイヤーが所有領土の全タイルから資源を得ます。人口の半分を切り捨てた値が science に加算されます。

人口成長は food が population × 2 以上の場合に自動実行され、必要量を消費して人口が1増えます。各ターンにつき各プレイヤー最大1回です。

現行の消費予定は次のとおりです。

1. ユニット作成: production 10
2. 建物建設: production 20
3. 技術研究: Technology.cost 相当の science
4. 領土拡張: gold 10 を要求する意図が読み取れますが、現行コードでは日本語キーを参照し、消費処理もありません。

production を産出する地形または建物効果は未実装です。

## 8. ユニット、建物、技術

Unit は type と hex、Building は type と hex、Technology は name、cost、effects を保持する最小クラスです。

サンプルキャラクターとして戦士Aと労働者BがJSONにあります。戦士Aは hp 100、attack 10、movement 2、労働者Bは hp 50、attack 1、movement 2です。攻撃、待機、建設のアクション定義と関数がありますが、画面操作やターン処理には接続されていません。

CharacterLayer は起動時に P 表示のキャラクターを3体ランダム配置します。その後、サンプルキャラクター2体、敵プレイヤー1体、蛮族1体も追加します。BuildingLayer は開始時に中央へ都市を1件表示します。

ユニットとキャラクターに別の管理配列があり、現時点では統一されていません。建物も Player.buildings と BuildingLayer.buildings の二重管理です。

## 9. ターン進行

状態名として TURN_START、PLAYER_PHASE、OTHER_PLAYERS_PHASE、CPU_PHASE、TURN_END があります。

現在実際に使われる流れは、TURN_START から PLAYER_PHASE へ入り、ターン終了操作のたびに currentPlayerIndex を進め、3人全員の PLAYER_PHASE が終わると currentTurn を増やして TURN_START に戻る形です。

OTHER_PLAYERS_PHASE、CPU_PHASE、TURN_END の処理は存在しますが、現在の endPlayerPhase からは到達しません。そのため enemyTurn と barbarianTurn は通常の進行では呼ばれません。

PLAYER_PHASE に入るたび30%の確率で ancient-ruins イベントが発生します。内容は3ページの文章表示だけで、選択肢や報酬、ゲーム状態への効果はありません。

## 10. 移動と経路探索

到達範囲探索は残移動力を持つ幅優先探索です。経路探索は独自 PriorityQueue を使った A* 形式で、ヒューリスティックはキューブ座標距離です。Void は通行不能相当です。

ただし、現行キャラクターの所有者表現が数値プレイヤーIDと一致せず、通常操作では自軍ユニットとして選択できません。さらに経路復元結果に開始地点が含まれ、その地点のコストまで消費するため、移動可能量の計算が不正確です。

## 11. イベント

イベント定義は DataManager にJSONとして読み込まれます。現行イベントは ancient-ruins 一件です。ページ送り、戻る、閉じるができます。イベント表示中も Phaser 側の入力やターン終了を止める状態管理はありません。

## 12. 内部構造

主な責務は次のように分かれています。

1. SceneManager: シーン切替の薄いラッパー。現状未使用
2. EventManager: Phaser EventEmitter のラッパー。現状未使用
3. GUIManager: GUI要素管理。現状未使用
4. DataManager: 埋め込みJSONの読込と資源名変換
5. Hex、Layout、PriorityQueue: 座標変換と探索
6. TileLayer、BuildingLayer、CharacterLayer、GUILayer: 描画と画面上のオブジェクト管理
7. Tile、Player、Unit、Building、Technology: ゲームデータ
8. GameScene: 初期化、入力、UI、ターン、イベント、AI、移動を集中管理

同じ目的の旧コードが大量にコメントアウトされ、GameScene 内には TileLayer と重複する createGrid、getMovementCost、drawHexagon も残っています。現行の保守単位は index.html 一ファイルです。


## 13. 旧版からの再利用候補と当時の不具合

以下は旧版に対する調査記録です。現在のmainで発生している不具合一覧ではありません。現行の課題は [STATUS.md](./STATUS.md) を参照してください。

### 旧版の再利用候補

1. Hex、Layoutの基本座標表現
2. Phaserによる地図描画の試作
3. Tileデータの基本形
4. DataManagerによるデータ読込の発想
5. 到達範囲探索とA*のたたき台
6. イベントウィンドウのページ送り
7. カメラ移動とズーム
8. turn stateという概念

いずれもそのまま完成部品ではなく、GameStateとCommandを正本にした上で修正して使います。

### 当時のP0不具合

1. resources.金 と resources.gold の不一致で領土拡張できません。
2. production の供給源がなく、UnitとBuildingを作れません。
3. CharacterLayer.addCharacter が未定義です。
4. ownerが数値、文字列、undefinedで混在し、自軍判定が成立しません。
5. CharacterLayer.characters と Player.units が二重管理です。
6. BuildingLayer.buildings と Player.buildings も二重管理です。
7. 現行 endPlayerPhase から OTHER_PLAYERS_PHASE と CPU_PHASEへ到達しません。
8. 川と壁の辺情報を生成直後に破棄しています。
9. 移動経路が開始地点のコストを余計に消費します。
10. cube coordinateの丸めが不正確です。
11. タイルと建物の再描画でText objectが増殖します。
12. 初期領土が重複し、Tile.ownerとPlayer.territoryが矛盾します。

当時はM1でモデル統一とCommand化を行う方針でした。現在はES Modules版へ置換済みです。旧版にしかない河川、カメラ、イベント等まで現行版へ移植・修正済みという意味ではありません。

