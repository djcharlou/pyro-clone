import Foundation
import QuartzCore

extension HybridMediaPlayerManager {
    // MARK: - Auto Crossfade Logic
    func autoShift(duration: Double = 1.5) {
        shiftTimer?.invalidate()
        
        let start = crossfader
        let target = start < 0.5 ? 1.0 : 0.0
        let startTime = CACurrentMediaTime()
        
        shiftTimer = Timer.scheduledTimer(withTimeInterval: 1/30, repeats: true) { timer in
            let elapsed = CACurrentMediaTime() - startTime
            let progress = min(elapsed / duration, 1.0)
            
            self.crossfader = start + (target - start) * progress
            
            if progress >= 1.0 {
                timer.invalidate()
            }
        }
    }
    
    func cancelAutoShift() {
        shiftTimer?.invalidate()
    }
    
}
