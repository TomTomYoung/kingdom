# Kingdom 開発資料

更新日: 2026-09-08

目標: Civilization VI 型の帝国運営、Party・Formation、Dungeon探索を統合したターン制ストラテジー

## 文書

1. [SPECIFICATION.md](./SPECIFICATION.md): 正規仕様
2. [RESOURCE_MODEL.md](./RESOURCE_MODEL.md): 軍事力、統治力、mana、人的資源
3. [PARTY_FORMATION.md](./PARTY_FORMATION.md): PartyとFormation
4. [CURRENT_IMPLEMENTATION.md](./CURRENT_IMPLEMENTATION.md): 現行コード調査
5. [STATUS.md](./STATUS.md): 進捗と差分
6. [HANDOFF.md](./HANDOFF.md): 次作業
7. [CIV6_REFERENCE.md](./CIV6_REFERENCE.md): Civ6準拠点と独自分岐

## 確定した方向

1. ソロでは敵対王国をAIが操作します。
2. マルチでは各王国をHumanまたはAIへ割り当てます。
3. 資源処理はターン開始時です。
4. 都市Productionはターン進捗、Gold等は全額即時購入です。
5. Unitの移動力と行動回数はUnit定義によります。
6. WorldMapの運用単位としてPartyを持ちます。
7. Party内部の配置としてFormationを持ちます。
8. manaを正式資源とします。
9. science、production、gold、mana、人的資源がMilitaryPowerを形成します。
10. religion、culture、制度、統治人材がGovernanceCapacityを形成します。
11. foodは国内人口とnativeHumanResourcesを生みます。
12. religionとcultureは国外Affiliate、移民、専門家、英雄候補を獲得できます。
13. Religion、Culture、Scienceの独立勝利は設けません。
14. 全システムは軍事力、統治力、国家間競争、Dungeon攻略へ収束します。
