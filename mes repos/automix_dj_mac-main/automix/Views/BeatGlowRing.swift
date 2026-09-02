import SwiftUI
import AVKit

struct BeatGlowRing: View {
    let level: Float
    let isActive: Bool
    let isDeckA: Bool
    
    var body: some View {
        Circle()
            .stroke(
                LinearGradient(
                    colors: isActive ? [.yellow, .orange] : [.cyan.opacity(0.3), .blue.opacity(0.3)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                // Limit the width to prevent "wider" crazy animation
                lineWidth: isActive ? 4 + CGFloat(min(level, 0.5) * 10) : 4
            )
            .shadow(color: isActive ? Color.orange.opacity(Double(level * 0.5)) : .clear,
                    radius: isActive ? CGFloat(level * 8) : 0)
            .scaleEffect(isActive ? 1.0 + CGFloat(level * 0.03) : 1.0)
            // drawingGroup() GPU use karega, CPU ko relief dega
            .drawingGroup()
    }
}
