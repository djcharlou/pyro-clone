
import SwiftUI
import AVKit
import Combine

struct CircularSeekBar: View {
    @ObservedObject var manager: HybridMediaPlayerManager
    let isDeckA: Bool

    @State private var progress: Double = 0
    @State private var isDragging = false

    
    let totalTicks = 80 // Total number of lines
        let tickThickness: CGFloat = 12
    
    
    var body: some View {
        ZStack {
            // Always visible background circle
            Circle()
                            .stroke(
                                Color.white.opacity(0.1),
                                style: StrokeStyle(
                                    lineWidth: tickThickness,
                                    lineCap: .butt,
                                    dash: [2, 2] // [length of line, gap between lines]
                                )
                            )
            // Progress circle
            Circle()
                            .trim(from: 0, to: progress)
                            .stroke(
                                isDragging ? Color.orange : (isDeckA ? Color.cyan : Color.yellow),
                                style: StrokeStyle(
                                    lineWidth: tickThickness,
                                    lineCap: .butt,
                                    dash: [2, 2] // Matches background for alignment
                                )
                            )
                            .rotationEffect(.degrees(-90))
                            // Glow effect for that "active" feel
                            .shadow(color: (isDeckA ? Color.cyan : Color.yellow).opacity(isDragging ? 0.8 : 0.4), radius: 5)
                    }
                    .padding(10)
                    .frame(width: 250, height: 250)
                    .contentShape(Circle()) // Better touch area
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                isDragging = true
                                updateProgressFromDrag(location: value.location, shouldPlay: false)
                            }
                            .onEnded { value in
                                updateProgressFromDrag(location: value.location, shouldPlay: true)
                                isDragging = false
                            }
                    )
                    .onReceive(deckPublisher()) { newProgress in
                        if !isDragging {
                            progress = newProgress
                        }
                    }
                }
    // Publisher to track deck currentFrame
    private func deckPublisher() -> AnyPublisher<Double, Never> {
        let deck = isDeckA ? manager.deckA : manager.deckB
        return deck.$currentFrame
            .map { frame -> Double in
                guard let file = deck.audioFile, file.length > 0 else { return 0 }
                return min(max(Double(frame) / Double(file.length), 0), 1)
            }
            .eraseToAnyPublisher()
    }

    // Update progress and deck on drag
    private func updateProgressFromDrag(location: CGPoint, shouldPlay: Bool) {
        let deck = isDeckA ? manager.deckA : manager.deckB
        guard let file = deck.audioFile else { return }

        let size: CGFloat = 250
        let center = CGPoint(x: size/2, y: size/2)
        let dx = location.x - center.x
        let dy = location.y - center.y

        var angle = atan2(dy, dx) + .pi/2
        if angle < 0 { angle += 2 * .pi }

        let percentage = min(max(angle / (2 * .pi), 0), 1)

        let totalSeconds = Double(file.length) / file.processingFormat.sampleRate
        let newSeconds = totalSeconds * percentage

        progress = percentage

        manager.seekAbsolute(
            deck: deck,
            to: newSeconds,
            playAfterSeek: shouldPlay
        )
    }
}
