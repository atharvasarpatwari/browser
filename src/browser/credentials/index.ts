export { CredentialStore, generateId as generateCredentialId } from './credential-store';
export type { ICredentialStore, CredentialEntry, CredentialChangeEvent, CredentialChangeKind, CredentialEventHandler } from './credential-store';

export { EncryptionService, PBKDF2_ITERATIONS, SALT_LENGTH, IV_LENGTH, generateBytes, bytesToHex, hexToBytes } from './encryption';
export type { IEncryptionService, EncryptedData, EncryptionKey } from './encryption';

export { AutofillService, inferUsernameField, inferPasswordField, matchConfidence } from './autofill';
export type { IAutofillService, FormField, AutofillSuggestion, AutofillEvent, AutofillEventKind, AutofillEventHandler } from './autofill';

export { PasskeyManager, generateKeyPair, signChallenge, generateChallenge } from './passkeys';
export type {
  IPasskeyManager, PasskeyCredential, PasskeyRegistrationOptions, PasskeyAuthenticationOptions,
  PasskeyRegistrationResult, PasskeyAuthenticationResult, PasskeyRpInfo, PasskeyUserInfo,
  PasskeyEvent, PasskeyEventKind, PasskeyEventHandler,
} from './passkeys';
