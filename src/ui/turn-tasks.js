import { listTurnTasks } from '../core/turn-tasks.js';

export class TurnTasksPanel {
  constructor(root, { onOpen, onSkip, onResume }) { Object.assign(this, { root, onOpen, onSkip, onResume }); }
  render(state, playerId, canAct) {
    this.root.replaceChildren();
    const tasks = listTurnTasks(state, playerId), pending = tasks.filter(task => !task.skipped);
    const heading = document.createElement('h2'); heading.textContent = 'このターンの行動';
    const status = document.createElement('p'); status.id = 'turn-task-status'; status.setAttribute('role', 'status');
    status.textContent = state.gameResult ? '対局は終了しました。' : !canAct ? '他プレイヤー・NPCの行動中です。終了後に生産・研究・資源を精算します。'
      : pending.length ? `未処理 ${pending.length}件。各項目を実行するか、このターンだけスキップしてください。` : '未処理の行動はありません。ターンを終了できます。';
    this.root.append(heading, status);
    const next = document.createElement('button'); next.id = 'next-turn-action'; next.textContent = '次の未処理行動へ'; next.disabled = !canAct || !pending.length;
    next.onclick = () => this.onOpen(pending[0]); this.root.append(next);
    const list = document.createElement('ul'); list.className = 'turn-task-list';
    for (const task of tasks) {
      const row = document.createElement('li'); row.dataset.turnTask = task.id;
      const title = document.createElement('strong'); title.textContent = `${task.label}${task.skipped ? ' · スキップ済み' : ''}`;
      const actions = document.createElement('div'); actions.className = 'turn-task-actions';
      for (const action of task.actions) {
        const button = document.createElement('button'); button.className = 'secondary'; button.textContent = action; button.disabled = !canAct;
        button.onclick = () => this.onOpen(task, action); actions.append(button);
      }
      const skip = document.createElement('button'); skip.className = 'secondary'; skip.disabled = !canAct;
      skip.dataset[task.skipped ? 'resumeTask' : 'skipTask'] = task.id;
      skip.textContent = task.skipped ? 'スキップを取り消す' : 'この項目をスキップ';
      skip.onclick = () => task.skipped ? this.onResume(task.id) : this.onSkip(task.id);
      row.append(title, actions, skip); list.append(row);
    }
    this.root.append(list);
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = '部隊の行動は候補から選びます。移動後も行動できる場合は一覧に残ります。購入・領土取得・生産予約の変更・配置や護衛設定は各詳細から随時行えます。';
    this.root.append(hint);
    return pending;
  }
}
