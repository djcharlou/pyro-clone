import SwiftUI
import AVKit

struct RoundPlayerDeck: View {
    
    let player: AVPlayer
    let songName: String
    @ObservedObject var manager: HybridMediaPlayerManager
    let isDeckA: Bool
    
    @State private var currentTime: Double = 0
    @State private var timer: Timer?
    // Add these computed properties inside RoundPlayerDeck

   
    var isActive: Bool {
        isDeckA ? manager.isDeckAActive : manager.isDeckBActive
    }
    
    func formatTime(_ seconds: Double) -> String {
        guard !seconds.isNaN else { return "00:00" }
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%02d:%02d", mins, secs)
    }
    
    var remianingTime: Double {
        guard let duration = player.currentItem?.duration.seconds,
              duration > 0 else { return 0 }
        return max(duration - currentTime, 0)
    }
    
   
    var body: some View {
        HStack(spacing: 50) {
            ZStack {
                
                Circle()
                    .fill(Color.black)
                  
                PlayerView(player: player)
                    .clipShape(Circle())
                   
                CircularSeekBar(manager: manager, isDeckA: isDeckA)
//                BeatGlowRing(level: currentLevel, isActive: isActive, isDeckA: isDeckA)
//                            .animation(.interactiveSpring(response: 0.15, dampingFraction: 0.7), value: currentLevel)
                Circle()
                    .stroke(
                        LinearGradient(
                            colors: isActive ? [Color.yellow, Color.orange] : [Color.cyan.opacity(0.5), Color.blue.opacity(0.5)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: isActive ? 10 : 6
                    )
                    .shadow(color: isActive ? .yellow : .clear,
                            radius: isActive ? 5 : 0)
//                    .animation(.easeInOut(duration: 0.5), value: isActive)
                
                VStack(spacing: 15) {
                    Text(songName.isEmpty ? "Drop Track" : songName)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.yellow)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(width: 180)
                    
                    Text(formatTime(currentTime))
                        .font(.system(size: 18, weight: .bold, design: .monospaced))
                            .foregroundColor(.green)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                    
                    
                    Text("-\(formatTime(remianingTime))")
                        .font(.system(size: 18, weight: .bold, design: .monospaced))
                            .foregroundColor(.red)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                }
                .frame(maxHeight: .infinity)
            }
            .frame(width: 240, height: 240)
            .onAppear {
                timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
                    guard let item = player.currentItem else {return}
                    
                    let time = CMTimeGetSeconds(item.currentTime())
                    let duration = CMTimeGetSeconds(item.duration)
                    
                    self.currentTime = time
                    
                    if duration > 0 && time >= (duration - 1.0) {
                        let deck = isDeckA ? manager.deckA : manager.deckB
                        if deck.isPlaying {
                            
                            manager.playNext(deck: deck)
                        }
                    }
                }
            }
            .onDisappear {
                timer?.invalidate()
            }
        }
    }
}
