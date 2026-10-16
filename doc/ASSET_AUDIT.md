# Kingdom 素材総点検・制作適用台帳

開始日: 2026-10-17（日本時間）
調査基準: main / f59804d8b6dfad75704bfa40024e148dee03391b

依頼: 今ある素材を含めて必要なものを総ざらいし、順番に制作・実装適用する。

## 1. 今回の進め方

既存27点を一つずつ確認し、現在遊べる画面から接続する。旧版・編集原稿・制作ジョブを残し、差し替え時はv002以降を追加する。見た目を変えただけで未実装ルールを実装済みにしない。

制作・ファイル検査・画面接続・画面目視・音声デコード・聴取を別々に記録する。音声波形の解析は、人が実際に聴いて確認した意味にはしない。素材の採用版とハッシュは `assets/manifest.json` に記録する。

画像は既存AIPaintの緑・金・石色のドット絵を基準とする。地形64×64、都市・Unit48×48、資源24×24、透過PNG。縦横同率の整数倍で表示し、画像に人数・HP・陣営色を焼き込まない。狭い画面は地図部分だけ横スクロールし、タイルや人を横に潰さない。

現在のゲームで必要な27点のうち、戦闘曲1点だけは戦闘UI未実装につき接続を待つ。今回はそれ以外の26点を接続し、現在ある自然拡張・保存・復元に不足するSE3点を新規制作する。後続素材は接続先の機能と一緒に進める。

## 2. 既存ファイル全体の点検

リポジトリ内217ファイルをGit blob SHAで照合。既存素材27点のPNG・WAV・Ogg、編集原稿、ジョブ、レポートを保持した。全素材のSHA-256、PNG透過・寸法・RGBA、音声復号・長さ・無音・クリッピング・ループ境界を再検査し、27点すべて成功。17点のコンタクトシートを目視した。

初回制作の詳細は [ASSET_LIST.md](ASSET_LIST.md)、画像・音声の原版一覧は [ASSET_PREVIEW.md](ASSET_PREVIEW.md)、再生成手順は [tools/assets/README.md](../tools/assets/README.md)。初回記録は削除しない。

## 3. 地上マップと都市: 8点

以下はすべて既存v001。第1段階で接続する。

- `terrain-plains` 平原: 64×64。短い草と黄緑の地面。terrainId=plainsへ対応。
- `terrain-grassland` 草原: 64×64。密な草と緑色の地面。plainsと明度・草量の差を確認。
- `terrain-forest` 森林: 64×64。樹冠と幹。地形移動コスト2の表示と整合。
- `terrain-hills` 丘陵: 64×64。岩山・稜線。森林と色・輪郭で区別。
- `terrain-arcane` 霊脈: 64×64。紫の岩盤と結晶。mana産出に対応。
- `terrain-void` 虚無: 64×64。暗い亀裂。盤面外・未ロード画像と区別し、通行不能の扱いを維持。
- `building-city` 都市: 48×48。地図と首都欄に表示。都市上のPartyと位置をずらす。
- `building-monument` モニュメント: 48×48。生産選択・建設済み一覧・地図の都市に表示。未建設時には地図へ出さない。

## 4. Unitと資源: 9点

以下はすべて既存v001。第1段階で接続する。

- `unit-warrior` 戦士: 48×48。地図のParty、選択Party欄、生産欄で共用。人数は別表示。
- `icon-food` 食料: 24×24。都市産出欄。
- `icon-production` 生産: 24×24。都市産出欄。
- `icon-gold` Gold: 24×24。国庫と産出欄。
- `icon-science` 科学: 24×24。進捗と産出欄。
- `icon-mana` Mana: 24×24。国庫と産出欄。
- `icon-religion` 宗教: 24×24。都市産出欄。備蓄資源として表示しない。
- `icon-culture` 文化: 24×24。進捗と産出欄。
- `icon-popular-support` 人心: 24×24。国庫欄。個人loyaltyと混同しない。

## 5. 既存音声: 10点

44.1kHzステレオ。SEはWAV、BGMはOgg。既存v001の音量は保持し、ゲーム側で主音量とBGMゲインを調整する。

- `se-ui-select` 選択: Partyを選択したとき。
- `se-ui-confirm` 確定: 生産設定・Party作成に成功したとき。
- `se-ui-cancel` 解除: 選択解除ボタン、同Party再選択、Esc。
- `se-ui-error` 拒否: 資金不足、移動不可、Unit不在、セーブ失敗など。成功音と同時に鳴らさない。
- `se-turn-start` 手番: ターン進行・新規開始。完成・自然拡張の通知がある場合はそちらを優先。
- `se-production-complete` 完成: `ItemCompleted` のsource=productionのみ。購入を完成通知に重複させない。
- `se-purchase` 購入: Item購入またはGoldによる領土購入の成功時。
- `se-party-move` 足取り: `PartyMoved` 成功時。失敗移動には鳴らさない。
- `bgm-overworld` 暁の王領: 地上操作中のループ。初期はミュート、利用者の操作で有効化。音量と設定を保存。
- `bgm-battle` 剣旗の進軍: 原版保持。戦闘UI待ち。音声切替基盤は用意するが、現在の都市運営中には鳴らさない。

## 6. 今回追加する音声: 3点

AIMusicの既存固定版と編集可能な音符モデルを使用する。既存音声の複製でなく用途別の短い音型を作る。原稿・ジョブ・MIDI・元レンダーレポート・WAV・ハッシュを保存する。

- `se-territory-expand`: 自然文化拡張。柔らかな上昇する和音、約0.5〜0.9秒。`TerritoryExpanded` のsource=cultureだけに接続。Gold購入には使わない。
- `se-save`: 保存成功。落ち着いた下降2音、約0.2〜0.5秒。localStorage書き込みが成功してから再生。
- `se-load`: 復元成功。短い上昇3音、約0.3〜0.6秒。セーブがない・壊れている場合はエラー音。

## 7. 可変状態の表示素材

以下は画像ファイルにせずCanvas／DOM／CSSの描画として整備する。画像制作数に加えない。

- 所有領土の金枠、購入候補枠、購入価格の事前表示。
- Party選択輪郭、同一Hex上の都市との位置調整、味方・敵の色、人数札。
- Party合計HPバー。HP0を回復させるなどルールの変更は行わない。
- 合法な隣接移動先の点線枠、移動費、残り移動力・攻撃回数。
- 選択解除ボタン、現在の操作モード表示、保存・ロード後の選択クリア。
- 食料・文化の進捗バー、音声オン・オフ、音量、読み込み失敗時の通知。
- 画像未取得時の地形色・城文字・部隊記号。画像失敗でゲーム操作を止めない。

## 8. 次の制作: M2戦闘とParty詳細

ゲーム不具合K-01〜K-05等を先に修正し、戦闘UIとResolverのイベントに合わせて少量ずつ制作する。未実装Guard等を装飾だけで公開しない。

画像・コマ素材:

- `effect-melee-slash`: 48×48、4〜6コマ。近接攻撃。
- `effect-hit`: 32×32、4コマ。被弾。
- `effect-ranged-projectile`: 24×24。飛翔方向は等方回転、着弾はhitを共用。
- `effect-guard`: 48×48、4コマ。Guard配分が実際に発生したとき。
- `effect-intercept`: 48×48、4コマ。庇った側と庇われた側を区別。
- `effect-recovery`: 48×48、4〜6コマ。回復が実装された時点で採用。
- `icon-downed` / `icon-shattered`: 各24×24。個人の戦闘不能と部隊崩壊を分ける。
- `icon-low-morale` / `icon-leader`: 各24×24。士気と指揮者。
- `icon-movement` / `icon-attack` / `icon-guard`: 各24×24。行動・容量の意味を固定してから作る。
- `icon-military-power` / `icon-governance` / `icon-governance-load`: 各24×24。派生能力と負荷。資源アイコンを流用して同じ意味に見せない。

効果音・曲:

- `se-melee` / `se-hit` / `se-ranged`: 攻撃・被弾・遠隔。
- `se-guard` / `se-intercept`: Guardと庇い。
- `se-downed` / `se-party-defeated` / `se-leader-change`: 個人状態、Party敗北、指揮継承。
- `se-recovery` / `se-retreat`: 回復・撤退。
- `bgm-victory` / `bgm-defeat`: 短い終止形。戦闘曲の停止・復帰と一緒に実装。

3×3 Formation、空Slot、列の露出、攻撃予測、ダメージ数値、Guard配分線はコード描画。配置・数値ごとの画像は作らない。

## 9. M2の地上運営拡張で必要なもの

採用する定義がまだないものは候補。ゲームデータに種類と役割が入ってから制作数を確定する。

- `unit-settler` / `unit-builder` / `unit-scout`: 48×48。入植・建設・偵察。戦士とシルエットを分ける。
- `npc-adventurer` / `npc-merchant` / `npc-recruit`: 48×48。冒険者・商人・加入候補。顔・性別・所属はキャラクター定義に従う。
- `party-barbarian`: 48×48。敵対Partyの仮候補。陣営色だけに頼らない識別。
- `improvement-farm` / `improvement-mine` / `improvement-lumbermill`: 48×48候補。改善ルール確定後にタイルへ重ねる。
- `overlay-road` / `overlay-river`: 接続方向別。道路・河川Edgeモデルの採用後に規格化。
- `icon-research` / `icon-recruit` / `icon-loyalty` / `icon-upkeep`: 各24×24。研究・募集・個人忠誠・維持費。人心備蓄と区別。
- `se-city-founded` / `se-improvement-complete` / `se-research-complete` / `se-recruit`: 各1点。対応成功イベントとセット。
- `bgm-town`: 1ループ。都市専用画面を設けた場合の候補。現行画面では地上曲を継続する。

王国の旗・紋章、人口・研究・生産の詳細パネル、外交・勝利画面はレイアウト確定後に規格追加。多国切替・非公開情報・色覚以外の識別を画面設計に含める。

## 10. M3〜M4のダンジョンで必要なもの

視点、セル寸法、地形ルールを確定してから作る。地上Hexと別の表示規格を混在させない。

- `dungeon-entrance`: 地上マップの入口、48〜64px候補。
- `dungeon-floor` / `dungeon-wall` / `dungeon-door` / `dungeon-stairs`: 探索視点に対応する1セット。扉は閉・開、階段は上り・下りの状態差分。
- `object-chest-closed` / `object-chest-open` / `object-trap` / `object-camp`: 32〜48px。罠の未発見状態を見せない。
- `monster-slime` / `monster-goblin`: 各48×48候補。正式な敵データ採用前に必須種扱いしない。
- ボス: 敵の種類、攻撃範囲、表示寸法ごとに個別IDを追加。未確定のボスを先に量産しない。
- `resource-relic` / `resource-dungeon-material`: 各24×24。遺物と素材。
- `icon-loot-carried` / `icon-loot-secured`: 各24×24。未確保と確保済みを輪郭でも区別。
- `effect-spell` / `effect-poison` / `effect-burn` / `effect-stun`: 32〜48pxのコマ素材。属性・状態効果の定義に従う。
- `bgm-dungeon` / `bgm-boss`: 各1ループ。通常探索とボス戦。
- `se-door` / `se-chest` / `se-trap` / `se-stairs` / `se-loot-secured`: 各1点。退出・撤退音は地上側と共用可能か聴取して決める。

装備種ごとのアイコン、イベント挿絵、タイトルロゴ、キービジュアル、人物立ち絵・表情はコンテンツと画面構成が確定したら別枠で追加する。現時点で絵柄やキャラクター設定を新規決定しない。

## 11. 制作・適用順と受入条件

1. 既存27点の再点検・台帳化。全ファイルのハッシュ、画像寸法と透過、音声解析を確認。
2. 地形6点→都市2点→戦士1点→資源8点の順に接続。欠損画像・細い画面・都市上のPartyを確認。
3. 既存SE8点・地上BGMを接続。ユーザー操作で開始、ミュート、音量保存、非表示停止、連打制限、失敗音の分離を確認。
4. 自然拡張・保存・復元のSE3点を制作して接続。古い音声を削除しない。
5. M2のルール修正と戦闘UIに合わせ、近接・被弾→遠隔→Guard・Intercept→状態・結果の順に制作・接続。
6. 地上運営拡張、Dungeonの各機能に合わせて制作。毎回、画面到達条件と再開位置をHANDOFFへ残す。

同一操作から複数通知が出る場合は、購入→生産完成→移動→自然拡張→新手番→汎用確定の順で1音に絞る。ロード時には過去eventLogを再生しない。BGM切替、ミュート直後、非表示直後に読み込みが完了しても古い音を開始しない。

## 12. 今回の実施結果

第1〜4段階を実装しました。画像17点、SE11点、地上BGMの29点を現在のUIへ接続し、戦闘BGMは未接続のまま保持しています。追加SEは自然拡張0.799秒、保存0.319秒、復元0.395秒です。旧v001原稿・画像・音声は変更していません。

Node標準32テスト、全JS構文、素材30点の整合性・復号、実UIコードによるDOM/Canvas操作検証に成功。画像欠損時の操作継続も確認しました。地形一覧とゲームCanvasは目視済みです。実ブラウザのレイアウト・実音声出力・聴取は未確認で、manifestのruntimeConnectedと最終integrated判定を分けています。詳細と再開手順は[接続検証記録](ASSET_INTEGRATION_QA.md)。

次は接続29点のブラウザ表示・聴取確認、その後K-01等の状態検証を修正し、戦闘UIと近接・被弾素材を進めます。将来分まで制作済みとは扱いません。
