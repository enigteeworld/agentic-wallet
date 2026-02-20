import {
  Connection,
  Keypair,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  Commitment,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

export class TxService {
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  buildSolTransferIx(params: {
    from: PublicKey;
    to: PublicKey;
    solAmount: number;
  }): TransactionInstruction {
    const lamports = Math.floor(params.solAmount * LAMPORTS_PER_SOL);

    return SystemProgram.transfer({
      fromPubkey: params.from,
      toPubkey: params.to,
      lamports,
    });
  }

  /**
   * Build a VersionedTransaction (v0) from instructions.
   * This avoids type mismatches in simulateTransaction across web3.js versions.
   */
  async buildV0Tx(params: {
    feePayer: PublicKey;
    instructions: TransactionInstruction[];
    commitment?: Commitment;
  }): Promise<{
    tx: VersionedTransaction;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const commitment = params.commitment ?? "confirmed";
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(commitment);

    const msg = new TransactionMessage({
      payerKey: params.feePayer,
      recentBlockhash: blockhash,
      instructions: params.instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);

    return { tx, blockhash, lastValidBlockHeight };
  }

  async simulateV0Tx(
    tx: VersionedTransaction,
    commitment: Commitment = "confirmed"
  ) {
    // For simulation, we do NOT need signatures to be valid.
    // This matches "agent pipeline: build -> simulate -> sign -> send".
    const sim = await this.connection.simulateTransaction(tx, { commitment });
    return sim;
  }

  async signSendConfirmV0Tx(params: {
    tx: VersionedTransaction;
    signer: Keypair;
    blockhash: string;
    lastValidBlockHeight: number;
    commitment?: Commitment;
  }): Promise<string> {
    const commitment = params.commitment ?? "confirmed";

    // Sign the v0 transaction
    params.tx.sign([params.signer]);

    // Send raw bytes
    const sig = await this.connection.sendRawTransaction(params.tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: commitment,
      maxRetries: 3,
    });

    await this.connection.confirmTransaction(
      {
        signature: sig,
        blockhash: params.blockhash,
        lastValidBlockHeight: params.lastValidBlockHeight,
      },
      commitment
    );

    return sig;
  }
}
