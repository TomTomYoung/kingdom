# 丘陵

[地形一覧](./README.md) · [Wiki入口](../README.md)

![丘陵](../../assets/graphics/terrain-hills/v001/image.png)

生産とGoldに寄った地形です。

現在: 実装済みです。識別子は `hills` です。

## 産出

| 項目 | 1タイル当たり |
| --- | ---: |
| [生産](../resources/production.md) | +3 |
| [Gold](../resources/gold.md) | +1 |

表にない産出は0です。自国が所有し、都市の市民が働くタイルから、ターン開始時に得られる値です。領有だけで全タイルの産出が入るわけではありません。

## 移動と特徴

進入コスト: 2移動力。

現行の地形で生産が最も多く、地形由来のGoldも得られます。食料は産出しません。進入には移動力2が必要で、高低差による戦闘補正や採掘施設は未実装です。

現在のパーティー最大移動力は2です。残り移動力が進入コストより少ない場合は入れません。

関連: [都市と市民配置](../rules/cities.md)・[移動](../rules/actions.md)・[領土](../rules/territory.md)。

根拠: [地形定義](../../src/core/ruleset.js)、[産出対象](../../src/systems/yield-system.js)、[移動コスト](../../src/systems/movement-system.js)、[マップ生成](../../src/world/world-map.js)。
