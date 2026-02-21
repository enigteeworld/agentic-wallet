🤖 Agentic Wallets for AI Agents (Solana Devnet)

Autonomous, encrypted, multi-agent wallet infrastructure for Solana AI
agents.



  ----------------------
  🚀 Executive Summary
  ----------------------

This project is a fully working agentic wallet framework that enables AI
agents to become autonomous economic actors on Solana Devnet.

Unlike a basic wallet demo, this system implements:

• Programmatic wallet generation per agent • AES‑256‑GCM encrypted
keystore storage • scrypt-based key derivation • Automatic transaction
signing (Versioned Transactions) • SOL transfers • SPL token minting and
transfers • Persistent state management • Multi-agent orchestration
harness • Jupiter DEX trade execution • On-chain Agent Registry
(PDA-based proof-of-agent) • Spend guardrails (transfer caps) •
AI-native HTTP 402 payment engine (x402-style) • Premium React
observability dashboard

The result is a modular, extensible infrastructure layer for AI-native
finance.

  ------------------------------
  🏗 Full Architecture Overview
  ------------------------------

CLI Layer (src/cli.ts - Commander) │ ├── Wallet Manager (Keys + Sign)
├── Tx Service (Build/Send) ├── Agent Brain (Policy Logic) ├── SPL Token
Service (Protocol) └── State Store (Persistence)

Add-ons: • Guardrails Layer • Jupiter Swap Integration • Agent Registry
(Anchor program) • x402 Payment Engine • Dashboard API • React Dashboard
UI

Design Principles: - Strict separation of policy, signing, and
execution - Simulation-first transaction flow - Persistent yet encrypted
local storage - Horizontal scalability for N agents - Read-only
observability boundary

  ----------------------------
  🔐 Wallet & Key Management
  ----------------------------

Each agent: • Generates a unique keypair programmatically • Encrypts
private key using AES‑256‑GCM • Uses scrypt for key derivation • Stores
encrypted keystore locally • Loads key only when signing is required

Security Boundaries: - No plaintext private keys stored - Encryption
passphrase stored in environment - Dashboard is strictly read-only - All
signing happens in CLI

  -----------------------------
  💸 Transaction Capabilities
  -----------------------------

SOL Transfers: • Versioned transactions (v0) • Pre-flight simulation •
Automatic signing • Explorer link output

SPL Token Operations: • Create mint • Create ATA per agent • Mint tokens
• Transfer tokens • Persistent mint reuse across runs

All interactions occur live on Solana Devnet.

  -----------------------------------------------
   🪐 DeFi Trade Execution — Jupiter Integration
  -----------------------------------------------

Agents can: • Fetch live swap quotes (SOL → USDC) • Build serialized
swap transactions • Sign autonomously • Simulate before execution •
Optionally execute on mainnet

This proves: • Real DEX liquidity routing • Aggregated trade execution •
Autonomous transaction signing • Safe simulation-first design

  ---------------------------------------------
   🧾 On-Chain Agent Registry (Proof-of-Agent)
  ---------------------------------------------

Anchor program enabling deterministic PDA registration.

Seeds: [“agent”, agent_pubkey]

Stored fields: • agent (Pubkey) • registered_at (timestamp) • agent_id
(string) • version (string)

CLI Commands:

Check status: npm run dev – registry:status –agent agent-001

Register agent: npm run dev – registry:register –agent agent-001
–agentId agent-001 –version 0.1.0

Program ID (devnet): 5ND2gro8VfRE9xASu6zB1FPfKeH3Sf86hgkCkRmjFFBW

  -----------------------------------
  🧠 Agent Brain (Autonomous Logic)
  -----------------------------------

Implements rule-based economic behavior: • Maintain minimum token
balances • Mint when below threshold • Transfer when required

Multi-Agent Simulation: • Configurable agent count • Configurable rounds
• Deterministic seeding • Cyclical token flows

  ------------------------------
  🛡 Guardrails (Risk Controls)
  ------------------------------

• Transfer caps enforced • Simulation before send • Separation between
policy and signing • Error-safe execution paths

  ------------------------------------------
  🌐 AI-Native Payment Engine (x402-style)
  ------------------------------------------

HTTP 402 flow: 1. Agent requests protected resource 2. Server responds
402 with required amount 3. Agent pays on-chain 4. Server verifies
transaction 5. Resource returned

  --------------------------------------------
  📊 Premium Dashboard (Observability Layer)
  --------------------------------------------

React + Vite + Tailwind UI

Features: • Live polling • Mint display • Agent balances • ATA
visibility • Registry verification status • Explorer links

Security: • Read-only API • No private keys exposed

  ----------------------------
  ⚡ Demo Flow (Recommended)
  ----------------------------

1.  npm run dev – step3 –amount 0.05
2.  npm run dev – step4
3.  npm run dev – step5
4.  npm run dev – step6 –agents 5 –rounds 3 –seed 25
5.  npm run x402:server
6.  npm run x402:client – –server http://localhost:8787 –agent agent-001
7.  npm run dash:api cd dashboard && npm run dev

  --------------------
  ✅ Judge Checklist
  --------------------

[x] Programmatic wallet creation [x] Automatic signing [x] SOL support
[x] SPL token support [x] Protocol interaction [x] Multi-agent
simulation [x] Jupiter DEX integration [x] Encrypted key management [x]
On-chain registry proof [x] AI-native payment model [x] Observability
dashboard [x] Devnet working prototype

  -------------------
   🏁 Final Thoughts
  -------------------

This submission demonstrates that AI agents can:

• Hold assets • Make decisions • Execute DeFi trades • Register identity
on-chain • Transact autonomously • Pay for services • Operate within
secure boundaries

It is a modular, extensible agent wallet framework designed for future
production-grade AI finance systems.
