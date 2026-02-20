export type AgentAction =
  | { type: "MINT_IF_LOW"; minTokens: number; topUpTokens: number }
  | { type: "TRANSFER_IF_OTHER_LOW"; otherMinTokens: number; transferTokens: number };

export type AgentPlan = {
  actions: AgentAction[];
};

export class AgentBrain {
  /**
   * Very simple “agentic” policy:
   * - Keep agent-001 token balance above minTokens by minting topUpTokens when low.
   * - Keep agent-002 token balance above otherMinTokens by transferring transferTokens when low.
   */
  createPlan(): AgentPlan {
    return {
      actions: [
        { type: "MINT_IF_LOW", minTokens: 50, topUpTokens: 50 },
        { type: "TRANSFER_IF_OTHER_LOW", otherMinTokens: 10, transferTokens: 5 },
      ],
    };
  }
}
