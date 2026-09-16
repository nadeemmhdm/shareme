/**
 * CryptShare Cryptographic Core
 * End-to-End Encryption (E2EE) powered by Web Crypto API (AES-256-GCM & PBKDF2)
 * Zero-Knowledge: Keys never leave the browser.
 */

class CryptCore {
  constructor() {
    this.crypto = window.crypto.subtle;
  }

  /**
   * Generates a cryptographically secure random token (URL-safe)
   */
  static generateSecureToken(byteLength = 16) {
    const bytes = new Uint8Array(byteLength);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Generates a user-friendly 6-digit room code
   */
  static generateRoomCode() {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return (100000 + (array[0] % 900000)).toString();
  }

  /**
   * Derives an AES-256-GCM key from a shared secret passphrase or room key
   * Uses PBKDF2 with 100,000 iterations and SHA-256
   */
  async deriveKey(secret, saltString = 'cryptshare-p2p-salt') {
    const enc = new TextEncoder();
    const keyMaterial = await this.crypto.importKey(
      'raw',
      enc.encode(secret),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const salt = enc.encode(saltString);

    return await this.crypto.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts an ArrayBuffer chunk with AES-256-GCM
   * Returns: [12-byte IV (Uint8Array)] + [Ciphertext + 16-byte Auth Tag]
   */
  async encryptChunk(chunkArrayBuffer, key, chunkIndex = 0) {
    // 12-byte IV: 8 bytes random + 4 bytes counter to guarantee uniqueness per chunk
    const iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv.subarray(0, 8));
    const view = new DataView(iv.buffer);
    view.setUint32(8, chunkIndex, false); // Big-endian chunk counter

    const encryptedBuffer = await this.crypto.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      chunkArrayBuffer
    );

    // Pack IV + Encrypted Data into one buffer for streaming
    const packed = new Uint8Array(iv.byteLength + encryptedBuffer.byteLength);
    packed.set(iv, 0);
    packed.set(new Uint8Array(encryptedBuffer), iv.byteLength);

    return packed.buffer;
  }

  /**
   * Decrypts an encrypted chunk
   */
  async decryptChunk(packedBuffer, key) {
    const packedBytes = new Uint8Array(packedBuffer);
    if (packedBytes.byteLength < 12 + 16) {
      throw new Error('Encrypted chunk is too small to contain IV and auth tag');
    }

    const iv = packedBytes.subarray(0, 12);
    const ciphertext = packedBytes.subarray(12);

    return await this.crypto.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      ciphertext
    );
  }

  /**
   * Encrypts a plaintext message (e.g. chat, metadata)
   */
  async encryptText(plainText, key) {
    const enc = new TextEncoder();
    const data = enc.encode(plainText);
    const encrypted = await this.encryptChunk(data.buffer, key);
    return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  }

  /**
   * Decrypts a base64 encrypted text
   */
  async decryptText(base64Ciphertext, key) {
    const binary = atob(base64Ciphertext);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decrypted = await this.decryptChunk(bytes.buffer, key);
    return new TextDecoder().decode(decrypted);
  }

  /**
   * Calculates SHA-256 checksum of an ArrayBuffer or Blob
   */
  async calculateHash(bufferOrBlob) {
    let buffer;
    if (bufferOrBlob instanceof Blob) {
      buffer = await bufferOrBlob.arrayBuffer();
    } else {
      buffer = bufferOrBlob;
    }
    const hashBuffer = await this.crypto.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// Global instance export
window.cryptCore = new CryptCore();
