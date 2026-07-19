/**
 * @file src/browser/security/csp-script-enforcer.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforce CSP script-src directives in the JavaScript engine. Handles:
 *   • script-src enforcement (external scripts)
 *   • Inline script blocking (no 'unsafe-inline' without nonce/hash)
 *   • eval() blocking (no 'unsafe-eval')
 *   • new Function() blocking
 *   • setTimeout/setInterval with string argument blocking
 *   • Nonce verification for inline scripts
 *   • Hash verification for script content
 *   • strict-dynamic propagation
 *   • Integration with ScriptGuard for execution timing
 *
 * Called by the JS engine / interpreter before executing any script.
 * Provides a pre-execution check that can be called inline.
 *
 * Does NOT:
 *   • Execute scripts (JS engine's job)
 *   • Parse CSP headers (csp-parser.ts's job)
 *   • Store policies (csp-policy-store.ts's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only enforces CSP script execution restrictions.
 *  Pure functions    Most checks are side-effect-free evaluations.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CspPolicy } from './csp-parser';
import type { CspEvalContext } from './csp-evaluator';
import type { CspReporter } from './csp-reporter';
import type { CspPolicyStore } from './csp-policy-store';
import { evaluateCsp } from './csp-evaluator';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Type of script execution being checked. */
type ScriptType =
  | 'external'       /* <script src="..."> */
  | 'inline'         /* <script>code</script> */
  | 'eval'           /* eval("code") */
  | 'new-function'   /* new Function("code") */
  | 'timer-string'   /* setTimeout("code", ms) */
  | 'inline-event'   /* onclick="code" */
  | 'javascript-uri' /* javascript: URL */
  | 'dynamic-import' /* import("module") */
  | 'module'         /* <script type="module"> */
  | 'worker';        /* new Worker("url") */

/** A script execution request to be checked against CSP. */
interface ScriptExecutionRequest {
  /** The script URL (for external scripts) or empty for inline. */
  readonly url: string;
  /** The type of script execution. */
  readonly scriptType: ScriptType;
  /** The origin of the page. */
  readonly pageOrigin: string;
  /** The document URL. */
  readonly documentUri: string;
  /** Nonce for inline scripts, if provided. */
  readonly nonce?: string;
  /** SHA-256/384/512 hash of the script content. */
  readonly hash?: string;
  /** The script content (first 40 chars) for reporting. */
  readonly scriptSample?: string;
  /** Whether this is a module script. */
  readonly isModule?: boolean;
  /** Whether the script is created by a trusted script (for strict-dynamic). */
  readonly trustedCreation?: boolean;
}

/** Result of a CSP script check. */
interface ScriptCheckResult {
  /** Whether the script execution is allowed. */
  readonly allowed: boolean;
  /** The CSP directive that was checked. */
  readonly directive: string;
  /** The script type. */
  readonly scriptType: ScriptType;
  /** The URL or 'inline'. */
  readonly source: string;
  /** Reason for denial, if blocked. */
  readonly reason?: string;
  /** The matched source expression. */
  readonly matchedSource?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class CspScriptEnforcer {
  private readonly policyStore: CspPolicyStore;
  private readonly reporter: CspReporter | null;
  private violations: ScriptCheckResult[] = [];

  constructor(policyStore: CspPolicyStore, reporter?: CspReporter | null) {
    this.policyStore = policyStore;
    this.reporter = reporter ?? null;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Check if a script execution is allowed by CSP.
   */
  checkScript(request: ScriptExecutionRequest): ScriptCheckResult {
    const policy = this.policyStore.getEnforcePolicy(request.pageOrigin);

    // No CSP policy → allow.
    if (!policy || !policy.directives.size) {
      return {
        allowed: true,
        directive: '',
        scriptType: request.scriptType,
        source: request.url || 'inline',
      };
    }

    const context: CspEvalContext = {
      pageOrigin: request.pageOrigin,
      isInline: request.scriptType === 'inline' ||
                request.scriptType === 'inline-event' ||
                request.scriptType === 'timer-string',
      isEval: request.scriptType === 'eval' ||
              request.scriptType === 'new-function' ||
              request.scriptType === 'timer-string',
      nonce: request.nonce,
      hash: request.hash,
      userInitiated: request.trustedCreation ?? false,
    };

    // For external scripts, workers, dynamic imports, and javascript: URIs, check with the actual URL.
    // For inline/eval, check script-src with context flags.
    const url = request.scriptType === 'external' || request.scriptType === 'module' || request.scriptType === 'worker' || request.scriptType === 'dynamic-import' || request.scriptType === 'javascript-uri'
      ? request.url
      : 'inline-script';

    // Workers are controlled by worker-src (falls back to child-src, then script-src).
    const directive = request.scriptType === 'worker' ? 'worker-src' : 'script-src';

    const result = evaluateCsp(policy, directive, url, context);

    const checkResult: ScriptCheckResult = {
      allowed: result.allowed,
      directive,
      scriptType: request.scriptType,
      source: request.url || 'inline',
      reason: result.allowed ? undefined : this.getDenialReason(request.scriptType, result),
      matchedSource: result.matchedSource?.raw,
    };

    if (!result.allowed) {
      this.violations.push(checkResult);
      this.reporter?.reportViolation(result, {
        documentUri: request.documentUri,
        policy,
        disposition: 'enforce',
        scriptSample: request.scriptSample,
      });
    }

    return checkResult;
  }

  /**
   * Check an external script URL (convenience method).
   */
  checkExternalScript(
    url: string,
    pageOrigin: string,
    documentUri: string,
    isModule = false,
  ): ScriptCheckResult {
    return this.checkScript({
      url,
      scriptType: isModule ? 'module' : 'external',
      pageOrigin,
      documentUri,
      isModule,
    });
  }

  /**
   * Check an inline script (convenience method).
   */
  checkInlineScript(
    content: string,
    pageOrigin: string,
    documentUri: string,
    nonce?: string,
    hash?: string,
  ): ScriptCheckResult {
    return this.checkScript({
      url: '',
      scriptType: 'inline',
      pageOrigin,
      documentUri,
      nonce,
      hash,
      scriptSample: content.slice(0, 40),
    });
  }

  /**
   * Check an eval() call (convenience method).
   */
  checkEval(
    pageOrigin: string,
    documentUri: string,
    codeSample?: string,
  ): ScriptCheckResult {
    return this.checkScript({
      url: '',
      scriptType: 'eval',
      pageOrigin,
      documentUri,
      scriptSample: codeSample?.slice(0, 40),
    });
  }

  /**
   * Check a new Function() call (convenience method).
   */
  checkNewFunction(
    pageOrigin: string,
    documentUri: string,
    codeSample?: string,
  ): ScriptCheckResult {
    return this.checkScript({
      url: '',
      scriptType: 'new-function',
      pageOrigin,
      documentUri,
      scriptSample: codeSample?.slice(0, 40),
    });
  }

  /**
   * Check a timer with string argument (convenience method).
   */
  checkTimerString(
    pageOrigin: string,
    documentUri: string,
    codeSample?: string,
  ): ScriptCheckResult {
    return this.checkScript({
      url: '',
      scriptType: 'timer-string',
      pageOrigin,
      documentUri,
      scriptSample: codeSample?.slice(0, 40),
    });
  }

  /**
   * Check a javascript: URL (convenience method).
   */
  checkJavascriptUri(
    url: string,
    pageOrigin: string,
    documentUri: string,
  ): ScriptCheckResult {
    return this.checkScript({
      url,
      scriptType: 'javascript-uri',
      pageOrigin,
      documentUri,
    });
  }

  /**
   * Check a worker URL (convenience method).
   */
  checkWorker(
    url: string,
    pageOrigin: string,
    documentUri: string,
  ): ScriptCheckResult {
    return this.checkScript({
      url,
      scriptType: 'worker',
      pageOrigin,
      documentUri,
    });
  }

  /**
   * Check a dynamic import (convenience method).
   */
  checkDynamicImport(
    url: string,
    pageOrigin: string,
    documentUri: string,
  ): ScriptCheckResult {
    return this.checkScript({
      url,
      scriptType: 'dynamic-import',
      pageOrigin,
      documentUri,
    });
  }

  /**
   * Get all recorded violations.
   */
  getViolations(): readonly ScriptCheckResult[] {
    return [...this.violations];
  }

  /**
   * Clear recorded violations.
   */
  clearViolations(): void {
    this.violations = [];
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private getDenialReason(scriptType: ScriptType, _result: import('./csp-evaluator').CspEvaluationResult): string {
    switch (scriptType) {
      case 'inline':
      case 'inline-event':
        return 'Inline script blocked by CSP (no unsafe-inline, nonce, or hash)';
      case 'eval':
        return 'eval() blocked by CSP (no unsafe-eval)';
      case 'new-function':
        return 'new Function() blocked by CSP (no unsafe-eval)';
      case 'timer-string':
        return 'Timer with string argument blocked by CSP (no unsafe-inline)';
      case 'javascript-uri':
        return 'javascript: URL blocked by CSP';
      case 'external':
        return 'External script blocked by CSP';
      case 'module':
        return 'Module script blocked by CSP';
      case 'worker':
        return 'Worker blocked by CSP';
      case 'dynamic-import':
        return 'Dynamic import blocked by CSP';
      default:
        return 'Script blocked by CSP';
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CspScriptEnforcer,
};

export type {
  ScriptType,
  ScriptExecutionRequest,
  ScriptCheckResult,
};
