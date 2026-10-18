# AIPaint・AIMusicによる素材制作

初回は画像17点、SE8点、BGM2曲です。用途と優先順位は [ASSET_LIST.md](../../doc/ASSET_LIST.md)、見本と音声は [ASSET_PREVIEW.md](../../doc/ASSET_PREVIEW.md) を参照してください。初回制作当時はゲーム未接続でした。最新の接続状況は末尾の2026-10-17追記を参照してください。

## 制作に使ったもの

- AIPaint: TomTomYoung/AIPaint、commit be94fc261c1ce926a5d63bf0720feb4b6bb2fd0d。
- AIMusic: TomTomYoung/AIMusic、commit 399fe1351368755f116512a459c95ecf555c5cba。
- Node.js v24.19.0とFFmpeg（libvorbisが必要）。Pythonパッケージ・npmパッケージの追加は不要です。

両リポジトリを別ディレクトリへ取得し、上記commitへcheckoutしてください。[tool-lock.json](./tool-lock.json) にソースファイルのGit blob SHAを記録し、制作スクリプトが実行前に照合します。初回制作ではツール本体を複製していません。第2段階では音声復旧用にAIMusicのcore.mjs・audio.mjsだけを固定版から無変更で同梱しました。出典はsrc/audio/vendor/README.mdを参照してください。

画像の図案は [graphics.mjs](./graphics.mjs)、曲とSEの音符は [music.mjs](./music.mjs) にあります。既存の絵・曲・外部音源を入力していません。AIPaintのexecuteJob／PaintCoreがすべての画素を描き、アダプターはRGBAをPNGへ梱包します。一覧画像も同じAIPaintの矩形コマンドで作ります。AIPaintのブラウザUIやPlaywrightを実行したものではありません。

音声はAIMusicの正式scripts/render.mjsで合成します。SEはPCM値を変えず末尾無音を切り、20msの余白を残します。BGMはスコア全長のWAVからOgg Vorbis q3を生成します。LOOPSTART／LOOPENDは制作情報であり、ブラウザが自動でこのタグを解釈する前提にはしません。

## 再生成と検査

kingdomのルートで実行します。パスは実際の取得先へ置き換えてください。出力先のassetsディレクトリが存在すると停止し、既存原稿を上書きしません。

```sh
node tools/assets/render-first-pack.mjs /path/to/AIPaint /path/to/AIMusic /path/to/new-output
node tools/assets/verify-first-pack.mjs /path/to/new-output
```

初回の確認環境で実行し、全27点の検査成功を確認しました。検査はファイルのSHA-256、FFmpegによるPNGのRGBA復号一致、音声復号後のフレーム数・非数値・無音・クリッピング・ループ境界を扱います。これは聴取・ブラウザQAを代替しません。

生成時は画像目視と聴取の欄を未実施に戻します。確認後にmanifestへ実施範囲を記録してください。Oggのコンテナ識別値やエンコーダー版により再生成ファイルのバイト列が変わる場合があります。採用する実ファイルのSHA-256をその都度保存します。

## 保存ファイル

- assets/jobs/: ツールへ渡す27件の制作ジョブ。
- `assets/graphics/<id>/v001/`: image.png、project.paint.json、report.json。
- `assets/audio/<id>/v001/`: project.music.json、song.mid、source-render-report.json、delivery-report.json、SEのaudio.wavまたはBGMのaudio.ogg。
- assets/manifest.json: ID・用途・版・ハッシュ・確認状態・ツール出典。
- assets/verification.json: 配信用ファイルの独立した復号検査結果。
- assets/previews/first-pack.png: 画像17点の見本。

project.paint.jsonはAIPaintの「原稿JSONを開く」、project.music.jsonはAIMusicの「原稿を開く」から編集できます。編集結果を採用する際は次revisionを追加し、ジョブまたは図案・音符も更新して再生成できる状態に保ちます。

AIMusicが生成する元song.wavはOSの一時ディレクトリに出力され、生成コマンドがその場所を表示します。大きい元WAVはGitへ保存せず、原稿・MIDI・ジョブ・元WAVのハッシュを保持します。source-render-report.json内のsong.wavはこの中間出力を指します。

ツール原報告のcandidateやgithubStored:falseはレンダリング直後の記録です。GitHubへ保存した事実や採用状態は、kingdomのコミットとmanifestで管理します。初回候補は画像目視済み・音声解析済み、聴取未実施・ゲーム未接続です。

## 2026-10-17の追加素材と接続

現在は既存画像17点・SE8点・地上BGMに加え、自然拡張・保存・復元のSE3点をゲームへ接続しています。初回27点の原稿・出力は変更していません。最新の台帳は[ASSET_AUDIT.md](../../doc/ASSET_AUDIT.md)、確認範囲は[ASSET_INTEGRATION_QA.md](../../doc/ASSET_INTEGRATION_QA.md)です。

追加SE3点は同じ固定版のAIMusicを使い、次のコマンドで新しい出力先へ再生成できます。

```sh
node tools/assets/render-ui-audio.mjs /path/to/AIMusic /path/to/new-output
```

生成先にはassets/jobs、assets/audioとui-audio-pack.jsonができ、採用する実ファイルのレコードをmanifestへ追記します。既存のassetsがある出力先には書き込みません。短音の末尾無音だけを20msの余白まで切り、PCMの音量・音色は変更しません。

`npm run check:assets` は現在のmanifestにある全素材を検査し、過去のレポートを上書きしません。日付つきレポートを保存する場合は第3引数で出力先を指定します。

```sh
node tools/assets/verify-first-pack.mjs . assets/verification-YYYY-MM-DD.json
```

runtimeConnectedは接続実装の有無、integratedは既存の最終確認条件を含む判定です。今回は実ブラウザと聴取の確認が残るため、runtimeConnected=trueの素材もintegrated=falseで保持しています。

## 音声読み込みの復旧データ

第2段階で、配信ファイルの取得・デコードに失敗した場合に採用音符から再生できるようにしました。スコアを採用変更した場合は、固定版AIMusicを使って次を実行します。

```sh
node tools/assets/build-audio-fallback.mjs /path/to/AIMusic
npm test
```

このコマンドは採用原稿のSHA-256とAIMusicのGit blob SHAを検証し、src/audio/scores.jsとsrc/audio/vendorの2モジュールを生成します。手編集しないでください。ゲームの通常起動には生成コマンドや外部AIMusic取得は不要です。

tests/audio-fallback.test.jsは全13件を再合成し、SEは配信用WAV、BGMはOgg変換前の元WAVとハッシュで照合します。Oggの不可逆圧縮後と元PCMのバイト一致を要求するものではありません。

## 2026-10-18 戦闘音の追加

命中・護衛SE2点は同じ固定版から次で再生成します。既存出力先は指定しません。

```sh
node tools/assets/render-ui-audio.mjs /path/to/AIMusic /path/to/new-combat-output combat
```

combat-audio-pack.jsonと2点の原稿・MIDI・ジョブ・WAV・レポートを出力します。省略時のuiパックは従来の3点です。現在は32素材接続、代替合成15スコア。機械検査・実ブラウザ確認済みですが、聴取の最終判定は未実施です。
