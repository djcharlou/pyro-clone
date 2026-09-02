import Foundation
import AVFoundation

extension HybridMediaPlayerManager {
    
      func toggleLoopMode(isDeckA: Bool) {
          if isDeckA {
              loopModeA = nextMode(current: loopModeA)
          } else {
              loopModeB = nextMode(current: loopModeB)
          }
      }
      

      private func nextMode(current: LoopMode) -> LoopMode {
          switch current {
          case .off: return .playlist
          case .playlist: return .single
          case .single: return .off
          }
      }
  
      func shufflePlaylist(isDeckA: Bool) {
          let deck = isDeckA ? deckA : deckB
          guard deck.playlist.count > 1 else { return }
  
          let current = deck.playlist.removeFirst()
          deck.playlist.shuffle()
          deck.playlist.insert(current, at: 0)
  
          self.objectWillChange.send()
      }
}
