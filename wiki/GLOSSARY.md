# 用語索引

[Wiki入口](./README.md)

ゲーム中の名前や仕様中の英語から、説明ページを探すための索引です。予定項目を含むため、各リンク先の現在の状態も参照してください。

## 資源・都市・王国

| 日本語・別名 | 英語・識別子 | 説明 |
| --- | --- | --- |
| 食料 | food | [人口成長に使う都市備蓄](./resources/food.md) |
| 生産 | production | [都市の生産対象を完成させる進捗](./resources/production.md) |
| ゴールド・金 | gold | [即時購入などに使う王国備蓄](./resources/gold.md) |
| 科学・研究 | science | [現在は累積進捗、技術解禁は予定](./resources/science.md) |
| マナ・魔力 | mana | [王国が蓄える魔力](./resources/mana.md) |
| 宗教・信仰 | religion | [現在は都市の産出集計](./resources/religion.md) |
| 文化 | culture | [都市拡張と王国の統治を支える産出](./resources/culture.md) |
| 人心 | popularSupport | [王国への加入・随従意思を表す備蓄](./resources/popular-support.md) |
| 産出 | Yield | [都市がターン開始に得る7種類の量](./resources/README.md) |
| 市民配置・働くタイル | workedTiles | [その都市の所属領土から人口数まで選ぶ産出元](./rules/cities.md) |
| 人口・人的資源 | population / HumanResource | [都市住民の規模と王国の人員区分](./rules/population.md) |
| 軍事力 | MilitaryPower | [王国の軍事基盤の表示指標](./rules/governance.md) |
| 統治力・統治容量 | GovernanceCapacity | [領土・組織を管理する能力](./rules/governance.md) |
| 統治負荷 | GovernanceLoad | [領土・人口などの管理負担](./rules/governance.md) |
| 都市・暁都・東都 | City | [人口・産出・生産を持つ拠点](./rules/cities.md) |
| 王国・黎明王国 | Kingdom | [備蓄・都市・人材を持つ勢力](./rules/turns.md) |
| 区画 | District | [都市で建設する予定の分類](./districts/README.md) |
| 建物・建造物 | Building | [モニュメントと城壁](./buildings/README.md) |
| モニュメント | monument | [文化+2の建物](./buildings/monument.md) |
| 城壁 | walls | [新規都市争奪戦の城壁HP60](./buildings/walls.md) |
| 都市耐久・攻城 | City Defense / AttackCity | [都市を削り、進入して占領](./rules/cities.md) |
| タイル改善 | Improvement | [労働者が建設・修理する予定の施設](./units/builder.md) |
| 領土 | Territory | [王国が所有し、一つの都市に所属するHex](./rules/territory.md) |
| 所属都市・都市中心 | territoryCityId / cityId | [作業・拡張を担当する都市と、中心施設の区別](./rules/territory.md) |
| 地形・六角タイル | Terrain / Hex | [6種類の地形と産出・移動コスト](./terrain/README.md) |
| 技術・制度・政策 | Technology / Institution / Policy | [研究や統治の解禁体系の予定](./rules/research.md) |

## ユニット・戦闘

| 日本語・別名 | 英語・識別子 | 説明 |
| --- | --- | --- |
| ユニット | Unit | [パーティーを構成する最小運用単位](./units/README.md) |
| 戦士 | warrior | [近接と護衛を担当する部隊](./units/warrior.md) |
| 弓兵 | archer | [射程2の狙い撃ち・横列射撃](./units/archer.md) |
| 弩砲 | ballista | [射程3の縦列・十字・貫通](./units/ballista.md) |
| 開拓者 | Settler | [都市建設・消費と条件](./units/settler.md) |
| 労働者 | Builder | [改善建設・修理役の予定](./units/builder.md) |
| 尺度 | scaleClass | [個人・部隊・兵器・魔物・群体の区分](./units/README.md) |
| パーティー | Party | [最大5ユニットの運用集団](./rules/parties.md) |
| 配置・陣形 | Formation | [パーティー内部の3×3枠](./rules/parties.md) |
| ダメージグリッド | Damage Grid | [被害対象や庇護の関係を扱う配置](./rules/combat.md) |
| 前列・中列・後列 | Front / Middle / Rear | [パーティー配置の3列](./rules/parties.md) |
| 指揮官 | Leader | [パーティーの先頭指揮者と継承](./rules/combat.md) |
| 士気 | morale | [被害・指揮官継承で減る状態値](./rules/abilities.md) |
| 結束 | cohesion | [現行のパーティー戦闘力補正](./rules/abilities.md) |
| 忠誠 | loyalty | [個人の状態値。王国の人心とは別](./resources/popular-support.md) |
| 移動力 | Movement Points | [地形へ入るために消費する値](./rules/actions.md) |
| 攻撃回数 | attacksRemaining | [現在はパーティーの標準1回](./rules/actions.md) |
| 建設チャージ | buildCharges | [労働者が使う有限回数の予定](./units/builder.md) |
| 能力・スキル・魔法 | Ability / Skill / Spell | [個別発動や効果の予定](./rules/abilities.md) |
| 護衛・割り込み・挑発・遮蔽 | Guard / Intercept / Taunt / Cover | [被害の配分と照準への影響](./rules/abilities.md) |
| 狙い撃ち・範囲・貫通 | aimed / precise / row / column / area / pierce | [照準と被害の分配](./rules/combat.md) |
| 戦闘不能・壊滅・敗北 | downed / shattered / defeated | [HP0とパーティー敗北の状態](./rules/combat.md) |

## 探索・進行

| 日本語・別名 | 英語・識別子 | 説明 |
| --- | --- | --- |
| ダンジョン・入口 | Dungeon / Site | [遠征先と地上入口の予定](./rules/dungeons.md) |
| 遠征 | Expedition | [同じパーティーで行う探索の予定](./rules/dungeons.md) |
| 未確保戦利品・確保済み戦利品 | carried / secured | [帰還・搬送による確保の区別](./rules/dungeons.md) |
| 制覇・ダンジョン制覇 | Domination / Dungeon Conquest | [勝利条件の予定](./rules/victory.md) |
| ターン開始・手番 | Turn Start / Player Turn | [収入と操作順の仕組み](./rules/turns.md) |
| 固定シード | seed | [同じ初期マップを作る値](./rules/turns.md) |
| セーブ・ロード | Save / Load | [ブラウザ内の保存と復元](./rules/turns.md) |

各項目の根拠となるコード・設計文書は、リンク先の末尾に記載しています。

都市反撃（City Counterattack）: 新規都市争奪戦で近接攻城後も防御が残る都市が行う全体ターン1回の反撃。[戦闘](rules/combat.md)・[詳細](../doc/CITY_RETALIATION.md)。

休養（RestParty）: 行動前に予約し、次の全体ターン開始に生存負傷者のHPを回復する操作。[休養と離脱](rules/recovery.md)。

戦闘不能者の離脱（RemoveCasualties）: HP0の記録を保持して部隊の枠を空ける操作。全滅部隊は対象外。[休養と離脱](rules/recovery.md)。

研究選択（SelectResearch）・未配分科学: [研究の規則](rules/research.md)。文字・農業・工学: [技術一覧](technologies/README.md)。図書館・穀物庫・工房: [建物一覧](buildings/README.md)。

- 施設投資AI: 研究で解禁した施設を安全・軍備・予備費・発注上限の条件下で建設する新規対局のAI方針。[詳細](rules/ai-development.md)。
