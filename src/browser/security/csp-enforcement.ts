import type { INavigationGuard } from '../navigation/navigation-controller';
import { CspPolicyStore } from './csp-policy-store';
import { CspReporter } from './csp-reporter';
import { CspNavigationGuard } from './csp-navigation-guard';
import { CspResourceEnforcer } from './csp-resource-enforcer';
import { CspScriptEnforcer } from './csp-script-enforcer';
import { CspGuardAdapter } from './csp-guard-adapter';

export interface CspEnforcement {
  readonly policyStore: CspPolicyStore;
  readonly reporter: CspReporter;
  readonly navigationGuard: INavigationGuard;
  readonly resourceEnforcer: CspResourceEnforcer;
  readonly scriptEnforcer: CspScriptEnforcer;
  readonly rawNavigationGuard: CspNavigationGuard;
}

export function createCspEnforcement(): CspEnforcement {
  const policyStore = new CspPolicyStore();
  const reporter = new CspReporter();

  const rawGuard = new CspNavigationGuard(policyStore, reporter);
  const adapter = new CspGuardAdapter(rawGuard);

  const resourceEnforcer = new CspResourceEnforcer(policyStore, reporter);
  const scriptEnforcer = new CspScriptEnforcer(policyStore, reporter);

  return {
    policyStore,
    reporter,
    navigationGuard: adapter,
    resourceEnforcer,
    scriptEnforcer,
    rawNavigationGuard: rawGuard,
  };
}
