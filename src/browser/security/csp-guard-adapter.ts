import type { INavigationGuard, NavigationRequest } from '../navigation/navigation-controller';
import { CspNavigationGuard, type CspNavigationResult } from './csp-navigation-guard';

export class CspGuardAdapter implements INavigationGuard {
  readonly name = 'csp';

  private readonly guard: CspNavigationGuard;

  constructor(guard: CspNavigationGuard) {
    this.guard = guard;
  }

  async canNavigate(request: NavigationRequest): Promise<boolean> {
    const result = this.check(request);
    // upgrade-insecure-requests comes back as allowed:true with an
    // upgradedUrl — treat it as a block so the guard chain's upgrade path
    // (see upgradeUrl below) actually redirects instead of silently loading
    // the original http: URL.
    if (result.upgradedUrl) return false;
    return result.allowed;
  }

  blockedReason(request: NavigationRequest): string {
    const result = this.check(request);
    if (result.upgradedUrl) {
      return `Content Security Policy requires HTTPS; use ${result.upgradedUrl} instead.`;
    }
    return result.reason ?? 'Content Security Policy blocked';
  }

  upgradeUrl(request: NavigationRequest): string | null | undefined {
    return this.check(request).upgradedUrl;
  }

  private check(request: NavigationRequest): CspNavigationResult {
    return this.guard.checkNavigation({
      url: request.url,
      type: request.type,
      referrer: request.referrer,
      userInitiated: request.userInitiated,
    });
  }
}
