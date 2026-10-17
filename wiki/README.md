# Kingdom Wiki

王国を育て、パーティーを編成し、領土とダンジョンへ進むためのゲーム事典です。資源の使い道、ユニットの能力、地形の産出、都市の成長や戦闘の仕組みを項目ごとに調べられます。

## 項目を探す

| 一覧 | 掲載内容 |
| --- | --- |
| [リソース一覧](./resources/README.md) | 食料・生産・Gold・科学・mana・宗教・文化・人心の8項目 |
| [ユニット一覧](./units/README.md) | 戦士の能力と費用、開拓者・労働者の予定仕様 |
| [区画一覧](./districts/README.md) | 区画の位置づけ、都市中心・建物・改善との区別 |
| [建物一覧](./buildings/README.md) | モニュメントの効果と費用 |
| [地形一覧](./terrain/README.md) | 6種類の地形、産出と移動コスト |
| [行動一覧](./rules/actions.md) | 都市・パーティーで行える操作と利用範囲 |
| [用語索引](./GLOSSARY.md) | 日本語名・英語名から関連項目を探す |

## 仕組みを調べる

| 分野 | ページ |
| --- | --- |
| 王国運営 | [都市と生産](./rules/cities.md)・[人口と人的資源](./rules/population.md)・[領土の取得](./rules/territory.md) |
| 国家の力 | [軍事力・統治力・負荷](./rules/governance.md)・[研究と制度](./rules/research.md) |
| 部隊運用 | [パーティーと配置](./rules/parties.md)・[戦闘](./rules/combat.md)・[能力と状態](./rules/abilities.md) |
| 冒険・競争 | [ダンジョンと戦利品](./rules/dungeons.md)・[勝利条件](./rules/victory.md) |
| 基本操作 | [ターン・開始時の状態・保存](./rules/turns.md) |

## 現在遊べる範囲

都市の生産・購入、領土拡張、指定Unitによるパーティー作成・選択・3×3配置編集・経路移動、セル/Unit詳細、ターン終了と保存が利用できます。戦闘処理はありますが、攻撃を画面から操作する機能はありません。区画、研究対象の選択、NPC加入、ダンジョン、勝利判定は未実装です。

各項目の「現在」は確認時点の挙動、「予定」は設計がある未実装部分を指します。個別名や数値が未定のものは、未定と記載します。Civilization VIの施設・技術・数値をそのままKingdomの内容として補ってはいません。

2026-10-17に地形・都市・戦士・資源の画像17点と効果音11点・地上BGMを画面へ接続しました。部隊の選択解除と購入前の価格表示もあります。音声は初期オフ、画面の音声設定から有効化できます。第2段階で音声読み込み失敗時の再合成と再試行、3×3の配置編集を追加しました。第3段階でマップを331セルへ広げ、初期部隊、待機Unit表示、セル/Unit詳細、カメラ・全体図を追加しました。操作方法は[マップ操作](../doc/MAP_OPERATIONS.md)を参照してください。[素材台帳](../doc/ASSET_AUDIT.md)・[検証範囲](../doc/ASSET_INTEGRATION_QA.md)を参照してください。

第2段階確認日: 2026-10-17。開始基準はmain / a9e66eaad5290c366c96eeacd07b1fce497b5dee。変更された画面操作・編成・戦闘条件を更新しました。初回調査時のmainは [636c222](https://github.com/TomTomYoung/kingdom/commit/636c222634927ec2fe54dd1b5e33d1950c31861e)、ゲームコードの基準はe0dcb3f、ルール版はm1.0です。今後の変更に合わせて項目を更新します。

開発上の既知課題は [STATUS](../doc/STATUS.md)、実装詳細は [CURRENT_IMPLEMENTATION](../doc/CURRENT_IMPLEMENTATION.md)、Wikiの更新方法は [EDITING](./EDITING.md) にあります。
