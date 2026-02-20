import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
  getAccount,
} from "@solana/spl-token";

export class SplTokenService {
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async createMint(params: {
    payer: Keypair;
    mintAuthority: PublicKey;
    freezeAuthority: PublicKey | null;
    decimals: number;
  }): Promise<PublicKey> {
    // Note: We intentionally do NOT pass commitment here to avoid type mismatches
    // across different @solana/spl-token versions. The Connection already uses
    // the commitment level we created it with ("confirmed").
    const mint = await createMint(
      this.connection,
      params.payer,
      params.mintAuthority,
      params.freezeAuthority,
      params.decimals
    );

    return mint;
  }

  async getOrCreateAta(params: {
    payer: Keypair;
    mint: PublicKey;
    owner: PublicKey;
  }): Promise<PublicKey> {
    const ata = await getOrCreateAssociatedTokenAccount(
      this.connection,
      params.payer,
      params.mint,
      params.owner
    );

    return ata.address;
  }

  async mintTo(params: {
    payer: Keypair;
    mint: PublicKey;
    destinationAta: PublicKey;
    mintAuthority: Keypair;
    amountRaw: bigint;
  }): Promise<string> {
    const sig = await mintTo(
      this.connection,
      params.payer,
      params.mint,
      params.destinationAta,
      params.mintAuthority,
      params.amountRaw
    );

    return sig;
  }

  async transfer(params: {
    payer: Keypair;
    sourceAta: PublicKey;
    destinationAta: PublicKey;
    owner: Keypair;
    amountRaw: bigint;
  }): Promise<string> {
    const sig = await transfer(
      this.connection,
      params.payer,
      params.sourceAta,
      params.destinationAta,
      params.owner,
      params.amountRaw
    );

    return sig;
  }

  async getTokenAccountAmountRaw(params: { ata: PublicKey }): Promise<bigint> {
    const acct = await getAccount(this.connection, params.ata);
    return acct.amount;
  }
}
