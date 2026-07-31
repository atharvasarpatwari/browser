import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProtocolHandlerRegistry,
  ProtocolHandlerType,
  NetworkTransport,
  buildAllowedProtocols,
  buildBlockedProtocols,
} from '../src/browser/networking/protocol-handler';

describe('ProtocolHandlerRegistry', () => {
  let registry: ProtocolHandlerRegistry;

  beforeEach(() => {
    registry = new ProtocolHandlerRegistry();
  });

  describe('resolve', () => {
    it('should resolve http: protocol', () => {
      const result = registry.resolve('http:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Network);
      expect(result!.label).toBe('HTTP');
      expect(result!.isEncrypted).toBe(false);
      expect(result!.defaultPort).toBe(80);
      expect(result!.transport).toBe(NetworkTransport.HTTP);
    });

    it('should resolve https: protocol', () => {
      const result = registry.resolve('https:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Network);
      expect(result!.label).toBe('HTTPS');
      expect(result!.isEncrypted).toBe(true);
      expect(result!.defaultPort).toBe(443);
      expect(result!.transport).toBe(NetworkTransport.HTTP);
    });

    it('should resolve ws: protocol', () => {
      const result = registry.resolve('ws:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Network);
      expect(result!.label).toBe('WebSocket');
      expect(result!.isEncrypted).toBe(false);
      expect(result!.transport).toBe(NetworkTransport.WebSocket);
    });

    it('should resolve wss: protocol', () => {
      const result = registry.resolve('wss:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Network);
      expect(result!.label).toBe('WebSocket Secure');
      expect(result!.isEncrypted).toBe(true);
      expect(result!.transport).toBe(NetworkTransport.WebSocket);
    });

    it('should resolve ftp: protocol', () => {
      const result = registry.resolve('ftp:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Network);
      expect(result!.label).toBe('FTP');
      expect(result!.isEncrypted).toBe(false);
      expect(result!.defaultPort).toBe(21);
      expect(result!.transport).toBe(NetworkTransport.FTP);
    });

    it('should resolve ftps: protocol', () => {
      const result = registry.resolve('ftps:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Network);
      expect(result!.label).toBe('FTPS');
      expect(result!.isEncrypted).toBe(true);
      expect(result!.defaultPort).toBe(990);
      expect(result!.transport).toBe(NetworkTransport.FTP);
    });

    it('should resolve sftp: protocol', () => {
      const result = registry.resolve('sftp:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Network);
      expect(result!.label).toBe('SFTP');
      expect(result!.isEncrypted).toBe(true);
      expect(result!.defaultPort).toBe(22);
      expect(result!.transport).toBe(NetworkTransport.SFTP);
    });

    it('should resolve file: protocol', () => {
      const result = registry.resolve('file:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Internal);
      expect(result!.label).toBe('Local File');
      expect(result!.isEncrypted).toBe(true);
    });

    it('should resolve data: protocol', () => {
      const result = registry.resolve('data:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Internal);
      expect(result!.label).toBe('Data URI');
    });

    it('should resolve blob: protocol', () => {
      const result = registry.resolve('blob:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Internal);
      expect(result!.label).toBe('Blob');
    });

    it('should resolve about: protocol', () => {
      const result = registry.resolve('about:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Internal);
      expect(result!.label).toBe('About');
    });

    it('should resolve nova: protocol', () => {
      const result = registry.resolve('nova:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Internal);
      expect(result!.label).toBe('Nova');
    });

    it('should resolve mailto: protocol', () => {
      const result = registry.resolve('mailto:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.External);
      expect(result!.label).toBe('Email');
      expect(result!.externalScheme).toBe('mailto:');
    });

    it('should resolve tel: protocol', () => {
      const result = registry.resolve('tel:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.External);
      expect(result!.label).toBe('Telephone');
      expect(result!.externalScheme).toBe('tel:');
    });

    it('should resolve sms: protocol', () => {
      const result = registry.resolve('sms:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.External);
      expect(result!.label).toBe('SMS');
      expect(result!.externalScheme).toBe('sms:');
    });

    it('should resolve smsto: protocol', () => {
      const result = registry.resolve('smsto:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.External);
      expect(result!.label).toBe('SMS');
      expect(result!.externalScheme).toBe('sms:');
    });

    it('should resolve ssh: protocol', () => {
      const result = registry.resolve('ssh:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.External);
      expect(result!.label).toBe('SSH');
      expect(result!.externalScheme).toBe('ssh:');
    });

    it('should resolve magnet: protocol', () => {
      const result = registry.resolve('magnet:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.External);
      expect(result!.label).toBe('Magnet Link');
      expect(result!.externalScheme).toBe('magnet:');
    });

    it('should resolve news: protocol', () => {
      const result = registry.resolve('news:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Network);
      expect(result!.label).toBe('Usenet');
      expect(result!.defaultPort).toBe(119);
    });

    it('should resolve nntp: protocol', () => {
      const result = registry.resolve('nntp:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Network);
      expect(result!.label).toBe('NNTP');
      expect(result!.defaultPort).toBe(119);
    });

    it('should resolve gopher: protocol', () => {
      const result = registry.resolve('gopher:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Network);
      expect(result!.label).toBe('Gopher');
      expect(result!.defaultPort).toBe(70);
    });

    it('should resolve wais: protocol', () => {
      const result = registry.resolve('wais:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Network);
      expect(result!.label).toBe('WAIS');
      expect(result!.defaultPort).toBe(210);
    });

    it('should resolve javascript: as blocked', () => {
      const result = registry.resolve('javascript:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Blocked);
      expect(result!.label).toBe('JavaScript');
    });

    it('should resolve vbscript: as blocked', () => {
      const result = registry.resolve('vbscript:');
      expect(result).not.toBeNull();
      expect(result!.type).toBe(ProtocolHandlerType.Blocked);
      expect(result!.label).toBe('VBScript');
    });

    it('should return null for unknown protocol', () => {
      const result = registry.resolve('custom:');
      expect(result).toBeNull();
    });
  });

  describe('isBlocked', () => {
    it('should return true for javascript:', () => {
      expect(registry.isBlocked('javascript:')).toBe(true);
    });

    it('should return true for vbscript:', () => {
      expect(registry.isBlocked('vbscript:')).toBe(true);
    });

    it('should return false for https:', () => {
      expect(registry.isBlocked('https:')).toBe(false);
    });

    it('should return false for unknown protocol', () => {
      expect(registry.isBlocked('custom:')).toBe(false);
    });
  });

  describe('isAllowed', () => {
    it('should return true for https:', () => {
      expect(registry.isAllowed('https:')).toBe(true);
    });

    it('should return true for mailto:', () => {
      expect(registry.isAllowed('mailto:')).toBe(true);
    });

    it('should return false for javascript:', () => {
      expect(registry.isAllowed('javascript:')).toBe(false);
    });

    it('should return false for unknown protocol', () => {
      expect(registry.isAllowed('custom:')).toBe(false);
    });
  });

  describe('isEncrypted', () => {
    it('should return true for https:', () => {
      expect(registry.isEncrypted('https:')).toBe(true);
    });

    it('should return true for wss:', () => {
      expect(registry.isEncrypted('wss:')).toBe(true);
    });

    it('should return true for ftps:', () => {
      expect(registry.isEncrypted('ftps:')).toBe(true);
    });

    it('should return true for sftp:', () => {
      expect(registry.isEncrypted('sftp:')).toBe(true);
    });

    it('should return true for ssh:', () => {
      expect(registry.isEncrypted('ssh:')).toBe(true);
    });

    it('should return true for mailto:', () => {
      expect(registry.isEncrypted('mailto:')).toBe(true);
    });

    it('should return false for http:', () => {
      expect(registry.isEncrypted('http:')).toBe(false);
    });

    it('should return false for ws:', () => {
      expect(registry.isEncrypted('ws:')).toBe(false);
    });

    it('should return false for ftp:', () => {
      expect(registry.isEncrypted('ftp:')).toBe(false);
    });

    it('should return false for unknown protocol', () => {
      expect(registry.isEncrypted('custom:')).toBe(false);
    });
  });

  describe('register', () => {
    it('should register a new protocol', () => {
      const isNew = registry.register({
        scheme: 'custom:',
        type: ProtocolHandlerType.Network,
        label: 'Custom',
        isEncrypted: false,
        defaultPort: 1234,
        transport: NetworkTransport.HTTP,
        externalScheme: null,
      });
      expect(isNew).toBe(true);
      expect(registry.resolve('custom:')?.label).toBe('Custom');
    });

    it('should replace an existing protocol', () => {
      const isNew = registry.register({
        scheme: 'https:',
        type: ProtocolHandlerType.Network,
        label: 'Secure HTTP',
        isEncrypted: true,
        defaultPort: 443,
        transport: NetworkTransport.HTTP,
        externalScheme: null,
      });
      expect(isNew).toBe(false);
      expect(registry.resolve('https:')?.label).toBe('Secure HTTP');
    });
  });

  describe('unregister', () => {
    it('should remove a registered protocol', () => {
      const existed = registry.unregister('gopher:');
      expect(existed).toBe(true);
      expect(registry.resolve('gopher:')).toBeNull();
    });

    it('should return false for non-existent protocol', () => {
      const existed = registry.unregister('custom:');
      expect(existed).toBe(false);
    });
  });

  describe('getSchemes', () => {
    it('should return all registered schemes', () => {
      const schemes = registry.getSchemes();
      expect(schemes).toContain('http:');
      expect(schemes).toContain('https:');
      expect(schemes).toContain('ws:');
      expect(schemes).toContain('wss:');
      expect(schemes).toContain('ftp:');
      expect(schemes).toContain('ftps:');
      expect(schemes).toContain('sftp:');
      expect(schemes).toContain('file:');
      expect(schemes).toContain('data:');
      expect(schemes).toContain('blob:');
      expect(schemes).toContain('about:');
      expect(schemes).toContain('nova:');
      expect(schemes).toContain('mailto:');
      expect(schemes).toContain('tel:');
      expect(schemes).toContain('sms:');
      expect(schemes).toContain('smsto:');
      expect(schemes).toContain('ssh:');
      expect(schemes).toContain('magnet:');
      expect(schemes).toContain('news:');
      expect(schemes).toContain('nntp:');
      expect(schemes).toContain('gopher:');
      expect(schemes).toContain('wais:');
      expect(schemes).toContain('javascript:');
      expect(schemes).toContain('vbscript:');
    });
  });

  describe('getBlockedSchemes', () => {
    it('should return only blocked schemes', () => {
      const blocked = registry.getBlockedSchemes();
      expect(blocked).toContain('javascript:');
      expect(blocked).toContain('vbscript:');
      expect(blocked).not.toContain('https:');
      expect(blocked).not.toContain('mailto:');
    });
  });

  describe('getAllowedSchemes', () => {
    it('should return only non-blocked schemes', () => {
      const allowed = registry.getAllowedSchemes();
      expect(allowed).toContain('http:');
      expect(allowed).toContain('https:');
      expect(allowed).toContain('ws:');
      expect(allowed).toContain('wss:');
      expect(allowed).toContain('ftp:');
      expect(allowed).toContain('ftps:');
      expect(allowed).toContain('sftp:');
      expect(allowed).toContain('mailto:');
      expect(allowed).toContain('tel:');
      expect(allowed).toContain('magnet:');
      expect(allowed).not.toContain('javascript:');
      expect(allowed).not.toContain('vbscript:');
    });
  });
});

describe('buildAllowedProtocols', () => {
  it('should return a Set of all non-blocked protocols', () => {
    const allowed = buildAllowedProtocols();
    expect(allowed).toBeInstanceOf(Set);
    expect(allowed.has('http:')).toBe(true);
    expect(allowed.has('https:')).toBe(true);
    expect(allowed.has('ws:')).toBe(true);
    expect(allowed.has('wss:')).toBe(true);
    expect(allowed.has('ftp:')).toBe(true);
    expect(allowed.has('ftps:')).toBe(true);
    expect(allowed.has('sftp:')).toBe(true);
    expect(allowed.has('mailto:')).toBe(true);
    expect(allowed.has('tel:')).toBe(true);
    expect(allowed.has('magnet:')).toBe(true);
    expect(allowed.has('javascript:')).toBe(false);
    expect(allowed.has('vbscript:')).toBe(false);
  });
});

describe('buildBlockedProtocols', () => {
  it('should return a Set of blocked protocols', () => {
    const blocked = buildBlockedProtocols();
    expect(blocked).toBeInstanceOf(Set);
    expect(blocked.has('javascript:')).toBe(true);
    expect(blocked.has('vbscript:')).toBe(true);
    expect(blocked.has('https:')).toBe(false);
    expect(blocked.has('mailto:')).toBe(false);
  });
});
