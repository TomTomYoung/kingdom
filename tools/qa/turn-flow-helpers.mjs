// Explicitly resolve each visible decision through the public UI before ending.
// No state injection or force-EndTurn escape hatch.
export async function finishTurn(page) {
  let count = 0;
  while (await page.locator('[data-skip-task]:not(:disabled)').count()) {
    if (++count > 512) throw new Error('turn task list did not converge');
    await page.locator('[data-skip-task]:not(:disabled)').first().evaluate(button => button.click());
  }
  await page.locator('#end-turn').evaluate(button => button.click());
}

// Older feature suites relocate players/change rounds to construct scenarios.
// Align only turn-flow metadata with that explicitly edited test fixture.
export function prepareTurnFixture(state) {
  if (state.turnFlowVersion === undefined || state.turnFlowVersion === 1) {
    state.turnFlowVersion = 1;
    state.lastSettledTurn = state.currentTurn - 1;
    if (!state.turnTasks || state.turnTasks.turn !== state.currentTurn || state.turnTasks.playerId !== state.activePlayerId)
      state.turnTasks = { turn: state.currentTurn, playerId: state.activePlayerId, skipped: [] };
  }
  return state;
}
