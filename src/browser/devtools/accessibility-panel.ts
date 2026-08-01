import type { A11yDomNode, A11yDomElement, AriaRole, A11yState } from '../accessibility/screen-reader';
import { buildAccessibilityTree, resolvedRole, isA11yElement } from '../accessibility/screen-reader';

export interface A11yAuditIssue {
  id: string;
  type: 'warning' | 'error' | 'info';
  message: string;
  elementId: string;
  tagName: string;
  suggestion: string;
}

export type A11yAuditCategory =
  | 'missing-label' | 'low-contrast' | 'missing-alt'
  | 'missing-role' | 'missing-lang' | 'focusable-disabled'
  | 'missing-heading' | 'empty-heading' | 'orphaned-focus';

export type A11yPanelEventType =
  | 'treeRebuilt' | 'nodeSelected' | 'auditComplete' | 'cleared';

export interface A11yPanelEvent {
  kind: A11yPanelEventType;
  nodeId?: string;
  issues?: A11yAuditIssue[];
}

export type A11yPanelEventHandler = (event: A11yPanelEvent) => void;

export class AccessibilityPanel {
  private currentTree: { id: string; role: AriaRole; name: string; description: string; value: string; states: Set<A11yState>; children: any[]; hidden: boolean } | null = null;
  private selectedNodeId: string | null = null;
  private auditResults: A11yAuditIssue[] = [];
  private handlers = new Set<A11yPanelEventHandler>();
  private issueCounter = 0;

  buildTree(root: A11yDomNode): void {
    this.currentTree = buildAccessibilityTree(root) as any;
    this.emit({ kind: 'treeRebuilt' });
  }

  getTree(): typeof this.currentTree { return this.currentTree; }

  selectNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.emit({ kind: 'nodeSelected', nodeId: nodeId ?? undefined });
  }

  getSelectedNodeId(): string | null { return this.selectedNodeId; }

  runAudit(root: A11yDomNode): A11yAuditIssue[] {
    this.auditResults = [];
    this.issueCounter = 0;
    this.checkNode(root);
    this.emit({ kind: 'auditComplete', issues: this.auditResults });
    return [...this.auditResults];
  }

  private checkNode(node: A11yDomNode): void {
    if (!isA11yElement(node)) return;
    const tag = node.tagName.toLowerCase();
    const attrs = node.attributes;
    const role = resolvedRole(attrs, tag);
    const hasAriaLabel = attrs.get('aria-label');
    const hasAlt = attrs.get('alt');
    const hasLabel = attrs.get('aria-labelledby') || attrs.get('aria-label') || attrs.get('title');

    if ((tag === 'img' || role === 'img') && !hasAlt && !hasAriaLabel) {
      this.addIssue('missing-alt', 'Image without alt text', node);
    }
    if ((tag === 'input' || tag === 'textarea' || tag === 'select') && !hasLabel) {
      this.addIssue('missing-label', 'Form element without accessible label', node);
    }
    if (tag === 'button' && !hasAriaLabel && !node.children.some(c => c.nodeType === 'element' || (c.nodeType === 'text' && c.domId))) {
      this.addIssue('missing-label', 'Button without accessible label', node);
    }
    if (role === 'none' && tag !== 'div' && tag !== 'span' && tag !== 'a' && tag !== 'label' && tag !== 'p' && !hasLabel) {
      this.addIssue('missing-role', 'Element without ARIA role', node);
    }
    if (attrs.get('aria-disabled') === 'true' && attrs.get('tabindex') === '0') {
      this.addIssue('focusable-disabled', 'Disabled element is focusable', node);
    }

    for (const child of node.children) {
      this.checkNode(child as A11yDomNode);
    }
  }

  private addIssue(type: A11yAuditCategory, message: string, node: A11yDomElement): void {
    this.issueCounter++;
    this.auditResults.push({
      id: `a11y-${this.issueCounter}`,
      type: type === 'missing-alt' || type === 'missing-label' ? 'error' as const : 'warning' as const,
      message,
      elementId: node.domId,
      tagName: node.tagName,
      suggestion: this.getSuggestion(type),
    });
  }

  private getSuggestion(type: A11yAuditCategory): string {
    switch (type) {
      case 'missing-alt': return 'Add alt="..." attribute to the image';
      case 'missing-label': return 'Add aria-label or associate a <label> element';
      case 'missing-role': return 'Add role="..." attribute to define semantics';
      case 'focusable-disabled': return 'Remove tabindex=0 or aria-disabled="true"';
      default: return 'Review accessibility guidelines';
    }
  }

  getAuditResults(): A11yAuditIssue[] { return [...this.auditResults]; }

  clear(): void {
    this.currentTree = null;
    this.selectedNodeId = null;
    this.auditResults = [];
    this.issueCounter = 0;
    this.emit({ kind: 'cleared' });
  }

  onEvent(handler: A11yPanelEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    this.clear();
    this.handlers.clear();
  }

  private emit(event: A11yPanelEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { }
    }
  }
}
