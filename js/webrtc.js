/**
 * CryptShare P2P WebRTC Transfer Engine
 * High-speed DataChannel streaming with Backpressure flow control.
 */

class WebRTCManager {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomCode = null;
    this.encryptionKey = null;
    this.connectedPeerId = null;

    // Stream control
    this.CHUNK_SIZE = 64 * 1024; // 64KB per chunk for high throughput & stability
    this.BUFFER_THRESHOLD = 512 * 1024; // 512KB backpressure threshold

    // File transfer states
    this.activeTransfers = new Map();
    this.incomingFiles = new Map();

    // Event listeners
    this.callbacks = {
      onReady: () => {},
      onConnecting: () => {},
      onConnected: () => {},
      onDisconnected: () => {},
      onProgress: () => {},
      onFileReceived: () => {},
      onChatMessage: () => {},
      onError: () => {},
      onPingUpdate: () => {}
    };

    // Ping interval for connection health & latency
    this.pingInterval = null;
    this.lastPingSent = 0;
  }

  setCallbacks(cbs) {
    this.callbacks = { ...this.callbacks, ...cbs };
  }

  /**
   * Initializes PeerJS client
   */
  async initPeer(customPrefix = 'cryptshare-room-') {
    return new Promise((resolve, reject) => {
      // PeerJS configuration using public reliable STUN servers
      const peerConfig = {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        },
        debug: 0
      };

      try {
        this.peer = new Peer(peerConfig);

        this.peer.on('open', (id) => {
          this.peerId = id;
          this.callbacks.onReady(id);
          resolve(id);
        });

        this.peer.on('connection', (conn) => {
          // Inbound connection
          this.handleIncomingConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.error('[PeerJS Error]', err);
          this.callbacks.onError(err);
          // Auto recover from common connection collisions
          if (err.type === 'unavailable-id') {
            this.callbacks.onError(new Error('Room ID already in use. Please generate a new room.'));
          }
        });

        this.peer.on('disconnected', () => {
          console.warn('[PeerJS Disconnected] Attempting reconnect...');
          if (this.peer && !this.peer.destroyed) {
            this.peer.reconnect();
          }
        });

      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Create or host a room with a specific 6-digit room code
   */
  async createRoom(roomCode, key) {
    this.isHost = true;
    this.roomCode = roomCode;
    this.encryptionKey = key;

    const hostPeerId = `cryptshare-${roomCode}`;

    if (this.peer) {
      this.peer.destroy();
    }

    return new Promise((resolve, reject) => {
      const peerConfig = {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        },
        debug: 0
      };

      this.peer = new Peer(hostPeerId, peerConfig);

      this.peer.on('open', (id) => {
        this.peerId = id;
        this.callbacks.onReady(id);
        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // Room code in use, suggest regeneration
          this.callbacks.onError(new Error('Room code is already active. Please generate a new room code.'));
        } else {
          this.callbacks.onError(err);
        }
        reject(err);
      });
    });
  }

  /**
   * Join an existing room created by a host
   */
  async joinRoom(roomCode, key) {
    this.isHost = false;
    this.roomCode = roomCode;
    this.encryptionKey = key;

    if (!this.peer || this.peer.destroyed) {
      await this.initPeer();
    }

    const hostPeerId = `cryptshare-${roomCode}`;
    this.callbacks.onConnecting(hostPeerId);

    const conn = this.peer.connect(hostPeerId, {
      reliable: true,
      serialization: 'binary'
    });

    this.setupConnection(conn);
  }

  /**
   * Connection listener & setup
   */
  handleIncomingConnection(conn) {
    if (this.conn && this.conn.open) {
      // We already have a connected peer, but allow reconnect
      console.log('Incoming reconnection from peer');
    }
    this.setupConnection(conn);
  }

  setupConnection(conn) {
    this.conn = conn;

    conn.on('open', () => {
      this.connectedPeerId = conn.peer;
      this.startPingMonitor();
      this.callbacks.onConnected(conn.peer);
    });

    conn.on('data', (data) => {
      this.handleIncomingData(data);
    });

    conn.on('close', () => {
      this.stopPingMonitor();
      this.callbacks.onDisconnected();
    });

    conn.on('error', (err) => {
      console.error('[Connection Error]', err);
      this.callbacks.onError(err);
    });
  }

  startPingMonitor() {
    this.stopPingMonitor();
    this.pingInterval = setInterval(() => {
      if (this.conn && this.conn.open) {
        this.lastPingSent = performance.now();
        this.sendControlMessage({ type: 'sys-ping', t: this.lastPingSent });
      }
    }, 4000);
  }

  stopPingMonitor() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Sends control messages (metadata, handshakes, chat, pings)
   */
  sendControlMessage(msgObj) {
    if (!this.conn || !this.conn.open) return;
    try {
      this.conn.send(JSON.stringify(msgObj));
    } catch (e) {
      console.error('Failed to send control message:', e);
    }
  }

  /**
   * Process incoming data packet (text, JSON or binary chunk)
   */
  async handleIncomingData(data) {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        this.handleControlMessage(msg);
      } catch (e) {
        console.error('Invalid JSON received:', data);
      }
      return;
    }

    // Binary packet: incoming file chunk
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      const buffer = data instanceof ArrayBuffer ? data : data.buffer;
      await this.handleIncomingChunk(buffer);
    }
  }

  handleControlMessage(msg) {
    switch (msg.type) {
      case 'sys-ping':
        this.sendControlMessage({ type: 'sys-pong', t: msg.t });
        break;

      case 'sys-pong': {
        const rtt = Math.round(performance.now() - msg.t);
        this.callbacks.onPingUpdate(rtt);
        break;
      }

      case 'chat-message':
        this.callbacks.onChatMessage(msg);
        break;

      case 'file-header':
        this.initializeIncomingFile(msg);
        break;

      case 'file-cancel':
        this.handleTransferCancelled(msg.fileId);
        break;

      default:
        console.log('Unknown control message:', msg);
    }
  }

  /**
   * Initializes state for a new file about to be received
   */
  initializeIncomingFile(meta) {
    const fileId = meta.id;
    this.incomingFiles.set(fileId, {
      id: fileId,
      name: meta.name,
      size: meta.size,
      mimeType: meta.mimeType || 'application/octet-stream',
      chunksTotal: meta.chunksTotal,
      chunkSize: meta.chunkSize,
      expectedHash: meta.hash,
      isEncrypted: meta.isEncrypted,
      receivedBytes: 0,
      receivedChunks: 0,
      chunks: new Array(meta.chunksTotal),
      startTime: performance.now(),
      lastSpeedCheck: performance.now(),
      lastBytesCheck: 0,
      currentSpeed: 0
    });

    // Notify UI that a new file is incoming
    this.callbacks.onProgress({
      fileId,
      name: meta.name,
      transferred: 0,
      total: meta.size,
      percent: 0,
      speed: 0,
      state: 'receiving'
    });
  }

  /**
   * Process a binary chunk received over DataChannel
   * Protocol Header (16 bytes):
   * - 8 bytes: fileId hash/index
   * - 4 bytes: chunk index (uint32)
   * - 4 bytes: chunk payload length (uint32)
   * - Remaining bytes: Chunk payload (Encrypted or raw)
   */
  async handleIncomingChunk(buffer) {
    const view = new DataView(buffer);
    const chunkIndex = view.getUint32(8, false);
    const payloadLength = view.getUint32(12, false);

    // Extract fileId from the first 8 bytes string or header
    // We pass fileId in custom header or map by active file
    const fileIdBytes = new Uint8Array(buffer, 0, 8);
    const fileId = Array.from(fileIdBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const fileMeta = this.incomingFiles.get(fileId);
    if (!fileMeta) {
      console.warn('Received chunk for unknown file:', fileId);
      return;
    }

    const payloadBuffer = buffer.slice(16, 16 + payloadLength);
    let chunkData = payloadBuffer;

    // Decrypt if file is marked encrypted and key exists
    if (fileMeta.isEncrypted && this.encryptionKey) {
      try {
        chunkData = await window.cryptCore.decryptChunk(payloadBuffer, this.encryptionKey);
      } catch (err) {
        console.error('Decryption failed on chunk', chunkIndex, err);
        this.callbacks.onError(new Error(`Failed to decrypt file chunk ${chunkIndex}. Invalid password/key.`));
        return;
      }
    }

    fileMeta.chunks[chunkIndex] = chunkData;
    fileMeta.receivedBytes += chunkData.byteLength;
    fileMeta.receivedChunks++;

    // Calculate real-time transfer speed
    const now = performance.now();
    const timeDelta = (now - fileMeta.lastSpeedCheck) / 1000;
    if (timeDelta >= 0.3) {
      const bytesDelta = fileMeta.receivedBytes - fileMeta.lastBytesCheck;
      fileMeta.currentSpeed = bytesDelta / timeDelta;
      fileMeta.lastSpeedCheck = now;
      fileMeta.lastBytesCheck = fileMeta.receivedBytes;
    }

    const percent = Math.min(100, Math.round((fileMeta.receivedBytes / fileMeta.size) * 100));

    this.callbacks.onProgress({
      fileId: fileMeta.id,
      name: fileMeta.name,
      transferred: fileMeta.receivedBytes,
      total: fileMeta.size,
      percent: percent,
      speed: fileMeta.currentSpeed,
      state: 'receiving'
    });

    // Check completion
    if (fileMeta.receivedChunks === fileMeta.chunksTotal || fileMeta.receivedBytes >= fileMeta.size) {
      await this.finalizeIncomingFile(fileMeta);
    }
  }

  /**
   * Assemble chunks into Blob and verify checksum
   */
  async finalizeIncomingFile(fileMeta) {
    const finalBlob = new Blob(fileMeta.chunks, { type: fileMeta.mimeType });
    const calculatedHash = await window.cryptCore.calculateHash(finalBlob);

    const isVerified = !fileMeta.expectedHash || (fileMeta.expectedHash === calculatedHash);

    this.callbacks.onFileReceived({
      id: fileMeta.id,
      name: fileMeta.name,
      size: fileMeta.size,
      mimeType: fileMeta.mimeType,
      blob: finalBlob,
      hash: calculatedHash,
      isVerified: isVerified
    });

    this.incomingFiles.delete(fileMeta.id);
  }

  /**
   * Transmits a File / Blob with Flow Control & Backpressure
   */
  async sendFile(file, isEncrypted = true) {
    if (!this.conn || !this.conn.open) {
      throw new Error('No active peer connection. Connect to a peer first.');
    }

    const rawDataChannel = this.conn.dataChannel;
    if (rawDataChannel) {
      rawDataChannel.bufferedAmountLowThreshold = this.BUFFER_THRESHOLD;
    }

    const fileId = window.cryptCore.constructor.generateSecureToken(4); // 8 hex chars
    const chunksTotal = Math.ceil(file.size / this.CHUNK_SIZE);
    
    // Calculate SHA-256 integrity hash before sending
    const fileHash = await window.cryptCore.calculateHash(file);

    // 1. Send File Header / Metadata
    this.sendControlMessage({
      type: 'file-header',
      id: fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      chunksTotal: chunksTotal,
      chunkSize: this.CHUNK_SIZE,
      hash: fileHash,
      isEncrypted: isEncrypted && !!this.encryptionKey
    });

    let transferredBytes = 0;
    let lastSpeedCheck = performance.now();
    let lastBytesCheck = 0;
    let currentSpeed = 0;

    // Convert fileId (8 hex chars) into 8-byte array
    const fileIdBytes = new Uint8Array(8);
    for (let i = 0; i < 4; i++) {
      fileIdBytes[i] = parseInt(fileId.substr(i * 2, 2), 16) || 0;
    }

    // 2. Stream chunk by chunk with flow control
    for (let chunkIndex = 0; chunkIndex < chunksTotal; chunkIndex++) {
      const start = chunkIndex * this.CHUNK_SIZE;
      const end = Math.min(file.size, start + this.CHUNK_SIZE);
      const slice = file.slice(start, end);
      const sliceBuffer = await slice.arrayBuffer();

      let payload = sliceBuffer;

      // Encrypt chunk if enabled
      if (isEncrypted && this.encryptionKey) {
        payload = await window.cryptCore.encryptChunk(sliceBuffer, this.encryptionKey, chunkIndex);
      }

      // Format protocol packet: [8B fileId][4B chunkIndex][4B payloadLength][payload]
      const packet = new Uint8Array(16 + payload.byteLength);
      packet.set(fileIdBytes, 0);

      const packetView = new DataView(packet.buffer);
      packetView.setUint32(8, chunkIndex, false);
      packetView.setUint32(12, payload.byteLength, false);
      packet.set(new Uint8Array(payload), 16);

      // Backpressure check: wait if buffer exceeds threshold
      if (rawDataChannel && rawDataChannel.bufferedAmount > this.BUFFER_THRESHOLD) {
        await new Promise(resolve => {
          const listener = () => {
            rawDataChannel.removeEventListener('bufferedamountlow', listener);
            resolve();
          };
          rawDataChannel.addEventListener('bufferedamountlow', listener);
        });
      }

      // Transmit packet
      this.conn.send(packet.buffer);

      transferredBytes += sliceBuffer.byteLength;

      // Speed calculation
      const now = performance.now();
      const timeDelta = (now - lastSpeedCheck) / 1000;
      if (timeDelta >= 0.3) {
        const bytesDelta = transferredBytes - lastBytesCheck;
        currentSpeed = bytesDelta / timeDelta;
        lastSpeedCheck = now;
        lastBytesCheck = transferredBytes;
      }

      const percent = Math.min(100, Math.round((transferredBytes / file.size) * 100));

      this.callbacks.onProgress({
        fileId: fileId,
        name: file.name,
        transferred: transferredBytes,
        total: file.size,
        percent: percent,
        speed: currentSpeed,
        state: 'sending'
      });
    }

    // Complete notification for this file
    this.callbacks.onProgress({
      fileId: fileId,
      name: file.name,
      transferred: file.size,
      total: file.size,
      percent: 100,
      speed: 0,
      state: 'completed'
    });
  }

  /**
   * Sends an encrypted instant chat message
   */
  async sendChatMessage(text) {
    if (!this.conn || !this.conn.open) return;
    let payload = text;
    let encrypted = false;

    if (this.encryptionKey) {
      payload = await window.cryptCore.encryptText(text, this.encryptionKey);
      encrypted = true;
    }

    const msgObj = {
      type: 'chat-message',
      payload: payload,
      isEncrypted: encrypted,
      timestamp: Date.now(),
      sender: this.isHost ? 'Host' : 'Peer'
    };

    this.sendControlMessage(msgObj);
    return msgObj;
  }
}

// Global instance
window.webrtcManager = new WebRTCManager();
