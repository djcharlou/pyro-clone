import Foundation
import AVFoundation

extension HybridMediaPlayerManager {
    // MARK: - Speed / Tempo Controls
    func setTemporarySpeed(isDeckA: Bool, value: Double) {
        let deck = isDeckA ? deckA : deckB
        let finalRate = Float(value)
        
        deck.timePitch.rate = finalRate
        
        if deck.isPlaying{
            deck.videoPlayer.rate = finalRate
        }
    }

    func resetSpeed(isDeckA: Bool) {
        let deck = isDeckA ? deckA : deckB
        
        // Smooth return to normal
        let startRate = deck.timePitch.rate
        let targetRate: Float = 1.0 // or current speeed value
        
        let steps = 15
        let duration = 0.2
        let stepTime = duration / Double(steps)
        
        for i in 1...steps {
            DispatchQueue.main.asyncAfter(deadline: .now() + stepTime * Double(i)) {
                let progress = Double(i) / Double(steps)
                let newRate = startRate + (targetRate - startRate) * Float(progress)
                
                deck.timePitch.rate = newRate
                if deck.isPlaying {
                    deck.videoPlayer.rate = newRate
                }
            }
        }
    }
    
    func resetEQ(isDeckA: Bool) {
        let steps = 15
        let duration = 0.2
        let stepTime = duration / Double(steps)

        for i in 1...steps {
            DispatchQueue.main.asyncAfter(deadline: .now() + stepTime * Double(i)) {
                let progress = 1.0 - Double(i) / Double(steps)

                if isDeckA {
                    self.lowGainA *= progress
                    self.midGainA *= progress
                    self.highGainA *= progress
                } else {
                    self.lowGainB *= progress
                    self.midGainB *= progress
                    self.highGainB *= progress
                }
            }
        }
    }
}
