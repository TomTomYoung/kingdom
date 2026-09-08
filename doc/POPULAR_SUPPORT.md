# Kingdom 人心・加入・忠誠仕様

更新日: 2026-09-08

仕様状態: 基本構造確定、数値係数と離反猶予ターンは暫定

## 1. 目的

人心は、人物が王国、指導者、理念へ自発的に付き従う意思をゲーム上の資源として表します。冒険者、英雄、専門家、国外Affiliate、友好的な知性ある魔物、独立Partyを仲間にする際の加入通貨であり、所属後も維持費がかかります。

内部キーは `popularSupport`、画面上の表記は「人心」です。

## 2. 他の値との境界

| 値 | 意味 | 主な用途 |
| --- | --- | --- |
| popularSupport | 王国が蓄える求心力 | 加入時支払い、毎ターン維持 |
| loyalty | 人物またはPartyごとの忠誠状態 | 命令受諾、離脱、離反 |
| GovernanceCapacity | 領土・組織を管理できる量 | 都市、区域、建造物、人口、占領地の維持 |
| charisma | Leaderや人物の能力 | 人心収入、加入費、維持費、Party補正 |
| affinity | 候補と王国・Leaderの相性 | 募集可否、加入費、loyalty変動 |
| reputation | 過去の行為に対する評価 | 候補群と派閥ごとの補正 |

人心を払っても、価値観の対立、未達Quest、敵対関係などの必須条件は無視できません。人心は好感度そのものではなく、条件を満たした相手を実際に動かすための有限資源です。

## 3. 保存単位

1. Kingdom popularSupport

   王国全体で使える備蓄です。標準の加入費と維持費はここから支払います。

2. popularSupportCap

   蓄積上限です。文化、宗教、正統性、通信網、首都施設、Leaderのcharismaで増えます。上限を設け、平時の無限備蓄を防ぎます。

3. Entity loyalty

   加入済み人物またはPartyごとの0から100の状態値です。資源として他者へ移せません。

4. Candidate affinity

   未加入候補ごとの相性です。王国、Leader、宗教、文化、所属Partyに対して別々に持てます。

## 4. 人心の収入

ターン開始時の基礎収入は次から算出します。

```text
popularSupportIncome =
  cultureContribution
  + religionContribution
  + legitimacy
  + prosperity
  + victories
  + completedPromises
  + heroicActs
  + leaderCharisma
  - defeats
  - atrocities
  - brokenPromises
  - unpaidContracts
  - oppressivePolicies
  - overRecruitment
```

cultureとreligionは全量をそのまま人心へ変換せず、建造物、制度、人物Ability等が定めるContributionだけを加えます。同じ源泉を積み重ねた際は逓減させ、多様な支持基盤を作る方が有利になる設計とします。

即時のQuest達成や救援で人心を得る場合も、GameEventへ理由と内訳を記録します。

## 5. 加入判定

候補は次の順で判定します。

1. Contact

   候補を発見し、交渉可能であること。

2. Availability

   捕虜、敵対中、Quest未達、雇用済みなどの状態による募集可否を満たすこと。

3. Prerequisites

   必要技術、宗教、文化、評判、称号、Party空き枠、GovernanceCapacity等を満たすこと。

4. Affinity

   価値観、王国方針、Leader、宗教、文化、過去の行為から加入費Modifierを算出すること。

5. Payment

   Gold、mana、item、popularSupport等のjoinCostを全額支払うこと。

6. Registration

   ownerId、partyId、supportUpkeep、loyalty、契約期間、離脱条件を登録すること。

加入時人心は次を基準にします。

```text
joinSupportCost =
  baseJoinSupport
  × rarity
  × ambition
  × foreignness
  × danger
  × reputationModifier
  × affinityModifier
  × relationshipModifier
```

高いcharisma、同宗教、文化的親和、救援実績、Quest達成はaffinityModifierを下げます。敵国出身、王国の悪評、危険な任務、価値観の不一致は上げます。

## 6. 関係性ごとの費用構造

| 関係 | 加入費の中心 | 維持費の中心 | 特徴 |
| --- | --- | --- | --- |
| 国内徴募兵 | 人的資源、Gold | Gold、食料、統治負荷 | 人心負担は小さいが、徴募しすぎると国家人心が減る |
| 傭兵 | Gold | Gold | 人心負担は低め。未払い時は急速に離脱する |
| 冒険者 | 人心、Gold、Quest | 人心、分配報酬 | 戦果、探索成果、Leaderとの相性を重視する |
| 英雄・盟友 | 人心、信頼、Quest | 人心、役割、価値観 | 強力だが政治方針や約束に反応する |
| 宗教的支持者 | 人心、同宗教 | 人心または宗教Contribution | 教義違反でloyaltyが大きく下がる |
| 文化的専門家 | 人心、文化親和 | 人心、待遇 | 研究、制作、自治、名誉等を要求できる |
| 外国Affiliate | Affiliation、人心 | 人心、秘匿コスト | 宗主国の対抗策と発覚リスクを受ける |
| 知性ある魔物 | 人心、契約、mana等 | 人心、mana、環境 | 種族固有の価値観と条件を持つ |
| 非知性魔物 | Bond、調教、Control | 食料、mana、Control | 原則として人心では募集しない |

Goldは契約上の役務、人心は継続的な随従意思を表します。混合費用を許可します。

## 7. 毎ターン維持

TURN_STARTの維持費フェーズで、加入済みEntityのsupportUpkeepを合計し、優先順位に従ってpopularSupportから支払います。

```text
supportUpkeep =
  baseSupportUpkeep
  × ambition
  × hardship
  × distance
  × casualtyPressure
  × valueConflict
  × integrationModifier
  × leaderModifier
```

プレイヤーはPartyまたは人物へ維持優先度を設定できます。同順位ではentityId順など決定論的規則を使い、マルチプレイとReplayで結果を一致させます。

維持費不足分はsupportDebtとして対象ごとに記録し、loyaltyを低下させます。余った人心で過去のDebtを自動完済するかはRuleset設定とし、MVPでは自動完済しません。

## 8. 忠誠と維持不足

loyaltyの標準範囲は0から100です。

```text
loyaltyDelta =
  personalAffinity
  + leaderRelationship
  + recentSuccess
  + fairTreatment
  + fulfilledPromises
  - unpaidSupport
  - unpaidGold
  - casualties
  - exhaustion
  - valueConflict
  - rivalInfluence
```

| loyalty | 状態 | 効果 |
| ---: | --- | --- |
| 75–100 | Devoted | Bonusが有効。困難な命令も受けやすい |
| 50–74 | Stable | 通常行動 |
| 25–49 | Discontent | 士気、相乗効果、任意行動へPenalty |
| 1–24 | Refusing | 危険な命令の拒否、離脱予告、交渉要求 |
| 0 | Break | 離脱、敵対、帰郷、離反のいずれかを性格と状況で決定 |

一度の不足で即離脱させません。ただし「金だけで動く傭兵」「短気」「裏切りやすい」等のTraitは猶予を短くできます。離脱結果は消滅ではなく、WorldMap上のNPC化、元勢力への帰還、独立Party化、敵国への亡命を基本とします。

## 9. Partyとの接続

Party最大人数は5名です。Partyへ人物を加入させる場合、王国への加入とParty配属を別Commandにします。既に王国所属の人物をPartyへ移すだけなら、通常はjoinSupportCostを再度払いません。

PartyのsupportUpkeepは構成員別維持費の合計を基礎にし、Leaderのcharisma、軍師能力、相性、Formation適性、戦果、補給状態で補正します。

PartyParameter集約時にloyaltyと人心不足をModifierとして適用します。高いloyaltyと優れたLeaderは構成員の単純合計を超える相乗効果を生みます。不満状態では連携が崩れ、総和を下回る場合があります。

## 10. 国外人材の引き抜きと対抗策

religionとcultureは国外候補をExposureからAffiliation、Availabilityへ進めます。人心はAvailability到達後のRecruitmentと維持に使います。

防御側は待遇改善、自治、同化または多文化制度、宗教保護、対抗文化、昇進、Gold支給、国内人心の投入、宣伝、国境管理、諜報摘発で候補のaffinityとAvailabilityへ対抗できます。

引き抜きに成功しても即時に完全統合しません。外国Affiliate、移民、亡命者、雇用専門家などの身分を保持し、GovernanceCapacityと時間を使って正規人材へ統合します。

## 11. CommandとEvent

最低限、次のCommandを用意します。

1. RecruitCandidate
2. AssignMemberToParty
3. RemoveMemberFromParty
4. SetSupportPriority
5. NegotiateTerms
6. ReleaseFollower
7. OfferAmnesty
8. CounterRecruitment

最低限、次のGameEventを記録します。

1. PopularSupportGained
2. PopularSupportSpent
3. CandidateRecruited
4. SupportUpkeepPaid
5. SupportUpkeepMissed
6. LoyaltyChanged
7. OrderRefused
8. FollowerDeparted
9. FollowerDefected

## 12. MVP受入条件

1. 同じGameStateとCommand列なら人心収支と忠誠結果が一致する。
2. 募集条件未達なら人心を保有していても加入できない。
3. 加入成功時だけjoinSupportCostが一度だけ減る。
4. Partyが5名なら6人目を加入できない。
5. TURN_STARTでsupportUpkeepが一度だけ処理される。
6. 維持費不足でloyaltyが下がるが、標準設定では即時消滅しない。
7. 忠誠0の結果がTraitと状況から決定論的に選ばれる。
8. Leaderのcharismaが加入費、維持費、PartyParameterの内訳へ表示される。
9. Gold主体の傭兵と人心主体の英雄で費用構造が異なる。
10. 国外候補はAffiliationとAvailabilityを経ずに直接募集できない。
