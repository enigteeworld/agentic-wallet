import chalk from "chalk";
import boxen from "boxen";

export function header(title: string) {
  console.log(
    boxen(chalk.bold(title), {
      padding: 1,
      margin: 1,
      borderStyle: "round",
    })
  );
}

export function section(title: string) {
  console.log("\n" + chalk.bold.white("— " + title));
}

export function infoLine(label: string, value: string) {
  console.log(chalk.cyan(label), value);
}

export function explorerTxUrl(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddressUrl(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}
