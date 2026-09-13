# 平原

[地形一覧](./README.md) · [Wiki入口](../README.md)

![平原](../../assets/graphics/terrain-plains/v001/image.png)

食料と生産を得られる、移動しやすい地形です。

現在: 実装済みです。識別子は `plains` です。

## 産出

| 項目 | 1タイル当たり |
| --- | ---: |
| [食料](../resources/food.md) | +1 |
| [生産](../resources/production.md) | +2 |

表にない産出は0です。自国が所有し、都市の市民が働くタイルから、ターン開始時に得られる値です。領有だけで全タイルの産出が入るわけではありません。

## 移動と特徴

進入コスト: 1移動力。

草原より食料が1少なく、生産が1多い地形です。都市の生産を支えながら、食料も確保できます。

現在のパーティー最大移動力は2です。残り移動力が進入コストより少ない場合は入れません。

関連: [都市と市民配置](../rules/cities.md)・[移動](../rules/actions.md)・[領土](../rules/territory.md)。

根拠: [地形定義](../../src/core/ruleset.js)、[産出対象](../../src/systems/yield-system.js)、[移動コスト](../../src/systems/movement-system.js)、[マップ生成](../../src/world/world-map.js)。
