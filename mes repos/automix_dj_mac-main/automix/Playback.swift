import Foundation
import AVFoundation

extension HybridMediaPlayerManager {
    // MARK: - Play / Pause Controls
    func playPauseDeck(isDeckA: Bool) {
           let deck = isDeckA ? deckA : deckB
           if deck.isPlaying {
               pause(deck: deck)
           } else {
               play(deck: deck)
           }
       }

       func stopDeck(isDeckA: Bool) {
           let deck = isDeckA ? deckA : deckB
   
           deck.playerNode.stop()
           deck.videoPlayer.pause()
           deck.videoPlayer.seek(to: .zero)
           deck.currentFrame = 0
           deck.isPlaying = false
   
   
       }

       func seekAbsolute(deck: DeckEngine, to seconds: Double, playAfterSeek: Bool = true) {
           guard let file = deck.audioFile else { return }
   
           let newFrame = AVAudioFramePosition(seconds * file.processingFormat.sampleRate)
           deck.currentFrame = max(0, min(newFrame, file.length))
   
           if playAfterSeek && deck.isPlaying {
               play(deck: deck) // Reschedule audio from currentFrame
           } else {
               deck.videoPlayer.seek(
                   to: CMTime(seconds: seconds, preferredTimescale: 600),
                   toleranceBefore: .zero,
                   toleranceAfter: .zero
               )
           }
       }
       func seekWithKeyboard(deck: DeckEngine, to seconds: Double) {
           guard let file = deck.audioFile else { return }
   
           deck.currentFrame = AVAudioFramePosition(seconds * file.processingFormat.sampleRate)
           self.seekAbsolute(deck: deck, to: seconds, playAfterSeek: deck.isPlaying)
       }
}
