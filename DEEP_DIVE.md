# Deep Dive — Agentic Wallets for AI Agents (Devnet Prototype)

This project implements an “agentic wallet” framework: a wallet system designed for autonomous software agents that can create identities, hold funds, sign transactions, and interact with on-chain protocols without manual approval clicks.

The goal is not to build another UI wallet. The goal is to build an infrastructure layer that lets **AI agents operate economically**, while maintaining **security boundaries**, **auditability**, and **safe defaults**.

---

## 1) What makes a wallet “agentic”?

A normal wallet (browser extension / mobile wallet) is optimized for humans:
- a human initiates each action
- a UI displays the transaction details
- a human approves with a click

An agentic wallet is optimized for software agents:
- it must sign automatically
- it must operate with no UI
- it must enforce rules (“guardrails”) because there is no human in the loop
- it must be observable/auditable without exposing keys

So the key requirements become:
1. programmatic wallet creation
2. automated signing
3. secure secret storage
4. protocol interactions (SOL + SPL and beyond)
5. clear separation between “agent logic” and “wallet execution”
6. multi-agent scalability
7. sandboxed safety controls and verifiability

---

## 2) Architecture overview

The system is split into layers so that:
- an “Agent Brain” can decide *what to do*
- a wallet layer can sign *how to do it*
- execution and protocol interactions remain cleanly separated

### Core modules (conceptual)
**Wallet Manager**
- creates/loads agent keypairs
- stores keys in encrypted keystores on disk
- exposes a signer (Keypair) only inside trusted runtime

**Tx Service**
- builds transactions (e.g. SOL transfers)
- simulation-first flow
- sends and confirms signed transactions

**SPL Token Service**
- creates mints + ATAs
- mints tokens + transfers tokens
- reads balances

**State Store**
- persists non-secret state (mint address, ATA mappings, config)
- provides “memory across runs” for agents

**Agent Brain**
- implements policy rules (thresholds, refills, transfers)
- never handles encryption details or low-level signing

**Harness**
- multi-agent orchestration
- deterministic seeding
- rounds of autonomous actions

**Add-ons**
- guardrails (spend caps / safe defaults)
- x402-style payment engine
- dashboard API + React dashboard
- Jupiter swap pipeline demo (quote/build/sign/simulate)

This architecture is intentionally modular: each unit is independently testable and can be replaced later without redesigning the entire system.

---

## 3) Key management and encrypted keystores

The most important security decision is: **how keys are stored and accessed**.

### Threat model (prototype)
This prototype assumes:
- the machine running the agent is trusted enough to hold encrypted keys
- we do not store plaintext secret keys on disk
- the passphrase is injected via environment variables (local dev only)
- the agent runtime may be “untrusted code” relative to the wallet manager

### How keys are stored
Each agent has a keystore file:

`./keystore/agent-XYZ.json`

The keystore contains:
- a salt (for key derivation)
- a nonce/iv (for AES-GCM)
- encrypted secret key bytes (ciphertext)
- auth tag (GCM tag)
- version metadata (so format can evolve)

### Key derivation
A passphrase is converted into an encryption key using **scrypt**.

Why scrypt?
- it is designed to be memory-hard
- it increases the cost of brute-force guessing
- it’s more resistant to GPU attacks than fast hashes

### Encryption
The secret key is encrypted using **AES-256-GCM**.

Why AES-GCM?
- it provides confidentiality + integrity (authenticated encryption)
- if the ciphertext is altered, decryption fails
- it is widely supported and fast

### Runtime key handling
The decrypted key only exists:
- in memory
- for as long as needed to sign transactions

This aligns with the principle:
> “Keys should be loaded only at the moment of signing.”

---

## 4) Automated signing: simulation-first transaction flow

Autonomous signing is powerful and dangerous. So the system uses a “simulation-first” pipeline.

Typical transaction flow:
1. build transaction
2. fetch recent blockhash
3. set fee payer
4. simulate transaction
5. if simulation is OK → sign
6. send raw transaction
7. confirm transaction
8. print explorer link

This is used across:
- SOL transfers
- SPL minting and transfers
- payment transactions (x402)
- (optionally) Jupiter-built swap transactions

Simulation is a safety checkpoint that reduces:
- obvious runtime mistakes
- insufficient funds issues
- account initialization issues
- invalid instruction failures

---

## 5) Protocol interaction: why SPL tokens matter

Many “wallet demos” only transfer SOL. That’s not enough for DeFi.

This project includes SPL token program interactions:
- create mint
- create associated token accounts (ATAs)
- mint tokens
- transfer tokens
- fetch balances

This demonstrates agent capability to:
- interact with on-chain programs beyond SystemProgram
- manage token inventory
- participate in token-based workflows (funding, rewards, internal accounting)

---

## 6) Persistent state: “memory across runs” for agents

Agents need continuity. If an agent restarts, it shouldn’t lose context like:
- which mint is “the system token”
- which ATA belongs to which agent
- parameters used by the policy engine

So we persist non-secret state in:

`./keystore/state.json`

Important boundary:
- state.json contains no private keys
- it is safe to regenerate if needed
- it enables consistent behavior across runs

This makes the agent system feel “alive” rather than stateless scripts.

---

## 7) Agent Brain: policy-driven autonomy

The “Agent Brain” is intentionally simple and explainable.

Example policy:
- If agent-001 < 50 tokens → mint 50
- If agent-002 < 10 tokens → transfer 5 to agent-002

Why rule-based?
- easy to audit
- deterministic and predictable for judges
- provides clear proof of autonomous decision-making

Key design decision:
> The policy engine never signs. It only decides.
> The wallet/execution layer signs.

This separation is essential for scaling into real AI models later:
- you can swap the rule-based brain with an LLM or RL agent
- without touching encryption, signing, or protocol execution

---

## 8) Multi-agent scalability

The harness demonstrates scalability by creating and running multiple independent agents.

Properties:
- each agent has its own encrypted wallet
- each agent has its own token account
- actions are deterministic with a seed
- transfers can be orchestrated across rounds

This proves the framework is not “single-wallet scripting.”
It’s a foundation for agent ecosystems.

---

## 9) Guardrails and safety controls

Without a human in the loop, “autonomy” must be bounded.

Current guardrails include:
- simulation before send
- transfer caps (spend limit behavior)
- policy-based thresholds
- read-only dashboard boundaries

Recommended production guardrails:
- strict spend ceilings per agent (hard-coded)
- allowlisted program IDs (only approved protocols)
- rate limiting and backoff for RPC calls
- secret injection via vault/KMS (no plaintext .env)
- MPC/HSM custody where possible
- on-chain policy contracts for enforceability

This is a devnet prototype, but it is designed with a realistic path to production.

---

## 10) AI-native payments (x402-style)

The x402 payment engine demonstrates something practical:
- agents can pay for resources automatically

Flow:
1. agent requests a protected endpoint
2. server replies 402 Payment Required (price + recipient)
3. agent signs and sends payment on-chain
4. agent retries with payment proof (signature)
5. server verifies payment and returns resource

This is a strong “AI agent” primitive:
- it enables pay-per-call APIs for agents
- it enables agent-to-agent markets
- it provides verifiable economic proof without trust

---

## 11) Observability: dashboard without key exposure

A key requirement for agentic systems is monitoring.

We include:
- a read-only dashboard API
- a minimal premium React dashboard
- live balances + token holdings + mint info

Important boundary:
- no private keys are ever exposed
- the dashboard never signs or executes transactions
- it only reads public on-chain data and local state metadata

This is how agent systems can be operated safely:
- high visibility
- low authority

---

## 12) DeFi trade pipeline demo (Jupiter)

To address the “trade execution” direction, we add a Jupiter integration that demonstrates:
- quote retrieval
- route planning
- swap transaction building
- agent signing
- simulation before execution

By default, it runs in dry-run mode to avoid spending real funds.

This shows how the framework can be extended to live DeFi operations when needed.

---

## 13) What a “normal user” would do vs an agent

A normal user typically uses:
- a wallet extension (browser) or mobile wallet
- manual approvals per transaction

This framework is different:
- it’s a backend agent wallet, not a browser extension
- it’s intended for automation and simulation environments
- it can be wrapped by a UI (like our dashboard), but the core is headless

If you wanted to build a user-facing version:
- you’d keep the same wallet/execution layer
- and expose it via:
  - a hosted service
  - a wallet adapter
  - an extension wrapper
But for this bounty, the headless agent wallet is the intended artifact.

---

## Conclusion

This repo demonstrates a complete agentic wallet prototype:

- encrypted agent identities
- autonomous signing
- protocol interaction (SOL + SPL)
- persistent state
- policy-driven decisions
- multi-agent orchestration
- AI-native payments
- safe observability
- extensibility to DeFi swaps

It is designed to be:
- modular
- audit-friendly
- safe by default
- production-upgradable

The main takeaway:
> AI agents become “economic actors” only when wallets, policies, and guardrails are engineered together.