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
      onPingUpdate: () => {},
      onRoomCollision: () => {}
    };

    // Ping interval for connection health & latency
    this.pingInterval = null;
    this.lastPingSent = 0;
  }

  setCallbacks(cbs) {
    this.callbacks = { ...this.callbacks, ...cbs };
  }

  getIceServers() {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.services.mozilla.com' }
    ];
  }

  /**
   * Initializes PeerJS client (client mode with random peer ID)
   */
  async initPeer() {
    if (this.peer && !this.peer.destroyed) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }

    return new Promise((resolve, reject) => {
      const peerConfig = {
        config: {
          iceServers: this.getIceServers()
        },
        debug: 1
      };

      try {
        this.peer = new Peer(peerConfig);

        this.peer.on('open', (id) => {
          console.log('[WebRTC Client] Registered peer ID:', id);
          this.peerId = id;
          this.callbacks.onReady(id);
          resolve(id);
        });

        this.peer.on('connection', (conn) => {
          this.handleIncomingConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.error('[WebRTC Peer Error]', err);
          this.handlePeerError(err);
        });

        this.peer.on('disconnected', () => {
          console.warn('[WebRTC Disconnected]');
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

    if (this.conn) {
      try { this.conn.close(); } catch (e) {}
      this.conn = null;
    }

    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }

    return new Promise((resolve, reject) => {
      const peerConfig = {
        config: {
          iceServers: this.getIceServers()
        },
        debug: 1
      };

      try {
        this.peer = new Peer(hostPeerId, peerConfig);

        this.peer.on('open', (id) => {
          console.log('[WebRTC Host] Room active on peer ID:', id);
          this.peerId = id;
          this.callbacks.onReady(id);
          resolve(id);
        });

        this.peer.on('connection', (conn) => {
          this.handleIncomingConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.error('[WebRTC Host Error]', err);
          if (err.type === 'unavailable-id') {
            console.warn(`[WebRTC] Room ID ${hostPeerId} collision. Triggering room regeneration.`);
            this.callbacks.onRoomCollision();
          } else {
            this.handlePeerError(err);
          }
          reject(err);
        });

        this.peer.on('disconnected', () => {
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
   * Join an existing room created by a host
   */
  async joinRoom(roomCode, key) {
    this.isHost = false;
    const cleanRoomCode = (roomCode || '').trim();
    this.roomCode = cleanRoomCode;
    this.encryptionKey = key;

    if (this.conn) {
      try { this.conn.close(); } catch (e) {}
      this.conn = null;
    }

    // Always create a fresh client peer with a unique client ID
    await this.initPeer();

    const hostPeerId = `cryptshare-${cleanRoomCode}`;
    this.callbacks.onConnecting(hostPeerId);
    console.log('[WebRTC] Connecting to host:', hostPeerId);

    const conn = this.peer.connect(hostPeerId, {
      reliable: true,
      serialization: 'binary'
    });

    let isConnected = false;
    const connectTimer = setTimeout(() => {
      if (!isConnected && (!this.conn || !this.conn.open)) {
        this.callbacks.onError(new Error(`Connection to room ${cleanRoomCode} timed out. Ensure the host is active and has this room open.`));
      }
    }, 12000);

    conn.on('open', () => {
      isConnected = true;
      clearTimeout(connectTimer);
    });

    this.setupConnection(conn);
  }

  handlePeerError(err) {
    let friendlyMessage = err.message || 'Connection error';
    if (err.type === 'peer-unavailable') {
      friendlyMessage = `Room ${this.roomCode || ''} not found. Please ensure the sender has created the room and is online.`;
    } else if (err.type === 'unavailable-id') {
      friendlyMessage = 'Room code is already active. Regenerating a new room code...';
    } else if (err.type === 'network') {
      friendlyMessage = 'Network connection error with WebRTC signaling server. Retrying...';
    } else if (err.type === 'server-error') {
      friendlyMessage = 'Signaling server temporarily busy. Please retry in a few moments.';
    }
    this.callbacks.onError(new Error(friendlyMessage));
  }

  /**
   * Connection listener & setup
   */
  handleIncomingConnection(conn) {
    console.log('[WebRTC] Incoming peer connection from:', conn.peer);
    if (this.conn) {
      try { this.conn.close(); } catch (e) {}
    }
    this.setupConnection(conn);
  }

  setupConnection(conn) {
    this.conn = conn;

    conn.on('open', () => {
      console.log('[WebRTC] DataChannel open with peer:', conn.peer);
      this.connectedPeerId = conn.peer;
      this.startPingMonitor();
      this.callbacks.onConnected(conn.peer);
    });

    conn.on('data', (data) => {
      this.handleIncomingData(data);
    });

    conn.on('close', () => {
      console.log('[WebRTC] DataChannel closed');
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
    }, 3000);
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
      let buffer = data;
      let byteOffset = 0;
      let byteLength = data.byteLength;

      if (ArrayBuffer.isView(data)) {
        buffer = data.buffer;
        byteOffset = data.byteOffset;
      }
      await this.handleIncomingChunk(buffer, byteOffset, byteLength);
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
    console.log('[WebRTC] Initializing incoming file:', meta.name, 'ID:', fileId, 'Size:', meta.size);
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
      currentSpeed: 0,
      isFinalized: false
    });

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
   */
  async handleIncomingChunk(buffer, byteOffset = 0, totalLength = 0) {
    if (totalLength < 16) {
      console.warn('Chunk packet smaller than 16-byte header:', totalLength);
      return;
    }

    const view = new DataView(buffer, byteOffset, 16);
    const fileId = view.getUint32(0, false);
    const chunkIndex = view.getUint32(4, false);
    const chunksTotal = view.getUint32(8, false);
    const payloadLength = view.getUint32(12, false);

    const fileMeta = this.incomingFiles.get(fileId);
    if (!fileMeta) {
      console.warn('Received chunk for unknown file ID:', fileId);
      return;
    }

    // Isolate payload bytes cleanly into a standalone ArrayBuffer
    const payloadSlice = new Uint8Array(buffer, byteOffset + 16, payloadLength);
    let chunkData = payloadSlice.slice().buffer;

    // Decrypt if file was marked encrypted
    if (fileMeta.isEncrypted && this.encryptionKey) {
      try {
        chunkData = await window.cryptCore.decryptChunk(chunkData, this.encryptionKey);
      } catch (err) {
        console.error('Decryption failed on chunk', chunkIndex, err);
        this.callbacks.onError(new Error(`Failed to decrypt chunk ${chunkIndex}. Password or key mismatch.`));
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
    if (!fileMeta.isFinalized && (fileMeta.receivedChunks >= fileMeta.chunksTotal || fileMeta.receivedBytes >= fileMeta.size)) {
      fileMeta.isFinalized = true;
      console.log('[WebRTC] File download complete, assembling blob:', fileMeta.name);
      await this.finalizeIncomingFile(fileMeta);
    }
  }

  /**
   * Assemble chunks into Blob and verify checksum
   */
  async finalizeIncomingFile(fileMeta) {
    try {
      const finalBlob = new Blob(fileMeta.chunks, { type: fileMeta.mimeType });
      const calculatedHash = await window.cryptCore.calculateHash(finalBlob);

      const isVerified = !fileMeta.expectedHash || (fileMeta.expectedHash === calculatedHash);
      console.log('[WebRTC] File assembled. Verified:', isVerified, 'Size:', finalBlob.size);

      this.callbacks.onFileReceived({
        id: fileMeta.id,
        name: fileMeta.name,
        size: fileMeta.size,
        mimeType: fileMeta.mimeType,
        blob: finalBlob,
        hash: calculatedHash,
        isVerified: isVerified
      });
    } catch (e) {
      console.error('Failed to finalize received file:', e);
      this.callbacks.onError(new Error(`Error saving file ${fileMeta.name}: ${e.message}`));
    } finally {
      this.incomingFiles.delete(fileMeta.id);
    }
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

    // 32-bit positive integer ID (matches DataView Uint32 exactly on both ends)
    const fileIdNumeric = Math.floor(Math.random() * 2000000000) + 1;
    const chunksTotal = Math.ceil(file.size / this.CHUNK_SIZE);
    
    // Calculate SHA-256 integrity hash before sending
    const fileHash = await window.cryptCore.calculateHash(file);

    // 1. Send File Header / Metadata
    this.sendControlMessage({
      type: 'file-header',
      id: fileIdNumeric,
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

      // Format protocol packet: [4B fileIdNumeric][4B chunkIndex][4B chunksTotal][4B payloadLength][payload]
      const packet = new Uint8Array(16 + payload.byteLength);
      const packetView = new DataView(packet.buffer);
      packetView.setUint32(0, fileIdNumeric, false);
      packetView.setUint32(4, chunkIndex, false);
      packetView.setUint32(8, chunksTotal, false);
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
        fileId: fileIdNumeric,
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
      fileId: fileIdNumeric,
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
