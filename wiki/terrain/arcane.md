# 霊脈

[地形一覧](./README.md) · [Wiki入口](../README.md)

![霊脈](../../assets/graphics/terrain-arcane/v001/image.png)

mana・科学・宗教を産出する魔力の地形です。

現在: 実装済みです。識別子は `arcane` です。

## 産出

| 項目 | 1タイル当たり |
| --- | ---: |
| [食料](../resources/food.md) | +1 |
| [科学](../resources/science.md) | +1 |
| [mana](../resources/mana.md) | +2 |
| [宗教](../resources/religion.md) | +1 |

表にない産出は0です。自国が所有し、都市の市民が働くタイルから、ターン開始時に得られる値です。領有だけで全タイルの産出が入るわけではありません。

## 移動と特徴

進入コスト: 1移動力。

現行の地形ではmana・科学・宗教を産出する唯一の種類です。生産は0です。manaを得るには領有だけでなく市民の配置も必要ですが、手動で働くタイルを指定する画面はありません。宗教は現状、集計・表示だけです。

現在のパーティー最大移動力は2です。残り移動力が進入コストより少ない場合は入れません。

関連: [都市と市民配置](../rules/cities.md)・[移動](../rules/actions.md)・[領土](../rules/territory.md)。

根拠: [地形定義](../../src/core/ruleset.js)、[産出対象](../../src/systems/yield-system.js)、[移動コスト](../../src/systems/movement-system.js)、[マップ生成](../../src/world/world-map.js)。
