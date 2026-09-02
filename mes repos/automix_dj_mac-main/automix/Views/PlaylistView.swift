import SwiftUI
import AVKit

struct PlaylistView: View {
    @ObservedObject var manager: HybridMediaPlayerManager
    @ObservedObject var deck: DeckEngine
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {

            List {
                ForEach(Array(deck.playlist.enumerated()), id: \.element.id) { index, item in
                    HStack {
                        if index == 0 {
                            Image(systemName: "play.circle.fill")
                                .foregroundColor(.green)
                                .font(.system(size: 10))
                        } else {
                            Image(systemName: "line.3.horizontal") // Drag handle hint
                                .font(.system(size: 10))
                                .foregroundColor(.secondary)
                        }
                        
                        Text(item.name)
                            .lineLimit(1)
                            .font(.system(size: 12, weight: index == 0 ? .bold : .regular))
                                    .foregroundColor(index == 0 ? .green : .primary)
                        
                        Spacer()
                    }
                    .opacity(index == 0 ? 0.9 : 1.0)
                    .padding(.vertical, 2)
                    .contextMenu {
                        Button(role: .destructive) {
                            deck.playlist.remove(at: index)
                        } label: {
                            Label("Remove Song", systemImage: "trash")
                        }
                    }
                }
                // --- 2. DRAG AND DROP MOVE ---
                .onMove { indices, newOffset in
                    if indices.contains(0) || newOffset == 0 {
                        return
                    }
                    deck.playlist.move(fromOffsets: indices, toOffset: newOffset)
                    
                    
                }
            }
            .listStyle(PlainListStyle()) // macOS default padding hatane ke liye
            
        }
        .frame(height: 180)
//        .background(Color.white)
        .cornerRadius(15)
        .onDrop(of: ["public.file-url"], isTargeted: nil) { providers in
            handleMultipleDrop(providers: providers) { urls in
                deck.add(urls: urls)
                if deck.audioFile == nil, let first = urls.first {
                    manager.loadFromPlaylist(url: first, into: deck)
                    if (deck === manager.deckA && manager.isDeckAActive) ||
                       (deck === manager.deckB && manager.isDeckBActive) {
                        manager.playPauseDeck(isDeckA: deck === manager.deckA)
                    }
                }
            }
            return true
        }
    }
}
