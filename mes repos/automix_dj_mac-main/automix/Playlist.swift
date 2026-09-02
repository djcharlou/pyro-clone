import Foundation
import AVFoundation

extension HybridMediaPlayerManager {
    
    func loadIntoDeckA(url: URL) {
        let newItem = PlaylistItem(url: url)
        
        
        if !deckA.playlist.isEmpty {
            deckA.playlist.insert(newItem, at: 0)
        } else {
            deckA.playlist.append(newItem)
        }
        load(url: url, deck: deckA)
    
        currentSongNameA = url.lastPathComponent
        if isDeckAActive {
                play(deck: deckA)
            }
        
    }
    
    func loadIntoDeckB(url: URL) {
        let newItem = PlaylistItem(url: url)
        if !deckB.playlist.isEmpty {
            deckB.playlist.insert(newItem, at: 0)
        } else {
            deckB.playlist.append(newItem)
        }
        load(url: url, deck: deckB)
        currentSongNameB = url.lastPathComponent
        if isDeckBActive {
                play(deck: deckB)
            }

    }
    func playNext(deck: DeckEngine) {
        let isDeckA = (deck === self.deckA)
        let mode = isDeckA ? loopModeA : loopModeB
        
        guard deck.playlist.count > 1 else {
           print(" No next song avalable in playlist")
            return
        }
        
        deck.playerNode.stop()
        deck.playerNode.reset()
        deck.videoPlayer.pause()
        deck.videoPlayer.replaceCurrentItem(with: nil)
        deck.isPlaying = false
        deck.audioFile = nil

        
        switch mode {
        case .single:
            deck.currentFrame = 0
            
        case .playlist:
           let finishedItem = deck.playlist.removeFirst()
            deck.playlist.append(finishedItem)
            deck.currentFrame = 0
            
        case .off:
            deck.playlist.removeFirst()
            deck.currentFrame = 0
        }
        guard let next = deck.playlist.first else {
            if isDeckA { currentSongNameA = "" } else { currentSongNameB = "" }
            return
        }
        load(url: next.url, deck: deck)
        if isDeckA {
            currentSongNameA = next.name
        } else {
            currentSongNameB = next.name
        }
        play(deck: deck)
    }
    
}
