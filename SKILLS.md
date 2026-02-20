# SKILLS — Agentic Wallet Capabilities (Final Version)

This repository exposes a structured set of executable “skills” that
enable an autonomous AI agent to operate economically on Solana Devnet.

These skills combine wallet management, cryptographic signing, protocol
interaction, policy enforcement, multi-agent orchestration, and
AI-native payment execution.


  ---------------------------------
  1️⃣ Environment Setup (Required)
  ---------------------------------

Create .env:

    touch .env
    code .env

Add:

    KEYSTORE_PASSPHRASE=your-long-secure-passphrase
    RPC_URL=https://api.devnet.solana.com

Install dependencies:

    npm install

Purpose: - KEYSTORE_PASSPHRASE secures encrypted agent wallets - RPC_URL
defines the Solana cluster (Devnet) - All skills rely on this
configuration

  -------------------------------------------------
  2️⃣ Wallet Management (Encrypted Agent Identity)
  -------------------------------------------------

Skill: Create or Load Agent Wallet

Agent wallets: - Stored at ./keystore/agent-XYZ.json - AES-256-GCM
encrypted - scrypt-derived encryption key - Never stored in plaintext

Wallets are created automatically when first referenced.

Example:

    npm run dev -- step3

If agent-001 does not exist: - A new keypair is generated - Private key
encrypted - Keystore saved locally - Public key printed

If it exists: - Encrypted keystore is loaded - Private key decrypted in
memory only

Capability Summary: • Programmatic keypair generation • Secure encrypted
storage • Deterministic reuse across runs • No manual wallet interaction
required

  ---------------------------------------------------
  3️⃣ Autonomous Transaction Signing (SOL Transfers)
  ---------------------------------------------------

Skill: SOL Transfer (agent-001 → agent-002)

    npm run dev -- step3 --amount 0.05

Behavior: - Builds a versioned (v0) transaction - Fetches latest
blockhash - Simulates transaction (preflight safety) - Signs with
agent-001 private key - Sends raw transaction - Confirms transaction -
Prints signature + devnet explorer link

This demonstrates: • Fully autonomous signing • Simulation-first
execution model • Confirmation tracking • Explorer traceability

  --------------------------------------
  4️⃣ Protocol Interaction (SPL Tokens)
  --------------------------------------

Skill: Create Mint + Mint + Transfer

    npm run dev -- step4

Behavior: - Creates new SPL token mint (if not persisted) - Creates
associated token accounts (ATAs) - Mints tokens to agent-001 - Transfers
tokens to agent-002 - Prints transaction signatures

Capabilities: • Token mint creation • ATA management • Token balance
tracking • Reusable mint persistence

This proves interaction with on-chain programs beyond SystemProgram.

  ---------------------------------------------------
  5️⃣ Policy Engine (Agent Brain + Persistent State)
  ---------------------------------------------------

Skill: Run AgentBrain Policy

    npm run dev -- step5

Uses: - ./keystore/state.json for mint + ATA persistence - Stored
thresholds and balances

Example Policy Logic: - If agent-001 < 50 tokens → mint 50 - If
agent-002 < 10 tokens → transfer 5

Behavior: - Reads persisted state - Fetches live balances - Applies
rule-based logic - Executes required transactions - Updates persistent
state

Capabilities: • Conditional autonomous decision-making • Persistent
memory across runs • Economic policy enforcement

  ------------------------------------
  6️⃣ Multi-Agent Scalability Harness
  ------------------------------------

Skill: Multi-Agent Simulation

    npm run dev -- step6 --agents 5 --rounds 3 --seed 25

Behavior: - Ensures N encrypted agent wallets exist - Ensures each has
an ATA for persisted mint - Seeds tokens where needed - Executes
autonomous transfer cycles - Prints per-round balance summaries

Capabilities: • Horizontal scalability • Independent wallet per agent •
Independent token accounts • Configurable simulation rounds •
Deterministic seeding for reproducibility

This simulates a small autonomous economic ecosystem.

  ----------------------------------------
  7️⃣ AI-Native HTTP Payment (x402 Model)
  ----------------------------------------

Skill: Autonomous Payment for Protected Resource

Start payment server:

    npm run x402:server

Run payment client:

    npm run x402:client -- --server http://localhost:8787 --agent agent-001

Behavior: - Agent requests protected resource - Receives HTTP 402
Payment Required - Parses required SOL amount + recipient - Executes
on-chain payment - Retries request with transaction signature - Server
verifies on-chain payment - Returns protected resource

Capabilities: • Machine-to-machine payment flow • On-chain proof
validation • Autonomous economic API interaction

This models AI-to-AI commerce.

  ------------------------------
  8️⃣ Observability (Dashboard)
  ------------------------------

Dashboard API:

    npm run dash:api

Dashboard UI:

    cd dashboard
    npm run dev

Capabilities: • Live polling of agent balances • Mint + ATA display •
Total SOL aggregation • RPC health warnings • Read-only observability
(no signing exposed)

This provides safe visibility into agent activity.


  ----------------------------------------------
   DeFi Trade Pipeline (Jupiter Swap Integration)
  -----------------------------------------------

  Jupiter swap routing is effectively mainnet-oriented; devnet test
  mints often aren’t tradable via Jupiter routes. This add-on
  demonstrates the trade pipeline (quote → build swap tx → sign →
  simulate) in dry-run mode by default.

Skill: Jupiter SOL → USDC Trade Pipeline (Dry-Run, Safe)

    npx ts-node src/addons/jupiter/jupiterSwap.ts   --agent agent-001   --sol 0.02   --slippageBps 100   --cluster mainnet-beta

Behavior: - Request live quote from Jupiter - Receive best route plan -
Build a serialized swap transaction - Sign swap transaction with agent
key - Simulate execution (preflight)

Optional (ONLY if you want to actually trade mainnet funds):

 npx ts-node src/addons/jupiter/jupiterSwap.ts --agent agent-001 --sol 0.02 --slippageBps 100 --cluster mainnet-beta --execute

  ------------------------
   Outputs & Artifacts
  ------------------------

Each skill prints:

• Transaction signatures • Devnet explorer links • Public wallet
addresses • Persistent state file paths • Round summaries (multi-agent)

All activity is verifiable on Solana Devnet.

  ------------------------------
  🔐 Safety & Production Notes
  ------------------------------

Current protections: • AES-256 encrypted keystores • scrypt key
derivation • Simulation before send • Policy-based execution •
Local-only secret storage

For production systems: • Add transaction spend caps • Add program
allowlists • Secure secret injection (vaults) • Consider MPC/HSM wallet
models • Implement RPC fallback logic

  ----------------------------
  📌 Summary of Agent Skills
  ----------------------------

Identity: • Generate wallets • Encrypt/decrypt keys • Sign transactions

Economic Activity: • Transfer SOL • Mint tokens • Transfer tokens

Autonomous Logic: • Evaluate balances • Apply policies • Execute
conditionally

Scalability: • Multi-agent orchestration • Deterministic simulation

AI Commerce: • HTTP 402 autonomous payments

DeFi Trading - Jupiter trade pipeline (quote/build/sign/simulate;
optional execute)

Observability: • Live dashboard monitoring

This repository defines a complete, modular skillset enabling AI agents
to operate securely, autonomously, and economically on Solana Devnet.
