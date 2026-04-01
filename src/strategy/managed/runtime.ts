import {
  createManagedStrategyLedger,
  ManagedStrategyLedger,
} from "./ledger";
import {
  createManagedStrategyNav,
  ManagedStrategyNav,
  UpdateNavInput,
} from "./nav";
import {
  createManagedStrategyShares,
  ManagedStrategyShares,
} from "./shares";
import {
  createManagedStrategyDeposits,
  ManagedStrategyDeposits,
  RegisterDepositInput,
  RegisterDepositResult,
} from "./deposits";
import {
  createManagedStrategyWithdrawals,
  ManagedStrategyWithdrawals,
  RequestWithdrawalByAmountInput,
  RequestWithdrawalBySharesInput,
  RequestWithdrawalResult,
  CompleteWithdrawalInput,
  WithdrawalRequestRecord,
} from "./withdrawals";
import {
  createManagedStrategyAccountService,
  ManagedStrategyAccountService,
  ManagedStrategyOverview,
  ManagedStrategyUserPosition,
} from "./account";
import {
  createManagedStrategyCapital,
  ManagedStrategyCapital,
  DeployCapitalInput,
  ReturnCapitalInput,
  CapitalOperationResult,
} from "./capital";
import {
  createManagedStrategyReconciliation,
  ManagedStrategyReconciliation,
  ReconcileNavInput,
  ReconcileNavResult,
} from "./reconciliation";

export interface ManagedStrategyRuntimeDependencies {
  ledger: ManagedStrategyLedger;
  nav: ManagedStrategyNav;
  shares: ManagedStrategyShares;
  deposits: ManagedStrategyDeposits;
  withdrawals: ManagedStrategyWithdrawals;
  account: ManagedStrategyAccountService;
  capital: ManagedStrategyCapital;
  reconciliation: ManagedStrategyReconciliation;
}

export class ManagedStrategyRuntime {
  readonly ledger: ManagedStrategyLedger;
  readonly nav: ManagedStrategyNav;
  readonly shares: ManagedStrategyShares;
  readonly deposits: ManagedStrategyDeposits;
  readonly withdrawals: ManagedStrategyWithdrawals;
  readonly account: ManagedStrategyAccountService;
  readonly capital: ManagedStrategyCapital;
  readonly reconciliation: ManagedStrategyReconciliation;

  constructor(deps?: Partial<ManagedStrategyRuntimeDependencies>) {
    this.ledger = deps?.ledger ?? createManagedStrategyLedger();
    this.nav = deps?.nav ?? createManagedStrategyNav(this.ledger);
    this.shares = deps?.shares ?? createManagedStrategyShares(this.nav);
    this.deposits =
      deps?.deposits ??
      createManagedStrategyDeposits(this.ledger, this.nav, this.shares);
    this.withdrawals =
      deps?.withdrawals ??
      createManagedStrategyWithdrawals(this.ledger, this.nav, this.shares);
    this.account =
      deps?.account ??
      createManagedStrategyAccountService(
        this.ledger,
        this.nav,
        this.shares,
        this.withdrawals
      );
    this.capital =
      deps?.capital ?? createManagedStrategyCapital(this.nav);
    this.reconciliation =
      deps?.reconciliation ??
      createManagedStrategyReconciliation(this.nav);
  }

  // =============================
  // READS
  // =============================

  getOverview(): ManagedStrategyOverview {
    return this.account.getOverview();
  }

  getUserPosition(wallet: string): ManagedStrategyUserPosition | null {
    return this.account.getUserPosition(wallet);
  }

  listUserPositions(): ManagedStrategyUserPosition[] {
    return this.account.listUserPositions();
  }

  listWithdrawalRequests(): WithdrawalRequestRecord[] {
    return this.withdrawals.listRequests();
  }

  getWithdrawalRequest(requestId: string): WithdrawalRequestRecord | null {
    return this.withdrawals.getRequestById(requestId);
  }

  // =============================
  // NAV / VALUATION
  // =============================

  updateNav(input: UpdateNavInput) {
    return this.nav.updateNav(input);
  }

  reconcileNav(input: ReconcileNavInput): ReconcileNavResult {
    return this.reconciliation.reconcileNav(input);
  }

  // =============================
  // CAPITAL MOVEMENT
  // =============================

  deployCapital(input: DeployCapitalInput): CapitalOperationResult {
    return this.capital.deployCapital(input);
  }

  returnCapital(input: ReturnCapitalInput): CapitalOperationResult {
    return this.capital.returnCapital(input);
  }

  // =============================
  // DEPOSITS
  // =============================

  registerDeposit(input: RegisterDepositInput): RegisterDepositResult {
    return this.deposits.registerDeposit(input);
  }

  // =============================
  // WITHDRAWALS
  // =============================

  requestWithdrawalByAmount(
    input: RequestWithdrawalByAmountInput
  ): RequestWithdrawalResult {
    return this.withdrawals.requestByAmount(input);
  }

  requestWithdrawalByShares(
    input: RequestWithdrawalBySharesInput
  ): RequestWithdrawalResult {
    return this.withdrawals.requestByShares(input);
  }

  completeWithdrawal(
    input: CompleteWithdrawalInput
  ): WithdrawalRequestRecord {
    return this.withdrawals.completeWithdrawal(input);
  }

  rejectWithdrawal(
    requestId: string,
    reason: string
  ): WithdrawalRequestRecord {
    return this.withdrawals.rejectWithdrawal(requestId, reason);
  }
}

export function createManagedStrategyRuntime(
  deps?: Partial<ManagedStrategyRuntimeDependencies>
): ManagedStrategyRuntime {
  return new ManagedStrategyRuntime(deps);
}