import SwiftUI

struct PitchBendKnob: View {
    @ObservedObject var manager: HybridMediaPlayerManager
    let isDeckA: Bool
    
    @State private var rotation: Double = 0
    @State private var lastAngle: Double?
    
    let maxRotation: Double = 100      // Visual limit (degrees)
    let maxBend: Double = 0.20         // ±20% pitch nudge
    
    var body: some View {
        VStack(spacing: 6) {
            GeometryReader { geo in
                let size = geo.size.width
                let center = CGPoint(x: size/2, y: size/2)
                
                ZStack {
                    // 1. SEGMENTED SCALE (Line-by-line)
                    ForEach(0..<11) { i in
                        // Map 0...10 to -100...100 degrees
                        let tickAngle = Double(i) * 20.0 - 100.0
                        
                        Rectangle()
                            .fill(rotation == 0 ? Color.white.opacity(0.1) :
                                    (abs(rotation) >= abs(tickAngle) && (rotation * tickAngle >= 0) ? Color.green : Color.white.opacity(0.1)))
                            .frame(width: 1.5, height: 4)
                            .offset(y: -size/1.7)
                            .rotationEffect(.degrees(tickAngle))
                            .animation(.interactiveSpring(), value: rotation)
                    }

                    // 2. THE KNOB BODY
                    Circle()
                        .fill(LinearGradient(colors: [Color(white: 0.15), .black], startPoint: .top, endPoint: .bottom))
                        .overlay(
                            Circle().stroke(Color.green.opacity(0.3), lineWidth: 1)
                        )
                        .shadow(color: .black.opacity(0.5), radius: 3, y: 2)
                    
                    // Center Indicator Needle
                    Capsule()
                        .fill(Color.green)
                        .frame(width: 3, height: size/2.5)
                        .offset(y: -size/4.5)
                        .rotationEffect(.degrees(rotation))
                        // Glow when bending
                        .shadow(color: .green.opacity(rotation != 0 ? 0.8 : 0), radius: 5)
                }
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            let angle = angleBetween(center: center, point: value.location)
                            if let last = lastAngle {
                                var delta = angle - last
                                if delta > 180 { delta -= 360 }
                                if delta < -180 { delta += 360 }
                                
                                rotation += delta
                                rotation = min(max(rotation, -maxRotation), maxRotation)
                                
                                let percent = rotation / maxRotation
                                let newRate = 1.0 + (percent * maxBend)
                                
                                manager.setTemporarySpeed(isDeckA: isDeckA, value: newRate)
                            }
                            lastAngle = angle
                        }
                        .onEnded { _ in
                            lastAngle = nil
                            // SNAP BACK ANIMATION
                            withAnimation(.spring(response: 0.2, dampingFraction: 0.6)) {
                                rotation = 0
                            }
                            manager.resetSpeed(isDeckA: isDeckA)
                        }
                )
            }
            .frame(width: 35, height: 35) // Compact for the mixer strip
            
            Text("BEND")
                .font(.system(size: 7, weight: .black))
                .foregroundColor(.green.opacity(0.6))
        }
    }
    
    private func angleBetween(center: CGPoint, point: CGPoint) -> Double {
        let dx = Double(point.x - center.x)
        let dy = Double(point.y - center.y)
        return atan2(dy, dx) * 180.0 / Double.pi
    }
}
