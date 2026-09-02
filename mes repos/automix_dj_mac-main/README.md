# 🎧 Automix DJ Mac
<img width="128" height="128" alt="Icon-128" src="https://github.com/user-attachments/assets/643d7949-369e-4b9f-9efa-2c9b97bedb69" />
<img width="1049" height="625" alt="Screenshot 2026-02-26 at 7 52 53 PM" src="https://github.com/user-attachments/assets/1aa0e045-3912-4c75-84f2-fbc1caf7098d" />
**Automix DJ Mac** is a lightweight, high-performance dual-deck media player designed specifically for macOS. Built with SwiftUI and AVFoundation, it offers a seamless DJing experience with a focus on stability, low CPU overhead, and intuitive controls.

## ✨ Key Features


* **Dual-Deck Architecture:** Independent control over Deck A and Deck B with dedicated audio engines.
* **Intelligent Playlist:** Drag-and-drop tracks directly onto the decks or playlists. Features smart auto-play to keep the music moving.
* **Hardware-Level Shortcuts:** Global keyboard monitoring for Play/Pause and Seeking, ensuring responsiveness even when the app isn't the primary focus.
* **Performance Optimized:** Refined audio processing to ensure minimal CPU usage, maintaining a stable 60FPS UI.
* **Advanced Audio Controls:** * 3-Band EQ (Low, Mid, High) for precise sound sculpting.
    * Smooth Crossfader with Auto-Shift functionality.
    * Circular Seek Bars for visual progress tracking.
* **Modern UI:** A dark, neon-inspired interface built entirely with SwiftUI.

## ⌨️ Keyboard Shortcuts

| Action | Key |
| :--- | :--- |
| **Play/Pause Active Deck** | `Spacebar` |
| **Rewind 10 Seconds** | `Left Arrow` |
| **Forward 5 Seconds** | `Right Arrow` |

## 🚀 Getting Started

### Prerequisites
* macOS 13.0 or later
* Xcode 14.0+


### Installation
1.  Clone the repository:
    ```bash
    git clone [https://github.com/Royalkerry/automix_dj_mac.git](https://github.com/Royalkerry/automix_dj_mac.git)
    ```
2.  Open `automix.xcodeproj` in **Xcode**.
3.  Select your target as **My Mac**.
4.  Press `Cmd + R` to build and run.

> **Note on Security:** As this app is not notarized via an Apple Developer Account, you may need to **Right-Click -> Open** the application the first time you run a release build to bypass Gatekeeper.

## 🛠 Tech Stack

* **Language:** Swift 5.x
* **UI Framework:** SwiftUI
* **Audio Engine:** AVFoundation (AVAudioEngine, AVAudioPlayerNode)
* **Mathematics/Signal Processing:** Accelerate Framework
* **Architecture:** Manager-Engine Pattern (ObservableObject)

## 👤 Author

**Royalkerry**
* GitHub: [@Royalkerry](https://github.com/Royalkerry)

---
*Created for the love of music and clean code.*
