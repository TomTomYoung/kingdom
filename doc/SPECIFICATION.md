# Kingdom 目標仕様

更新日: 2026-09-13（実装状況と文書整合性を再確認）

仕様状態: 基本構造確定、数値バランスと一部マルチプレイ規則は暫定

## 0. 現行実装との区分

この文書は目標仕様です。実装済みの判定は [CURRENT_IMPLEMENTATION.md](./CURRENT_IMPLEMENTATION.md) と [STATUS.md](./STATUS.md) を正本とします。コード確認基準はmain / e0dcb3fc2e6162547d7499fdd913aaaa0b9f10c7です。

現行はM1都市運営とM2のParty作成・移動・基本単体戦闘までです。Canvas 2D／DOMで表示し、複数王国の手番・配置変更・攻撃はcoreにありますが、複数王国・配置編集・戦闘UIはありません。AI、Dungeon、職業・Ability実行、加入・個別loyalty、Guard・範囲配分、勝利、オンライン通信は未実装です。

以下のGameStateフィールドは目標モデルです。実装の実キー・省略項目・暫定式はCURRENT_IMPLEMENTATIONを参照してください。現行の独立ランダム地形、平均戦闘力、固定移動力、簡略HP0を目標仕様へ逆輸入しません。

## 1. ゲームの定義

Kingdom は、Civilization VI 型の地上帝国運営と、部隊単位のダンジョン探索を一つのターン進行へ統合するストラテジーゲームです。

地上では都市建設、領土拡張、資源産出、生産、研究、外交、戦争を扱います。ダンジョンでは探索、戦闘、罠、宝物、ボス、撤退判断を扱います。ダンジョンで得た遺物、技術、資源、人材は帝国運営へ戻り、帝国の生産力と研究力は遠征隊の装備と補充を支えます。

Civilization VI を完全複製するのではなく、都市生産、領土、ユニット行動、複数勝利条件という骨格を準拠対象とします。ダンジョン探索との接続に必要な部分は Kingdom 独自仕様とします。

## 2. ゲームモード

### 2.1 ソロプレイ

一人の人間プレイヤーが一王国を操作します。敵対王国はAIが操作します。中立勢力、蛮族、ダンジョン勢力もAIまたは規則ベースで処理します。

### 2.2 マルチプレイ

王国スロットごとに Human または AI の ControllerType を設定します。一つの対局に人間王国とAI王国を混在できます。

初期実装はローカルの順次ターン方式とします。オンライン化する場合は、次のターン方式をルール設定として選べる設計にします。

1. Sequential

   人間を含む全王国が固定順で行動します。再現性とデバッグを優先する標準方式です。

2. Simultaneous

   人間プレイヤーが同時入力し、ターン終了時にサーバーまたはホストが確定処理します。競合解決規則が必要なため、MVP後に実装します。

3. Dynamic

   平時は同時、戦争当事国など競合する勢力は順次処理します。将来候補であり、初期実装範囲外です。

### 2.3 Sandbox

勝敗を無効化し、マップシード、地形比率、AI数、AI思考傾向、資源倍率、ダンジョン数、イベント率を設定して観察できるモードです。通常ゲームと同じエンジンを使用します。

## 3. ゲーム状態の正本

ゲームの全状態は GameState を正本とします。描画方式にかかわらず、Canvas・DOM等の表示は GameState の投影であり、ゲームルールを保持しません。

GameState は最低限、次を保持します。

1. rulesetVersion
2. seed と乱数ストリーム状態
3. currentTurn
4. currentPhase
5. playerSlots
6. kingdoms
7. worldMap
8. cities
9. units
10. improvements
11. districts
12. technologies と civics
13. dungeons
14. expeditions
15. events
16. victoryState

状態変更は Command を RuleSystem が検証、実行して行います。UI、AI、マルチプレイ入力はいずれも同じ Command を発行します。AIだけが別ルールで直接状態を書き換えることは禁止します。

## 4. ターン進行

### 4.1 基本順序

一つの世界ターンを次の順序で処理します。

1. TURN_START

   前ターンからの継続効果、維持費、資源収集、都市生産、研究、文化圏拡張候補、人口成長、ユニット回復、移動力と行動回数のリセットを解決します。

2. PLAYER_PHASES

   各王国の Controller が行動します。Human は入力待ち、AI は同じ合法手集合から行動を選びます。

3. DUNGEON_RESOLUTION

   各王国フェーズ中に入力された遠征行動の結果を確定します。順次ターンでは王国フェーズ内で即時解決しても構いませんが、ルール上の解決点は記録します。

4. WORLD_RESOLUTION

   戦闘後処理、占領、外交、イベント、死亡、建設完了後の派生効果を確定します。

5. TURN_END

   終了判定、勝利判定、ログ確定、オートセーブを行い、currentTurn を一回だけ増やします。

6. 次の TURN_START

### 4.2 ターン開始時の資源処理

ユーザーが確認する画面上では、ターン開始直後に収入と進捗が反映された状態を表示します。内部処理順は固定し、再現可能にします。

標準順は次です。

1. Gold、mana、人心等の維持費と前ターン効果
2. タイルと建物の産出集計
3. 都市の食料、成長
4. 都市の生産進捗
5. 王国の gold、mana 等の備蓄
6. science、culture の研究進捗
7. 領土文化進捗
8. 完成、解禁、成長イベント
9. ユニット状態リセット

同じターン開始処理内で発生した解禁を、そのターンから使用可能にします。

## 5. 資源と能力軸

Kingdomでは個別の資源と、資源から派生する能力を区別します。MilitaryPowerとGovernanceCapacityは、直接支払う単一通貨ではなく、複数の資源、施設、人員、制度から算出される能力です。詳細は RESOURCE_MODEL.md を参照してください。

### 5.1 軍事力

MilitaryPowerは次から形成されます。

1. science

   Unit、装備、魔法、戦術、兵站を解禁する開発力です。Science勝利には使いません。

2. production

   Unit、Party装備、Building、District、補給物資を製造する都市ローカル能力です。

3. gold

   UnitとPartyの維持、雇用、即時購入、補給、開発加速に使う王国備蓄です。

4. mana

   魔法Unit、Spell、魔導装備、召喚、Dungeon機構、魔法施設に使う王国備蓄です。

5. militaryHumanResources

   兵員、指揮官、英雄、技術者など、編成へ投入可能な人的資源です。

scienceによる解禁、productionによる実体化、goldによる維持と加速、manaによる魔法的能力、人的資源による運用が揃って軍事力になります。

### 5.2 統治力

GovernanceCapacityは、領土、District、Building、都市人口、占領地、多民族集団を維持し、命令を通す能力です。

主な源泉は次です。

1. religion

   信仰共同体、正統性、結束、奉仕組織、他国に存在する信徒ネットワークを表します。Religion勝利には使いません。

2. culture

   言語、制度、教育、威信、生活様式、行政規範への求心力を表します。Culture勝利には使いません。

3. institutions

   法、官僚制、自治制度、交通、記録、徴税などの統治機構です。

4. governanceHumanResources

   官僚、司祭、教師、職人、専門家、地域指導者などです。

GovernanceLoadは領土、都市、District、Building、人口、Party、占領地、未統合人口から発生します。LoadがCapacityを超えると、維持費増加、Yield低下、命令遅延、離反、反乱が段階的に発生します。

### 5.3 食料と人的資源

foodは都市ごとに産出、蓄積して人口を増やします。人口はただちに兵員になる数値ではなく、国内で生まれるnativeHumanResourcesの母体です。

人口から、政策、教育、職業、徴募、施設に応じてmanpower、officers、specialists、administrators、clergy、artisans、adventurersを供給します。徴兵や過剰動員は生産、食料、統治、忠誠、将来人口へ代償を与えます。

### 5.4 宗教と文化による国外人材

人物は居住国、出身文化、宗教、忠誠、職能を別々に持ち得ます。他国居住のまま自国の宗教共同体または文化圏へ属する状態を表現します。

religionとcultureは次の経路で国外人的資源へ作用します。

1. Attraction

   移民、留学生、職人、冒険者、学者を引き寄せます。

2. Affiliation

   他国居住の信徒、文化的支持者、協力者からexternalAffiliatePoolを形成します。

3. Recruitment

   条件を満たしたAffiliateを宣教師、案内人、密偵、傭兵、専門家、英雄候補として別枠登用します。

4. Integration

   移住者、占領地住民、異文化人材をGovernanceCapacityの範囲で正規人材へ統合します。

5. Defection

   戦争、圧政、魅力差、宗教対立などにより、他国人材が離反または亡命します。

国外人材は無条件に相手国人口から即時取得しません。Exposure、Affiliation、Availability、Recruitment、Integrationを段階状態として処理し、相手国は融和、対抗文化、宗教政策、国境管理などで抵抗できます。

### 5.5 人心、加入、忠誠

人心は、王国、指導者、理念へ人物が自発的に付き従う意思を表すKingdomStockpileです。内部キーは popularSupport とします。GovernanceCapacityが領土や組織を管理できる量であるのに対し、人心は人物、冒険者、英雄、協力者、Partyを仲間に迎え、関係を維持するための資源です。

加入時は対象固有の前提条件を満たし、joinSupportCost以上の人心を一括消費します。その後はTURN_STARTごとにsupportUpkeepを支払います。ただし、人心だけで誰でも獲得できるわけではなく、接触、募集可能状態、宗教・文化・価値観、評判、契約、Quest、敵対関係を別に判定します。

人物やPartyは個別のloyaltyを持ちます。人心は共通通貨、loyaltyは個別状態です。維持費不足で即座に消滅させず、不満、任意命令の拒否、離脱準備、離脱または離反の順に悪化させます。

人心の主な収入源はculture、religion、正統性、繁栄、勝利、Quest達成、約束履行、英雄的行為、Leaderのcharismaです。敗北、残虐行為、契約不履行、未払い、過剰徴募、価値観に反する命令は収入またはloyaltyを低下させます。

Goldは役務を買い、人心は随従意思を得る資源として区別します。傭兵はGold寄り、英雄や盟友は人心寄りの加入・維持費を持ちます。詳細は POPULAR_SUPPORT.md を参照してください。

### 5.6 宗教と文化の最終用途

religionとcultureは独立勝利を生みません。領土と施設の維持、占領地統合、人材獲得、士気、忠誠、PartyとFormationの編成上限、軍事施設と補給網の維持を通じて、最終的に軍事力と国家存続へ寄与します。

### 5.7 保存形態

1. CityLocal

   food、production、localCultureなどです。

2. KingdomStockpile

   gold、mana、popularSupport、strategicResources、dungeonMaterialsなどです。

3. Progress

   science研究、制度開発、生産Projectなどです。

4. HumanPool

   native、affiliate、specialist、military、governanceなどの人的資源です。

5. DerivedCapacity

   MilitaryPower、GovernanceCapacity、LogisticsCapacityなどです。
## 6. 都市生産

### 6.1 標準生産

各都市は productionPerTurn、productionQueue、currentProject を持ちます。生産対象は Unit、Building、District、Wonder、Project に分類します。

ターン開始時、都市の productionPerTurn を currentProject.productionProgress へ加算します。productionProgress が productionCost 以上になれば完成します。

完成時の超過productionは、同じ都市の次のキュー項目へ繰り越します。キューが空なら次ターンまで未割当として保持せず、原則として失われます。将来の政策や能力がこの規則を変更できます。

生産対象を切り替えた場合、既存の progress は対象ごとに保持します。陳腐化、都市喪失、明示キャンセル時の処理は対象定義に従います。

### 6.2 即時購入

purchaseCurrency と purchaseCost が定義された対象は、王国が必要額を全額保有していれば即時完成できます。標準通貨は gold です。魔法対象は mana、Dungeon固有対象は dungeonMaterials を要求できます。religionとcultureは通常の即時購入通貨ではなく、統治、人材獲得、制度条件へ使用します。

即時購入は、残りproductionだけを通貨で埋める処理ではありません。対象の全purchaseCostを支払う独立した取得経路です。途中まで蓄積した productionProgress は返金または通貨換算しません。

District、Wonder、特殊Projectなど、原則購入不可の対象を定義できます。能力、政策、総督相当の効果により購入可能化しても構いません。

### 6.3 生産とユニット行動の分離

都市のUnit、Building、District生産は都市キューを使います。Builderによるタイル改善はユニット行動であり、都市キューとは別です。Settlerによる都市建設もユニット行動です。

## 7. 都市と領土

### 7.1 都市

都市は cityId、ownerId、centerHex、population、foodStorage、productionPerTurn、productionQueue、workedTiles、districts、buildings、localCultureProgress を持ちます。

市民は所有タイルへ配置され、そのタイルのYieldを都市へ与えます。初期MVPでは自動配置のみとし、後に手動配置を追加できます。

### 7.2 都市建設

Settler が合法な地上タイルで FoundCity を実行すると、新しい都市が成立し、Settler は消費されます。都市間最低距離、地形制限、占有、外交条件を Ruleset で検証します。

### 7.3 領土拡張

領土拡張は二経路です。

1. 文化による自然拡張

   都市の localCultureProgress が次のタイル取得コストへ到達すると、合法な隣接タイルを一つ取得します。初期MVPでは候補評価に基づく自動選択とします。

2. Goldによる即時購入

   プレイヤーが都市に隣接する合法タイルを選び、表示された全Goldコストを払って即時取得します。

Gold購入は文化進捗を消費またはリセットしません。他国領は通常購入できず、戦争、外交、イベントなど別ルールで移転します。飛び地取得は原則禁止します。

## 8. Unit、Party、Formation

個別Unitを直接運用するだけでなく、PartyとFormationを第一級のゲーム要素として持ちます。詳細は PARTY_FORMATION.md を参照してください。

### 8.1 Unit

Unitは人物、小隊、兵器、魔物など、Partyへ加入できる最小運用単位です。unitId、ownerId、unitTypeId、hp、movement、combatStats、role、abilityStates、charges、upkeep、statusEffectsを持ちます。全Unit共通の単一行動回数は持たせず、移動力、攻撃回数、有限チャージ、Ability固有コストを分離します。

### 8.2 Party

Partyは最大5名のUnitをまとめる永続的な運用集団です。地上移動、Dungeon探索、補給、Inventory、経験、指揮系統を共有します。

WorldMapでは原則としてPartyを一つのTokenかつMapUnitとして扱います。Partyのmovementは構成員、Formation、地形、輸送手段、補給状態から算出し、標準では最も遅い必須構成員を基準にします。Party内部Unitは個別にWorldMapを移動しません。

Partyは作成、解散、分割、合流、Unit加入、Unit離脱ができます。敵隣接中、戦闘中、Dungeon内など、変更できない状態をRulesetで定義します。

### 8.3 Formation

FormationはParty内部の配置、役割、指揮関係を定義する戦闘構造であり、別Unitではありません。

Party最大5UnitをFront、Middle、RearとLeft、Center、Rightからなる3×3 Gridへ配置します。GridはDamage配分専用であり、WorldMapまたはDungeonの移動盤面、行動順、射程距離を表しません。

正面通常攻撃はFrontを優先し、空いた列から後列が露出します。Guard、Intercept、Tauntを持つ前衛は味方へのDamageを率先して引き受けられます。攻撃側はAbilityが許可する場合、Unit、Slot、Roleを指定して後衛、Leader、Healer等を狙えますが、Cover、Guard、Accuracy、Stealthの判定を受けます。

Row、Column、Area、Pierce等のAttack Patternも同じGridで解決します。詳細は DAMAGE_GRID.md を正本とします。

### 8.4 Party分類

1. Army Party
2. Expedition Party
3. Scout Party
4. Convoy Party
5. Religious Mission
6. Cultural Mission

Party分類は別実装ではなく、許可Unit、行動、維持、Formation、目的をRulesetで変えます。

### 8.5 維持と占有

PartyはUnitごとのgold upkeep、supplies、必要に応じてmanaと人心維持費を消費します。指揮官、Formationの複雑さ、Party規模はCommand Capacityを要求します。

GovernanceCapacity、MilitaryOrganization、指揮官能力が、保有可能Party数、最大規模、高度Formationを制約します。

WorldMapの一タイル占有単位はUnitではなくPartyです。Dungeon内では同じPartyをFormation Slotへ展開します。地上用とDungeon用にUnitを複製しません。

### 8.6 Civ6準拠の行動

行動仕様の正本は ACTION_SYSTEM.md とします。

1. TURN_STARTでmovementRemaining、attacksRemaining、ターン回復Abilityをリセットします。
2. 移動は進入先のTerrain、Feature、River、Road、Zone of Control等のMovement Costを消費します。
3. 通常攻撃はattacksRemainingを一消費し、標準ではPartyの行動を終了します。
4. 一ターン複数回攻撃、攻撃後移動、移動後攻撃禁止等はAbilityで明示します。
5. Builder相当の建設、Great Person相当の能力は有限Chargeを使い、毎ターン自動回復しません。
6. Pillageは標準3 Movement、または残り全Movementを消費します。
7. FoundCityは都市を即時成立させ、Settler相当Entityを消費します。
8. City Production、即時購入、研究、政策、外交はParty行動を消費しません。
## 9. 戦闘

戦闘仕様の正本は COMBAT_SYSTEM.md、構成UnitへのDamage配分は DAMAGE_GRID.md とします。

UnitはIndividual、Detachment、Construct、Monster、SwarmのscaleClassを持ちます。Expedition Partyは個人中心、Army Partyは部隊中心ですが、同じUnit、Party、Combat Resolverを使います。

地上戦とDungeon戦はParty対Partyとして解決します。PartyPowerは構成Unitを集約した後、Formation、指揮、cohesion、補給、地形、Abilityを適用します。

標準Damageは戦闘力差による指数倍率で算出し、同戦闘力なら平均約30Damageです。通常攻撃は原則命中します。Melee Attackでは防御側が行動可能なら同じ解決内で反撃し、Ranged Attackと通常Spellには標準反撃がありません。

Party内部では3×3 Gridを使い、Front優先、Guard、Intercept、Taunt、Cover、狙撃、範囲、貫通を解決します。前衛が倒れても後列を自動で前へ詰めません。

HP0のNamed Characterは原則Downedとなり、専用Tag、救命失敗、Critical EventでDeadになります。DetachmentとSwarmはShatteredとなり、生存者、捕虜、再編可能人員へ分解できます。

moraleは戦闘継続意思、cohesionはParty連携、loyaltyは長期的な随従意思として別々に保持します。全員戦闘不能、morale崩壊、指揮崩壊、撤退または降伏によりParty敗北を判定します。敗北はParty消滅と同義ではありません。

複数Partyは独立したGridのまま共同戦闘へ参加します。MVPでは側面・背面攻撃をAmbush、Surround、Flank Ability等の特殊条件に限定します。

攻撃ごとにHP、空Slot、Guard、Formation、morale、Leader継承、PartyParameter、勝敗を再計算します。

## 10. AI

AIは Human と同じ GameState を読み、同じ合法Commandを発行します。AI専用の直接資源付与や規則無視は行いません。

難易度補正が必要な場合は Ruleset の明示的Modifierとして設定し、ログとUIから確認可能にします。

AIは次の層に分けます。

1. GrandStrategy

   勝利方針、拡張、ダンジョン重視度を決めます。

2. Empire

   都市生産、研究、経済、外交を決めます。

3. Operational

   戦争、遠征隊編成、ダンジョン攻略目標を決めます。

4. Tactical

   個々のユニットの移動、攻撃、撤退を決めます。

初期MVPでは評価関数と優先順位による決定論的AIから始めます。

## 11. ダンジョン探索

### 11.1 地上との接続

ダンジョン入口は WorldMap 上の Site として生成またはイベント配置されます。Scout、Hero、Expedition Partyなど、進入能力を持つユニットが入口で EnterDungeon を実行します。

進入したユニットは地上盤面上で expedition 状態となり、通常移動と地上戦の対象から外れます。入口封鎖、救援、強制退出などは別規則で扱います。

### 11.2 ターン同期

ダンジョン探索は世界ターンと同期します。各遠征隊はPartyのmovementRemaining、attacksRemaining、AbilityDefinitionを共用し、世界ターン開始時に規定の回復を行います。独立した一律dungeonActionsは設けず、距離や地形の差はDungeon固有のModifierで扱います。詳細は ACTION_SYSTEM.md を正本とします。

Human は自王国のフェーズ中に地上とダンジョンの双方を操作し、必要な遠征行動を終えてからターンを終了します。AI王国は同じ遠征CommandをAIが選びます。

ダンジョン中だけ世界時間を無期限停止する仕様にはしません。探索を続ける間も敵王国の生産、研究、侵攻は進みます。これが帝国運営と探索の主要な緊張関係になります。

### 11.3 ダンジョン状態

Dungeon は最低限、次を持ちます。

1. dungeonId
2. entranceHex
3. seed
4. depth と floors
5. threatLevel
6. discoveryState
7. floorMaps
8. encounters
9. traps
10. lootTables
11. bossState
12. completionState
13. occupants

Dungeon floor は部屋と通路、またはヘックスマップで表現できますが、最初の実装は地上と同じヘックス座標系を再利用します。

### 11.4 遠征と戦利品

Expedition は partyUnits、inventory、supplies、position、visibility、retreatRoute、status を持ちます。

戦利品は carried と secured を区別します。

1. carried

   ダンジョン内で保持している未確保品です。全滅、撤退失敗、特定イベントで失う可能性があります。

2. secured

   地上へ帰還または安全地点へ搬送し、王国資源、装備、遺物として確定したものです。

この区別により、深く進むほど報酬が増える一方、喪失リスクも増えます。

### 11.5 ダンジョンの帝国効果

ダンジョンから次を獲得できます。

1. dungeonMaterials
2. 装備
3. 遺物
4. 技術またはEureka相当の進捗
5. 英雄、捕虜、人材
6. 地上施設の解禁
7. 一時的または恒久的な王国Modifier
8. 勝利条件に関わる重要品

帝国側からは遠征隊へ装備、生産物、補給、研究解禁を提供します。

### 11.6 競合

初期実装では一つのダンジョンに同時に入れる遠征隊を一隊とし、占有状態を明示します。複数王国が同一ダンジョンへ同時侵入する共有インスタンスは、マルチプレイ競合解決とPvP規則が必要なため後続仕様とします。

## 12. イベント

イベントはターン制の Command 解決です。リアルタイムの時計や自動進行はありません。

選択必須イベントが発生した場合、対象プレイヤーは回答するまで EndTurn できません。順次ターンでは対象プレイヤーの入力だけをイベントへ限定します。

同時ターンでは他プレイヤーのローカル入力を止めません。ただし共有状態へ影響する結果は Resolution barrier で確定し、先着入力による不公平を避けます。

イベント定義は trigger、conditions、target、pages、choices、effects、once、cooldown、visibility を持ちます。

## 13. 研究、宗教、文化、制度

scienceは技術と軍事開発を進め、Unit、装備、魔法、施設、Formation、兵站を解禁します。Science自体による勝利はありません。

religionとcultureはGovernanceCapacityを生み、領土、District、Building、人口集団の維持と統合へ使います。また、国外のAffiliate、移民、専門家、英雄候補を獲得する経路になります。

制度開発はculture、religion、統治経験、特定条件から進み、政策、行政方式、動員方式、宗教組織、教育、Party編制上限などを解禁します。

Eureka相当の条件達成ボーナスはscienceだけでなく、religion、culture、governance制度にも適用できます。
## 14. 勝敗

Religion勝利、Culture勝利、Science勝利は設けません。これらは統治、人材、軍事開発を経由して、最終的な国家間競争とDungeon攻略へ収束します。

1. Domination

   敵対王国の首都、継戦能力、または政治的主権を失わせ、全主要敵対勢力を降伏させます。

2. Dungeon Conquest

   複数の大Dungeonから重要遺物を確保し、最終Dungeonを開き、その軍事的脅威を撃破して必要な国家Projectを完成させます。

3. Scenario Objective

   防衛、脱出、討伐、期限内確保などの軍事目標です。

4. Score

   最大ターン到達時に、領土、人口、統治余力、軍事力、Dungeon成果、継戦能力から総合判定します。

religion、culture、scienceを高めるだけでは勝利できません。強い統治で軍事・生産基盤を保持し、人材を集め、軍事開発と遠征成功へ変換する必要があります。
## 15. マップ

地上はポイントトップ型六角形マップです。地形は連続性のある生成器で作り、独立一様ランダム配置は使用しません。

WorldMap は次を扱います。

1. terrain
2. feature
3. elevation
4. resource
5. riverEdge
6. road
7. improvement
8. district
9. ownerId
10. visibility
11. dungeonSite

マップ、ダンジョン、AI、イベントの乱数ストリームを分離し、同じseedとCommand列から同じ結果を再現できるようにします。

## 16. セーブとマルチプレイ

セーブは GameState と Ruleset のバージョン、全乱数状態、CommandLog をJSONで保存します。初期は localStorage とJSONエクスポートを使います。

オンラインマルチプレイではホストまたはサーバーを権威状態とします。クライアントはCommandを送信し、確定GameStateまたは差分を受け取ります。表示オブジェクトを同期対象にしません。

切断プレイヤーを一時的にAIへ引き継ぐ Controller 交換を可能にします。

## 17. 確定済み事項と残る調整

### 17.1 確定済みの設計境界

PartyはArmy／Expeditionとも最大5Unit、配置は3×3の9Slotです。UnitはIndividual、Detachment、Construct、Monster、Swarmの尺度を持ちます。地上・DungeonでUnit、Party、行動・Combat Resolverを共有し、GridはDamage配分専用です。

国外人材はExposure、Affiliation、Availability、Recruitment、Integrationを経ます。加入時に人心等を支払い、相手国の対抗策を設ける構造は確定しています。初期Dungeonは一入口一遠征隊で、複数勢力同時侵入は後続です。これらを未確定の構造として再提案しません。

### 17.2 未確定・調整が必要なもの

1. PartyPowerのBaseAggregation、尺度混成時のcommandCost、Formation・指揮・補給Modifierの具体係数。
2. GovernanceCapacity／Loadの本番算出式、宗教の寄与、負荷超過Penalty。現行の暫定式とは区別します。
3. 国外候補の発生率、affinity・加入費・統合期間・防御側効果の具体係数。
4. manaの産出・消費・備蓄上限・地域依存と各用途のバランス。
5. Party upkeep、補給切れ、人心不足・loyaltyの猶予とPenalty係数。
6. 時代区分・標準ターン数、Domination／Dungeon Conquest／Scenario／Scoreの具体条件。
7. 同時ターンの競合規則、切断・再接続、複数勢力同一Dungeonの後続ルール。
8. Dungeonの大きさ・深度、撤退・全滅・救命・戦利品喪失の具体係数。
9. Construct／Monsterを含むHP0後の固有処理、Critical・回復・運搬・捕虜・Lootの詳細定義。

未確定事項はRulesetで変更可能な構造にし、決定時は理由と確認日を残します。実装済み／未実装の区分はSTATUS、着手順はHANDOFFを更新してください。
