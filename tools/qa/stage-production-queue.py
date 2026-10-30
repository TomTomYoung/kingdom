# One-use, branch-scoped integration of the locally tested queue editor.
# Removed after the implementation and its verification reports are committed.
from pathlib import Path
r = Path.cwd()
def replace(path, old, new):
    p = r/path
    s = p.read_text()
    if old in s:
        p.write_text(s.replace(old, new))
    else:
        assert new in s, (path, old)
replace('src/core/command-validation.js', "SetCityProduction: ['cityId', 'itemId'],", "SetCityProduction: ['cityId'],")
replace('src/core/command-validation.js', "  if (command.type === COMMAND_TYPES.SET_CITY_PRODUCTION && (!Array.isArray(payload.queue) || !payload.queue.every(identifier))) return '生産キューは対象IDの配列で指定してください';", """  if (command.type === COMMAND_TYPES.SET_CITY_PRODUCTION) {
    if (!Object.hasOwn(payload, 'itemId') || (payload.itemId !== null && !identifier(payload.itemId))) return 'itemIdが必要です';
    if (!Array.isArray(payload.queue) || !payload.queue.every(identifier)) return '生産キューは対象IDの配列で指定してください';
    if (payload.itemId === null && payload.queue.length) return '生産停止時はキューを空にしてください';
  }""")
replace('src/core/rule-system.js', "if (!Object.hasOwn(RULESET.items, command.payload.itemId)) return reject('不明な生産対象です');", "if (command.payload.itemId !== null && !Object.hasOwn(RULESET.items, command.payload.itemId)) return reject('不明な生産対象です');")
replace('src/systems/production-system.js', "if (RULESET.items[id].category !== 'building') continue;", "if (id === null || RULESET.items[id].category !== 'building') continue;")
replace('index.html', '<div id="production-status" class="production-status"></div><div class="actions">', '<div id="production-status" class="production-status"></div><div id="production-queue" class="production-queue"></div><div class="actions">')
p = r/'src/ui/main.js'
if "import { ProductionQueuePanel, queueForSelection }" not in p.read_text():
    p.write_text("import { ProductionQueuePanel, queueForSelection } from './production-queue.js';\n" + p.read_text())
if "const productionQueue = new ProductionQueuePanel" not in p.read_text():
    replace('src/ui/main.js', "const partyCare = new PartyCarePanel", """const productionQueue = new ProductionQueuePanel($('#production-queue'), {
  onApply: (cityId, items) => run(controller.setProduction(state, cityId, items[0] ?? null, items.slice(1)), items.length ? '生産キューを確定しました。途中の進捗は保持しています。' : '生産を停止しました。途中の進捗は再選択すると引き継ぎます。'),
});
const partyCare = new PartyCarePanel""")
if "  productionQueue.render(state, city, controller.playerId, canAct());" not in p.read_text():
    replace('src/ui/main.js', '  renderCityDetails(city);', '  renderCityDetails(city);\n  productionQueue.render(state, city, controller.playerId, canAct());')
replace('src/ui/main.js', 'controller.setProduction(state, currentCity()?.id, button.dataset.produce)', 'controller.setProduction(state, currentCity()?.id, button.dataset.produce, queueForSelection(currentCity(), button.dataset.produce))')
p = r/'src/ui/style.css'
if '.production-queue {' not in p.read_text():
    p.write_text(p.read_text() + '''
/* Production drafts are UI state; only confirmation changes the city. */
.production-queue { margin: 12px 0 18px; min-width: 0; }
.production-queue h3 { font-size: 1rem; margin: 0 0 8px; }
.production-plan { padding: 0; list-style: none; margin: 8px 0; display: grid; gap: 8px; }
.production-plan-row { display: grid; gap: 6px; padding: 10px; border: 1px solid #526054; border-radius: 8px; min-width: 0; overflow-wrap: anywhere; }
.production-plan-row .hint { margin: 0; }
.production-queue-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.production-queue-actions button { flex: 1 1 auto; min-width: 0; }
.production-queue select { display: block; width: 100%; min-width: 0; margin: 6px 0; }
''')
replace('doc/HANDOFF.md', '''次は都市の生産キュー編集UIを優先します。

- coreのSetCityProductionはqueueを受け取れますが、画面にはキュー編集がありません。対象・予約順・途中進捗を確認し、追加・並べ替え・取消を共通Commandで確定できる操作を設計してください。
- 建設済み・重複建物の拒否、購入での予約正規化、Unit連続生産、都市切替・AI手番・終了後のロックを維持します。プレビューだけでは状態や資源を変えず、途中保存から同じ生産結果へ再開できることを確認します。
- 新しい費用や返金を導入せず、既存の生産進捗とoverflow規則に沿って接続します。UIの編集選択をGameStateへ保存しません。''', '''PR #7はmainの8534535へマージ済みです。続いて都市の生産キュー編集UIを実装しました。[操作・規則・保存](PRODUCTION_QUEUE.md)を参照してください。

- 現在対象と予約を一つの一覧で確認し、末尾追加・前後移動・個別削除・全件削除を編集案として作成します。「確定」だけがSetCityProductionを1回実行し、「編集を取り消す」は状態を変えません。
- 明示的なitemId:nullとqueue:[]を生産停止として受理します。途中進捗は対象種類ごとに保持し、既存の費用・購入・overflow規則は変更しません。従来の直接生産ボタンも予約を保持します。
- 都市・手番・ロード・新規開始・成功Commandで編集案を破棄し、AI手番・終了後・所有都市なしでは編集できません。UIの編集案をGameStateへ保存しません。

次は能動的な都市砲撃を優先します。既存の近接攻城への自動反撃とは区別し、射程・回数・手番・予測・ログ・AI・保存互換を共通Commandへ接続してください。具体的な攻撃値・利用条件は既存の目標仕様を確認してから定め、現在の都市反撃を勝手に置換しないでください。''')
replace('doc/HANDOFF.md', '最新の検証結果はSTATUSの「2026-10-30 休養・回復・戦闘不能者の離脱」節を参照してください。', '最新の検証結果はSTATUSの「2026-10-30 生産キュー編集UI」節と[生産キュー](PRODUCTION_QUEUE.md)を参照してください。')
replace('doc/STATUS.md', 'キュー編集UIと未確認の旧中間版すべての移行保証はありません。', 'キュー編集UIを追加しました。未確認の旧中間版すべての移行保証はありません。')
replace('doc/STATUS.md', '次の優先事項は都市の生産キュー編集UIです。', '生産キュー編集UIは実装済みです。次の優先事項は能動的な都市砲撃です。')
replace('doc/CURRENT_IMPLEMENTATION.md', '生産キュー編集、JSONファイル入出力、任意プレイヤー設定のUIはありません。', '生産キューの追加・並べ替え・削除・停止と明示確定を実装しました。詳しくは[生産キュー](PRODUCTION_QUEUE.md)を参照してください。JSONファイル入出力、任意プレイヤー設定のUIはありません。')
replace('doc/README.md', '次の優先事項は都市の生産キュー編集UIです。', '[生産キュー編集UI](PRODUCTION_QUEUE.md)も実装済みです。次の優先事項は能動的な都市砲撃です。')
replace('wiki/rules/cities.md', '現在の画面にはキュー編集がありません。', '画面の「生産キューを編集」で追加・並べ替え・削除ができ、「この内容で確定」で反映します。全件削除を確定すると生産停止になり、途中の種類別進捗は保持します。編集取消・都市切替では未確定の案だけを破棄します。')
replace('wiki/resources/production.md', '複数項目を予約するキューの編集は画面にありません。', '「生産キューを編集」で末尾追加・並べ替え・個別削除・全件削除を行い、確定ボタンで反映します。全件削除の確定は生産停止ですが、途中進捗を返金・移転せず保持します。編集案はセーブ対象ではなく、都市切替・手番更新・ロード等で破棄します。')
p = r/'doc/STATUS.md'
if '## 2026-10-30 生産キュー編集UI' not in p.read_text():
    replace('doc/STATUS.md', '## 1. 現在地', '''## 2026-10-30 生産キュー編集UI

PR #7をmainの8534535へマージ後、生産対象と予約の一覧・追加・並べ替え・個別削除・全削除・生産停止・明示確定・編集取消を実装しました。途中進捗と既存の購入・overflow規則は保持します。都市切替、状態更新、ロード、新規開始で編集案を破棄し、AI手番・終了後の操作を制限します。[詳細](PRODUCTION_QUEUE.md)。

検証: Node標準274テストが成功。JavaScript 97ファイルの構文検査が成功。直前の実ソースから4seed・9開始設定・4状態の144保存を生成し、復元の完全一致・576継続Commandの結果一致を確認しました。[保存互換記録](../assets/qa/save-production-queue-compat-2026-10-30.json)。実ブラウザの最終結果は[検証概要](../assets/qa/production-queue-summary-2026-10-30.json)に記録します。素材32点と目標仕様本文は変更していません。

## 1. 現在地''')
print('Integrated production queue editor without replacing unrelated source or documentation.')
