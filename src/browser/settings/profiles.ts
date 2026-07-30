/**
 * @file src/browser/settings/profiles.ts
 *
 * Multi-profile support — separate bookmarks, history, cookies, settings
 * per profile with avatars, names, and data isolation.
 */

import type { IDisposable } from '../../app/dependency-container';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ProfileColor = 'blue' | 'red' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink' | 'teal';

export interface Profile {
  readonly id: string;
  name: string;
  avatar: string;
  color: ProfileColor;
  isDefault: boolean;
  isGuest: boolean;
  isIncognito: boolean;
  createdAt: number;
  lastActiveAt: number;
}

export interface ProfileData {
  bookmarks: unknown[];
  history: unknown[];
  cookies: Record<string, unknown>;
  localStorage: Record<string, unknown>;
  settings: Record<string, unknown>;
  extensions: unknown[];
}

export type ProfileEventType = 'profileCreated' | 'profileRemoved' | 'profileSwitched' | 'profileUpdated';

export interface ProfileEvent {
  readonly kind: ProfileEventType;
  readonly profileId: string;
  readonly profileIds?: string[];
}

export type ProfileEventHandler = (event: ProfileEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// AVATAR ICONS
// ─────────────────────────────────────────────────────────────────────────────

const AVATAR_ICONS = ['👤', '🧑', '👩', '🧔', '👱', '🧒', '👴', '👵', '🦊', '🐱', '🐶', '🦁', '🐸', '🦉', '🐧', '🦄'];

export function randomAvatar(): string {
  return AVATAR_ICONS[Math.floor(Math.random() * AVATAR_ICONS.length)] ?? '👤';
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface IProfileManager extends IDisposable {
  /** Create a new profile */
  createProfile(name: string, options?: Partial<Pick<Profile, 'avatar' | 'color'>>): Profile;
  /** Remove a profile */
  removeProfile(profileId: string): boolean;
  /** Get a profile by ID */
  getProfile(profileId: string): Profile | undefined;
  /** Get all profiles */
  getProfiles(): readonly Profile[];
  /** Get the active profile */
  getActiveProfile(): Profile;
  /** Switch to a profile */
  switchProfile(profileId: string): boolean;
  /** Update profile name/avatar/color */
  updateProfile(profileId: string, updates: Partial<Pick<Profile, 'name' | 'avatar' | 'color'>>): boolean;
  /** Get profile data (isolated storage) */
  getProfileData(profileId: string): ProfileData | undefined;
  /** Set profile data */
  setProfileData(profileId: string, data: Partial<ProfileData>): void;
  /** Get active profile ID */
  getActiveProfileId(): string;
  /** Subscribe to events */
  onEvent(handler: ProfileEventHandler): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

export class ProfileManager implements IProfileManager {
  private profiles = new Map<string, Profile>();
  private profileData = new Map<string, ProfileData>();
  private activeProfileId: string;
  private handlers: ProfileEventHandler[] = [];
  private disposed = false;

  constructor() {
    // Create default profile
    const defaultProfile: Profile = {
      id: 'default',
      name: 'Default',
      avatar: '🦊',
      color: 'blue',
      isDefault: true,
      isGuest: false,
      isIncognito: false,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    this.profiles.set('default', defaultProfile);
    this.profileData.set('default', this.emptyData());
    this.activeProfileId = 'default';
  }

  createProfile(name: string, options?: Partial<Pick<Profile, 'avatar' | 'color'>>): Profile {
    const id = `profile-${randomUUID().slice(0, 8)}`;
    const profile: Profile = {
      id,
      name,
      avatar: options?.avatar ?? randomAvatar(),
      color: options?.color ?? 'blue',
      isDefault: false,
      isGuest: false,
      isIncognito: false,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    this.profiles.set(id, profile);
    this.profileData.set(id, this.emptyData());
    this.emit({ kind: 'profileCreated', profileId: id });
    return profile;
  }

  removeProfile(profileId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile || profile.isDefault) return false;
    if (profile.isGuest) return false;

    this.profiles.delete(profileId);
    this.profileData.delete(profileId);

    if (this.activeProfileId === profileId) {
      this.switchProfile('default');
    }

    this.emit({ kind: 'profileRemoved', profileId });
    return true;
  }

  getProfile(profileId: string): Profile | undefined {
    return this.profiles.get(profileId);
  }

  getProfiles(): readonly Profile[] {
    return [...this.profiles.values()].sort((a, b) => {
      if (a.isDefault) return -1;
      if (b.isDefault) return 1;
      return b.lastActiveAt - a.lastActiveAt;
    });
  }

  getActiveProfile(): Profile {
    return this.profiles.get(this.activeProfileId) ?? this.profiles.values().next().value!;
  }

  switchProfile(profileId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) return false;
    if (profile.isIncognito) return false;

    this.activeProfileId = profileId;
    (profile as { lastActiveAt: number }).lastActiveAt = Date.now();

    this.emit({ kind: 'profileSwitched', profileId, profileIds: this.getProfiles().map(p => p.id) });
    return true;
  }

  updateProfile(profileId: string, updates: Partial<Pick<Profile, 'name' | 'avatar' | 'color'>>): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) return false;

    if (updates.name !== undefined) (profile as { name: string }).name = updates.name;
    if (updates.avatar !== undefined) (profile as { avatar: string }).avatar = updates.avatar;
    if (updates.color !== undefined) (profile as { color: ProfileColor }).color = updates.color;

    this.emit({ kind: 'profileUpdated', profileId });
    return true;
  }

  getProfileData(profileId: string): ProfileData | undefined {
    return this.profileData.get(profileId);
  }

  setProfileData(profileId: string, data: Partial<ProfileData>): void {
    const existing = this.profileData.get(profileId);
    if (!existing) return;
    Object.assign(existing, data);
  }

  getActiveProfileId(): string {
    return this.activeProfileId;
  }

  onEvent(handler: ProfileEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.handlers.length = 0;
  }

  private emptyData(): ProfileData {
    return { bookmarks: [], history: [], cookies: {}, localStorage: {}, settings: {}, extensions: [] };
  }

  private emit(event: ProfileEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch {}
    }
  }
}

export function createProfileManager(): ProfileManager {
  return new ProfileManager();
}
