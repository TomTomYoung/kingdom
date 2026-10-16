# Kingdom 開発資料

確認・更新日: 2026-10-16

目標: Civilization VI 型の帝国運営、Party・Formation、Dungeon探索を統合したターン制ストラテジー

## 現在地と読み方

mainのコード確認基準は 21826414ea238468ff9b7c2ddaaf47cd012c1f80 です。M1都市運営は実装済み、M2はParty・移動・基本戦闘の途中です。23テスト成功を確認しましたが、現行不具合と未実装項目が残っています。今回のブラウザ実操作確認は未実施です。2026-10-16に既存23テスト、構文確認、K-01〜K-05の一時診断を再実行しました。調査時点のブランチはmainのみ、open PR・open issueは各0件です。

まずCURRENT_IMPLEMENTATIONで現行の実挙動、STATUSで実装段階と未修正課題、HANDOFFで次作業を確認してください。画面から使える機能とcore APIだけの機能を区別します。

SPECIFICATIONと各システム仕様は目標です。記載された機能・受入条件がすべて実装済みとは限りません。旧一枚HTMLの調査と旧P0はLEGACY_IMPLEMENTATIONへ保存しました。

起動はリポジトリルートで `npm run dev`、確認は `npm test` と `npm run check` です。現行はCanvas 2D／DOMとES Modulesで、Phaser／Vite／Vitestは使っていません。

プレイヤー向けの用語・効果・費用・ルールは [Kingdom Wiki](../wiki/README.md) にまとめています。リソース・ユニット・区画・建物・地形の一覧から個別項目を参照できます。

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

## 今回の確認範囲（2026-10-16）

既存doc・Wikiと現行ソースを照合し、現在地・課題・再開手順を更新しました。ゲーム本体、目標ルール、素材は変更していません。既存資料にある画像の目視・音声解析結果は過去の制作記録であり、今回素材検査を再実行したわけではありません。
