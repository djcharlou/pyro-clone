import SwiftUI
import AVKit
import Accelerate

struct ContentView: View {
    
    @StateObject var manager = HybridMediaPlayerManager()
    
    var body: some View {
        VStack(spacing: 15) {
//            HStack {
//                DeckWaveformView(manager: manager, isDeckA: true)
//                    .frame(height: 100) // Yeh frame hona zaroori hai
//                
//                DeckWaveformView(manager: manager, isDeckA: false)
//                    .frame(height: 100)
//            }
//            .padding(5)
//            
            // ROW 2 – DECKS & EQ / VOLUME CONTROLS
            HStack(alignment: .center, spacing: 20) {
                
                // Deck A + EQ
                RoundPlayerDeck(player: manager.deckA.videoPlayer,
                                songName: manager.currentSongNameA,
                                manager: manager,
                                isDeckA: true)
                .onDrop(of: ["public.file-url"], isTargeted: nil) { providers in
                    handleDrop(providers: providers) { url in
                        manager.loadIntoDeckA(url: url)
                    }
                    return true
                }
                
                VStack(spacing: 6) {
                    // Replace your EQKnob lines with these:
                    EQKnob(value: Binding(get: { manager.lowGainA }, set: { manager.lowGainA = $0 }), range: -12...12, label: "LOW")
                    EQKnob(value: Binding(get: { manager.midGainA }, set: { manager.midGainA = $0 }), range: -12...12, label: "MID")
                    EQKnob(value: Binding(get: { manager.highGainA }, set: { manager.highGainA = $0 }), range: -12...12, label: "HIGH")
                    HoverButton(label: "RESET", tooltip: "Reset EQ", action: { manager.resetEQ(isDeckA: true) })
                }
                .frame(width: 80)
                
                // Volume + Crossfader
                VStack(spacing: 5) {
                    HStack(spacing: 15) {
                        
                        HStack(spacing: 4) {
                           
                            Slider(value: $manager.volumeA, in: 0...1)
                                .rotationEffect(.degrees(-90))
                                .frame(width: 100)
                            
                           }
                        
                        // Deck B Volume + Meter
                        HStack(spacing: 4) {
                            Slider(value: $manager.volumeB, in: 0...1)
                                .rotationEffect(.degrees(-90))
                                .frame(width: 100)
                        }
                    }
                    .frame(height: 150)
                   
                    Text("CROSSFADER")
                        .foregroundColor(.white.opacity(0.7))
                    
                    Slider(value: $manager.crossfader, in: 0...1) { editing in
                        if editing { manager.cancelAutoShift() }
                    }
                    .frame(width: 200)
                    
                    Button("AUTO SHIFT") { manager.autoShift() }
                        .buttonStyle(.borderedProminent)
                }
                .padding(10)
                .background(Color.gray.opacity(0.15))
                .cornerRadius(15)
                
                // Deck B + EQ
                VStack(spacing: 6) {
                    // Replace your EQKnob lines with these:
                    EQKnob(value: Binding(get: { manager.lowGainA }, set: { manager.lowGainA = $0 }), range: -12...12, label: "LOW")
                    EQKnob(value: Binding(get: { manager.midGainA }, set: { manager.midGainA = $0 }), range: -12...12, label: "MID")
                    EQKnob(value: Binding(get: { manager.highGainA }, set: { manager.highGainA = $0 }), range: -12...12, label: "HIGH")
                    HoverButton(label: "RESET", tooltip: "Reset EQ", action: { manager.resetEQ(isDeckA: false) })
                }
                .frame(width: 80)
                
                RoundPlayerDeck(player: manager.deckB.videoPlayer,
                                songName: manager.currentSongNameB,
                                manager: manager,
                                isDeckA: false)
                .onDrop(of: ["public.file-url"], isTargeted: nil) { providers in
                    handleDrop(providers: providers) { url in
                        manager.loadIntoDeckB(url: url)
                    }
                    return true
                }
            }
            
            // Deck Controls Row
            HStack(spacing: 100) {
                DeckControlsView(manager: manager, isDeckA: true)
                DeckControlsView(manager: manager, isDeckA: false)
            }
            
            // Playlists
            HStack(spacing: 20) {
                PlaylistView(manager: manager, deck: manager.deckA, title: "PLAYLIST A")
                PlaylistView(manager: manager, deck: manager.deckB, title: "PLAYLIST B")
            }
            
        }
        .padding()
        .frame(width: 1050, height: 600)
        .background(
            LinearGradient(
                colors: [Color(red: 0.05, green: 0.08, blue: 0.2),
                         Color(red: 0.1, green: 0.1, blue: 0.3)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .background()
    }
}
