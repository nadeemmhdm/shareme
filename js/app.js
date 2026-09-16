/**
 * CryptShare Main Application Controller
 * Coordinates WebRTC, Web Crypto, and UI interactions.
 */

class CryptShareApp {
  constructor() {
    this.selectedFiles = [];
    this.receivedFiles = [];
    this.currentRoomCode = null;
    this.encryptionSecret = null;
    this.derivedKey = null;
    this.useCustomPassword = false;
    this.customPassword = '';
    this.autoDownload = true;
    this.soundEnabled = true;
    this.isTransferring = false;
    this.currentTheme = localStorage.getItem('cs_theme') || 'dark';

    // DOM Elements cache
    this.dom = {};
  }

  async init() {
    this.cacheDom();
    this.applyTheme(this.currentTheme);
    this.bindEvents();
    this.setupWebRTCCallbacks();

    // Check if user came with a share link in the URL hash (#code=...&key=...)
    const isJoiningFromLink = await this.checkUrlHash();

    // Listen for hashchange if user navigates or pastes new share link
    window.addEventListener('hashchange', () => this.checkUrlHash());

    // Only auto-initialize as Host if NOT joining from a URL link!
    if (!isJoiningFromLink) {
      this.generateNewRoomSecret();
      await this.initializeHostSession();
    }
  }

  cacheDom() {
    this.dom = {
      // Top bar & status
      themeToggleBtn: document.getElementById('theme-toggle-btn'),
      connectionStatusBadge: document.getElementById('connection-status-badge'),
      connectionStatusText: document.getElementById('connection-status-text'),
      pingBadge: document.getElementById('ping-badge'),
      encryptionBadge: document.getElementById('encryption-badge'),
      
      // Host / Join panels
      tabHost: document.getElementById('tab-host'),
      tabJoin: document.getElementById('tab-join'),
      panelHost: document.getElementById('panel-host'),
      panelJoin: document.getElementById('panel-join'),
      
      // Room sharing controls
      displayRoomCode: document.getElementById('display-room-code'),
      copyCodeBtn: document.getElementById('copy-code-btn'),
      copyLinkBtn: document.getElementById('copy-link-btn'),
      showQrBtn: document.getElementById('show-qr-btn'),
      regenCodeBtn: document.getElementById('regen-code-btn'),

      // Join controls
      joinCodeInput: document.getElementById('join-code-input'),
      joinKeyInput: document.getElementById('join-key-input'),
      joinConnectBtn: document.getElementById('join-connect-btn'),

      // Password security
      passwordModal: document.getElementById('password-modal'),
      passwordToggleBtn: document.getElementById('password-toggle-btn'),
      passwordInput: document.getElementById('custom-password-input'),
      savePasswordBtn: document.getElementById('save-password-btn'),
      passwordStatusIndicator: document.getElementById('password-status-indicator'),

      // Dropzone & File Queue
      dropZone: document.getElementById('drop-zone'),
      fileInput: document.getElementById('file-input'),
      folderInput: document.getElementById('folder-input'),
      btnBrowseFiles: document.getElementById('btn-browse-files'),
      btnBrowseFolder: document.getElementById('btn-browse-folder'),
      fileQueueSection: document.getElementById('file-queue-section'),
      fileQueueList: document.getElementById('file-queue-list'),
      queueCountText: document.getElementById('queue-count-text'),
      queueTotalSizeText: document.getElementById('queue-total-size-text'),
      clearQueueBtn: document.getElementById('clear-queue-btn'),
      startTransferBtn: document.getElementById('start-transfer-btn'),

      // Active Transfer Speedometer & Stats
      activeTransferSection: document.getElementById('active-transfer-section'),
      transferFileName: document.getElementById('transfer-file-name'),
      transferSpeedText: document.getElementById('transfer-speed-text'),
      transferEtaText: document.getElementById('transfer-eta-text'),
      transferProgressBar: document.getElementById('transfer-progress-bar'),
      transferPercentText: document.getElementById('transfer-percent-text'),

      // Received Files Section
      receivedSection: document.getElementById('received-section'),
      receivedList: document.getElementById('received-list'),
      receivedCountText: document.getElementById('received-count-text'),
      downloadAllBtn: document.getElementById('download-all-btn'),

      // Modals
      qrModal: document.getElementById('qr-modal'),
      qrContainer: document.getElementById('qr-code-canvas-container'),
      qrRoomCodeText: document.getElementById('qr-room-code-text'),
      closeQrModalBtn: document.getElementById('close-qr-modal-btn'),
      copyQrLinkBtn: document.getElementById('copy-qr-link-btn'),

      settingsModal: document.getElementById('settings-modal'),
      settingsBtn: document.getElementById('settings-btn'),
      closeSettingsModalBtn: document.getElementById('close-settings-modal-btn'),
      autoDownloadCheckbox: document.getElementById('setting-auto-download'),
      soundCheckbox: document.getElementById('setting-sound'),

      // Chat drawer
      chatToggleBtn: document.getElementById('chat-toggle-btn'),
      chatDrawer: document.getElementById('chat-drawer'),
      closeChatBtn: document.getElementById('close-chat-btn'),
      chatMessagesList: document.getElementById('chat-messages-list'),
      chatInput: document.getElementById('chat-input'),
      sendChatBtn: document.getElementById('send-chat-btn'),
      chatBadge: document.getElementById('chat-unread-badge'),
      chatAttachBtn: document.getElementById('chat-attach-file-btn'),
      chatFileInput: document.getElementById('chat-file-input'),
      chatEmojiBar: document.getElementById('chat-emoji-bar'),
      toggleEmojiPickerBtn: document.getElementById('toggle-emoji-picker-btn'),
      fullEmojiPicker: document.getElementById('full-emoji-picker')
    };
  }

  generateNewRoomSecret() {
    this.currentRoomCode = CryptCore.generateRoomCode();
    this.encryptionSecret = CryptCore.generateSecureToken(16);
    this.dom.displayRoomCode.textContent = this.currentRoomCode;
    this.updateUrlHash();
    this.deriveActiveKey();
  }

  async deriveActiveKey() {
    const secretSource = this.useCustomPassword && this.customPassword 
      ? `${this.encryptionSecret}:${this.customPassword}`
      : this.encryptionSecret;

    if (secretSource) {
      this.derivedKey = await window.cryptCore.deriveKey(secretSource);
      window.webrtcManager.encryptionKey = this.derivedKey;
    }
  }

  updateUrlHash() {
    if (this.currentRoomCode && this.encryptionSecret) {
      const hash = `code=${encodeURIComponent(this.currentRoomCode)}&key=${encodeURIComponent(this.encryptionSecret)}`;
      window.history.replaceState(null, '', `#${hash}`);
    }
  }

  async checkUrlHash() {
    const hash = window.location.hash.substring(1);
    if (!hash) return false;

    const params = new URLSearchParams(hash);
    const code = params.get('code') || params.get('room');
    const key = params.get('key');

    if (code) {
      this.currentRoomCode = code;
      this.encryptionSecret = key || '';
      this.dom.joinCodeInput.value = code;
      if (key) this.dom.joinKeyInput.value = key;

      // Switch to join tab automatically
      this.switchTab('join', false);
      window.uiController.showToast(`Room code ${code} detected from link!`, 'info');

      // Auto-connect
      setTimeout(() => {
        this.handleJoinRoom();
      }, 600);
      return true;
    }
    return false;
  }

  bindEvents() {
    // Theme toggle
    this.dom.themeToggleBtn.addEventListener('click', () => {
      this.toggleTheme();
    });

    // Tab switching
    this.dom.tabHost.addEventListener('click', () => this.switchTab('host', true));
    this.dom.tabJoin.addEventListener('click', () => this.switchTab('join', true));

    // Host room controls
    this.dom.copyCodeBtn.addEventListener('click', () => {
      this.copyToClipboard(this.currentRoomCode, 'Room code copied to clipboard!');
    });

    this.dom.copyLinkBtn.addEventListener('click', () => {
      const shareUrl = this.getShareUrl();
      this.copyToClipboard(shareUrl, 'Secure Share Link copied! (Key is in zero-knowledge URL hash)');
    });

    this.dom.showQrBtn.addEventListener('click', () => {
      this.openQrModal();
    });

    this.dom.regenCodeBtn.addEventListener('click', () => {
      if (window.webrtcManager.conn && window.webrtcManager.conn.open) {
        if (!confirm('Regenerating room code will disconnect the current peer. Proceed?')) return;
      }
      this.generateNewRoomSecret();
      this.initializeHostSession();
      window.uiController.showToast('Generated new secure room code', 'info');
    });

    // Join room action
    this.dom.joinConnectBtn.addEventListener('click', () => {
      this.handleJoinRoom();
    });

    this.dom.joinCodeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleJoinRoom();
    });

    // Password security modal
    this.dom.passwordToggleBtn.addEventListener('click', () => {
      this.openPasswordModal();
    });

    this.dom.savePasswordBtn.addEventListener('click', async () => {
      const pwd = this.dom.passwordInput.value.trim();
      if (pwd) {
        this.useCustomPassword = true;
        this.customPassword = pwd;
        this.dom.passwordStatusIndicator.textContent = 'Password Active (PBKDF2)';
        this.dom.passwordStatusIndicator.classList.add('active');
        window.uiController.showToast('End-to-End Password Protection enabled!', 'success');
      } else {
        this.useCustomPassword = false;
        this.customPassword = '';
        this.dom.passwordStatusIndicator.textContent = 'No Password (URL Key Only)';
        this.dom.passwordStatusIndicator.classList.remove('active');
        window.uiController.showToast('Custom password removed', 'info');
      }
      await this.deriveActiveKey();
      this.closeModal(this.dom.passwordModal);
    });

    // Dropzone & File Pickers
    this.dom.btnBrowseFiles.addEventListener('click', () => this.dom.fileInput.click());
    this.dom.btnBrowseFolder.addEventListener('click', () => this.dom.folderInput.click());

    this.dom.fileInput.addEventListener('change', (e) => this.handleFilesSelected(e.target.files));
    this.dom.folderInput.addEventListener('change', (e) => this.handleFilesSelected(e.target.files));

    // Drag and Drop
    ['dragenter', 'dragover'].forEach(eventName => {
      this.dom.dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dom.dropZone.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      this.dom.dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dom.dropZone.classList.remove('drag-active');
      });
    });

    this.dom.dropZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        this.handleFilesSelected(files);
      }
    });

    // Queue actions
    this.dom.clearQueueBtn.addEventListener('click', () => {
      this.selectedFiles = [];
      this.renderFileQueue();
    });

    this.dom.startTransferBtn.addEventListener('click', () => {
      this.startSendingFiles();
    });

    // Received files batch download
    this.dom.downloadAllBtn.addEventListener('click', () => {
      this.downloadAllReceived();
    });

    // Modals
    this.dom.closeQrModalBtn.addEventListener('click', () => this.closeModal(this.dom.qrModal));
    this.dom.copyQrLinkBtn.addEventListener('click', () => {
      this.copyToClipboard(this.getShareUrl(), 'Share link copied!');
    });

    this.dom.settingsBtn.addEventListener('click', () => this.openSettingsModal());
    this.dom.closeSettingsModalBtn.addEventListener('click', () => this.closeModal(this.dom.settingsModal));

    this.dom.autoDownloadCheckbox.addEventListener('change', (e) => {
      this.autoDownload = e.target.checked;
    });

    this.dom.soundCheckbox.addEventListener('change', (e) => {
      this.soundEnabled = e.target.checked;
    });

    // Chat Drawer Events
    this.dom.chatToggleBtn.addEventListener('click', () => this.toggleChatDrawer());
    this.dom.closeChatBtn.addEventListener('click', () => this.closeChatDrawer());
    this.dom.sendChatBtn.addEventListener('click', () => this.sendChatMessage());
    this.dom.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChatMessage();
    });

    // Chat Attachment Button
    if (this.dom.chatAttachBtn && this.dom.chatFileInput) {
      this.dom.chatAttachBtn.addEventListener('click', () => {
        this.dom.chatFileInput.click();
      });

      this.dom.chatFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          await this.sendChatFile(file);
          this.dom.chatFileInput.value = '';
        }
      });
    }

    // Emoji Support in Chat
    if (this.dom.toggleEmojiPickerBtn && this.dom.fullEmojiPicker) {
      this.dom.toggleEmojiPickerBtn.addEventListener('click', () => {
        this.dom.fullEmojiPicker.classList.toggle('hidden');
      });
    }

    // Insert Emoji Click Handlers
    document.querySelectorAll('.emoji-btn, .emoji-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const emoji = e.target.getAttribute('data-emoji') || e.target.textContent.trim();
        if (emoji) {
          this.insertEmoji(emoji);
        }
      });
    });

    // Close modals when clicking backdrop
    [this.dom.qrModal, this.dom.passwordModal, this.dom.settingsModal].forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal);
      });
    });
  }

  insertEmoji(emoji) {
    const input = this.dom.chatInput;
    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
    input.focus();
    input.selectionStart = input.selectionEnd = start + emoji.length;
    this.playSound('click');
  }

  setupWebRTCCallbacks() {
    window.webrtcManager.setCallbacks({
      onReady: (peerId) => {
        console.log('[WebRTC] Signaling Broker Ready. Peer ID:', peerId);
        if (window.webrtcManager.isHost) {
          this.updateConnectionBadge('waiting', 'Ready for Peer');
        }
      },
      onConnecting: (targetPeerId) => {
        this.updateConnectionBadge('connecting', 'Connecting...');
      },
      onConnected: (peerId) => {
        this.updateConnectionBadge('connected', 'Encrypted Peer Connected');
        this.playSound('connect');
        window.uiController.showToast('Secure WebRTC DataChannel Established!', 'success');
        
        // Auto start transfer if files already queued
        if (this.selectedFiles.length > 0 && !this.isTransferring) {
          setTimeout(() => this.startSendingFiles(), 600);
        }
      },
      onSessionHandshake: async (msg) => {
        console.log('[WebRTC] Session handshake received from host');
        // Always synchronize secret with host so AES-256 keys match 100%
        if (msg.secret) {
          this.encryptionSecret = msg.secret;
          await this.deriveActiveKey();
          console.log('[WebRTC] Encryption key synchronized with host');
        }
        if (msg.hasPassword && !this.customPassword) {
          window.uiController.showToast('This room is password protected. Click "Password Protect" to enter password.', 'warning');
        }
      },
      onDisconnected: () => {
        this.updateConnectionBadge('disconnected', 'Disconnected');
        this.dom.pingBadge.textContent = '-- ms';
        window.uiController.showToast('Peer disconnected.', 'warning');
      },
      onPingUpdate: (rtt) => {
        this.dom.pingBadge.textContent = `${rtt} ms`;
      },
      onProgress: (info) => {
        this.handleTransferProgress(info);
      },
      onFileReceived: (fileMeta) => {
        this.handleFileReceived(fileMeta);
      },
      onChatMessage: (msg) => {
        this.handleIncomingChatMessage(msg);
      },
      onError: (err) => {
        console.error('WebRTC error event:', err);
        window.uiController.showToast(err.message || 'Connection error', 'error');
        this.updateConnectionBadge('disconnected', 'Connection Error');
      },
      onRoomCollision: () => {
        this.generateNewRoomSecret();
        this.initializeHostSession();
      }
    });
  }

  async initializeHostSession() {
    if (!this.currentRoomCode) {
      this.generateNewRoomSecret();
    }
    await this.deriveActiveKey();
    try {
      this.updateConnectionBadge('connecting', 'Creating Room...');
      await window.webrtcManager.createRoom(
        this.currentRoomCode,
        this.derivedKey,
        this.encryptionSecret,
        this.useCustomPassword
      );
      this.updateConnectionBadge('waiting', 'Ready for Peer');
    } catch (e) {
      console.warn('Could not initialize room:', e);
      this.updateConnectionBadge('disconnected', 'Signaling Unavailable');
    }
  }

  async handleJoinRoom() {
    const roomCode = this.dom.joinCodeInput.value.trim();
    if (!roomCode || roomCode.length < 4) {
      window.uiController.showToast('Please enter a valid 6-digit room code', 'error');
      return;
    }

    this.currentRoomCode = roomCode;
    const key = this.dom.joinKeyInput.value.trim();
    if (key) {
      this.encryptionSecret = key;
    }

    await this.deriveActiveKey();
    this.updateConnectionBadge('connecting', 'Locating Peer...');
    
    try {
      await window.webrtcManager.joinRoom(this.currentRoomCode, this.derivedKey);
    } catch (e) {
      window.uiController.showToast(e.message || 'Failed to connect to room', 'error');
      this.updateConnectionBadge('disconnected', 'Connection Failed');
    }
  }

  updateConnectionBadge(state, label) {
    const badge = this.dom.connectionStatusBadge;
    const text = this.dom.connectionStatusText;
    badge.className = `status-badge status-${state}`;
    text.textContent = label;
  }

  switchTab(tab, triggerInit = true) {
    if (tab === 'host') {
      this.dom.tabHost.classList.add('active');
      this.dom.tabJoin.classList.remove('active');
      this.dom.panelHost.classList.remove('hidden');
      this.dom.panelJoin.classList.add('hidden');
      if (triggerInit && (!window.webrtcManager.isHost || !window.webrtcManager.peer || window.webrtcManager.peer.destroyed)) {
        this.initializeHostSession();
      }
    } else {
      this.dom.tabJoin.classList.add('active');
      this.dom.tabHost.classList.remove('active');
      this.dom.panelJoin.classList.remove('hidden');
      this.dom.panelHost.classList.add('hidden');
      if (triggerInit) {
        this.updateConnectionBadge('waiting', 'Enter Room Code');
      }
    }
  }

  handleFilesSelected(fileList) {
    if (!fileList || fileList.length === 0) return;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!this.selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
        this.selectedFiles.push(file);
      }
    }

    this.playSound('click');
    this.renderFileQueue();
    window.uiController.showToast(`Added ${fileList.length} file(s) to queue`, 'info');
  }

  renderFileQueue() {
    const list = this.dom.fileQueueList;
    list.innerHTML = '';

    if (this.selectedFiles.length === 0) {
      this.dom.fileQueueSection.classList.add('hidden');
      return;
    }

    this.dom.fileQueueSection.classList.remove('hidden');

    let totalBytes = 0;
    this.selectedFiles.forEach((file, index) => {
      totalBytes += file.size;
      const iconClass = UIController.getFileIconClass(file.name, file.type);
      const row = document.createElement('div');
      row.className = 'queue-item animate-fade-in';
      row.innerHTML = `
        <div class="queue-item-left">
          <i class="${iconClass} queue-icon"></i>
          <div class="queue-meta">
            <span class="queue-name" title="${UIController.prototype.escapeHtml(file.name)}">${UIController.prototype.escapeHtml(file.name)}</span>
            <span class="queue-size">${UIController.formatBytes(file.size)}</span>
          </div>
        </div>
        <div class="queue-item-right">
          <span class="queue-status-badge" id="queue-badge-${index}">Ready</span>
          <button class="btn-icon queue-remove-btn" title="Remove file" data-index="${index}">
            <i class="bx bx-x"></i>
          </button>
        </div>
      `;

      row.querySelector('.queue-remove-btn').addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-index'));
        this.selectedFiles.splice(idx, 1);
        this.renderFileQueue();
      });

      list.appendChild(row);
    });

    this.dom.queueCountText.textContent = `${this.selectedFiles.length} file${this.selectedFiles.length > 1 ? 's' : ''}`;
    this.dom.queueTotalSizeText.textContent = `Total: ${UIController.formatBytes(totalBytes)}`;
  }

  async startSendingFiles() {
    if (this.selectedFiles.length === 0) {
      window.uiController.showToast('Please select files to send', 'warning');
      return;
    }

    if (!window.webrtcManager.conn || !window.webrtcManager.conn.open) {
      window.uiController.showToast('Peer not connected yet! Share your Room Code or Link first.', 'warning');
      return;
    }

    if (this.isTransferring) return;
    this.isTransferring = true;
    this.dom.startTransferBtn.disabled = true;
    this.dom.activeTransferSection.classList.remove('hidden');

    for (let i = 0; i < this.selectedFiles.length; i++) {
      const file = this.selectedFiles[i];
      const badge = document.getElementById(`queue-badge-${i}`);
      if (badge) {
        badge.className = 'queue-status-badge status-sending';
        badge.textContent = 'Encrypting & Sending';
      }

      this.dom.transferFileName.textContent = file.name;

      try {
        await window.webrtcManager.sendFile(file, true, false);
        if (badge) {
          badge.className = 'queue-status-badge status-completed';
          badge.textContent = 'Sent';
        }
      } catch (err) {
        console.error('Error sending file:', err);
        if (badge) {
          badge.className = 'queue-status-badge status-error';
          badge.textContent = 'Failed';
        }
        window.uiController.showToast(`Error sending ${file.name}: ${err.message}`, 'error');
      }
    }

    this.isTransferring = false;
    this.dom.startTransferBtn.disabled = false;
    this.playSound('complete');
    window.uiController.showToast('All files sent successfully!', 'success');
  }

  handleTransferProgress(info) {
    this.dom.activeTransferSection.classList.remove('hidden');
    this.dom.transferFileName.textContent = `${info.name} (${info.state})`;
    this.dom.transferProgressBar.style.width = `${info.percent}%`;
    this.dom.transferPercentText.textContent = `${info.percent}%`;

    this.dom.transferSpeedText.textContent = UIController.formatSpeed(info.speed);
    const remainingBytes = info.total - info.transferred;
    this.dom.transferEtaText.textContent = `ETA: ${UIController.formatETA(remainingBytes, info.speed)}`;

    if (info.percent >= 100) {
      setTimeout(() => {
        if (!this.isTransferring) {
          this.dom.activeTransferSection.classList.add('hidden');
        }
      }, 1500);
    }
  }

  handleFileReceived(fileMeta) {
    // Generate persistent Blob URL that remains valid for the session
    if (!fileMeta.objectUrl && fileMeta.blob) {
      fileMeta.objectUrl = URL.createObjectURL(fileMeta.blob);
    }

    const type = (fileMeta.mimeType || '').toLowerCase();
    fileMeta.canPreview = type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/') || type.includes('pdf') || type.includes('text');

    this.receivedFiles.push(fileMeta);
    this.renderReceivedFiles();
    this.playSound('complete');
    window.uiController.showToast(`Received "${fileMeta.name}" (${UIController.formatBytes(fileMeta.size)}) - Click Download to save!`, 'success', 6000);

    // If file was sent inside chat, append file card to chat thread
    if (fileMeta.inChat) {
      this.appendChatFileCard({
        name: fileMeta.name,
        size: fileMeta.size,
        mimeType: fileMeta.mimeType,
        blob: fileMeta.blob,
        blobUrl: fileMeta.objectUrl,
        isSelf: false,
        sender: 'Peer',
        timestamp: Date.now()
      });

      if (!this.dom.chatDrawer.classList.contains('open')) {
        this.dom.chatBadge.classList.remove('hidden');
        const count = (parseInt(this.dom.chatBadge.textContent) || 0) + 1;
        this.dom.chatBadge.textContent = count;
      }
    } else {
      // Smoothly scroll down to received files section
      setTimeout(() => {
        this.dom.receivedSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 200);
    }

    // Auto download if enabled
    if (this.autoDownload) {
      this.triggerDownload(fileMeta, true);
    }
  }

  renderReceivedFiles() {
    this.dom.receivedSection.classList.remove('hidden');
    const list = this.dom.receivedList;
    list.innerHTML = '';

    this.receivedFiles.forEach((fileMeta, index) => {
      if (!fileMeta.objectUrl && fileMeta.blob) {
        fileMeta.objectUrl = URL.createObjectURL(fileMeta.blob);
      }

      const iconClass = UIController.getFileIconClass(fileMeta.name, fileMeta.mimeType);
      const card = document.createElement('div');
      card.className = 'received-item animate-fade-in';
      card.innerHTML = `
        <div class="received-left">
          <i class="${iconClass} queue-icon"></i>
          <div class="received-info">
            <span class="received-name">${UIController.prototype.escapeHtml(fileMeta.name)}</span>
            <div class="received-badges">
              <span class="file-size-badge">${UIController.formatBytes(fileMeta.size)}</span>
              ${fileMeta.isVerified ? '<span class="verified-badge" title="SHA-256 Checksum Verified"><i class="bx bx-check-shield"></i> Verified Authentic</span>' : '<span class="unverified-badge">Checksum Error</span>'}
            </div>
          </div>
        </div>
        <div class="received-right" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          ${fileMeta.canPreview ? `
            <a href="${fileMeta.objectUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="Preview / Open in new tab">
              <i class="bx bx-show"></i> Preview
            </a>
          ` : ''}
          <a href="${fileMeta.objectUrl}" download="${UIController.prototype.escapeHtml(fileMeta.name)}" class="btn btn-primary btn-sm download-link-btn" data-index="${index}" title="Save ${UIController.prototype.escapeHtml(fileMeta.name)} to your device">
            <i class="bx bx-download"></i> Download
          </a>
        </div>
      `;

      card.querySelector('.download-link-btn').addEventListener('click', () => {
        this.playSound('complete');
        window.uiController.showToast(`Downloading "${fileMeta.name}"... Check your downloads.`, 'info');
      });

      list.appendChild(card);
    });

    this.dom.receivedCountText.textContent = `${this.receivedFiles.length} file${this.receivedFiles.length > 1 ? 's' : ''} received`;
  }

  async triggerDownload(fileMeta, isAuto = false) {
    if (!fileMeta || !fileMeta.blob) return;

    if (!fileMeta.objectUrl) {
      fileMeta.objectUrl = URL.createObjectURL(fileMeta.blob);
    }

    try {
      const a = document.createElement('a');
      a.href = fileMeta.objectUrl;
      a.download = fileMeta.name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
      }, 2000);

      if (!isAuto) {
        window.uiController.showToast(`Downloading "${fileMeta.name}"...`, 'success');
      }
    } catch (e) {
      console.warn('Download trigger notice:', e);
      if (isAuto) {
        window.uiController.showToast(`File "${fileMeta.name}" ready! Click "Download" to save.`, 'info', 6000);
      }
    }
  }

  downloadAllReceived() {
    this.receivedFiles.forEach((file, index) => {
      setTimeout(() => this.triggerDownload(file, false), index * 500);
    });
  }

  // Encrypted Chat Feature
  toggleChatDrawer() {
    const isOpen = this.dom.chatDrawer.classList.contains('open');
    if (isOpen) {
      this.closeChatDrawer();
    } else {
      this.dom.chatDrawer.classList.add('open');
      this.dom.chatBadge.classList.add('hidden');
      this.dom.chatBadge.textContent = '0';
      this.dom.chatInput.focus();
    }
  }

  closeChatDrawer() {
    this.dom.chatDrawer.classList.remove('open');
  }

  async sendChatMessage() {
    const text = this.dom.chatInput.value.trim();
    if (!text) return;

    if (!window.webrtcManager.conn || !window.webrtcManager.conn.open) {
      window.uiController.showToast('Cannot send message: Peer is not connected', 'warning');
      return;
    }

    const msg = await window.webrtcManager.sendChatMessage(text);
    this.appendChatMessage({
      text: text,
      isSelf: true,
      timestamp: Date.now(),
      sender: 'You'
    });

    this.dom.chatInput.value = '';
    this.playSound('click');
  }

  async sendChatFile(file) {
    if (!window.webrtcManager.conn || !window.webrtcManager.conn.open) {
      window.uiController.showToast('Peer not connected yet!', 'warning');
      return;
    }

    const blobUrl = URL.createObjectURL(file);
    this.appendChatFileCard({
      name: file.name,
      size: file.size,
      mimeType: file.type,
      blob: file,
      blobUrl: blobUrl,
      isSelf: true,
      sender: 'You',
      timestamp: Date.now()
    });

    try {
      window.uiController.showToast(`Sending ${file.name} in chat...`, 'info');
      await window.webrtcManager.sendFile(file, true, true);
      this.playSound('complete');
    } catch (e) {
      console.error('Chat file send error:', e);
      window.uiController.showToast(`Failed to send file in chat: ${e.message}`, 'error');
    }
  }

  appendChatFileCard(item) {
    const list = this.dom.chatMessagesList;
    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${item.isSelf ? 'chat-msg-self' : 'chat-msg-peer'} animate-fade-in`;

    const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isImg = item.mimeType && item.mimeType.startsWith('image/');
    const iconClass = UIController.getFileIconClass(item.name, item.mimeType);

    msgEl.innerHTML = `
      <div class="chat-bubble chat-file-card">
        <span class="chat-sender">${item.sender}</span>
        <div class="chat-file-inner">
          ${isImg ? `<img src="${item.blobUrl}" class="chat-img-preview" alt="Image preview">` : ''}
          <div class="chat-file-info">
            <i class="${iconClass}"></i>
            <div>
              <div class="chat-file-name" title="${UIController.prototype.escapeHtml(item.name)}">${UIController.prototype.escapeHtml(item.name)}</div>
              <div class="chat-file-size">${UIController.formatBytes(item.size)}</div>
            </div>
          </div>
          <a href="${item.blobUrl}" download="${UIController.prototype.escapeHtml(item.name)}" class="btn btn-secondary btn-sm chat-download-btn" style="width: 100%; margin-top: 0.35rem; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; gap: 0.35rem;">
            <i class="bx bx-download"></i> Download (${UIController.formatBytes(item.size)})
          </a>
        </div>
        <span class="chat-time">${timeStr} <i class="bx bxs-lock-alt" title="E2EE Encrypted"></i></span>
      </div>
    `;

    msgEl.querySelector('.chat-download-btn').addEventListener('click', () => {
      this.playSound('complete');
      window.uiController.showToast(`Downloading "${item.name}"... Check downloads.`, 'info');
    });

    list.appendChild(msgEl);
    list.scrollTop = list.scrollHeight;
  }

  async handleIncomingChatMessage(msg) {
    let plainText = msg.payload;
    if (msg.isEncrypted && this.derivedKey) {
      try {
        plainText = await window.cryptCore.decryptText(msg.payload, this.derivedKey);
      } catch (e) {
        plainText = '[Encrypted Message: Decryption Failed]';
      }
    }

    this.appendChatMessage({
      text: plainText,
      isSelf: false,
      timestamp: msg.timestamp,
      sender: msg.sender || 'Peer'
    });

    this.playSound('message');

    if (!this.dom.chatDrawer.classList.contains('open')) {
      this.dom.chatBadge.classList.remove('hidden');
      const count = (parseInt(this.dom.chatBadge.textContent) || 0) + 1;
      this.dom.chatBadge.textContent = count;
      window.uiController.showToast(`New message from peer: "${plainText.substring(0, 24)}..."`, 'info');
    }
  }

  appendChatMessage(item) {
    const list = this.dom.chatMessagesList;
    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${item.isSelf ? 'chat-msg-self' : 'chat-msg-peer'} animate-fade-in`;

    const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgEl.innerHTML = `
      <div class="chat-bubble">
        <span class="chat-sender">${item.sender}</span>
        <p class="chat-text">${UIController.prototype.escapeHtml(item.text)}</p>
        <span class="chat-time">${timeStr} <i class="bx bxs-lock-alt" title="E2EE Encrypted"></i></span>
      </div>
    `;

    list.appendChild(msgEl);
    list.scrollTop = list.scrollHeight;
  }

  // QR Code Modal
  openQrModal() {
    const url = this.getShareUrl();
    this.dom.qrRoomCodeText.textContent = `Room Code: ${this.currentRoomCode}`;
    new QRCode(this.dom.qrContainer, {
      text: url,
      width: 220,
      height: 220,
      colorDark: '#0ea5e9',
      colorLight: '#090d16'
    });
    this.openModal(this.dom.qrModal);
  }

  // Password Modal
  openPasswordModal() {
    this.openModal(this.dom.passwordModal);
    this.dom.passwordInput.focus();
  }

  // Settings Modal
  openSettingsModal() {
    this.dom.autoDownloadCheckbox.checked = this.autoDownload;
    this.dom.soundCheckbox.checked = this.soundEnabled;
    this.openModal(this.dom.settingsModal);
  }

  openModal(modalEl) {
    modalEl.classList.remove('hidden');
    modalEl.classList.add('flex');
  }

  closeModal(modalEl) {
    modalEl.classList.add('hidden');
    modalEl.classList.remove('flex');
  }

  getShareUrl() {
    const base = window.location.origin + window.location.pathname;
    return `${base}#code=${encodeURIComponent(this.currentRoomCode)}&key=${encodeURIComponent(this.encryptionSecret)}`;
  }

  copyToClipboard(text, successMsg) {
    navigator.clipboard.writeText(text).then(() => {
      this.playSound('click');
      window.uiController.showToast(successMsg, 'success');
    }).catch(() => {
      window.uiController.showToast('Failed to copy. Please copy manually.', 'error');
    });
  }

  toggleTheme() {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('cs_theme', this.currentTheme);
    this.applyTheme(this.currentTheme);
  }

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = this.dom.themeToggleBtn.querySelector('i');
    if (icon) {
      icon.className = theme === 'dark' ? 'bx bx-sun' : 'bx bx-moon';
    }
  }

  playSound(type) {
    if (this.soundEnabled) {
      window.uiController.playSound(type);
    }
  }
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new CryptShareApp();
  window.app.init();
});
