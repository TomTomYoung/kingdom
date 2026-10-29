# Kingdom 開発資料

確認・更新日: 2026-10-30

目標はCivilization VI型の帝国運営、Party・Formation、Dungeon探索を統合したターン制ストラテジーです。現行はM1都市運営とM2の複数都市・Party・移動・近接／遠隔戦闘の途中です。

## 現在地と読み方

開拓者の生産・購入、都市建設、護衛の維持、新都市選択と保存互換を利用できます。都市別の領土・市民作業・文化／Gold取得、二都市運営と都市切替・産出内訳も利用できます。弓兵・弩砲と7攻撃、敗北非占有、旧37セル保存を維持します。戦術AIと部隊撃破・40ターン期限の遭遇戦勝敗を追加しました。都市運営AI、Domination、Dungeonは未実装です。

まず[現行実装](CURRENT_IMPLEMENTATION.md)、[課題](STATUS.md)、[次作業](HANDOFF.md)を確認してください。操作は[戦闘操作](COMBAT_OPERATIONS.md)と[地図操作](MAP_OPERATIONS.md)、定義・配分・保存互換は[遠隔仕様](RANGED_COMBAT.md)にあります。都市操作・所属・保存移行は[CITY_MANAGEMENT.md](CITY_MANAGEMENT.md)、[AIと遭遇戦](AI_SCENARIOS.md)も参照してください。次の優先事項は都市運営AIと増援編成です。

起動は `npm run dev`、検証は `npm test`、`npm run check`、`npm run check:assets`。Canvas 2D／DOM・ES Modules・Node標準テストを使い、Phaser／Vite／Vitestは使いません。プレイヤー向け名称・費用・操作は[Kingdom Wiki](../wiki/README.md)で確認できます。

目標仕様の受入条件は実装完了の宣言ではありません。旧Phaser版の調査は[保存資料](LEGACY_IMPLEMENTATION.md)です。過去のテスト・素材記録はSTATUSと素材QAの各日付の節に保持しています。

## 文書

1. [SPECIFICATION.md](./SPECIFICATION.md): 目標となる規範仕様
2. [RESOURCE_MODEL.md](./RESOURCE_MODEL.md): 軍事力、統治力、mana、人的資源
3. [PARTY_FORMATION.md](./PARTY_FORMATION.md): PartyとFormation
4. [POPULAR_SUPPORT.md](./POPULAR_SUPPORT.md): 人心、加入、忠誠、維持
5. [ACTION_SYSTEM.md](./ACTION_SYSTEM.md): Civ6準拠の移動、攻撃、チャージ、特殊行動
6. [DAMAGE_GRID.md](./DAMAGE_GRID.md): Party内9グリッドとダメージ配分
7. [COMBAT_SYSTEM.md](./COMBAT_SYSTEM.md): 戦闘力、ダメージ、反撃、負傷、士気、回復
8. [CURRENT_IMPLEMENTATION.md](./CURRENT_IMPLEMENTATION.md): 現行ES Modules版の挙動・API・UI・制約
9. [STATUS.md](./STATUS.md): 実装段階・現行の既知課題・テスト結果
10. [HANDOFF.md](./HANDOFF.md): 次作業・修正優先度・受入条件
11. [CIV6_REFERENCE.md](./CIV6_REFERENCE.md): Civ6準拠点と独自分岐の調査記録
12. [LEGACY_IMPLEMENTATION.md](./LEGACY_IMPLEMENTATION.md): 旧Phaser版の調査・旧不具合（保存資料）
13. [ASSET_LIST.md](./ASSET_LIST.md): AIPaint・AIMusicを使う素材制作一覧と優先順位
14. [ASSET_PREVIEW.md](./ASSET_PREVIEW.md): 初回27素材の画像一覧・音声ファイル・検査状況
15. [ASSET_AUDIT.md](./ASSET_AUDIT.md): 既存を含む全必要素材、制作・適用順、最新進捗
16. [ASSET_INTEGRATION_QA.md](./ASSET_INTEGRATION_QA.md): 接続32点の動作検証と残る聴取確認

17. [COMBAT_OPERATIONS.md](COMBAT_OPERATIONS.md): 二国交互操作・遠隔照準・護衛・予測
18. [RANGED_COMBAT.md](RANGED_COMBAT.md): 新兵種・7攻撃定義・payload・命中・範囲配分・保存互換
19. [CITY_MANAGEMENT.md](CITY_MANAGEMENT.md): 都市別の領土・市民作業・取得・都市切替・旧保存移行

## 確定した目標方針（実装完了を意味しません）

1. ソロでは敵対王国をAIが操作します。
2. マルチでは各王国をHumanまたはAIへ割り当てます。
3. 資源処理はターン開始時です。
4. 都市Productionはターン進捗、Gold等は全額即時購入です。
5. UnitとPartyの行動はCiv6準拠とし、移動力、攻撃回数、有限チャージ、Ability固有コストを分離します。
6. WorldMapの運用単位としてPartyを持ちます。
7. Party内部の配置としてFormationを持ちます。
8. manaを正式資源とします。
9. science、production、gold、mana、人的資源がMilitaryPowerを形成します。
10. religion、culture、制度、統治人材がGovernanceCapacityを形成します。
11. foodは国内人口とnativeHumanResourcesを生みます。
12. religionとcultureは国外Affiliate、移民、専門家、英雄候補を獲得できます。
13. Religion、Culture、Scienceの独立勝利は設けません。
14. 全システムは軍事力、統治力、国家間競争、Dungeon攻略へ収束します。
15. Partyは最大5名で、それ自体を一つの戦闘Unitとして扱います。
16. 人心は人物やPartyの加入時に支払い、毎ターン維持にも使う王国資源です。
17. 人心不足は個別の忠誠を段階的に悪化させ、命令拒否、離脱、離反を引き起こします。
18. WorldMapではPartyを行動主体とし、内部Unitを個別移動させません。
19. 通常攻撃は一ターン一回で行動終了とし、追加攻撃や攻撃後移動はAbilityで例外化します。
20. Party最大5Unitを3×3 Gridへ配置し、Gridは対象選択、庇護、狙撃、範囲、Damage配分にだけ使います。
21. UnitはIndividual、Detachment、Construct、Monster、Swarmの尺度を持ちます。
22. 通常攻撃は原則命中し、近接攻撃は相互Damage、Named CharacterはHP0で原則Downedになります。

## 過去の調査記録（2026-10-16）

既存doc・Wikiと現行ソースを照合し、現在地・課題・再開手順を更新しました。ゲーム本体、目標ルール、素材は変更していません。既存資料にある画像の目視・音声解析結果は過去の制作記録であり、今回素材検査を再実行したわけではありません。
