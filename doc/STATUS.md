# Kingdom 進捗

更新日: 2026-09-08

目標仕様: Civilization VI 型帝国運営とダンジョン探索

現行コード基準: index.html、コミット 297199396d27a88392dbe9423e96fb7388f30593

## 1. 現在地

仕様文書は目標形へ更新されましたが、ゲームコードは以前の技術試作のままです。目標仕様に対する実装段階は M0「仕様再編完了」です。

現行コードにあるのは、Phaser起動、六角形マップ、3プレイヤー、簡易領土、王国単位の資源、人口、文字ユニット、文字建物、ターン送り、文章イベント、移動範囲、A*形式探索の骨格です。

都市単位生産、Production queue、Gold purchase、Culture border growth、mana、GovernanceCapacity、人的資源Pool、統一Unitモデル、Party、Formation、Controller分離、AI意思決定、Dungeon、Expedition、セーブ、マルチプレイは未実装です。

## 2. マイルストーン

### M0 仕様再編

状態: 完了

1. Civ6型の生産と購入を区別
2. ソロとマルチのController仕様を定義
3. ターン開始時の資源解決を定義
4. ユニット別行動回数を定義
10. 地上とダンジョンのターン同期を定義
11. 現行実装仕様を別文書へ退避

### M1 単一都市のCiv型ループ

状態: 未着手

1. GameStateを正本化
2. Kingdom、City、Unitのモデル統一
3. ターン開始時Yield解決
4. 都市Production progress
5. Gold即時購入
6. Culture自然拡張とGoldタイル購入
7. 人間一人で複数ターン進行

### M2 地上4X垂直スライス

状態: 未着手

1. 複数都市
2. SettlerとBuilder
3. 戦士、探索、戦闘
4. Party作成とFormation
5. 技術研究とmana
6. GovernanceCapacityと人的資源
7. 敵王国AI
6. 蛮族
7. Domination仮勝利

### M3 ダンジョン垂直スライス

状態: 未着手

1. Dungeon Site
2. Expedition Party
3. Dungeon用Formation
4. 一階層の生成
4. 探索、戦闘、宝箱、撤退
5. carriedとsecuredの戦利品
6. 帝国への資源、mana、人材の還元

### M4 統合ゲーム

状態: 未着手

1. 複数階層とボス
2. Dungeon勝利
3. 地上AIの遠征判断
4. 装備、生産、研究の相互接続
5. イベントデータ化
6. セーブとロード

### M5 マルチプレイ

状態: 未着手

1. HumanとAIのスロット割当
2. Sequentialマルチ
3. 権威GameStateとCommand同期
4. 切断時AI引継ぎ
5. Simultaneous競合解決

## 3. 現行コードの再利用可能部分

1. Hex、Layoutの基本座標表現
2. Phaserによる地図描画の試作
3. Tileデータの基本形
4. DataManagerによるデータ読込の発想
5. 到達範囲探索とA*のたたき台
6. イベントウィンドウのページ送り
7. カメラ移動とズーム
8. turn stateという概念

いずれもそのまま完成部品ではなく、GameStateとCommandを正本にした上で修正して使います。

## 4. P0 不具合

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

これらを個別に延命修正するのではなく、M1でモデル統一とCommand化を行う中で解消します。ただしHex丸め、描画リークなど独立修正可能なものは小さなコミットに分けます。

## 5. テスト状況

自動テスト、CI、固定seed、再現用セーブはありません。ブラウザ実行の正式な確認環境も記録されていません。

M1開始時に次を追加します。

1. Hex cube roundの単体テスト
2. Yield集計の単体テスト
3. Production完成とoverflowの単体テスト
4. Gold purchaseの単体テスト
5. Territory取得の単体テスト
6. Turn incrementの単体テスト
7. 固定seedのスモークテスト

## 6. リポジトリ状況

コードは index.html 一ファイルです。Issue、Pull Request、CIはありません。実装コミットは2024-09-21から2024-09-23に集中しています。

現行コードの詳細は CURRENT_IMPLEMENTATION.md、今後の規範は SPECIFICATION.md、次作業は HANDOFF.md を参照してください。
