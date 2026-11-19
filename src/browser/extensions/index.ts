export { ExtensionLoader } from './extension-loader';
export type { ExtensionSource } from './extension-loader';

export { ContentScriptsManager, matchUrlPattern } from './content-scripts';
export type { RegisteredContentScript, ContentScriptEvent, ContentScriptEventHandler } from './content-scripts';

export { BackgroundScriptsManager } from './background-scripts';
export type { BackgroundPageInfo, BgEvent, BgEventHandler } from './background-scripts';

export { Messaging } from './messaging';
export type { Message, MessageListener, Port, MsgEvent, MsgEventHandler } from './messaging';

export { ExtensionStorage } from './storage-api';
export type { StorageAreaType, StorageChange, StorageEventHandler } from './storage-api';

export { Permissions, KNOWN_PERMISSIONS } from './permissions';
export type { PermissionStatus } from './permissions';

export { validateManifest, normalizeManifest, createExtensionFromManifest } from './manifest';
export type { ManifestValidationResult } from './manifest';

export { computeExtensionId } from './extension-types';
export type {
  ExtensionManifest, ExtensionData, ExtensionEvent, ExtensionEventHandler,
  MessageSender, MessageResponse,
  ContentScriptDeclaration, ContentScriptPattern,
  BackgroundDeclaration, ExtensionHostPermission,
  ExtensionActionDeclaration,
} from './extension-types';
