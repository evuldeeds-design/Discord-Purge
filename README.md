# Discord Purge: Privacy Enforcement Unit

[![Release](https://img.shields.io/github/v/release/evuldeeds-design/Discord-Purge?style=for-the-badge)](https://github.com/evuldeeds-design/Discord-Purge/releases)
[![License](https://img.shields.io/github/license/evuldeeds-design/Discord-Purge?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=for-the-badge)](https://github.com/evuldeeds-design/Discord-Purge/releases)

A high-performance, high-security desktop utility designed for deep Discord privacy management. Built with **Rust** and **Tauri** for maximum efficiency and unyielding security.

## 🚀 Key Protocols

-   **Official Gate (OAuth2)**: Secure, standard authorization for managing public guilds and profile data.
-   **Bypass Mode (User Token)**: High-level access for private buffers including DMs, group chats, and bulk relationship severance.
-   **Local Handshake (RPC)**: Zero-config rapid link using your active Discord desktop process.
-   **QR Signature**: Secure mobile-bridge login via Discord's remote auth gateway.

## 🛠 Features

-   **Bulk Message Deletion**: High-speed, rate-limit aware purging of messages across multiple channels and servers simultaneously.
-   **Connection Severance**: Rapidly leave multiple servers at once while maintaining a whitelist of essential nodes.
-   **Identity Purge**: Bulk relationship severance (friends/blocks) to clear your social footprint.
-   **Engine Tools**:
    -   **Audit Log Burial**: Cyclic node renames to flood and mask server audit history.
    -   **Webhook Ghosting**: Detection and removal of identity-linked integrations.
    -   **Stealth Wipes**: Automated profile masking (status, DMs, presence).

## 🔒 Security Architecture

-   **OS Vault Integration**: Sensitive tokens and application secrets are stored exclusively in the host OS keychain (Windows Credential Manager / macOS Keychain). No plain-text secrets reside on disk.
-   **Rate Limit Engine**: A granular, multi-threaded Rust dispatcher ensures your account remains safe with exponential backoff and speculative bucket tracking.
-   **Transparency**: A real-time **System Protocol Log** provides a deep technical trace of every handshake and API interaction.

## 📥 Installation

Download the latest production build for your platform from the [Releases](https://github.com/evuldeeds-design/Discord-Purge/releases) page.

### Windows
-   Download `.msi` or `.exe`
-   Install and launch `Discord Privacy Utility`

### macOS
-   Download `.dmg`
-   Drag to Applications

### Linux
-   Download `.AppImage` or `.deb`
-   `chmod +x` and execute

## 🏗 Developer Setup

```bash
# Clone the repository
git clone https://github.com/evuldeeds-design/Discord-Purge.git

# Install dependencies
npm install

# Launch in Development Mode (requires Rust installed)
npm run tauri dev
```

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

---
*Created for the Privacy Enforcement Unit.*
