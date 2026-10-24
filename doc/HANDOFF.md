# Kingdom 開発ハンドオフ

確認・更新日: 2026-10-24

開始基準: main / f3ca8a5ee0f7e9619ec8e7fa5ccd6ec4344fe1cb（PR #3）。遠隔Unit・照準・範囲攻撃とK-10の敗北後占有を追加・修正しました。現行挙動は[CURRENT_IMPLEMENTATION.md](CURRENT_IMPLEMENTATION.md)、課題は[STATUS.md](STATUS.md)、目標は[SPECIFICATION.md](SPECIFICATION.md)を正本とします。

## 1. 再開位置

M1都市運営と、M2のParty・配置・移動・戦闘をCanvas 2D／DOMで操作できます。GameState、ES Modules、Command／RuleSystem、Node標準テストは導入済みです。旧Phaser版の再実装は不要です。

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

K-01〜K-04、K-06、K-08、K-09は修正済み。K-07は固定二国の交互操作に対応し、任意プレイヤー・AI・オンラインは残っています。

K-10は今回修正しました。占有するのはactive Partyだけです。敗北Party・Unit・HP・配置・位置を履歴として保持し、地図の駒と占有から除外します。撃破地点へ移動・通過・新Party作成ができ、生存Partyと敗北記録が同じ座標にある保存も復元できます。撃破直後の自動前進・回復・捕虜・Lootは未実装です。

保存のaccuracy／evasion／tauntStrength／coverPowerを検証し、旧保存の欠落にはaccuracy 1、他0を補完します。既存のGuard率・容量0を変えません。不正なstatusEffectsの識別子で予測が例外になる問題も拒否検証と安全な参照で修正しました。

## 4. 戦闘の引き継ぎ

[RANGED_COMBAT.md](RANGED_COMBAT.md)に定義・payload・配分・予測を、[COMBAT_OPERATIONS.md](COMBAT_OPERATIONS.md)に操作を記録しています。

攻撃定義は信頼済みの表から選び、クライアント指定の倍率は受け付けません。弓兵用攻撃には届く弓兵、弩砲用攻撃には届く弩砲自身が必要です。別兵種の長射程を借りません。狙い撃ちの命中には射手accuracy、対象evasion、同列前方のCover、露出Tauntを使います。通常攻撃は命中し、Taunt優先で露出対象を選びます。

範囲の対象集合は攻撃前に固定し、主対象だけGuard／Interceptを1回解決します。同じUnitへの直撃と肩代わりは合算して装甲を1回適用します。貫通は生存対象ごとに減衰し、空き枠・HP0で深度を消費せず、他列へ流しません。配分が0なら最低1Damageを作りません。

## 5. 次の作業

最優先はK-05と都市別の領土・市民作業です。同一王国の二都市が同じタイルを重複計上する問題を、都市ごとの所属・作業モデルから解決します。

- Tile.ownerIdは王国所有です。既存Tile.cityIdは都市中心の参照なので、都市圏全体の所属として流用しません。
- 都市別の領土取得候補・購入先・作業可能範囲、同一タイルの二重作業拒否、保存互換を先に決めます。
- 二都市の収支・人口・生産・文化・Gold購入の独立性を検証してから都市切替UIとSettler／FoundCityへ進みます。
- その後、小さなAIControllerとScenario Objectiveを組み合わせて一戦を完結できる状態にし、国家間Dominationへ拡張します。

PartyParameter集約、構成員依存移動、汎用Ability、撤退・回復・死傷者・Loot、Builder、研究・mana用途・宗教統治接続、人心・loyalty、Dungeonは後続です。

## 6. 検証と文書更新

```sh
npm test
npm run check
npm run check:assets
npm run dev
```

実ブラウザ検証は[通常・音声404](../assets/qa/browser-grid-2026-10-24.json)と[遠隔・範囲](../assets/qa/browser-ranged-2026-10-24.json)、素材・検証範囲は[台帳](ASSET_AUDIT.md)と[QA記録](ASSET_INTEGRATION_QA.md)を参照してください。人による聴取は未実施です。

実挙動をCURRENT_IMPLEMENTATION、課題をSTATUS、次作業を本書へ反映します。能力・費用・操作は[Wiki更新方法](../wiki/EDITING.md)に従い一覧・個別項目・ルールを同期します。目標仕様本文を現行実装の規模へ縮小しません。
