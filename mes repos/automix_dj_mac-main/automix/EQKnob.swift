import SwiftUI

struct EQKnob: View {
    @Binding var value: Double
    let range: ClosedRange<Double>
    let label: String
    
    private let angleRange: Double = 270 // Total arc of the knob
    private let startAngle: Double = -135 // Starting rotation
    
    var body: some View {
        VStack(spacing: 8) {
            GeometryReader { geo in
                let size = geo.size.width
                let center = CGPoint(x: size / 2, y: size / 2)
                
                ZStack {
                    // 1. STATIC BACKGROUND TICKS
                    ForEach(0..<21) { i in
                        let tickAngle = Double(i) * (angleRange / 20) + startAngle
                        Rectangle()
                            .fill(Color.white.opacity(0.2))
                            .frame(width: 1, height: 4)
                            .offset(y: -size / 1.6)
                            .rotationEffect(.degrees(tickAngle))
                    }
                    
                    // 2. ACTIVE PROGRESS TICKS (Glows based on value)
                    ForEach(0..<21) { i in
                        let tickAngle = Double(i) * (angleRange / 20) + startAngle
                        let isTickActive = angleFromValue() >= tickAngle
                        
                        Rectangle()
                            .fill(isTickActive ? Color.yellow : Color.clear)
                            .frame(width: 1.5, height: 5)
                            .offset(y: -size / 1.6)
                            .rotationEffect(.degrees(tickAngle))
                            .shadow(color: isTickActive ? .yellow.opacity(0.6) : .clear, radius: 2)
                            .animation(.spring(), value: value)
                    }
                    
                    // 3. THE KNOB BODY
                    Circle()
                        .fill(LinearGradient(colors: [Color(white: 0.1), .black], startPoint: .top, endPoint: .bottom))
                        .shadow(color: .black.opacity(0.8), radius: 4, x: 0, y: 2)
                    
                    // Center Indicator Line
                    Rectangle()
                        .fill(Color.yellow)
                        .frame(width: 2, height: size / 2.5)
                        .offset(y: -size / 4.5)
                        .rotationEffect(.degrees(angleFromValue()))
                }
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { gesture in
                            let vector = CGVector(dx: gesture.location.x - center.x, dy: gesture.location.y - center.y)
                            let angle = atan2(vector.dy, vector.dx)
                            var degrees = angle * 180 / .pi + 90
                            
                            // Normalize degrees
                            if degrees > 180 { degrees -= 360 }
                            
                            // Clamp to range
                            let clamped = min(max(degrees, -135), 135)
                            value = valueFromAngle(clamped)
                        }
                )
            }
            .frame(width: 30, height: 30) // Slightly larger to accommodate ticks
            
            VStack(spacing: 0) {
                Text(label)
                    .font(.system(size: 8, weight: .black))
                    .foregroundColor(.white.opacity(0.6))
                
                Text("\(value, specifier: "%.1f")")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(.yellow)
            }
        }
    }
    
    private func angleFromValue() -> Double {
        let percentage = (value - range.lowerBound) / (range.upperBound - range.lowerBound)
        return percentage * angleRange + startAngle
    }
    
    private func valueFromAngle(_ angle: Double) -> Double {
        let percentage = (angle - startAngle) / angleRange
        return percentage * (range.upperBound - range.lowerBound) + range.lowerBound
    }
}
