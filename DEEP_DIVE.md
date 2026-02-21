Deep Dive — Agentic Wallets for AI Agents (Devnet Prototype)

This project implements an “agentic wallet” framework: a wallet system
designed for autonomous software agents that can create identities, hold
funds, sign transactions, interact with on-chain protocols, execute DeFi
trades, and register identity proofs — without manual approval clicks.

The goal is not to build another UI wallet.

The goal is to build an infrastructure layer that lets AI agents operate
economically while maintaining security boundaries, auditability, safe
defaults, and verifiable identity.

------------------------------------------------------------------------

1) What makes a wallet “agentic”?

A normal wallet (browser extension / mobile wallet): - requires human
initiation - requires manual approval - is optimized for UI interaction

An agentic wallet: - signs automatically - runs headless (no UI
required) - enforces guardrails - separates policy from execution -
remains observable without exposing secrets

Core requirements: 1. programmatic wallet creation 2. automated signing
3. encrypted secret storage 4. protocol interaction (SOL + SPL + DeFi)
5. policy-driven autonomy 6. multi-agent scalability 7. verifiable
on-chain identity 8. safe operational boundaries

------------------------------------------------------------------------

2) Architecture overview

The system is layered so that:

-   Agent Brain decides what to do
-   Wallet layer signs how to do it
-   Execution layer interacts with protocols
-   Observability layer monitors safely

Core modules:

Wallet Manager - creates/loads encrypted agent keypairs - handles
encryption/decryption - exposes signer only at runtime

Tx Service - builds transactions - simulation-first flow - sends and
confirms

SPL Token Service - mint creation - ATA management - token transfers -
balance reads

State Store - persists non-secret state - maintains mint + ATA
mappings - enables continuity across runs

Agent Brain - rule-based decision engine - applies economic policies -
never directly handles encryption

Multi-Agent Harness - orchestrates N independent agents - deterministic
seeding - round-based execution

Add-ons - guardrails (transfer caps) - x402-style payment engine -
Jupiter trade pipeline - on-chain Agent Registry (PDA proof) - dashboard
API + UI

This modularity ensures each component can evolve independently.

------------------------------------------------------------------------

3) Encrypted key management

The most critical design choice is secure key storage.

Threat model (prototype): - local environment is semi-trusted - private
keys must never be stored plaintext - passphrase injected via
environment variable

Each agent keystore: ./keystore/agent-XYZ.json

Contains: - salt (scrypt derivation) - IV / nonce (AES-GCM) - encrypted
secret key (ciphertext) - auth tag - version metadata

Key derivation: scrypt (memory-hard, GPU-resistant)
Encryption: AES-256-GCM (confidentiality + integrity)

Runtime rule: Keys are decrypted only when signing and never persisted
in memory longer than required.

------------------------------------------------------------------------

4) Simulation-first transaction pipeline

Autonomous signing is powerful and must be bounded.

Transaction flow: 1. Build transaction 2. Fetch blockhash 3. Set fee
payer 4. Simulate 5. If simulation passes → sign 6. Send raw transaction
7. Confirm 8. Print explorer link

Used for: - SOL transfers - SPL mint + transfer - x402 payments -
Jupiter swap transactions

Simulation reduces runtime risk and aligns with safe autonomy
principles.

------------------------------------------------------------------------

5) Protocol interaction (SOL + SPL)

The framework interacts with: - SystemProgram (SOL transfers) - SPL
Token Program (mint, ATA, transfer)

This proves agents can: - manage inventory - interact with on-chain
programs - operate beyond simple SOL movement

------------------------------------------------------------------------

6) Persistent state (“agent memory”)

State file: ./keystore/state.json

Stores: - mint address - token decimals - ATA mappings - configuration

It contains no private keys.

This enables continuity: Agents retain economic context across restarts.

------------------------------------------------------------------------

7) Agent Brain (policy-driven autonomy)

Example policy: - Maintain minimum token balances - Mint when below
threshold - Transfer when required

Design principle: The policy engine decides. The wallet layer signs.

This separation allows future replacement of the rule-based brain
with: - LLM decision models - RL trading agents - Strategy engines

Without rewriting cryptography or protocol code.

------------------------------------------------------------------------

8) Multi-agent scalability

The harness demonstrates:

-   Independent encrypted wallets
-   Independent token accounts
-   Deterministic seed-based simulation
-   Round-based transfers

This transforms the project from single-wallet scripting into a
multi-agent economic micro-ecosystem.

------------------------------------------------------------------------

9) On-Chain Agent Registry (Proof-of-Agent)

A lightweight Anchor program enables agents to register themselves
on-chain via a deterministic PDA.

PDA seeds: [“agent”, agent_pubkey]

Stored fields: - agent (Pubkey) - registered_at (timestamp) - agent_id -
version

Why this matters:

It converts “this is an agent wallet” from a local claim into an
on-chain verifiable fact.

The dashboard: - derives the PDA deterministically - checks account
existence - displays Verified ✅ or Not Registered ❌

This creates strong identity guarantees without exposing keys.

------------------------------------------------------------------------

10) Guardrails and safety controls

Current guardrails: - simulation before send - transfer caps - policy
thresholds - strict signing boundaries - read-only dashboard

Production recommendations: - program allowlists - hard spend ceilings -
RPC fallback logic - vault/KMS secret injection - MPC/HSM custody -
on-chain enforceable policy contracts

------------------------------------------------------------------------

11) AI-native payments (x402 model)

The x402 engine demonstrates autonomous API monetization.

Flow: 1. Agent requests protected endpoint 2. Server responds 402
Payment Required 3. Agent signs + sends on-chain payment 4. Agent
retries with signature proof 5. Server verifies and returns resource

This enables: - pay-per-call AI APIs - agent-to-agent markets -
verifiable machine commerce

------------------------------------------------------------------------

12) DeFi trade pipeline (Jupiter integration)

The Jupiter integration demonstrates real DeFi interaction:

-   quote retrieval
-   optimal route selection
-   serialized swap transaction building
-   agent signing
-   simulation-first execution

Default mode is dry-run for safety.

This proves the architecture can extend into: - trading bots - liquidity
strategies - automated treasury rebalancing

------------------------------------------------------------------------

13) Observability without key exposure

The dashboard provides:

-   live balances
-   token holdings
-   registry verification
-   explorer links

Critical boundary: The dashboard never signs transactions and never
accesses private keys.

This ensures high visibility with minimal authority.

------------------------------------------------------------------------

Conclusion

This prototype demonstrates:

-   encrypted agent identities
-   autonomous signing
-   protocol interaction (SOL + SPL)
-   DeFi swap capability
-   persistent state
-   policy-driven decisions
-   multi-agent orchestration
-   on-chain identity verification
-   AI-native payment flows
-   safe observability boundaries

The core principle:

AI agents become economic actors only when wallets, policies, identity
proofs, and guardrails are engineered together.
