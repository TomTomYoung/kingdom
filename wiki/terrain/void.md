# 虚無

[地形一覧](./README.md) · [Wiki入口](../README.md)

![虚無](../../assets/graphics/terrain-void/v001/image.png)

マップ内に存在する、通行と利用ができない地形です。

現在: 実装済みです。識別子は `void` です。

## 産出

| 項目 | 1タイル当たり |
| --- | ---: |
| 全産出 | 0 |

虚無は市民の労働対象になりません。

## 移動と特徴

進入コスト: 進入不可。

パーティーは進入できず、都市の労働先や新しい領土の取得候補にも入りません。通常の生成ではマップの外周に現れます。マップに存在しない座標とは別で、六角形の地形として表示されます。

関連: [都市と市民配置](../rules/cities.md)・[移動](../rules/actions.md)・[領土](../rules/territory.md)。

根拠: [地形定義](../../src/core/ruleset.js)、[産出対象](../../src/systems/yield-system.js)、[移動コスト](../../src/systems/movement-system.js)、[マップ生成](../../src/world/world-map.js)。
