/** 接口规格 v0.3-draft. 类型契约，不包含业务实现；细节以配套文档为准。 */
export type Id = string;
/** Canonical unsigned decimal integer: /^(0|[1-9][0-9]*)$/; JSON string. */
export type Nat = string;
export type Signed = string;
export type Ms = number; // nonnegative safe integer, UTC epoch or duration according to field
export type Gram = number; // positive safe integer
export type Ratio = number; // finite 0..1
export type Multiplier = number; // finite >=0
export type Dict<T> = Record<Id, T>;
export type Stat = 'strength'|'skill'|'agility'|'perception'|'luck';
export type Stats = Record<Stat,Nat>;
export type Grade = 'TINY'|'SMALL'|'NORMAL'|'LARGE'|'GIANT'|'RECORD';
export type Rarity = 'COMMON'|'UNCOMMON'|'RARE'|'EPIC'|'LEGENDARY';
export type Water = 'FRESH'|'SALT'|'SPECIAL';
export type BaitKind = 'FREE'|'CONSUMABLE'|'REUSABLE';
export type Version = {schemaVersion:number; configVersion:Id; engineVersion:Id};
export type Failure = 'STRENGTH'|'HOOK'|'LINE_PHYSICAL'|'ROD_PHYSICAL'|'LINE_OPERATION'|'ROD_OPERATION';
export type Outcome = 'SUCCESS'|'FAILURE'|'EMPTY'|'REPLACEMENT'|'CANCELLED';
export type Phase = 'IDLE'|'CASTING'|'WAITING'|'FIGHTING'|'SETTLING'|'PREPARING'|'PAUSED';
export type RunState = 'INITIALIZING'|'MIGRATING'|'OFFLINE_SETTLING'|'RUNNING'|'BACKGROUND'|'RECOVERING'|'ERROR';
export type PauseReason = 'OFFLINE_LIMIT'|'WAREHOUSE_FULL'|'PENDING_FISH'|'NO_BAIT'|'INVALID_CONFIG'|'STORAGE_ERROR'|'CLOCK_ERROR';
export type Overflow = 'STOP'|'SELL_NEW'|'SMART_SELL';
export type Cmp = 'EQ'|'GTE'|'LTE';
export type StatKey = 'attempts'|'successes'|'failures'|'empty'|'cancelled'|'caughtWeightG'|'goldIn'|'goldOut'|'baitUsed'|'fishingMs'|'paidResets';
export type Condition = {type:'ALL'|'ANY';children:Condition[]}|{type:'NOT';child:Condition}
 | {type:'LEVEL';min:Nat}|{type:'REGION_UNLOCKED'|'POSITION_DISCOVERED'|'DISCOVERY'|'EQUIPMENT_OWNED'|'ACHIEVEMENT';id:Id}
 | {type:'SPECIES_COUNT';min:number;regionId?:Id}|{type:'RECORD';speciesId:Id;minG:Gram;regionId?:Id}
 | {type:'STAT';key:StatKey;cmp:Cmp;value:Nat}|{type:'ELIGIBLE_ATTEMPTS';pityId:Id;min:Nat}
 | {type:'CURRENT_REGION'|'CURRENT_POSITION'|'CURRENT_BAIT'|'CURRENT_ROD'|'DAY_PHASE'|'WEATHER';id:Id}
 | {type:'OUTCOME';value:Outcome}|{type:'FISH_SPECIES'|'FISH_COLOR';id:Id}|{type:'FISH_WEIGHT';cmp:Cmp;weightG:Gram};
export type Reward = {type:'GOLD'|'XP';amount:Nat}|{type:'BAIT';baitId:Id;count:Nat}
 | {type:'EQUIPMENT';equipmentId:Id;duplicateRewardId?:Id}|{type:'DISCOVERY';discoveryId:Id}|{type:'COSMETIC';cosmeticId:Id};
export interface RewardDef {id:Id;items:Reward[]}
export interface Curve {k:number;maxEffect:number}
export interface LuckCurve {k:number;maxMultiplier:number}
export interface Bounds {min:number;max:number}
export interface DurationBounds {minRealMs:Ms;maxActiveMs:Ms;minWorkMs:Ms;maxWorkMs:Ms}
export interface Piecewise {points:{x:number;y:number}[]} // linear interpolation, clamp endpoints
export interface AttributeRules {initial:Stats;pointsPerLevel:Nat;castAgility:Curve;reelAgility:Curve;prepareAgility:Curve;bitePerception:Curve;fightStrength:Curve}
export interface RodDef {id:Id;nameKey:Id;type:Id;quality:Id;isSpecial:boolean;statBonus:Stats;maxCastM:number;maxDepthM:number;capacityN:number;control:number;sensitivity:Ratio;reelEfficiency:number;castBaseMs:Ms;castMsPerM:number;useCondition:Condition}
export interface LineDef {id:Id;nameKey:Id;material:Id;quality:Id;lengthM:number;capacityN:number;stealth:Ratio;burstBuffer:Ratio;signal:Ratio;useCondition:Condition}
export interface BaitDef {id:Id;nameKey:Id;kind:BaitKind;attraction:number;speciesPreference:{default:number;byDiet:Dict<number>;bySpecies:Dict<number>;byRegionSpecies:Dict<Dict<number>>};weightPreference:{defaultByGrade:Record<Grade,number>;bySpeciesGrade:Dict<Partial<Record<Grade,number>>>};useCondition:Condition;referenceGold:Nat;adSupplyTier?:Id}
export interface RegionDef {id:Id;nameKey:Id;waterType:Water;hidden:boolean;unlockCondition:Condition;unlockCostGold:Nat;weatherProfileId:Id;eventIds:Id[]}
export interface PositionDef {id:Id;regionId:Id;distanceBand:Id;depthBand:Id;distanceM:number;depthM:number;hidden:boolean;discoveryId?:Id;enabled:boolean;biteBaseMs:Ms}
export interface PopulationDef {id:Id;positionId:Id;speciesId:Id;baseWeight:number;activityMultiplier:number;gradeMultipliers:Partial<Record<Grade,number>>;colorMultipliers:Dict<number>;environmentProfileId:Id;eligibility:Condition}
export interface WeightBand {grade:Grade;minG:Gram;maxG:Gram;baseWeight:number;shapeAlpha:number}
export interface ColorDef {id:Id;baseWeight:number;priceMultiplier:number;xpBonusRate:Ratio;assetKey:Id}
export interface CombatProfile {referenceG?:Gram;sustainN:number;burstExtraN:number;sustainExponent:number;burstExponent:number;hookDifficulty:Piecewise;baseHookRisk:Ratio;errorDifficulty:Piecewise;baseErrorRisk:Ratio;errorExtraForceN:Piecewise;fightBaseMs:Piecewise}
export interface XpProfile {baseXp:Nat;referenceG?:Gram;weightExponent:number;weightMultiplier:Bounds;firstSpeciesXp:Nat;firstRegionXp:Nat;firstColorXp:Dict<Nat>;milestoneXp:Partial<Record<Grade,Nat>>}
export interface SpeciesDef {id:Id;nameKey:Id;rarity:Rarity;diet:Id;waterType:Water;visibility:'NORMAL'|'HIDDEN';minWeightG:Gram;maxWeightG:Gram;referenceG:Gram;wariness:Ratio;baseActivity:number;bands:WeightBand[];colors:ColorDef[];combat:CombatProfile;xp:XpProfile;price:{baseGold:Nat;referenceG?:Gram;weightExponent:number};aquariumSpace:Piecewise;compatibilityTags:Id[];habitHintKeys:Id[];publicRegionIds:Id[]}
export interface DayPhase {id:Id;startMinute:number;endMinute:number}
export interface WeatherProfile {id:Id;initial:Dict<number>;transitions:Dict<Dict<number>>;durationGameMs:Dict<{min:Ms;max:Ms}>}
export interface EnvFactors {activity:number;speciesWeight:number;grade:Partial<Record<Grade,number>>;color:Dict<number>;prohibited:boolean}
export interface EnvironmentProfile {id:Id;byDay:Dict<EnvFactors>;byWeather:Dict<EnvFactors>}
export type Modifier = {channel:'ACTIVITY'|'SPECIES_WEIGHT';factor:number;regionId:Id;positionId?:Id;speciesId?:Id}
 | {channel:'GRADE_WEIGHT';factor:number;grade:Grade;regionId:Id;positionId?:Id;speciesId?:Id}
 | {channel:'COLOR_WEIGHT';factor:number;colorId:Id;regionId:Id;positionId?:Id;speciesId?:Id}
 | {channel:'TEMP_POPULATION';population:PopulationDef;regionId:Id}
 | {channel:'PROHIBIT';regionId:Id;positionId?:Id;speciesId?:Id};
export interface PityDef {id:Id;eligible:Condition;targetDiscoveryId?:Id;targetEquipmentId?:Id;curve:Piecewise;maxMultiplier:number}
export type EventDef = {id:Id;category:'ENVIRONMENT';regionId:Id;eligibility:Condition;stackGroup:Id;checkEveryGameMs:Ms;chance:Ratio;durationGameMs:Ms;modifiers:Modifier[]}
 | {id:Id;category:'REPLACEMENT';trigger:'BEFORE_DRAW';eligibility:Condition;chance:Ratio;luck?:LuckCurve;pityId?:Id;rewardId:Id;claimKey?:Id;recoveryMs:Ms}
 | {id:Id;category:'EXTRA'|'DISCOVERY';trigger:'AFTER_SETTLEMENT';eligibility:Condition;chance:Ratio;luck?:LuckCurve;pityId?:Id;rewardId:Id;claimKey?:Id}
 | {id:Id;category:'ENCOUNTER';eligibility:Condition;presentationKey:Id};
export interface DiscoveryDef {id:Id;hidden:boolean;condition:Condition;unlockRegionIds:Id[];unlockPositionIds:Id[];logKey:Id}
export interface AchievementDef {id:Id;nameKey:Id;visibility:'NORMAL'|'HIDDEN';condition:Condition;rewardId:Id;stageGroup?:Id;stageOrder?:number}
export type ItemRef = {kind:'ROD'|'LINE'|'BAIT';id:Id};
export interface ShopOffer {id:Id;scopeRegionId?:Id;item:ItemRef;priceGold:Nat;condition:Condition;enabled:boolean}
export interface WarehouseTier {id:Id;previousId?:Id;capacity:number;costGold:Nat}
export interface SlotTier {id:Id;previousId?:Id;capacity:number;costGold:Nat}
export interface TankType {id:Id;waterType:Water;allowedTags:Id[];maxWeightG:Gram;spaceUnits:Nat;priceGold:Nat;condition:Condition;upgradeFromIds:Id[]}
export interface TimingRules {cast:DurationBounds;wait:DurationBounds;fight:DurationBounds;prepare:DurationBounds;prepareMs:Record<Outcome|Failure,Ms>;reelOperationMs:Ms;reelBaseMps:number;signalRodWeight:Ratio;signalMaxReduction:Ratio;triangle:{a:number;mode:number;b:number};activity:Bounds;emptyTimeoutMs:Ms;maxRateMicro:Nat}
export interface ProbabilityRules {stealthMaxLoss:Ratio;speciesLuck:Record<Rarity,LuckCurve>;gradeLuck:Record<Grade,LuckCurve>;colorLuck:Dict<LuckCurve>;activityBounds:Bounds;speciesBounds:Bounds;gradeBounds:Bounds;colorBounds:Bounds;specialColorCap:Ratio;replacementCap:Ratio;extraCap:Ratio}
export interface CaptureRules {forceReferenceN:number;strengthK:number;strengthMaxRisk:Ratio;strengthGamma:number;hookSkill:Curve;errorSkill:Curve;hookControlExponent:number;sustainProgress:Ratio;burstProgress:Ratio;strengthNodeRange:[Ratio,Ratio];hookNodeRange:[Ratio,Ratio]}
export interface GrowthRules {nextLevelA:number;nextLevelB:number;failRatio:Ratio;failXpCap:Nat;capabilityExponent:number;recordRelativeThreshold:Ratio;recordAbsoluteThresholdG:Gram;recordRewardXp:Nat;maxLevelUpsPerTransaction:number}
export interface EconomyRules {minSaleGold:Nat;resetInitialGold:Nat;resetMultiplier:number;resetCapGold:Nat;freeResetCount:number;freeResetMaxLevel:Nat}
export interface OfflineRules {tiers:{minLevel:Nat;allowanceMs:Ms}[];maxMs:Ms}
export interface AdsRules {speedMultiplier:number;speedDurationMs:Ms;speedDailyLimit:number;extensionMs:Ms;extensionDailyLimit:number;goldRate:Ratio;goldCap:Nat;goldClaimWindowMs:Ms;requestTimeoutMs:Ms;baitSupply:Dict<{count:Nat;quotaGroup:Id;dailyLimit:number}>;resetDailyLimit:number;quotaTimezoneOffsetMinutes:number}
export interface GameConfig {version:Version;cosmetics:Dict<{id:Id;kind:'TITLE'|'AVATAR_FRAME'|'DECOR';nameKey:Id}>;contentHash:Id;experiment:boolean;initial:{regionId:Id;positionId:Id;rodId:Id;lineId:Id;freeBaitId:Id;warehouseTierId:Id;slotTierId:Id;gold:Nat};attributes:AttributeRules;admission:{lineReserve:Ratio};timing:TimingRules;probability:ProbabilityRules;capture:CaptureRules;growth:GrowthRules;economy:EconomyRules;offline:OfflineRules;ads:AdsRules;persistence:{autoSaveIntervalMs:Ms;checkpointMaxNodes:number;deleteConfirmMs:Ms;clockToleranceMs:Ms};inventory:{baitStockLimit:Nat;maxBatch:number;maxPageSize:number;maxEventSteps:number;maxLedgerEntries:number;maxRecentSettlements:number;maxClosedReports:number};world:{anchorRealMs:Ms;anchorGameMs:Ms;speed:12;dayPhases:DayPhase[]};rods:Dict<RodDef>;lines:Dict<LineDef>;baits:Dict<BaitDef>;regions:Dict<RegionDef>;positions:Dict<PositionDef>;populations:Dict<PopulationDef>;species:Dict<SpeciesDef>;weather:Dict<WeatherProfile>;environment:Dict<EnvironmentProfile>;events:Dict<EventDef>;pity:Dict<PityDef>;discoveries:Dict<DiscoveryDef>;achievements:Dict<AchievementDef>;rewards:Dict<RewardDef>;offers:Dict<ShopOffer>;warehouse:Dict<WarehouseTier>;slots:Dict<SlotTier>;tanks:Dict<TankType>}
export interface Selection {regionId:Id;positionId:Id;rodId:Id;lineId:Id;baitId:Id}
export type FishPredicate = {type:'SPECIES'|'COLOR';ids:Id[]}|{type:'RARITY';values:Rarity[]}|{type:'GRADE';values:Grade[]}|{type:'WEIGHT';minG?:Gram;maxG?:Gram}|{type:'FIRST_SPECIES'|'FIRST_REGION'|'FIRST_COLOR'|'NEW_RECORD'};
export interface FishRule {id:Id;enabled:boolean;predicate:FishPredicate}
export interface Policies {retain:FishRule[];sell:FishRule[];overflow:Overflow;replenish:{enabled:boolean;batch:number;reserveGold:Nat;onInsufficient:'FREE'|'STOP'}}
export interface CastSnapshot {selection:Selection;stats:Stats;level:Nat;version:Version;requiredLineM:number;baitReferenceGold:Nat;startedAt:Ms}
export interface EnvironmentSnapshot {regionId:Id;gameMs:Ms;dayPhaseId:Id;weatherId:Id;activeEvents:Id[]}
export interface PlannedFish {id:Id;speciesId:Id;populationId:Id;weightG:Gram;grade:Grade;colorId:Id;biteAt:Ms;environment:EnvironmentSnapshot}
export interface Combat {sustainN:number;burstExtraN:number;hookDifficulty:number;errorDifficulty:number}
export interface FightNode {id:Id;work:Nat;kind:'SUSTAIN'|'BURST'|'OPERATION'|'STRENGTH'|'HOOK'|'COMPLETE';failure?:Failure;loadN?:number}
export interface FightPlan {baseWork:Nat;extraWork:Nat;totalWork:Nat;physicalPass:boolean;successProbability:Ratio;nodes:FightNode[];cursor:number}
export interface WorkState {done:Nat;required:Nat;activeMs:Ms;emptyMs:Ms}
export interface Attempt {id:Id;seq:Nat;activeElapsedMs:Ms;encounterKey?:Id;cast:CastSnapshot;phase:'CASTING'|'WAITING'|'FIGHTING'|'SETTLING';work:WorkState;baitDebitKey:Id;fish?:PlannedFish;fight?:FightPlan;replacementEventId?:Id;outcome?:Outcome;failure?:Failure;settled:boolean}
export interface FishingState {enabled:boolean;phase:Phase;pausedFrom?:Exclude<Phase,'PAUSED'>;pauseReason?:PauseReason;attempt?:Attempt;prepare?:{work:WorkState;cast:CastSnapshot;outcome:Outcome;failure?:Failure};selection:Selection;preferredBaitId:Id;lastSelectionByRegion:Dict<Selection>;policies:Policies;nextAttemptSeq:Nat;lastTerminalAttemptSeq:Nat}
export interface CatchFlags {firstSpecies:boolean;firstRegion:boolean;firstColor:boolean;newRecord:boolean}
export interface CatchArchive {id:Id;rarityAtCatch:Rarity;fish:PlannedFish;cast:CastSnapshot;catchAt:Ms;catchEnvironment:EnvironmentSnapshot;flags:CatchFlags}
export type Owner = {kind:'WAREHOUSE'}|{kind:'PENDING'}|{kind:'TANK';tankId:Id};
export interface FishInstance {id:Id;rarityAtCatch:Rarity;archiveId:Id;speciesId:Id;weightG:Gram;grade:Grade;colorId:Id;catchAt:Ms;owner:Owner;manualLocked:boolean;flags:CatchFlags}
export interface RecordEntry {scopeKey:Id;maxG:Gram;maxFishId:Id;minG:Gram;minFishId:Id;maxTies:Nat;minTies:Nat;rewardBaselineG?:Gram;milestones:Grade[]}
export interface SpeciesStats {count:Nat;weightG:Nat;firstFishId:Id;firstAt:Ms;minG:Gram;maxG:Gram;colors:Id[];regions:Id[];positions:Id[];baits:Id[];dayPhases:Id[];weatherIds:Id[]}
export interface TankInstance {id:Id;typeId:Id;slot:number}
export interface GoldEntry {id:Id;at:Ms;reason:'SALE'|'AUTO_SALE'|'EVENT'|'ACHIEVEMENT'|'AD'|'BAIT_BUY'|'EQUIPMENT_BUY'|'REGION_UNLOCK'|'WAREHOUSE'|'TANK'|'SLOT'|'RESET';delta:Signed;balanceAfter:Nat;attemptId?:Id;sessionId?:Id;configVersion:Id}
export interface AttemptSettlement {attemptId:Id;at:Ms;activeElapsedMs:Ms;outcome:Outcome;failure?:Failure;fishId?:Id;xp:Nat;goldDelta:Signed;referenceBaitGold:Nat;eventIds:Id[];progress:Ratio}
export interface Aggregate {counts:Record<StatKey,Nat>;failureCounts:Record<Failure,Nat>;bySpecies:Dict<SpeciesStats>;byRegionSpecies:Dict<SpeciesStats>;dimensions:Dict<Nat>}
export interface OfflineAccumulator {fishingMs:Ms;pausedMs:Ms;lostMs:Ms;attempts:Nat;completedAttempts:Nat;successes:Nat;failures:Record<Failure,Nat>;empty:Nat;replacement:Nat;xp:Nat;levels:Nat;goldIn:Nat;goldOut:Nat;newFishAutoSaleGold:Nat;consumedBaitReferenceGold:Nat;fishValueGold:Nat;baitUsed:Dict<Nat>;baitBought:Dict<Nat>;highlightArchiveIds:Id[];discoveryIds:Id[];achievementIds:Id[]}
export interface OfflineSession {id:Id;startedAt:Ms;allowanceMs:Ms;deadline:Ms;settledUntil:Ms;target?:Ms;extensionMs:Ms;acc:OfflineAccumulator}
export interface OfflineReport {id:Id;sessionId:Id;startedAt:Ms;endedAt:Ms;deadline:Ms;acc:OfflineAccumulator;adEligibleGold:Nat;adRewardGold:Nat;claimExpiresAt:Ms;adClaimed:boolean;configVersion:Id}
export type AdTarget = {kind:'SPEED'|'EXTENSION'|'RESET'}|{kind:'GOLD';reportId:Id}|{kind:'BAIT';baitId:Id};
export interface AdRequest {id:Id;seq:Nat;expiresAt:Ms;completedAt?:Ms;target:AdTarget;status:'CREATED'|'SHOWING'|'COMPLETED'|'REWARDED'|'CANCELLED'|'FAILED';createdAt:Ms;quotaDay:Id;quotaGroup:Id;configVersion:Id;reward?:Nat;durationMs?:Ms;failureCode?:Id}
export interface AdState {speedUntil:Ms;speedMultiplier:number;nextOfflineExtensionMs:Ms;quotaDay:Id;usedByDay:Dict<Dict<number>>;request?:AdRequest;lastTerminalSeq:Nat;nextSeq:Nat}
export interface RegionEnvironment {regionId:Id;configVersion:Id;weatherId:Id;nextWeatherAt:Ms;active:{eventId:Id;startAt:Ms;endAt:Ms}[];nextChecks:Dict<Ms>}
export interface RngState {algorithm:'XOSHIRO128SS_V1';streams:Dict<[number,number,number,number]>}
export interface GameState {version:Version;rootSeed:number;playerId:Id;saveEpoch:Id;cursorMs:Ms;stateRevision:Nat;level:Nat;xpInLevel:Nat;totalXp:Nat;unspentPoints:Nat;totalPointsGranted:Nat;allocated:Stats;paidResets:Nat;freeResetsUsed:number;gold:Nat;ownedRods:Id[];ownedLines:Id[];ownedReusableBaits:Id[];baitStock:Dict<Nat>;unlockedRegions:Id[];discoveredPositions:Id[];discoveries:Id[];discoveryLog:Dict<{at:Ms;sourceId:Id;archiveId?:Id}>;achievements:Id[];cosmetics:Id[];claims:Id[];pity:Dict<Nat>;fishing:FishingState;fish:Dict<FishInstance>;archives:Dict<CatchArchive>;records:Dict<RecordEntry>;recordHistory:{scopeKey:Id;kind:'MIN'|'MAX';archiveId:Id;at:Ms}[];warehouseTierId:Id;slotTierId:Id;tanks:Dict<TankInstance>;stats:Aggregate;ledger:GoldEntry[];recentSettlements:AttemptSettlement[];environment:Dict<RegionEnvironment>;rng:RngState;offline?:OfflineSession;reports:Dict<OfflineReport>;ads:AdState;clock:{lastWallMs:Ms;highWaterMs:Ms};nextObjectSeq:Nat;lastClientCommandSeq:Nat;lastCommandReceipt?:{seq:Nat;requestHash:Id;reply:Result<CommandReply>}}
export type ErrorCode = 'INVALID_ARGUMENT'|'NOT_FOUND'|'LOCKED'|'NOT_OWNED'|'ALREADY_OWNED'|'INSUFFICIENT_GOLD'|'INSUFFICIENT_POINTS'|'INVALID_SELECTION'|'LINE_TOO_SHORT'|'CAST_TOO_FAR'|'DEPTH_TOO_DEEP'|'NO_BAIT'|'STOCK_LIMIT'|'WAREHOUSE_FULL'|'FISH_PROTECTED'|'PENDING_FISH'|'TANK_INCOMPATIBLE'|'TANK_FULL'|'NO_TANK_SLOT'|'NOT_NEXT_TIER'|'NO_CHANGE'|'NOT_RUNNING'|'BUSY'|'STALE_REVISION'|'STALE_COMMAND'|'COMMAND_CONFLICT'|'AD_UNAVAILABLE'|'AD_LIMIT'|'AD_EXPIRED'|'AD_IN_PROGRESS'|'ALREADY_CLAIMED'|'CLOCK_ERROR'|'CONFIG_INVALID'|'VERSION_UNSUPPORTED'|'SAVE_CORRUPT'|'SAVE_IO'|'SAVE_UNCERTAIN'|'MIGRATION_FAILED'|'NUMERIC_LIMIT'|'EVENT_LIMIT'|'INVARIANT_VIOLATION'|'CONFIRM_REQUIRED'|'UNSUPPORTED_FEATURE';
export type Result<T> = {ok:true;data:T}|{ok:false;error:{code:ErrorCode;field?:string;detail?:string;retryable:boolean}};
export type Command = {type:'START_FISHING'|'STOP_FISHING'|'RESUME_FISHING'|'RESTORE_PREFERRED_BAIT'}
 | {type:'CHANGE_SELECTION';selection:Selection}|{type:'CHANGE_REGION';regionId:Id;selection:Selection}
 | {type:'SET_POLICIES';policies:Policies}|{type:'ALLOCATE';points:Stats}|{type:'RESET';method:'FREE'|'GOLD'}
 | {type:'BUY';offerId:Id;quantity:Nat}|{type:'UNLOCK_REGION';regionId:Id}|{type:'EXPAND_WAREHOUSE';tierId:Id}
 | {type:'SET_FISH_LOCK';fishId:Id;locked:boolean}|{type:'SELL_FISH';fishIds:Id[];confirmProtected:boolean}
 | {type:'BUY_TANK';typeId:Id;slot:number}|{type:'EXPAND_TANK_SLOTS';tierId:Id}|{type:'UPGRADE_TANK';tankId:Id;typeId:Id}
 | {type:'MOVE_FISH';fishId:Id;destination:Owner}|{type:'BEGIN_AD';target:AdTarget};
export interface CommandEnvelope {seq:Nat;expectedRevision:Nat;command:Command}
export interface CommandReply {changed:boolean;revision:Nat;goldDelta:Signed;fishIds:Id[];objectIds:Id[];notices:Id[];adRequestId?:Id}
export interface PageRequest {limit:number;cursor?:Id}
export interface Page<T> {items:T[];nextCursor?:Id;revision:Nat;total:number}
export interface PublicCatchArchive {id:Id;fishId:Id;speciesId:Id;weightG:Gram;grade:Grade;colorId:Id;biteAt:Ms;catchAt:Ms;selection:Selection;stats:Stats;level:Nat;environment:EnvironmentSnapshot;catchEnvironment:EnvironmentSnapshot;version:Version;flags:CatchFlags}
export interface PublicFish {id:Id;speciesId:Id;nameKey:Id;weightG:Gram;grade:Grade;colorId:Id;catchAt:Ms;owner:Owner;manualLocked:boolean;protected:boolean;saleGold:Nat}
export interface PublicFishing {phase:Phase;pausedFrom?:Phase;pauseReason?:PauseReason;selection:Selection;preferredBaitId:Id;progress:Ratio;enabled:boolean;encounterKey?:Id}
export interface PlayerView {revision:Nat;level:Nat;xpInLevel:Nat;nextXp:Nat;unspent:Nat;allocated:Stats;effectiveStats:Stats;gold:Nat;offlineAllowanceMs:Ms;nextOfflineExtensionMs:Ms;speedUntil:Ms;paidResetCost:Nat;freeResetAvailable:boolean}
export interface SpeciesView {id:Id;nameKey:Id;rarity:Rarity;discovered:boolean;hintKeys:Id[];stats?:SpeciesStats}
export interface OfferView {id:Id;item:ItemRef;price:Nat;owned:boolean;eligible:boolean;canAfford:boolean}
export interface RegionView {id:Id;nameKey:Id;unlocked:boolean;eligible:boolean;cost:Nat;positions:{id:Id;distanceM:number;depthM:number;admitted:boolean;reasons:ErrorCode[]}[]}
export interface AchievementView {id:Id;completed:boolean;nameKey:Id;progress?:{current:Nat;target:Nat}}
export interface TankView {id:Id;typeId:Id;slot:number;usedSpace:Nat;totalSpace:Nat;fishCount:number}
export interface PublicRecordEntry {scopeKey:Id;maxG:Gram;maxFishId:Id;minG:Gram;minFishId:Id;maxTies:Nat;minTies:Nat}
export interface EquipmentView {id:Id;nameKey:Id;kind:'ROD'|'LINE'|'BAIT';owned:boolean;eligible:boolean;type:Id;quality?:Id;stats?:Stats;maxCastM?:number;maxDepthM?:number;capacityN?:number;control?:number;sensitivity?:Ratio;reelEfficiency?:number;lengthM?:number;stealth?:Ratio;burstBuffer?:Ratio;signal?:Ratio;baitKind?:BaitKind;stock?:Nat;attraction?:number;hintKeys?:Id[]}
export interface ReadApi {equipmentCatalog():EquipmentView[];commandMetadata():{revision:Nat;nextSeq:Nat;runState:RunState};player():PlayerView;fishing():PublicFishing;policies():Policies;inventory():{rods:Id[];lines:Id[];reusableBaits:Id[];baitStock:Dict<Nat>;warehouseTierId:Id;capacity:number;count:number;pending?:PublicFish};fish(req:PageRequest&{owner?:Owner;speciesId?:Id;rarity?:Rarity;grade?:Grade;colorId?:Id;sort:'TIME_DESC'|'WEIGHT_DESC'|'PRICE_DESC'}):Result<Page<PublicFish>>;fishArchive(id:Id):Result<PublicCatchArchive>;regions():RegionView[];offers():OfferView[];encyclopedia(req:PageRequest&{regionId?:Id;rarity?:Rarity;discovered?:boolean;colorId?:Id}):Result<Page<SpeciesView>>;records(req:PageRequest&{scopePrefix?:Id}):Result<Page<PublicRecordEntry>>;recordHistory(req:PageRequest&{scopeKey:Id}):Result<Page<{scopeKey:Id;kind:'MIN'|'MAX';archiveId:Id;at:Ms}>>;achievements():AchievementView[];discoveries():{id:Id;logKey:Id;at:Ms}[];tanks():TankView[];tankCatalog():{id:Id;waterType:Water;maxWeightG:Gram;spaceUnits:Nat;priceGold:Nat;eligible:boolean;upgradeFromIds:Id[]}[];reports(req:PageRequest):Result<Page<OfflineReport>>;statistics():Aggregate;adOptions():{target:AdTarget;available:boolean;reason?:ErrorCode;rewardPreview?:Nat}[];adStatus():{id:Id;target:AdTarget;status:AdRequest['status'];reward?:Nat;failureCode?:Id}|undefined;admission(selection:Selection):AdmissionResult}
export interface AdmissionResult {allowed:boolean;reasons:ErrorCode[];requiredLineM:number;effectiveLineM:number}
export interface Candidate {populationId:Id;speciesId:Id;weight:number;probability:Ratio;grades:{grade:Grade;weight:number}[];colors:{id:Id;probability:Ratio}[]}
export interface Distribution {candidates:Candidate[];activity:number;empty:boolean}
export interface ModelContext {config:Readonly<GameConfig>;environment:EnvironmentSnapshot;regionModifiers:Modifier[]}
export interface CoreApi {effectiveStats(initial:Stats,allocated:Stats,rodBonus:Stats):Stats;admission(state:Readonly<GameState>,selection:Selection,config:Readonly<GameConfig>):AdmissionResult;castWork(cast:CastSnapshot,config:Readonly<GameConfig>):Nat;waitDemand(u:Ratio,config:Readonly<GameConfig>):Nat;waitRate(cast:CastSnapshot,dist:Distribution,config:Readonly<GameConfig>,speedMultiplier:number):Nat;distribution(cast:CastSnapshot,ctx:ModelContext,conditionState:Readonly<GameState>):Distribution;individual(candidate:Candidate,draws:{grade:Ratio;weight:Ratio;color:Ratio},id:Id,at:Ms,ctx:ModelContext):PlannedFish;combat(fish:PlannedFish,config:Readonly<GameConfig>):Combat;capture(fish:PlannedFish,cast:CastSnapshot,draws:{strength:Ratio;hook:Ratio;error:Ratio;strengthAt:Ratio;hookAt:Ratio},config:Readonly<GameConfig>):FightPlan;prepareWork(cast:CastSnapshot,outcome:Outcome,failure:Failure|undefined,config:Readonly<GameConfig>):Nat;xpNormal(fish:PlannedFish,config:Readonly<GameConfig>):Nat;xpSettlement(attempt:Attempt,flags:CatchFlags,recordBefore:RecordEntry|undefined,claims:readonly Id[],config:Readonly<GameConfig>):{total:Nat;parts:Dict<Nat>;newClaimKeys:Id[];recordBaselineG?:Gram};grantXp(state:Readonly<GameState>,amount:Nat,config:Readonly<GameConfig>):{level:Nat;xpInLevel:Nat;totalXp:Nat;unspent:Nat;totalPointsGranted:Nat;levels:Nat};salePrice(fish:Pick<FishInstance,'speciesId'|'weightG'|'colorId'>,config:Readonly<GameConfig>):Nat;resetCost(paidResets:Nat,config:Readonly<GameConfig>):Nat;replenishQuote(balance:Nat,reserve:Nat,stock:Nat,unit:Nat,batch:number,limit:Nat):{quantity:Nat;cost:Nat};offlineGold(acc:OfflineAccumulator,config:Readonly<GameConfig>):{eligible:Nat;reward:Nat}}
export interface RandomApi {next(state:Readonly<RngState>,rootSeed:number,stream:Id):{u:number;state:RngState}}
export interface AdvanceContext {mode:'ONLINE'|'OFFLINE'|'WORLD_ONLY';deadline?:Ms;versions:VersionResolver;maxNodes:number;allowStartAtTarget:boolean}
export interface AdvanceResult {state:GameState;reachedTarget:boolean;processedNodes:number;mustCommit:boolean;notices:Id[]}
export interface VersionResolver {get(version:Version):Readonly<GameConfig>|undefined;current():Readonly<GameConfig>}
export interface EngineApi {advanceUntil(state:Readonly<GameState>,target:Ms,ctx:AdvanceContext):Result<AdvanceResult>;settleAttempt(state:Readonly<GameState>,attemptId:Id,versions:VersionResolver):Result<{state:GameState;settlement:AttemptSettlement;mustCommit:boolean}>;tryStart(state:Readonly<GameState>,versions:VersionResolver,permit:boolean):Result<GameState>;applyCommand(state:Readonly<GameState>,command:Command,versions:VersionResolver):Result<{state:GameState;reply:Omit<CommandReply,'revision'>;mustCommit:boolean}>}
export interface SaveEnvelope {magic:'IDLE_FISHING';format:1;revision:Nat;epoch:Id;payload:string;sha256:Id}
export type LoadResult = {kind:'EMPTY'}|{kind:'VALID';state:unknown;schemaVersion:number;epoch:Id;revision:Nat;recovered:boolean}|{kind:'CORRUPT'|'UNSUPPORTED'|'DELETED';detail?:string};
export type CommitResult = {kind:'COMMITTED';revision:Nat}|{kind:'CONFLICT'|'FAILED'|'UNCERTAIN';detail:Id};
export interface SaveRepository {beginEpoch(epoch:Id):Promise<Result<void>>;load():Promise<LoadResult>;commit(state:Readonly<GameState>,expectedRevision:Nat|null):Promise<CommitResult>;clear(epoch:Id|null,expectedRevision:Nat|null):Promise<Result<void>>}
export interface IdentityProvider {newId():Id;seed32():number}
export interface ClockProvider {wallNowMs():Ms;monotonicNowMs():Ms}
export interface FilePort {read(path:Id):Promise<string|null>;write(path:Id,text:string):Promise<void>;remove(path:Id):Promise<void>;list(path:Id):Promise<Id[]>}
export interface AdProvider {isAvailable(target:AdTarget):boolean;show(requestId:Id,target:AdTarget):Promise<'COMPLETED'|'CANCELLED'|'FAILED'>}
export interface LifecycleProvider {subscribe(listener:(event:'SHOW'|'HIDE')=>void):()=>void}
export interface ConfigProvider {load(version?:Version):Promise<unknown>}
export interface TelemetryProvider {record(event:{code:Id;at:Ms;fields:Dict<string|number|boolean>}):void}
export interface ApplicationApi {initialize():Promise<Result<{state:RunState;revision:Nat;reportIds:Id[]}>>;dispatch(command:CommandEnvelope):Promise<Result<CommandReply>>;tick():Promise<Result<void>>;onHide():Promise<Result<void>>;onShow():Promise<Result<void>>;read:ReadApi;subscribe(listener:(revision:Nat)=>void):()=>void;requestDelete():Promise<Result<{token:Id;expiresAt:Ms}>>;confirmDelete(token:Id):Promise<Result<void>>}
export interface ConfigIssue {path:string;code:Id;message:string;severity:'ERROR'|'WARNING'}
export interface ConfigApi {validate(raw:unknown):Result<{config:Readonly<GameConfig>;issues:ConfigIssue[]}>;inspect(raw:unknown):ConfigIssue[]}
export interface MigrationApi {migrate(raw:unknown,from:number,to:number):Result<GameState>}
export interface SimulationRequest {scenarioId:Id;mode:'FIXED'|'GROWTH'|'STRESS';configVersion:Id;seedStart:number;seedCount:number;durationMs:Ms;strategyId:Id;loginScheduleMs:Ms[];adStrategyId:Id;sampleAtMs:Ms[]}
export interface SimulatorApi {run(request:SimulationRequest):Promise<Result<SimulationReport>>}
export interface SimulationReport {scenarioId:Id;configVersion:Id;engineVersion:Id;strategyVersion:Id;seeds:number[];metrics:Dict<{mean:number;p10:number;p25:number;p50:number;p75:number;p90:number;min:number;max:number}>;violations:{seed:number;at:Ms;code:Id;trace:Id}[];blocked:Id[]}
