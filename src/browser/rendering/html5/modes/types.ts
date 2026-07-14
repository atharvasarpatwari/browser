import type { Token } from '../../html5-tokenizer';
import type { HtmlElement, HtmlNode, MutableElement, MutableDocument, DiscoveredResource } from '../dom';
import { Namespace } from '../dom';
import { OpenElements } from '../stack';
import { ActiveFormattingElements } from '../formatting';
import { Im } from '../constants';

/**
 * Shared context passed to all insertion mode handlers.
 * Mutable fields represent the tree builder's current state.
 */
export interface TreeBuilderContext {
  // Data structures
  openElements: OpenElements;
  formattingElements: ActiveFormattingElements;
  document: MutableDocument;

  // Mutable state
  insertionMode: Im;
  originalInsertionMode: Im;
  framesetOk: boolean;
  formElement: HtmlElement | null;
  headElement: HtmlElement | null;
  bodyElement: HtmlElement | null;
  htmlElement: HtmlElement | null;
  templateInsertionModes: Im[];
  pendingRawText: string;
  baseUrl: string;
  scriptingEnabled: boolean;

  // Resources discovered during parsing
  resources: DiscoveredResource[];

  // Token dispatch
  processToken(token: Token): void;

  // Error handling
  parseError(token: Token): void;

  // Insertion helpers
  insertHTMLElement(token: Token, ns?: Namespace): HtmlElement;
  insertForeignElement(token: Token, ns: Namespace): HtmlElement;
  insertText(token: Token): void;
  insertCharacter(text: string): void;
  insertComment(token: Token): void;
  insertCommentBeforeOpenElements(token: Token): void;
  insertDoctype(token: Token): void;

  // Stack helpers
  currentNode(): HtmlElement | null;
  popCurrentNode(): HtmlElement;
  popCurrentNodeUntil(tagName: string): void;

  // Formatting helpers
  reconstructActiveFormattingElements(): void;
  activeFormattingPush(el: HtmlElement): void;
  activeFormattingHas(tagName: string): boolean;
  activeFormattingRemove(tagName: string): void;
  activeFormattingClearUpToMarker(): void;

  // Implied end tags
  generateImpliedEndTags(except?: string): void;
  generateImpliedEndTagsThoroughly(except?: string): void;

  // Scope checks
  isInScope(tagName: string): boolean;
  isInButtonScope(tagName: string): boolean;
  isInListItemScope(tagName: string): boolean;
  isInTableScope(tagName: string): boolean;
  isInSelectScope(tagName: string): boolean;
  isInTemplateScope(tagName: string): boolean;

  // Mode switching
  setMode(mode: Im): void;
  resetInsertionMode(): void;

  // Reprocessing
  reprocessInBody(token: Token): void;
  reprocessInTable(token: Token): void;
  processInHeadToken(token: Token): void;
  processInBodyToken(token: Token): void;
  reprocessInForeignContent(token: Token): void;

  // Close element helpers
  closePElement(): void;
  closeTableCellElement(): void;

  // Adoption agency
  adoptionAgencyAlgorithm(token: Token): void;

  // Foster parenting
  fosterParent(node: HtmlNode): void;

  // Special: handleEof
  handleEofInBody(): void;

  // Resource discovery
  discoverResources(token: Token): void;
  checkMetaCharset(token: Token): void;

  // Raw text element handling
  handleRawTextElement(token: Token): void;

  // Fragment parsing support
  contextElement?: HtmlElement;
}
