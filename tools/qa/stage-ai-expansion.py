# Temporary integration helper: explicit source edits, removed before merge.
from pathlib import Path
import hashlib
r = Path.cwd()
def edit(path, old, new):
    p = r/path
    text = p.read_text()
    assert old in text, (path, 'expected source not found')
    p.write_text(text.replace(old, new))

# Reuse the existing site checks instead of loosening the founding command.
p = r/'src/systems/founding-system.js'
s = p.read_text()
start = s.index('  const tile = Object.hasOwn(state.world.tiles, party.location)')
end = s.index('  const sequence = state.nextIds.city;', start)
block = s[start:end].replace('party.location','location').replace('other.id !== party.id','other.id !== partyId')
s = s[:start] + '  const site = validateCitySite(state, playerId, party.location, party.id);\n  if (!site.ok) return site;\n  const tile = state.world.tiles[site.tileKey];\n' + s[end:]
pos = s.index('// Shared by the command')
s = s[:pos] + '// Placement rules shared with the expansion planner; no actions or RNG are spent.\nexport function validateCitySite(state, playerId, location, partyId = null) {\n' + block + '  return { ok: true, tileKey: tile.key };\n}\n\n' + s[pos:]
p.write_text(s)
edit('src/core/ruleset.js', '  aiCityDefense: Object.freeze(', '  // Provisional expansion policy, not a human city/settler limit.\n  aiExpansion: Object.freeze({ minimumCombatUnits: 6, maxCities: 3, threatRange: 3, maxSiteDistance: 8, maxPathCost: 16 }),\n  aiCityDefense: Object.freeze(')
edit('src/core/scenarios.js','  state.aiInfrastructureVersion = 1;', '  state.aiInfrastructureVersion = 1;\n  state.aiExpansionVersion = 1;')
edit('src/core/save-validation.js', "  const recovery = Object.hasOwn(state, 'partyRecoveryVersion');", "  if (Object.hasOwn(state, 'aiExpansionVersion')) check(state.aiExpansionVersion === 1, 'aiExpansionVersion');\n  const recovery = Object.hasOwn(state, 'partyRecoveryVersion');")
edit('src/core/ai-controller.js', 'import { chooseResearchCommand }', "import { chooseExpeditionCommand, isExpansionParty } from './ai-expansion.js';\nimport { chooseResearchCommand }")
edit('src/core/ai-controller.js', '    if (conquest) for (const party of ordered(state.parties))', '    if (conquest) for (const party of ordered(state.parties).filter(p => !isExpansionParty(state, p)))')
edit('src/core/ai-controller.js', "    const recruits = state.kingdoms[this.playerId].aiPolicy === 'reinforcements';", "    const expedition = chooseExpeditionCommand(state, this.playerId, id);\n    if (expedition) return expedition;\n    const recruits = state.kingdoms[this.playerId].aiPolicy === 'reinforcements';")
edit('src/core/ai-controller.js', 'const own = parties.filter(p => p.ownerId === this.playerId', 'const own = parties.filter(p => !isExpansionParty(state, p) && p.ownerId === this.playerId')
edit('src/core/ai-economy.js', 'import { chooseInfrastructureCommand }', "import { chooseExpansionSupplyCommand, reservedEscortIds, isExpansionParty } from './ai-expansion.js';\nimport { chooseInfrastructureCommand }")
edit('src/core/ai-economy.js', 'const waiting = (state, playerId) => ordered(state.units).filter(unit => unit.ownerId === playerId && unit.partyId === null && combatUnit(unit));', 'const waiting = (state, playerId) => {\n  const reserved = reservedEscortIds(state, playerId);\n  return ordered(state.units).filter(unit => unit.ownerId === playerId && unit.partyId === null && combatUnit(unit) && !reserved.has(unit.id));\n};')
edit('src/core/ai-economy.js', 'p.ownerId === playerId && p.unitIds.some', '!isExpansionParty(state, p) && p.ownerId === playerId && p.unitIds.some')
edit('src/core/ai-economy.js', 'if (!party || party.ownerId !== playerId || !hasActiveUnits(state, party)) continue;', 'if (!party || isExpansionParty(state, party) || party.ownerId !== playerId || !hasActiveUnits(state, party)) continue;')
edit('src/core/ai-economy.js', '  const infrastructure = chooseInfrastructureCommand', '  const expansion = chooseExpansionSupplyCommand(state, playerId, commandId); if (expansion) return expansion;\n  const infrastructure = chooseInfrastructureCommand')
p = r/'src/ui/main.js'
s = "import { hasExpansionAi } from '../core/ai-expansion.js';\n" + p.read_text()
s = s.replace("    SelectResearch: 'AIが研究対象を選択しました。',", "    FoundCity: 'AIが開拓者を使って新しい都市を建設しました。',\n    SelectResearch: 'AIが研究対象を選択しました。',")
s = s.replace('const labels = { SelectResearch:', "const labels = { FoundCity: '都市建設', SelectResearch:")
s = s.replace('Object.values(RULESET.items).filter(item => item.requiredTechnology)', "Object.values(RULESET.items).filter(item => item.requiredTechnology || item.itemId === 'settler')")
needle = '  const result = state.gameResult;\n  if (result) {'
assert needle in s
s = s.replace(needle, "  const expansionStatus = $('#ai-expansion-status');\n  expansionStatus.hidden = investmentStatus.hidden;\n  expansionStatus.textContent = hasExpansionAi(state)\n    ? `都市拡張AI: 生存兵${RULESET.aiExpansion.minimumCombatUnits}体以上・自国都市の安全を確認して、護衛付きで最大${RULESET.aiExpansion.maxCities}都市まで開拓します。開拓者は同時に1体、購入後Gold72以上を保持。敵軍・敵都市から3ヘクス以内を避け、危険時は退避を試みます。数値は暫定です。`\n    : '旧セーブの開拓なしAIを維持しています。都市拡張AIは新規の増援戦・都市争奪戦で利用できます。';\n" + needle)
p.write_text(s)
p = r/'index.html'; s = p.read_text()
pos = s.index('</p>',s.index('<p id="ai-infrastructure-status"')) + 4
p.write_text(s[:pos] + '\n          <p id="ai-expansion-status" class="hint" hidden></p>' + s[pos:])
edit('tests/ai-economy.test.js', "  const state = aiTurn(), party = smallParty(state); relocate(state, party.id, capital);\n  const civilian = recruit(state, 'settler')", "  const state = aiTurn(), party = smallParty(state); relocate(state, party.id, capital);\n  // Pre-expansion AI regression: it must not acquire the new escort reservation.\n  delete state.aiExpansionVersion;\n  const civilian = recruit(state, 'settler')")
edit('tests/ai-infrastructure.test.js', '  const s = fixture(); for (let i = 0; i < 10; i++) recruit(s);', '  const s = fixture(); delete s.aiExpansionVersion; // Preserve the pre-expansion supply ordering.\n  for (let i = 0; i < 10; i++) recruit(s);')

# Compare the same historical saves, plus pre-existing settlers, against main.
p = r/'tools/qa/save-ai-expansion-compat.mjs'
s = (r/'tools/qa/save-ai-infrastructure-compat.mjs').read_text()
s = s.replace('pre-infrastructure','pre-expansion').replace('save-ai-infrastructure-compat','save-ai-expansion-compat')
s = s.replace('3ffac57429050908fe120fef81d896770f7499f1','7da210f663fe9c1d49af81138ce12746682a1c93')
s = s.replace('delete legacy.researchVersion;', 'delete legacy.aiInfrastructureVersion; delete legacy.researchVersion;')
s = s.replace('no infrastructure version or facility decisions added to old research games','no expansion version or settlement decisions added to old infrastructure games')
extra = '''// Compare old, legally purchased and queued settlers as well as ready escorted parties.
for (const seed of seeds) {
  let state = oldScenarios.createSettlementGameState(seed);
  const c = new OldController(state.activePlayerId);
  state = OldRules.execute(state, c.startTurn(state)).state;
  verify(state, 'settlement', seed, 'old-escorted-settler');
  state.kingdoms['kingdom-1'].stockpiles.gold = 200;
  const purchase = OldRules.execute(state, c.purchaseItem(state, 'city-1', 'settler')); assert.equal(purchase.ok, true, purchase.reason);
  verify(purchase.state, 'settlement', seed, 'old-waiting-settler');
  const queued = OldRules.execute(state, c.setProduction(state, 'city-1', 'settler', ['warrior'])); assert.equal(queued.ok, true, queued.reason);
  verify(queued.state, 'settlement', seed, 'old-queued-settler-and-escort');
}
'''
p.write_text(s.replace('const report = {',extra + 'const report = {'))

p = r/'doc/HANDOFF.md'; s = p.read_text()
start = s.index('次の候補は都市拡張AIです。'); end = s.index('\n\n',start)
s = s[:start] + '都市拡張AIをaiExpansionVersion 1の新規増援戦・都市争奪戦へ追加しました。6生存兵・全都市安全・購入後Gold72、同時開拓者1体・暫定3都市まで。既存FoundCity・移動・編成・護衛Commandを共用し、旧版なし保存のAIを維持します。地点・経路評価、護衛確保、退避、検証範囲を[都市拡張AI](AI_EXPANSION.md)へ記録しました。\n\n次の候補は汎用Abilityの最小実装です。既存のmana累計・国庫・Unit Charge・攻撃回数・反応の区別と目標仕様を確認し、まず1つの能動能力をCommand／RuleSystem、費用、対象、予測、UI、AI、保存へ接続してください。未確定の能力名・数値を正式仕様とせず、旧対局の行動を変えない版境界を設けます。' + s[end:]
s = s.replace('STATUSの「2026-11-01 解禁施設へのAI投資」節と[投資AI](AI_INFRASTRUCTURE.md)','STATUSの「2026-11-01 都市拡張AI」節と[都市拡張AI](AI_EXPANSION.md)');p.write_text(s)
section = '''## 2026-11-01 都市拡張AI

main / 7da210f（PR #11）を基準に、開拓者確保・護衛編成・安全な候補地と経路・移動・建設を既存Commandへ接続しました。新規増援戦・都市争奪戦だけaiExpansionVersion 1を使用し、旧施設投資AI保存は維持します。軍備6体・全都市安全・Gold予備費・同時開拓者1体・暫定3都市の条件があります。[現行規則と制約](AI_EXPANSION.md)。

Node382テスト・構文117ファイルが成功。旧main216保存と864継続Commandが一致しました。12シードの単独王国で3都市までの拡張と各Commandの保存再開を確認しました。これは通常対戦のバランス評価とは区別します。[保存互換](../assets/qa/save-ai-expansion-compat-2026-11-01.json)・[運営検証](../assets/qa/ai-expansion-playthrough-2026-11-01.json)。実ブラウザ検証は未完了です。

'''
edit('doc/STATUS.md','## 2026-11-01 解禁施設へのAI投資',section+'## 2026-11-01 解禁施設へのAI投資')
edit('doc/STATUS.md','任意プレイヤー設定、都市拡張・3研究施設と城壁以外の建物・領土を扱う戦略AIはありません。','都市拡張AIを追加済みです。任意プレイヤー設定は未実装です。3研究施設と城壁以外の建物・領土を扱う戦略AIはありません。')
edit('doc/STATUS.md','任意設定・都市拡張や3研究施設と城壁以外の建物の戦略AIは未実装。','都市拡張AIは段階実装済み。任意設定は未実装。3研究施設と城壁以外の建物の戦略AIは未実装。')
for name in ['doc/CURRENT_IMPLEMENTATION.md','doc/README.md','doc/AI_SCENARIOS.md','doc/AI_INFRASTRUCTURE.md','wiki/rules/cities.md']:
    link = '../../doc/AI_EXPANSION.md' if name.startswith('wiki/') else 'AI_EXPANSION.md'
    p = r/name
    p.write_text(p.read_text() + '\n\n## 2026-11-01 都市拡張AI\n\n新規増援戦・都市争奪戦に、開拓者の確保・護衛・安全な経路・都市建設を追加しました。旧版なし保存のAIは変更しません。6生存兵、購入後Gold72以上、同時開拓者1体、暫定3都市までの方針です。[条件・操作・制約・検証]('+link+')。\n')
p = r/'wiki/README.md'; p.write_text(p.read_text()+'\n- [都市拡張AI](rules/expansion.md)：護衛付き開拓、安全と予算、旧保存との区別。\n')

expected = {'index.html': '130a648b9dee3c35ec5758186689600fa91a4f57cb5c1c1cc154840d5b54cd24', 'src/core/ai-controller.js': '40796dc77954c3f0597f9401d86e8492fe00b46b15655a68717fef94fea7a7f8', 'src/core/ai-economy.js': '9f73c2ecb5b9ca1e80b6cfac8ffe6f384232f0a651610d815ea59fe74a498581', 'src/core/ruleset.js': 'd1eabefff424405878f5d4bdfa90ea1e4a126760c848f206c1ad8d329abf338a', 'src/core/save-validation.js': '824f90b5597fb64cab51ece38bc125602ed6a651843c902f6716bee1c6760657', 'src/core/scenarios.js': '182576adfa8ccf36459481f2a8a59f996b8e141f3046ca80e9c3403cf97122a6', 'src/systems/founding-system.js': '299bba97f36e52d50c6d5f13841cfe98f4203365c078669db3db04f8b6d25969', 'src/ui/main.js': '12ee1d0027eb523030fd43cb0d3185f0d324f4d4a4a53892382a021f44997948', 'tests/ai-economy.test.js': '9d44b039efee1d5dd37832bf8bed027dcbc747d06f3e32b9960ebc9c32fca108', 'tests/ai-infrastructure.test.js': 'f189531a4a65838131b52b2bbe1d5c194a014bf6b3d0366e78d84c86a387b42a', 'src/core/ai-expansion.js': '9867bc74bc5c8e7ed41154d7c5ff7d9cd8dc8671972a557341193257f1d84863', 'tests/ai-expansion.test.js': '5284de94dd085f8a658578c9521882eae5a255cedee232dd2be790c3668ffb23', 'tools/qa/browser-ai-expansion.mjs': 'b06acb38996bbbad7458559e9ac47f691037c425b251e1c24bcb735e75f83140', 'tools/qa/playthrough-ai-expansion.mjs': '95643b495261e564836e80b637fe20b922ae310d717e634f60b5584e5666676f', 'tools/qa/save-ai-expansion-compat.mjs': '1201e6c09a8967ee856ca3bae5739416e5bd9fb69107505ee09a26f1741956c8'}
for name, digest in expected.items():
    assert hashlib.sha256((r/name).read_bytes()).hexdigest() == digest, ('unexpected source', name)
print(f'Integrated and matched {len(expected)} reviewed source files.')
