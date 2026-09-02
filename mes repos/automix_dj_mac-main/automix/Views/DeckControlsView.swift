import SwiftUI

struct DeckControlsView: View {
    @ObservedObject var manager: HybridMediaPlayerManager
    let isDeckA: Bool
    
    var speedBinding: Binding<Double> {
        isDeckA ? $manager.speedA : $manager.speedB
    }
    
    var currentSpeed: Double {
        isDeckA ? manager.speedA : manager.speedB
    }
    
    // Check if deck is playing to trigger the "Pulse"
    var isPlaying: Bool {
        isDeckA ? manager.deckA.isPlaying : manager.deckB.isPlaying
    }

    var body: some View {
        HStack(spacing: 20) {
            
            // 1. SPEED SECTION (Knobs)
            HStack(spacing: 12) {
                PitchBendKnob(manager: manager, isDeckA: isDeckA)
                
                VStack(spacing: 4) {
                    TempoKnob(value: speedBinding, minValue: 0.5, maxValue: 2.0)
                        .frame(width: 35, height: 35)
                    
                    Text("\(currentSpeed, specifier: "%.2f")x")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(.green)
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 15)
            .background(Color.black.opacity(0.3))
            .cornerRadius(12)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.1), lineWidth: 1))

            // 2. TRANSPORT CONTROL GROUP (Mechanical Buttons)
            HStack(spacing: 0) {
                
                let currentPlayList = isDeckA ? manager.deckA.playlist : manager.deckB.playlist
                let canPlayNext = currentPlayList.count > 1
                // RESET BUTTON
                transportButton(icon: "arrow.counterclockwise", color: .gray) {
                    speedBinding.wrappedValue = 1.0
                }
                
                Divider().frame(height: 20).background(Color.white.opacity(0.1))
                transportButton(icon: "shuffle", color: .purple) {
                    manager.shufflePlaylist(isDeckA: isDeckA)
                }

                // 2. Repeat Mode Button (Iska icon mode ke hisaab se badlega)
                let currentMode = isDeckA ? manager.loopModeA : manager.loopModeB
                transportButton(
                    icon: currentMode == .single ? "repeat.1" : "repeat",
                    color: currentMode == .off ? .gray : .green
                ) {
                    manager.toggleLoopMode(isDeckA: isDeckA)
                }
                Divider().frame(height: 20).background(Color.white.opacity(0.1))
                // PLAY / PAUSE BUTTON
                transportButton(
                    icon: isPlaying ? "pause.fill" : "play.fill",
                    color: isPlaying ? .green : .white,
                    isMain: true
                ) {
                    manager.playPauseDeck(isDeckA: isDeckA)
                }
                Divider().frame(height: 20).background(Color.white.opacity(0.1))
                
                
                transportButton(icon: "forward.fill", color: canPlayNext ? .blue : .gray) {
                        let deck = isDeckA ? manager.deckA : manager.deckB
                        manager.playNext(deck: deck)
                    }
                .disabled(!canPlayNext)
                .opacity(canPlayNext ? 1.0 : 0.4)
                
                
                Divider().frame(height: 20).background(Color.white.opacity(0.1))
                
                // STOP BUTTON
                transportButton(icon: "stop.fill", color: .red) {
                    manager.stopDeck(isDeckA: isDeckA)
                }
            }
            .background(Color.black.opacity(0.4))
            .cornerRadius(10)
            .shadow(color: isPlaying ? Color.green.opacity(0.2) : .clear, radius: 10)
        }
    }

    // Helper for specialized mechanical buttons
    @ViewBuilder
    func transportButton(icon: String, color: Color, isMain: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack {
                if isMain && isPlaying {
              }
                
                Image(systemName: icon)
                    .font(.system(size: isMain ? 18 : 14, weight: .bold))
                    .foregroundColor(color)
                    .frame(width: 44, height: 44)
            }
        }
        .buttonStyle(PlainButtonStyle())
    }
}
