# Kingdom 開発ハンドオフ

確認・更新日: 2026-09-13

コード基準: main / e0dcb3fc2e6162547d7499fdd913aaaa0b9f10c7

次作業: 現行の状態・行動検証の不具合を回帰テスト付きで修正し、M2 Guard・Damage Grid配分と戦闘UIへ進む。

素材制作: [ASSET_LIST.md](./ASSET_LIST.md) の一覧を先にコミットした後、AIPaintで画像17点、AIMusicでSE8点・BGM2曲の初回候補を生成しました。[ASSET_PREVIEW.md](./ASSET_PREVIEW.md) から確認できます。原稿・再生成ジョブ・検査記録を保存済みで、聴取とゲーム接続は未実施です。

素材の次作業: 音声を聴取して音量・余韻・ループの聞こえ方を確認し、画像ローダーと音声再生基盤へ接続します。画像は整数倍・nearest-neighbor、状態表示は別描画とします。音声はユーザー操作からの再生開始、ミュート・音量、成功／拒否イベントの分離、BGM切替を扱います。P1の戦闘素材は対応イベントと併せて作ります。再生成方法は [tools/assets/README.md](../tools/assets/README.md) にあります。

## 1. 最初に読むもの

[CURRENT_IMPLEMENTATION.md](./CURRENT_IMPLEMENTATION.md) が現在動く処理、[STATUS.md](./STATUS.md) が進捗と既知課題、[SPECIFICATION.md](./SPECIFICATION.md) が目標です。旧Phaser版は [LEGACY_IMPLEMENTATION.md](./LEGACY_IMPLEMENTATION.md) の保存資料として扱います。

GameState、ES Modules、Command／RuleSystem、Node.js標準テストは導入済みです。M1導入やPhaser依存除去を最初からやり直す必要はありません。描画はCanvas 2D／DOMです。現在の構成にVite／Vitestはありません。

## 2. 維持する設計境界

1. GameStateを正本とし、UI・AI・Remoteは同じCommandとRuleSystemを使います。描画オブジェクトやControllerへルールを分散させません。
2. WorldMapの移動・戦闘主体はPartyです。最大5Unit、3×3配置を維持し、同じUnitを地上とDungeonへ複製しません。
3. Gridは対象選択とDamage配分に使い、移動盤面・行動順・追加行動回数へ転用しません。
4. 移動力、攻撃回数、有限Charge、Ability固有コストを分けます。単一actionsRemainingや独立dungeonActionsへ戻しません。
5. 都市Productionと全額即時購入、Party行動は別です。
6. 軍事力・統治力は派生能力、人心は備蓄、loyaltyは個別状態です。Religion・Culture・Science独立勝利は設けません。
7. 戦闘・領土等の乱数は分離したseed付きRNGを使います。同じGameState・Command列で再現できることを守ります。
8. 目標仕様と現在の暫定実装を区別し、平均能力・固定移動力等を完成仕様として固定しません。

## 3. 現在あるもの

M1の都市Yield・生産キュー・購入・領土・人心の基礎収支・派生計算・JSON保存があります。UIは一王国一都市を操作します。

M2には複数王国の順次手番、Party作成、3×3配置検証、経路移動、melee／rangedの単体Damage、近接反撃、HP0、Leader継承があります。

SetFormationとAttackPartyはHumanControllerから生成できますが、画面に配置編集・攻撃操作はありません。Guard容量、charges、abilityStates、loyalty等の保存欄を、対応システム完成と誤認しないでください。

## 4. 優先する修正と受入条件

詳細と再現結果はSTATUSのK-01〜K-10にあります。今回の文書更新ではゲームコードは修正していません。

### 4.1 状態・行動の検証

1. K-01／K-10: defeated Partyや戦闘可能構成員のないPartyの通常移動を拒否し、次ターン回復でも復活させない。敗北後の盤上占有は死傷者・撤退規則と分けて整理する。
2. K-02: Party作成時にも場所・占有・Unit生存状態を検証する。都市で待機する未編成Unitと主戦闘Party一体の区別を保つ。
3. K-03: 遠隔攻撃能力のないUnitだけのPartyでrangedを発行しても、HP・RNG・行動回数を変えず拒否する。合法な遠隔攻撃は反撃なしを維持する。
4. K-04: 全Commandの必須payload、phase、所有者、参照先を検証する。cityId欠落等で例外を外へ漏らさず、拒否時に元stateを保持する。
5. K-09: 保存データの必須構造と参照整合性、現行版への移行を検証し、失敗時に現在の対局を壊さない。

まず問題ごとの回帰テストを追加し、小さな修正単位で既存23件を維持します。Party戦闘状態、行動終了、Guard回復、占有が独立に矛盾しないことを確認してください。

### 4.2 UIと都市運営

1. K-06: Party選択解除を用意し、領土購入へ戻れること。ロード・新規開始時は選択IDを消すか現stateへ検証する。
2. K-07: 複数王国の設定・切替UIを入れるまで「複数人で遊べる」と表示しない。UIの固定kingdom-1／city-1参照を整理する。
3. K-05: 同一王国内の複数都市を扱う前に、都市別作業タイルと領土帰属・取得候補を定義する。同じタイルの二重産出を防ぐ。
4. K-08: 重複建物の生産選択と、進行中の同建物を即時購入した後のキュー・progress処理を整理しテストする。
5. 購入価格を支払い前に表示する。内部キューを編集できるUIを作る場合もCommandを通す。

## 5. 次のM2機能: Guard・Damage Grid・戦闘UI

規範は [COMBAT_SYSTEM.md](./COMBAT_SYSTEM.md)、[DAMAGE_GRID.md](./DAMAGE_GRID.md)、[PARTY_FORMATION.md](./PARTY_FORMATION.md)、[ACTION_SYSTEM.md](./ACTION_SYSTEM.md) です。

1. 現行のFront優先単体選択を基礎に、列の露出・攻撃方向・Targeting情報を追加する。
2. Guard Shareと容量上限、InterceptとreactionCharges、複数候補の決定論的優先順位を実装する。
3. Taunt、Cover、Unit／Slot狙い撃ち、Row／Column／Area／Pierceを同じResolverへ接続する。
4. HP0・継承・morale・空Slotを攻撃ごとに更新し、次の攻撃に反映する。後列は自動で詰めない。
5. 3×3配置編集、敵Party選択、攻撃種別、予測Damage・反撃・Guard・戦闘ログをUIへ接続する。

受入条件は、5Unitの一意配置、Guard容量超過禁止、単体・範囲・貫通で配分規則が明確なこと、対象非公開情報を漏らさないこと、同じ入力・RNGによる再現、失敗Commandで状態を変えないことです。保存・復元後もHP、配置、容量、行動値、戦闘RNGが一致するようテストします。

PartyParameterの本来の集約、構成員依存移動力、Ability実行基盤、撤退・回復・死傷・Lootは別途実装します。現行の平均×cohesion、移動力固定2、non-individual一律shatteredを完全実装扱いにしません。

## 6. M2の残り

Settler／Builder、FoundCity／改善、技術解禁、mana用途、宗教の統治力接続、Capacity不足Penalty、NPC加入・人心・個別loyalty、敵AI、蛮族、Dominationへ進みます。

AIController、RemoteController、ReplayControllerは未実装です。合法手取得と実行はRuleSystemと共有し、AIだけ別ルールでstateを書き換えません。addKingdomは現状セットアップ補助であり、ゲーム内FoundCityの代替にしません。

## 7. M3以降

地上の状態・行動が安定してからDungeon Site、EnterDungeon、DungeonState、Expedition、階層、宝箱・撤退・帰還・戦利品確保を追加します。行動はPartyのmovementRemaining、attacksRemaining、AbilityDefinitionを共用し、Dungeonの距離・地形補正として扱います。

carriedとsecured lootを分け、帰還時に王国の資源・装備・人材へ確定します。初期は一Dungeon一遠征隊です。オンライン・同時ターン競合はM5で扱います。

## 8. 検証と引継ぎの完了条件

```sh
npm test
npm run check
npm run dev
```

2026-09-13の基準は23テスト成功です。npm run checkはUI一ファイルの構文確認であり、ブラウザQAではありません。今回、ブラウザ実操作は未実施です。

変更後は該当回帰テスト、既存テスト、変更JSの構文、必要なUI実操作を確認します。UIでは新規開始→生産・購入→Party作成→移動→選択解除→領土購入→保存・復元を確認し、戦闘UI追加後は攻撃・反撃・HP0・継承も含めます。

## 9. 文書更新規則

1. コードの実挙動・UI公開範囲が変わったらCURRENT_IMPLEMENTATIONを更新する。
2. 進捗・未修正課題・検証結果が変わったらSTATUSを更新する。
3. 次作業と受入条件が変わったらHANDOFFを更新する。
4. ゲーム規則の決定を変える場合は対応する目標仕様とSPECIFICATIONを更新し、決定日と理由を残す。
5. READMEの案内と目標文書冒頭の実装状況も同時にそろえる。
6. LEGACY_IMPLEMENTATIONは旧版の保存資料として維持し、現在の課題を書き足さない。
7. コード確認の基準SHA、確認日、テスト実施範囲、未検証項目を記録する。
8. 名称・費用・能力・産出・利用できる操作を変更したら、[Wiki](../wiki/README.md) の該当一覧・個別項目・関連ルールも更新する。実装済みと予定を分け、[更新方法](../wiki/EDITING.md) に従ってリンクと出典を照合する。
