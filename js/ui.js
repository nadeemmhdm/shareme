/**
 * CryptShare UI & Audio Feedback Controller
 */

class UIController {
  constructor() {
    this.audioCtx = null;
    this.initSoundSystem();
  }

  /**
   * Zero-dependency Web Audio API synthesizer for crisp modern UI feedback
   */
  initSoundSystem() {
    const initAudio = () => {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.audioCtx = new AudioContext();
        }
      }
      document.removeEventListener('click', initAudio);
      document.removeEventListener('keydown', initAudio);
    };
    document.addEventListener('click', initAudio, { once: true });
    document.addEventListener('keydown', initAudio, { once: true });
  }

  playSound(type = 'chime') {
    if (!this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;

      if (type === 'connect') {
        // High ascending double-tone
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'complete') {
        // Joyful chord completion
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.start(now);
        osc.stop(now + 0.45);
      } else if (type === 'click') {
        // Subtle haptic pop
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.05);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'message') {
        // Soft bubble chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      }
    } catch (e) {
      // Ignore audio context autoplay restrictions
    }
  }

  /**
   * Displays modern toast notifications
   */
  showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} animate-slide-up`;

    let iconClass = 'bx bx-info-circle';
    if (type === 'success') iconClass = 'bx bx-check-circle';
    if (type === 'error') iconClass = 'bx bx-error-circle';
    if (type === 'warning') iconClass = 'bx bx-shield-quarter';

    toast.innerHTML = `
      <i class="${iconClass}"></i>
      <span class="toast-text">${this.escapeHtml(message)}</span>
      <button class="toast-close" aria-label="Dismiss">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    });

    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
  }

  /**
   * Helper to format bytes to human readable form
   */
  static formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  /**
   * Helper to format speed
   */
  static formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
    return `${UIController.formatBytes(bytesPerSec)}/s`;
  }

  /**
   * Helper to format remaining time
   */
  static formatETA(remainingBytes, speed) {
    if (!speed || speed <= 0 || remainingBytes <= 0) return '--:--';
    const seconds = Math.ceil(remainingBytes / speed);
    if (seconds >= 3600) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return `${h}h ${m}m`;
    }
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Get File Icon based on mime or extension
   */
  static getFileIconClass(fileName, mimeType = '') {
    const ext = fileName.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) || mimeType.startsWith('image/')) {
      return 'bx bxs-file-image';
    }
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext) || mimeType.startsWith('video/')) {
      return 'bx bxs-file-video';
    }
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext) || mimeType.startsWith('audio/')) {
      return 'bx bxs-music';
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      return 'bx bxs-file-archive';
    }
    if (['pdf'].includes(ext) || mimeType.includes('pdf')) {
      return 'bx bxs-file-pdf';
    }
    if (['js', 'html', 'css', 'json', 'py', 'java', 'cpp', 'rs', 'ts'].includes(ext)) {
      return 'bx bx-code-alt';
    }
    if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) {
      return 'bx bxs-file-doc';
    }
    return 'bx bxs-file-blank';
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

window.uiController = new UIController();
