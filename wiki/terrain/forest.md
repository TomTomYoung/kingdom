# 森林

[地形一覧](./README.md) · [Wiki入口](../README.md)

![森林](../../assets/graphics/terrain-forest/v001/image.png)

食料・生産に加え、文化を産出する地形です。

現在: 実装済みです。識別子は `forest` です。

## 産出

| 項目 | 1タイル当たり |
| --- | ---: |
| [食料](../resources/food.md) | +1 |
| [生産](../resources/production.md) | +2 |
| [文化](../resources/culture.md) | +1 |

表にない産出は0です。自国が所有し、都市の市民が働くタイルから、ターン開始時に得られる値です。領有だけで全タイルの産出が入るわけではありません。

## 移動と特徴

進入コスト: 2移動力。

平原と同じ食料・生産に文化+1が加わります。一方、進入には移動力2が必要です。防御ボーナスや伐採・除去の処理はまだありません。

現在のパーティー最大移動力は2です。残り移動力が進入コストより少ない場合は入れません。

関連: [都市と市民配置](../rules/cities.md)・[移動](../rules/actions.md)・[領土](../rules/territory.md)。

根拠: [地形定義](../../src/core/ruleset.js)、[産出対象](../../src/systems/yield-system.js)、[移動コスト](../../src/systems/movement-system.js)、[マップ生成](../../src/world/world-map.js)。
