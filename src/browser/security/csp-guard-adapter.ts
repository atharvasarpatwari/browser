import type { INavigationGuard, NavigationRequest } from '../navigation/navigation-controller';
import { CspNavigationGuard } from './csp-navigation-guard';

export class CspGuardAdapter implements INavigationGuard {
  readonly name = 'csp';

  private readonly guard: CspNavigationGuard;

  constructor(guard: CspNavigationGuard) {
    this.guard = guard;
  }

  async canNavigate(request: NavigationRequest): Promise<boolean> {
    const result = this.guard.checkNavigation({
      url: request.url,
      type: request.type,
      referrer: request.referrer,
      userInitiated: request.userInitiated,
    });
    return result.allowed;
  }

  blockedReason(request: NavigationRequest): string {
    const result = this.guard.checkNavigation({
      url: request.url,
      type: request.type,
      referrer: request.referrer,
      userInitiated: request.userInitiated,
    });
    return result.reason ?? 'Content Security Policy blocked';
  }
}
