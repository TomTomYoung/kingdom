# Kingdom 開発ハンドオフ

確認・更新日: 2026-10-24

開始基準: main / d3f79162e0a6254dc36ed8f580a8a1d90c8f5761（PR #4）。K-05の重複作業を修正し、都市別領土・市民作業・取得先、二都市運営・都市切替と産出内訳を追加しました。現行挙動は[CURRENT_IMPLEMENTATION.md](CURRENT_IMPLEMENTATION.md)、課題は[STATUS.md](STATUS.md)、目標は[SPECIFICATION.md](SPECIFICATION.md)を正本とします。

## 1. 再開位置

M1都市運営と、M2の複数都市・Party・配置・移動・戦闘をCanvas 2D／DOMで操作できます。GameState、ES Modules、Command／RuleSystem、Node標準テストは導入済みです。旧Phaser版の再実装は不要です。

「遠隔部隊の二国対戦」→「新規開始」で、各国の戦士2・弓兵2・弩砲1を使えます。敵を選び、遠隔・攻撃内容・照準を指定して予測を確認します。通常・狙い射ち・精密射撃・横列・縦列・十字・貫通を共通Resolver／予測／ログで解決します。従来の戦士3体ずつの二国対戦と、通常331セル開始、旧37セル保存を維持しています。

両国を人が交互に操作します。AI・勝利判定はありません。新兵種は「弓」「弩」バッジで識別し、専用画像・射撃SEは未制作です。

## 2. 維持する設計境界

1. GameStateを正本とし、操作はCommandとRuleSystemを通します。表示選択やカメラをGameStateへ混ぜません。
2. 地上の移動・戦闘主体はParty。最大5Unit、3×3配置を対象と被害配分へ使います。
3. 移動力、攻撃回数、反応、有限Charge、Abilityコスト、都市生産・購入を分離します。
4. 戦闘・領土のseed付きRNGは分離します。予測は次の乱数を読みません。
5. 失敗Commandは状態・RNG・資源・ID・ログを変えません。保存復元後の再現性を維持します。
6. 目標仕様と暫定実装を区別します。平均戦闘力、固定移動力2、簡略HP0、正面・公開配置は完成仕様ではありません。

## 3. 今回までに解消した課題

K-01〜K-06、K-08、K-09は修正済み。K-07は固定二国の交互操作に対応し、任意プレイヤー・AI・オンラインは残っています。

K-10はPR #4で修正しました。占有するのはactive Partyだけです。敗北Party・Unit・HP・配置・位置を履歴として保持し、地図の駒と占有から除外します。撃破地点へ移動・通過・新Party作成ができ、生存Partyと敗北記録が同じ座標にある保存も復元できます。撃破直後の自動前進・回復・捕虜・Lootは未実装です。

保存のaccuracy／evasion／tauntStrength／coverPowerを検証し、旧保存の欠落にはaccuracy 1、他0を補完します。既存のGuard率・容量0を変えません。不正なstatusEffectsの識別子で予測が例外になる問題も拒否検証と安全な参照で修正しました。

## 4. 戦闘の引き継ぎ

[RANGED_COMBAT.md](RANGED_COMBAT.md)に定義・payload・配分・予測を、[COMBAT_OPERATIONS.md](COMBAT_OPERATIONS.md)に操作を記録しています。

攻撃定義は信頼済みの表から選び、クライアント指定の倍率は受け付けません。弓兵用攻撃には届く弓兵、弩砲用攻撃には届く弩砲自身が必要です。別兵種の長射程を借りません。狙い撃ちの命中には射手accuracy、対象evasion、同列前方のCover、露出Tauntを使います。通常攻撃は命中し、Taunt優先で露出対象を選びます。

範囲の対象集合は攻撃前に固定し、主対象だけGuard／Interceptを1回解決します。同じUnitへの直撃と肩代わりは合算して装甲を1回適用します。貫通は生存対象ごとに減衰し、空き枠・HP0で深度を消費せず、他列へ流しません。配分が0なら最低1Damageを作りません。

## 5. 都市の引き継ぎと次作業

[CITY_MANAGEMENT.md](CITY_MANAGEMENT.md)にモデル・操作・移行条件を記録しました。「二都市運営」で暁都・東都を切り替えられます。都市選択は表示状態だけで、生産・購入・領土価格・候補はすべて選択都市へ揃えています。食料・生産・文化は都市別、Gold等の国庫は王国共有です。

Tile.ownerIdは王国、Tile.cityIdは中心、Tile.territoryCityIdは所属都市です。新規取得は実行都市へ固定し、所属を距離で再分配しません。作業は自都市の非Void領土から人口数まで、半径制限は今回追加していません。共通境界は先取得都市へ所属し、文化取得順はcityIds順です。

cityTerritoryVersion 1と全tile所属を保存します。完全な旧保存だけ最近同国都市・同距離ID順で移行し、複数都市の重複作業・表示集計・派生能力を直します。既収集資源やRNGは動かしません。負の補正後は産出0以上、存在する内訳は型・参照・数値を検証し、省略内訳は表示で捏造しません。

次はSettler／FoundCityです。

- セットアップ用addCityをそのままCommand化せず、都市間最低距離、地形、領有、活動中Partyの占有、Settler所属・消費をRuleset／RuleSystemで検証します。
- 新都市IDの発行・保存互換、初期領土と既存都市の所属維持、初期人口・収入開始時点を決めます。設置時に収入を二重に与えません。
- 成功後の都市選択・新都市表示、失敗時のUnit／資源／ID／RNGの無変更をテストします。
- 都市建設後、小さなAIControllerとScenario Objectiveで一戦を完結させ、国家間Dominationへ拡張します。

都市間移管・手動市民配置、PartyParameter集約、構成員依存移動、汎用Ability、撤退・回復・死傷者・Loot、Builder、研究・mana用途・宗教統治接続、人心・loyalty、Dungeonは後続です。

## 6. 検証と文書更新

今回の最終検証はNode標準111テスト・JavaScript 65ファイルの構文検査が成功しています。都市操作12チェック群、従来操作26チェック群、遠隔戦闘13チェック群も実ブラウザで再検証しました。

```sh
npm test
npm run check
npm run check:assets
npm run dev
```

都市の検証は[都市操作](../assets/qa/browser-cities-2026-10-24.json)と[従来操作の回帰](../assets/qa/browser-city-regression-2026-10-24.json)です。前回の戦闘実ブラウザ検証は[通常・音声404](../assets/qa/browser-grid-2026-10-24.json)と[遠隔・範囲](../assets/qa/browser-ranged-2026-10-24.json)、素材・検証範囲は[台帳](ASSET_AUDIT.md)と[QA記録](ASSET_INTEGRATION_QA.md)を参照してください。人による聴取は未実施です。

実挙動をCURRENT_IMPLEMENTATION、課題をSTATUS、次作業を本書へ反映します。能力・費用・操作は[Wiki更新方法](../wiki/EDITING.md)に従い一覧・個別項目・ルールを同期します。目標仕様本文を現行実装の規模へ縮小しません。
