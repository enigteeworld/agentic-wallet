import fs from "fs";
import path from "path";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { encryptSecretKeyV1, decryptSecretKeyV1 } from "../crypto/keystore";

export class WalletManager {
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  keystorePathForAgent(agentId: string) {
    return path.join(process.cwd(), "keystore", `${agentId}.json`);
  }

  createKeypair(): Keypair {
    return Keypair.generate();
  }

  saveEncryptedKeypair(agentId: string, keypair: Keypair, passphrase: string) {
    const filepath = this.keystorePathForAgent(agentId);
    fs.mkdirSync(path.dirname(filepath), { recursive: true });

    const encrypted = encryptSecretKeyV1(keypair.secretKey, passphrase);
    fs.writeFileSync(filepath, JSON.stringify(encrypted, null, 2), "utf-8");
    return filepath;
  }

  loadEncryptedKeypair(agentId: string, passphrase: string): Keypair {
    const filepath = this.keystorePathForAgent(agentId);
    if (!fs.existsSync(filepath)) {
      throw new Error(`Keystore not found for ${agentId}: ${filepath}`);
    }

    const raw = fs.readFileSync(filepath, "utf-8");
    const json = JSON.parse(raw);

    const secret = decryptSecretKeyV1(json, passphrase);
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }

  /**
   * Dashboard-safe helper:
   * - Uses KEYSTORE_PASSPHRASE from env
   * - Loads keystore if it exists
   * - Otherwise creates and saves a new encrypted keystore
   */
  loadOrCreateEncryptedKeypairOrThrow(agentId: string): Keypair {
    const passphrase = process.env.KEYSTORE_PASSPHRASE;
    if (!passphrase) throw new Error("Missing KEYSTORE_PASSPHRASE in environment");

    const filepath = this.keystorePathForAgent(agentId);
    if (fs.existsSync(filepath)) {
      return this.loadEncryptedKeypair(agentId, passphrase);
    }

    const kp = this.createKeypair();
    this.saveEncryptedKeypair(agentId, kp, passphrase);
    return kp;
  }

  async getSolBalance(pubkey: PublicKey): Promise<number> {
    const lamports = await this.connection.getBalance(pubkey, "confirmed");
    return lamports / LAMPORTS_PER_SOL;
  }
}
