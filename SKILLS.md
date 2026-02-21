SKILLS — Agentic Wallet Capabilities (Final Version)

This repository exposes a structured set of executable “skills” that
enable an autonomous AI agent to operate economically on Solana Devnet.

These skills combine wallet management, cryptographic signing, protocol
interaction, policy enforcement, multi-agent orchestration, DeFi trade
execution, on-chain identity registration, and AI-native payment flows.

  ---------------------------------
  1️⃣ Environment Setup (Required)
  ---------------------------------

Create .env:

    touch .env
    code .env

Add:

    KEYSTORE_PASSPHRASE=your-long-secure-passphrase
    RPC_URL=https://api.devnet.solana.com
    AGENT_REGISTRY_PROGRAM_ID=5ND2gro8VfRE9xASu6zB1FPfKeH3Sf86hgkCkRmjFFBW

Install dependencies:

    npm install

Purpose: - KEYSTORE_PASSPHRASE secures encrypted agent wallets - RPC_URL
defines the Solana cluster (Devnet) - AGENT_REGISTRY_PROGRAM_ID enables
on-chain verification - All skills rely on this configuration

  -------------------------------------------------
  2️⃣ Wallet Management (Encrypted Agent Identity)
  -------------------------------------------------

Skill: Create or Load Agent Wallet

Agent wallets: - Stored at ./keystore/agent-XYZ.json - AES-256-GCM
encrypted - scrypt-derived encryption key - Never stored in plaintext

Wallets are created automatically when first referenced.

Example:

    npm run dev -- step3

Capabilities: • Programmatic keypair generation • Secure encrypted
storage • Deterministic reuse across runs • No manual wallet interaction
required

  ---------------------------------------------------
  3️⃣ Autonomous Transaction Signing (SOL Transfers)
  ---------------------------------------------------

Skill: SOL Transfer (agent-001 → agent-002)

    npm run dev -- step3 --amount 0.05

Behavior: - Builds versioned (v0) transaction - Simulates before send -
Signs automatically - Sends and confirms - Prints explorer link

Capabilities: • Fully autonomous signing • Simulation-first execution •
Confirmation tracking • Public traceability

  --------------------------------------
  4️⃣ Protocol Interaction (SPL Tokens)
  --------------------------------------

Skill: Create Mint + Mint + Transfer

    npm run dev -- step4

Behavior: - Create SPL token mint (persisted) - Create ATAs - Mint
tokens - Transfer tokens - Print transaction signatures

Capabilities: • Token mint creation • ATA management • Balance tracking
• Persistent mint reuse

  ---------------------------------------------------
  5️⃣ Policy Engine (Agent Brain + Persistent State)
  ---------------------------------------------------

Skill: Run AgentBrain Policy

    npm run dev -- step5

Uses: - ./keystore/state.json - Stored thresholds + balances

Behavior: - Read persisted state - Fetch live balances - Apply
rule-based logic - Execute transactions conditionally

Capabilities: • Autonomous decision-making • Persistent economic memory
• Conditional execution logic

  ------------------------------------
  6️⃣ Multi-Agent Scalability Harness
  ------------------------------------

Skill: Multi-Agent Simulation

    npm run dev -- step6 --agents 5 --rounds 3 --seed 25

Behavior: - Ensure N encrypted wallets exist - Ensure ATAs exist - Seed
balances deterministically - Execute transfer cycles - Print round
summaries

Capabilities: • Horizontal scalability • Independent wallet per agent •
Independent token accounts • Deterministic reproducibility

  ---------------------------------------------
  7️⃣ On-Chain Agent Registry (Proof-of-Agent)
  ---------------------------------------------

Skill: Register Agent On-Chain (PDA)

Check status:

    npm run dev -- registry:status --agent agent-001

Register agent:

    npm run dev -- registry:register --agent agent-001 --agentId agent-001 --version 0.1.0

Registry design: - PDA seeds: [“agent”, agent_pubkey] - Stores agent,
timestamp, agent_id, version

Capabilities: • Deterministic PDA derivation • On-chain identity proof •
Version tracking • Dashboard verification integration

  ----------------------------------------------
  8️⃣ DeFi Trade Pipeline (Jupiter Integration)
  ----------------------------------------------

Skill: Jupiter SOL → USDC Trade (Dry-Run Safe)

    npx ts-node src/addons/jupiter/jupiterSwap.ts   --agent agent-001   --sol 0.02   --slippageBps 100   --cluster mainnet-beta

Behavior: - Request live quote - Receive best route - Build serialized
swap transaction - Sign transaction - Simulate execution

Optional execution (real mainnet funds):

    npx ts-node src/addons/jupiter/jupiterSwap.ts --agent agent-001 --sol 0.02 --slippageBps 100 --cluster mainnet-beta --execute

Capabilities: • Live DEX route discovery • Aggregated liquidity routing
• Autonomous trade signing • Safe simulation-first pipeline

  ----------------------------------------
  9️⃣ AI-Native HTTP Payment (x402 Model)
  ----------------------------------------

Start server:

    npm run x402:server

Run client:

    npm run x402:client -- --server http://localhost:8787 --agent agent-001

Behavior: - HTTP 402 payment challenge - On-chain payment execution -
Retry with signature - Server-side on-chain verification

Capabilities: • Machine-to-machine payments • On-chain proof validation
• Autonomous API monetization

  ------------------------------
  🔟 Observability (Dashboard)
  ------------------------------

Dashboard API:

    npm run dash:api

Dashboard UI:

    cd dashboard
    npm run dev

Capabilities: • Live balance polling • Mint + ATA visibility • Registry
verification status • Explorer links • Read-only observability boundary

  ---------------------
   Outputs & Artifacts
  ---------------------

Each skill prints:

• Transaction signatures • Explorer links • Wallet addresses • PDA
addresses (registry) • Persistent state paths • Round summaries

All activity is verifiable on Solana Devnet.

  ------------------------------
  🔐 Safety & Production Notes
  ------------------------------

Current protections: • AES-256 encrypted keystores • scrypt key
derivation • Simulation before send • Policy-based execution • Read-only
dashboard boundary

Production recommendations: • Spend caps • Program allowlists • Secure
secret injection (vaults) • MPC/HSM wallet models • RPC fallback logic

  ----------------------------
  📌 Summary of Agent Skills
  ----------------------------

Identity: • Generate wallets • Encrypt/decrypt keys • Register identity
on-chain

Economic Activity: • Transfer SOL • Mint tokens • Transfer tokens •
Execute DeFi swaps

Autonomous Logic: • Evaluate balances • Apply policies • Execute
conditionally

Scalability: • Multi-agent orchestration • Deterministic simulation

AI Commerce: • HTTP 402 autonomous payments

Observability: • Live dashboard monitoring

This repository defines a complete, modular skillset enabling AI agents
to operate securely, autonomously, verifiably, and economically on
Solana Devnet.
