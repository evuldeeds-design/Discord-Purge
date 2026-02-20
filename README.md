<div align="center">
  <img src="https://raw.githubusercontent.com/evuldeeds-design/Discord-Purge/main/src-tauri/icons/icon.png" alt="Discord Purge Logo" width="150">
  <h1 align="center">Discord Purge</h1>
  <p align="center">
    The ultimate tool for taking control of your Discord data.
    <br />
    <a href="https://github.com/evuldeeds-design/Discord-Purge/releases">View Releases</a>
    ·
    <a href="https://github.com/evuldeeds-design/Discord-Purge/issues">Report Bug</a>
    ·
    <a href="https://github.com/evuldeeds-design/Discord-Purge/issues">Request Feature</a>
  </p>
</div>

<div align="center">

[![Build Status](https://github.com/evuldeeds-design/Discord-Purge/actions/workflows/main.yml/badge.svg)](https://github.com/evuldeeds-design/Discord-Purge/actions/workflows/main.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)

</div>

---

## About The Project

**Discord Purge** is a high-performance desktop application built to empower users with ultimate control over their digital footprint on Discord. It connects directly to Discord's API, providing a suite of powerful, privacy-focused tools wrapped in a clean, modern, and intuitive interface.

Whether you're looking to clean up old conversations, manage your server presence, or perform a full GDPR-compliant data scrub, this utility provides the tools to do it safely and efficiently.

<br>

### ❤️ Support The Project

If this tool is useful to you and you appreciate the time saved, please consider showing your support!

<a href="https://www.buymeacoffee.com/evuldeeds">
  <img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=evuldeeds&button_colour=5F7FFF&font_colour=ffffff&font_family=Poppins&outline_colour=000000&coffee_colour=FFDD00" alt="Buy Me A Coffee" />
</a>

---

## ✨ Features

-   **Multi-Authentication:** Log in via the official, secure **OAuth2** flow, or use **Bypass Mode** with a user token for deep-level access to DMs and friend lists.
-   **Bulk Message Deletion:**
    -   Select multiple servers, DMs, and group chats in a single operation.
    -   Filter messages by date range ("Last 24 Hours," "Last 7 Days," "All Time," or custom).
    -   Filter by keyword or only delete messages with attachments.
    -   **Simulation Mode:** Perform a safe dry run to see what would be deleted without actually removing any data.
-   **Bulk Server Departure:** Quickly leave multiple servers at once while whitelisting the ones you want to stay in.
-   **Bulk Friend Removal:** Clean up your friends list with a simple, powerful bulk removal tool.
-   **Privacy & GDPR Tools:**
    -   **Profile Wipe:** A guided flow to help you permanently delete your Discord account.
    -   **GDPR Request:** A helper to guide you through the process of requesting your data package and submitting a compliant GDPR deletion request to Discord.
-   **Advanced Tools:**
    -   **Audit Log Burial:** Flood a server's audit log with rapid channel renames to bury previous actions.
    -   **Webhook Ghosting:** Find and delete all webhooks created by you on a server.

---

## 🖼️ Screenshots

*(Add screenshots or GIFs of the application in action here)*

<details>
  <summary>Click to expand screenshots</summary>
  
  _Placeholder: Screenshot of the login screen_
  
  _Placeholder: Screenshot of the message deletion dashboard_
  
</details>

---

## 🛠️ Tech Stack

This project is built with a focus on performance and security, using modern, cutting-edge technologies.

| Tech               | Category         |
| ------------------ | ---------------- |
| **Rust**           | Backend Language |
| **Tauri**          | Desktop Framework|
| **React**          | Frontend Library |
| **TypeScript**     | Frontend Language|
| **Vite**           | Build Tool       |
| **Tailwind CSS**   | Styling          |
| **Zustand**        | State Management |
| **Framer Motion**  | Animations       |

---

## 🚀 Getting Started

### Prerequisites

-   Windows, macOS, or Linux operating system.

### Installation

1.  Go to the [**Latest Release**](https://github.com/evuldeeds-design/Discord-Purge/releases/latest) page.
2.  Download the appropriate installer for your operating system (`.msi` for Windows, `.dmg` for macOS, `.AppImage` or `.deb` for Linux).
3.  Run the installer and follow the on-screen instructions.

---

## 👨‍💻 For Developers

Interested in contributing? Here’s how to get the project running locally.

### Prerequisites

-   **Node.js** (v18.x or later)
-   **Rust** and **Cargo**: [https://www.rust-lang.org/tools/install](https://www.rust-lang.org/tools/install)
-   (Windows) **WebView2**: Should be installed on modern Windows systems.
-   (Linux) Required dependencies for Tauri: `sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.0-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`

### Local Development Setup

1.  **Clone the repository:**
    ```sh
    git clone https://github.com/evuldeeds-design/Discord-Purge.git
    cd Discord-Purge
    ```

2.  **Install frontend dependencies:**
    ```sh
    npm install
    ```

3.  **Run the development server:**
    ```sh
    npm run tauri dev
    ```
    The application will compile and launch in a development window with hot-reloading enabled for both the frontend and backend.

---

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Please see the `CONTRIBUTING.md` file for guidelines (TODO: Create this file).

---

## 📜 License

This project is distributed under the MIT License. See `LICENSE.txt` for more information. (Note: You can choose a different license if you prefer).
