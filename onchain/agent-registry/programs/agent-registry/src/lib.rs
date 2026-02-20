use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

#[program]
pub mod agent_registry {
    use super::*;

    /// Registers an agent wallet on-chain.
    /// PDA seeds: ["agent", agent.key()]
    pub fn register_agent(ctx: Context<RegisterAgent>, agent_id: String, version: String) -> Result<()> {
        require!(agent_id.len() <= 32, RegistryError::AgentIdTooLong);
        require!(version.len() <= 16, RegistryError::VersionTooLong);

        let acct = &mut ctx.accounts.registry;
        acct.agent = ctx.accounts.agent.key();
        acct.agent_id = agent_id;
        acct.version = version;
        acct.registered_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    /// Updates version (optional but useful for upgrades).
    pub fn update_version(ctx: Context<UpdateVersion>, version: String) -> Result<()> {
        require!(version.len() <= 16, RegistryError::VersionTooLong);

        let acct = &mut ctx.accounts.registry;
        acct.version = version;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(agent_id: String, version: String)]
pub struct RegisterAgent<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    #[account(
        init,
        payer = agent,
        space = AgentRegistry::space(&agent_id, &version),
        seeds = [b"agent", agent.key().as_ref()],
        bump
    )]
    pub registry: Account<'info, AgentRegistry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateVersion<'info> {
    pub agent: Signer<'info>,

    #[account(
        mut,
        has_one = agent,
        seeds = [b"agent", agent.key().as_ref()],
        bump
    )]
    pub registry: Account<'info, AgentRegistry>,
}

#[account]
pub struct AgentRegistry {
    pub agent: Pubkey,
    pub registered_at: i64,
    pub agent_id: String,
    pub version: String,
}

impl AgentRegistry {
    pub fn space(agent_id: &String, version: &String) -> usize {
        // Anchor account discriminator
        8
        // agent pubkey
        + 32
        // registered_at
        + 8
        // agent_id string: 4 bytes length + data
        + 4 + agent_id.len()
        // version string: 4 bytes length + data
        + 4 + version.len()
    }
}

#[error_code]
pub enum RegistryError {
    #[msg("agent_id too long (max 32 chars)")]
    AgentIdTooLong,
    #[msg("version too long (max 16 chars)")]
    VersionTooLong,
}