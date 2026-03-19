🤖 Corsair — Autonomous Financial Agent (Solana)

Autonomous infrastructure for managing on-chain capital through policy, execution, and real-time accounting.


🚀 Executive Summary

Corsair is an autonomous financial agent that manages on-chain capital through:

1. policy-constrained execution

2. live accounting

3. public telemetry


CARV-1 (Corsair Autonomous Ranger Vault) is the first deployed strategy module running on this system.

This is not a trading bot or a passive vault.

It is a continuous system that:

evaluates markets

enforces risk constraints

executes transactions

updates its own state


🏗 Architecture Overview

Corsair is structured as a modular system:

Core Layers:

Runtime (execution loop)

Strategy modules (e.g. CARV-1)

Policy engine (risk constraints)

Execution layer (transactions, Jupiter)

Accounting layer (NAV, balances, PnL)

Telemetry layer (public state output)


Frontend:

Vault interface (deposit / withdraw)

Dashboard (monitoring + metrics)

Trade logs and transparency layer



💼 Vault & Capital

CARV-1 operates a live on-chain vault:

Base asset: USDC

Deployed on Ranger

LP tokens minted on deposit

Capital tracked continuously

This vault is actively managed — not passive.



📈 Strategy Behavior (CARV-1)

The agent continuously:

monitors market conditions

generates signals

evaluates execution opportunities

Execution only happens if all policy constraints are satisfied.



🛡 Policy & Risk Controls

Every action is validated before execution:

per-trade size limits

maximum exposure caps

drawdown-aware constraints

execution gating (no trade without validation)

Planned improvements:

daily loss limits

cooldown periods

emergency stop conditions



⚙️ Execution Flow

Each action follows a deterministic loop:

strategy → decision → policy → execution → accounting → telemetry

This ensures:

no arbitrary trades

full traceability

consistent state updates



🪐 DeFi Execution (Jupiter Integration)

The agent can:

fetch live swap quotes

build swap transactions

sign transactions programmatically

simulate before execution

execute on-chain

This enables real interaction with DeFi liquidity.


📊 Accounting & Telemetry

The system continuously updates:

Vault NAV

balances

positions

exposure

drawdown

trade history

All values reflect live state — not simulated data.



🌐 Frontend (Observability Layer)

Built with React + Tailwind.

Features:

live vault monitoring

performance tracking

strategy transparency

vault identity and structure

deposit / withdraw interface

Security:

read-only for sensitive data

no private keys exposed

⚡ Current Status

Vault deployed and funded

CARV-1 strategy active

trades executing through runtime

live accounting and telemetry

currently operator-assisted



🔮 Future Direction

fully autonomous execution

multiple agents across strategies

shared capital allocation system

more advanced policy controls



✅ What This Demonstrates

Corsair shows that AI agents can:

manage capital

enforce risk policies

execute DeFi strategies

maintain real-time accounting

operate transparently


🏁 Final Note

Corsair is not just a tool.

It is a system for autonomous capital operating on-chain.

CARV-1 is the first live instance of that system.