# 🛡️ CryptShare — Ultra-Fast Zero-Knowledge P2P File Transfer

> **100% Free, Open Source, and Ready to Host on GitHub Pages.**  
> Direct device-to-device file transfers powered by **WebRTC DataChannels** and **AES-256-GCM** client-side encryption.

---

## ⚡ Key Features

- **🚀 Direct P2P WebRTC Transfer**: Files stream directly from sender to receiver without ever hitting an intermediary storage server or cloud bucket.
- **🔐 Double-Layer Security & Privacy**:
  - Transport layer: Native WebRTC DTLS/SCTP encryption.
  - Application layer: Client-side **AES-256-GCM** chunk encryption via the native Web Crypto API.
  - Optional Passphrase: Key derivation using **PBKDF2** (100,000 rounds, SHA-256).
- **♾️ Unlimited File Size**: Built-in streaming backpressure flow control (`bufferedAmountLowThreshold`) prevents memory leaks on multi-gigabyte transfers.
- **🔗 Zero-Knowledge URLs**: Encryption keys are stored in the URL **hash fragment** (`#code=...&key=...`), which web browsers never transmit over HTTP requests to signaling servers or hosts.
- **📱 Instant Cross-Device QR Pairing**: Connect a phone to a desktop in seconds by scanning an offline-generated QR code canvas.
- **💬 Encrypted Real-Time Chat & Clipboard**: Exchange passwords, text snippets, and notes securely between peers during transfers.
- **✔️ Streaming SHA-256 Integrity Check**: Calculates and verifies cryptographic checksums to ensure received files are 100% authentic and uncorrupted.
- **🎨 Cyber-Glass Aesthetics**: Dark mode default, responsive across mobile, tablet, and desktop, subtle Web Audio API chimes, and Boxicons icon system.
- **🌐 100% GitHub Pages Ready**: Pure static client-side application requiring zero build steps or server infrastructure.

---

## 🚀 How to Host on GitHub Pages (In 1 Minute)

1. **Fork or Clone this repository**:
   ```bash
   git clone https://github.com/your-username/shareme.git
   cd shareme
   ```

2. **Push to your GitHub repository**:
   ```bash
   git add .
   git commit -m "Deploy CryptShare"
   git push origin main
   ```

3. **Enable GitHub Pages**:
   - Go to your repository on GitHub.
   - Click **Settings** > **Pages** (in the left sidebar).
   - Under **Build and deployment** > **Source**, select **Deploy from a branch**.
   - Select Branch: `main`, Folder: `/ (root)`.
   - Click **Save**.
   
4. **Done!** Your site will be live at `https://<your-username>.github.io/shareme/`.

---

## 💻 Running Locally

Since CryptShare is a static web app with ES6 modules, you can serve it with any local static HTTP server:

### Option 1: Using Python
```bash
# Python 3
python -m http.server 8080
```
Then visit `http://localhost:8080` in your browser.

### Option 2: Using Node / npx
```bash
npx -y serve .
```

### Option 3: VS Code Live Server
Right-click `index.html` and click **"Open with Live Server"**.

---

## 🔒 Security Architecture

```
[ Sender Browser ] ═════════ WebRTC DataChannel (DTLS / SCTP) ═════════> [ Receiver Browser ]
       ║                                                                          ║
       ╠══ AES-256-GCM Chunk Encryption                            AES-256-GCM Decryption ══╣
       ╠══ PBKDF2 Key Derivation (100k rounds)                  PBKDF2 Key Derivation ══╣
       ╚══ SHA-256 Streaming Checksum Check                     SHA-256 Integrity Verification ╝
```

- **Zero Cloud Storage**: No file data, chunk, or metadata is ever saved on any server or database.
- **Signaling Only**: The signaling broker (PeerJS cloud or your own STUN/TURN server) only exchanges SDP session descriptions to establish the initial peer connection, and never sees your files or encryption keys.

---

## 📁 Project Structure

```
shareme/
├── index.html              # Main responsive application shell
├── 404.html                # GitHub Pages single-page redirect handler
├── manifest.json           # Progressive Web App (PWA) manifest
├── robots.txt              # SEO crawler instructions
├── sitemap.xml             # Search engine sitemap
├── README.md               # Open source documentation & deployment guide
├── assets/
│   └── icon.svg            # Vector app logo and favicon
├── css/
│   ├── style.css           # Design tokens, glassmorphism, animations
│   └── responsive.css      # Mobile, tablet, and desktop breakpoints
└── js/
    ├── app.js              # Application coordinator & state machine
    ├── webrtc.js           # WebRTC DataChannel engine & flow control
    ├── crypto.js           # Web Crypto API (AES-256-GCM, PBKDF2, SHA-256)
    ├── ui.js               # Audio synthesis, toasts, DOM helpers
    └── qrcode.min.js       # Offline QR code canvas renderer
```

---

## 📄 License

This project is free, open-source software licensed under the **[MIT License](LICENSE)**.
