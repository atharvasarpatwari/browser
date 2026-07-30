export {
  implicitRole,
  explicitRole,
  resolvedRole,
  computeAccessibleName,
  computeAccessibleDescription,
  computeValue,
  computeStates,
  computeHidden,
  buildAccessibilityTree,
  createScreenReaderManager,
  TAG_ROLE_MAP,
} from './screen-reader';

export type {
  AriaRole,
  A11yState,
  AccessibleNode,
  A11yEvent,
  A11yEventHandler,
  IScreenReaderManager,
  A11yDomNode,
  A11yDomElement,
} from './screen-reader';
