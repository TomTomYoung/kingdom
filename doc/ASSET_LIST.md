# Kingdom 素材制作一覧

2026-10-17更新: 最新の必要素材・接続状態は[素材総点検台帳](ASSET_AUDIT.md)、検証範囲は[接続検証記録](ASSET_INTEGRATION_QA.md)を参照してください。既存26点と追加SE3点を接続しました。以下の2026-09-13記載は初回制作時の記録として保持しています。

作成日: 2026-09-13

参照したkingdom: main / 99fa298b51a2a76c40df6288981162f4112b9aff。ゲームコードの基準はe0dcb3fです。

## 1. 制作方針

画像は [AIPaint](https://github.com/TomTomYoung/AIPaint)、音声は [AIMusic](https://github.com/TomTomYoung/AIMusic) を使って制作します。PNG・再生用音声だけでなく、各ツールで編集できる原稿と再生成ジョブを残します。

画像は現行の落ち着いた緑・金・石色を基調とするドット絵です。輪郭・基本色・ハイライトの2〜3段階で読みやすくし、拡大時はnearest-neighborを使います。陣営色、人数、HP、選択枠、移動範囲、数値・文字は実行時の描画で重ね、素材へ焼き込みません。

BGMは古典的なダンジョンRPGを想定した器楽曲です。地上は探索と国づくり、戦闘は緊張と前進を音型で分けます。AIMusicの内蔵シンセと編集可能な音符で作り、既存曲や外部音源を素材として取り込みません。

現在の画面は図形・文字描画のみで、画像読込・音声再生基盤はありません。「素材制作済み」と「ゲームへ接続済み」を区別します。既知のゲーム不具合は [STATUS.md](./STATUS.md) にあり、この一覧によって解決済みにはしません。

## 2. 制作環境と保存規則

AIPaint確認版: be94fc261c1ce926a5d63bf0720feb4b6bb2fd0d。paint-job/1、pixel-v0.1、paint-project/0.1を使用します。AIPaintのexecuteJob／PaintCoreで描画し、Node実行時のPNG梱包だけをアダプターが担います。ブラウザ画面を操作したという意味ではありません。

AIMusic確認版: 399fe1351368755f116512a459c95ecf555c5cba。aimusic-job version 1、aimusic-project version 1、pcm-synth/1を使用します。正式CLIでWAV・MIDI・原稿・解析レポートを生成します。

両アプリには別リポジトリへの自動保存機能がないため、成果物はkingdomへGitHub連携で格納します。AIPaint／AIMusic本体はこの作業で変更しません。

素材IDは英小文字とハイフンで固定し、原稿更新はv001、v002…と版を分けます。配置先は `assets/graphics/<asset-id>/<revision>/`、`assets/audio/<asset-id>/<revision>/`、制作ジョブはassets/jobs/、素材索引は [assets/manifest.json](../assets/manifest.json) です。

画像は透過RGBA PNG、地形64×64、建物・人物48×48、アイコン24×24が初回規格です。地形はpointy-top Hex内部へ描き、外部を透過にします。解像度変更は原稿から行います。

音声はAIMusicでWAVを生成し、BGMの配信用にOgg Vorbisを派生させます。短いSEはWAVを基本にし、余分な末尾無音だけを整えます。編集元JSON、MIDI、元レンダーレポート、派生処理、SHA-256を保存します。ループは曲頭0からスコア終端とし、継ぎ目の解析と聴取状況を記録します。

## 3. 初回制作 P0: 画像17点

状態: 17点すべてv001を生成し、寸法・透過・原稿往復・PNGの再デコードと一覧画像の目視を確認しました。ゲーム未接続です。画像は [ASSET_PREVIEW.md](./ASSET_PREVIEW.md) で確認できます。

1. terrain-plains: 平原。64×64。短い草と土の筋で草原と区別する。現行terrainId: plains。
2. terrain-grassland: 草原。64×64。密な草地と明るい葉。terrainId: grassland。
3. terrain-forest: 森林。64×64。重なる樹冠と幹、暗い地面。terrainId: forest。
4. terrain-hills: 丘陵。64×64。岩肌と段差、露出した石。terrainId: hills。
5. terrain-arcane: 霊脈。64×64。紫の岩盤と青白い結晶。terrainId: arcane。
6. terrain-void: 虚無。64×64。暗い断裂地形。単なる透明画像にせず盤面外・通行不能を区別する。terrainId: void。
7. building-city: 首都・都市の基本像。48×48。石の塔・城壁・屋根。陣営旗の色は実行時に加える。
8. building-monument: モニュメント。48×48。石碑と台座。city.buildingsのmonumentに対応。
9. unit-warrior: 戦士。48×48。剣・盾・兜の識別可能な全身像。warriorを表し、Party人数表示は別描画。
10. icon-food: 食料。24×24。麦穂。
11. icon-production: 生産。24×24。金槌と金床。
12. icon-gold: Gold。24×24。金貨。
13. icon-science: 科学。24×24。開いた書物。
14. icon-mana: mana。24×24。青紫の結晶。
15. icon-religion: 宗教。24×24。灯火と光輪。science・manaと形で区別する。
16. icon-culture: 文化。24×24。竪琴。
17. icon-popular-support: 人心。24×24。集まる人物の紋章。個人loyaltyと別IDにする。

## 4. 初回制作 P0: SE8点・BGM2曲

状態: SE8点・BGM2曲のv001を生成しました。配信用ファイルのデコード・長さ・無音・数値・クリッピング・BGM境界の解析を確認済みです。聴取とゲーム接続は未実施です。実際の長さと再生用ファイルは [ASSET_PREVIEW.md](./ASSET_PREVIEW.md) とmanifestに記録しています。SEの連打時の聞こえ方と音量バランスは聴取時に確認します。

1. se-ui-select: タイル・Party・項目の選択。短い単音。目安0.08〜0.25秒。
2. se-ui-confirm: 操作確定。上向きの2音。目安0.15〜0.45秒。
3. se-ui-cancel: 選択解除・戻る。下向きの2音。目安0.15〜0.45秒。解除UIは今後実装。
4. se-ui-error: 条件不足・不正操作の拒否。低い短い音型。目安0.15〜0.5秒。失敗でも成功音を鳴らさない。
5. se-turn-start: 自分の手番開始。控えめな鐘。目安0.4〜1.1秒。
6. se-production-complete: Unit・建物の完成。短い上昇フレーズ。目安0.4〜1.2秒。
7. se-purchase: 全額購入の成功。金属的な2打。目安0.15〜0.65秒。購入拒否時はse-ui-error。
8. se-party-move: Partyの1歩移動。軽い足取り。目安0.1〜0.4秒。
9. bgm-overworld: 地上帝国運営・探索。8小節を初回のループ単位とする。穏やかな旋律、分散和音、低音。長時間の操作を妨げない。
10. bgm-battle: Party戦闘。8小節を初回のループ単位とする。短調の動機と明確な拍。戦闘UI実装後の候補で、現在のゲームで鳴るわけではない。

## 5. 次期制作 P1: M2戦闘・操作

これらは初回27素材の確認後に進めます。未実装機能に対応する項目は接続先の設計と同時に確定します。

1. effect-melee-slash: 48×48、4〜6コマ。剣の軌跡。
2. effect-hit: 32×32、4コマ。通常被弾。
3. effect-guard: 48×48、4コマ。盾と反射光。
4. effect-intercept: 48×48、4コマ。割り込みの方向表示。
5. effect-ranged-projectile: 24×24、方向別または実行時回転。矢・投射物。
6. effect-recovery: 48×48、4〜6コマ。回復の光。
7. icon-downed: 24×24。戦闘不能。死者と混同しない。
8. icon-low-morale: 24×24。士気低下。人心と混同しない。
9. icon-movement／icon-attack／icon-guard: 各24×24。移動力、攻撃回数、Guard容量。
10. se-melee／se-hit／se-ranged／se-guard／se-intercept: 各1点。攻撃・命中・防御の音を分ける。
11. se-downed／se-party-defeated／se-leader-change: 各1点。個人の戦闘不能、Party敗北、指揮継承。
12. se-territory-expand／se-save／se-load: 各1点。自然拡張と保存・復元。
13. bgm-victory／bgm-defeat: 各1点、短い終止形。戦果処理の実装に合わせる。

## 6. 後続制作 P2: コンテンツ確定後

1. unit-settler／unit-builder／unit-scout: 各48×48。対応するUnit定義・役割が確定してから作る。
2. npc-adventurer／npc-merchant／npc-recruit: 各48×48。中立NPC・加入候補。性別・職業等の具体設定はデータ側と合わせる。
3. monster-slime／monster-goblin: 各48×48を候補とする。正式採用は敵データを作る段階で決める。
4. dungeon-entrance／dungeon-floor／dungeon-wall／dungeon-door／dungeon-stairs: Hexの寸法・探索視点に合わせる。
5. object-chest-closed／object-chest-open／object-trap／object-camp: 各32〜48px。探索操作の対象。
6. resource-relic／resource-dungeon-material／icon-loot-carried／icon-loot-secured: 各24×24。未確保・確保を形で区別。
7. effect-spell／effect-poison／effect-burn／effect-stun: Status・Spell定義に沿ったコマ素材。
8. bgm-town／bgm-dungeon／bgm-boss: 各1ループ。場所・状況で曲を分ける。
9. se-door／se-chest／se-trap／se-stairs／se-recruit／se-retreat: 対応イベントごとの単発SE。
10. タイトルロゴ、キービジュアル、キャラクター立ち絵、顔差分、大型ボスは画面設計・登場設定が確定してから個別に規格を追加する。

選択枠・陣営境界・移動可能Hex・HPバー・ダメージ数値・Grid・ゲージは当面コード描画とします。可変状態ごとの画像を大量に重複作成しません。

## 7. 完了・採用の判定

planned: 一覧化済み。rendered: 両ツールで原稿から生成済み。checked-candidate: 機械検査・画像目視等の実施範囲を記録した候補。integrated: ゲームの画像読込・音声再生へ接続して実動作確認済み。

音声は解析済みと人間による聴取済みを別フィールドで記録します。無音・非数値・クリッピング・ループ境界の検査だけで聴取済みとはしません。BGM切替・ミュート・音量・ブラウザの再生開始制約は接続時に扱います。

asset-id、revision、toolとcommit、用途、出力形式・寸法・長さ、原稿、job、SHA-256、確認結果、ゲーム接続状態をmanifestへ記録します。旧版を消さず次revisionを追加し、採用版のみ参照を切り替えます。

## 8. 作業順

この一覧を [4b2fb51](https://github.com/TomTomYoung/kingdom/commit/4b2fb517b55116139f9664ed9992344b0b9a8745) で先にコミットしてから、P0の27素材を制作しました。2026-09-13に初回検査を完了し、制作結果を追記しました。次に音声聴取と画像読込・音声再生基盤、P1素材を進め、P2は各機能・コンテンツの確定を待ちます。

## 9. 初回の保存内容と確認結果

画像17点はAIPaintで生成した透過PNGと編集原稿、音声10点はAIMusicで生成した編集原稿・MIDIと配信用SE WAV／BGM Oggを保存しました。全27点に制作ジョブ・出力ハッシュ・ツールの固定commitがあります。BGMの元WAVは再生成できる中間出力とし、そのハッシュとレンダーレポートを保存しています。

[検証記録](../assets/verification.json) の27件はすべて成功しました。画像は4〜16色で、PNGをFFmpegで復号したRGBAがAIPaintの出力と一致します。音声は44.1kHz・ステレオ、SEは0.184〜0.894秒、地上BGMは17.778秒、戦闘BGMは13.333秒です。Ogg復号後の継ぎ目の振幅差はそれぞれ約0.000511、0.001007（振幅の基準1.0）でした。これは境界サンプルの解析であり、音楽的な接続の聴取評価ではありません。

全点をchecked-candidateとして扱い、integratedはfalseです。ゲームでの表示・再生と音声聴取は未実施です。原稿の開き方と再生成は [制作手順](../tools/assets/README.md) を参照してください。
