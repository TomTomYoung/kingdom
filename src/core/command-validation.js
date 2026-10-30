import { COMMAND_TYPES } from './commands.js';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) => typeof value === 'string' && value.trim().length > 0;
const fields = {
  RestParty: ['partyId'], RemoveCasualties: ['partyId'],
  AttackCity: ['partyId', 'cityId', 'attackType'],
  CaptureCity: ['partyId', 'cityId'],
  StartTurn: [], EndTurn: [], SetGuardOrder: ['partyId', 'guardUnitId', 'mode'],
  SetCityProduction: ['cityId', 'itemId'],
  PurchaseCityItem: ['cityId', 'itemId', 'currency'],
  PurchaseTile: ['cityId', 'tileKey'],
  ReinforceParty: ['partyId'], MergeParties: ['sourcePartyId', 'targetPartyId'], SplitParty: ['partyId', 'location'],
  CreateParty: ['location'], FoundCity: ['partyId', 'settlerUnitId'],
  SetFormation: ['partyId'], MoveParty: ['partyId'],
  AttackParty: ['attackerPartyId', 'defenderPartyId', 'attackType'],
};

// Check untrusted command structure before any payload dereference or state clone.
export function validateCommand(state, command) {
  if (state.gameResult || state.phase === 'GAME_OVER') return '対局は終了しています。新規開始で次の対局を始めてください';
  if (!record(command) || !identifier(command.commandId)) return 'commandIdが必要です';
  if (!Object.values(COMMAND_TYPES).includes(command.type)) return '不明なCommandです';
  if (!identifier(command.playerId) || !Object.hasOwn(state.kingdoms, command.playerId)) return '不明なプレイヤーです';
  if (!Number.isInteger(command.turn) || command.turn !== state.currentTurn) return 'ターンが一致しません';
  const isStart = command.type === COMMAND_TYPES.START_TURN;
  if (command.phase !== (isStart ? 'TURN_START' : 'PLAYER_ACTION')) return 'Commandのフェーズが一致しません';
  if (isStart) {
    if (state.phase !== 'TURN_START' && !(state.phase === 'PLAYER_ACTION' && state.lastProcessedTurn === 0)) return '開始処理を実行できるフェーズではありません';
  } else if (state.phase !== 'PLAYER_ACTION') return '行動フェーズではありません';
  const payload = command.payload;
  if (!record(payload)) return 'payloadが必要です';
  for (const field of fields[command.type]) {
    if (!Object.hasOwn(payload, field) || !identifier(payload[field])) return `${field}が必要です`;
  }
  if (command.type === COMMAND_TYPES.SET_CITY_PRODUCTION && (!Array.isArray(payload.queue) || !payload.queue.every(identifier))) return '生産キューは対象IDの配列で指定してください';
  if ([COMMAND_TYPES.CREATE_PARTY, COMMAND_TYPES.REINFORCE_PARTY, COMMAND_TYPES.SPLIT_PARTY].includes(command.type) && (!Array.isArray(payload.unitIds) || !payload.unitIds.every(identifier))) return 'UnitのIDを配列で指定してください';
  if (command.type === COMMAND_TYPES.MOVE_PARTY && (!Array.isArray(payload.path) || !payload.path.every(identifier))) return '移動経路はタイルIDの配列で指定してください';
  if (command.type === COMMAND_TYPES.SET_FORMATION && !record(payload.formation)) return '配置はslotとUnitの対応で指定してください';
  if (command.type === COMMAND_TYPES.SET_GUARD_ORDER && payload.mode !== 'off' && !identifier(payload.targetUnitId)) return '護衛対象のUnit IDが必要です';
  if (command.type === COMMAND_TYPES.ATTACK_PARTY && Object.hasOwn(payload, 'targeting') && !record(payload.targeting)) return '照準はオブジェクトで指定してください';
  return null;
}
