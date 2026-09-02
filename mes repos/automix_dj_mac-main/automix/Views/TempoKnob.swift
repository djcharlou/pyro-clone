import SwiftUI

struct TempoKnob: View {
    @Binding var value: Double
    let minValue: Double
    let maxValue: Double
    
    @State private var rotation: Double = 0
    @State private var lastAngle: Double?
    
    let maxRotation: Double = 270 // Total sweep
    
    var body: some View {
        VStack(spacing: 4) {
            GeometryReader { geo in
                let size = geo.size.width
                let center = CGPoint(x: size/2, y: size/2)
                
                ZStack {
                    // 1. GRADUATED SCALE (Line-by-line)
                    // We draw 21 ticks to show increments
                    ForEach(0..<21) { i in
                        let tickAngle = Double(i) * (maxRotation / 20) - (maxRotation / 2)
                        let isCenter = i == 10 // The 1.0x neutral position
                        
                        Rectangle()
                            .fill(rotation >= tickAngle ? Color.green : Color.white.opacity(0.15))
                            .frame(width: isCenter ? 2 : 1, height: isCenter ? 6 : 4)
                            .offset(y: -size/1.6)
                            .rotationEffect(.degrees(tickAngle))
                    }
                    
                    // 2. KNOB BODY
                    Circle()
                        .fill(LinearGradient(colors: [Color(white: 0.1), .black], startPoint: .top, endPoint: .bottom))
                        .overlay(
                            Circle()
                                .stroke(Color.green.opacity(0.2), lineWidth: 1)
                        )
                        .shadow(color: .black.opacity(0.5), radius: 4, y: 2)
                    
                    // Indicator Needle
                    Rectangle()
                        .fill(Color.green)
                        .frame(width: 2.5, height: size/2.5)
                        .offset(y: -size/4.5)
                        .rotationEffect(.degrees(rotation))
                        .shadow(color: Color.green.opacity(0.5), radius: 3)
                }
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { gesture in
                            let angle = angleBetween(center: center, point: gesture.location)
                            
                            if let last = lastAngle {
                                var delta = angle - last
                                if delta > 180 { delta -= 360 }
                                if delta < -180 { delta += 360 }
                                
                                rotation += delta
                                rotation = min(max(rotation, -maxRotation/2), maxRotation/2)
                                
                                let percent = (rotation + maxRotation/2) / maxRotation
                                value = minValue + percent * (maxValue - minValue)
                            }
                            lastAngle = angle
                        }
                        .onEnded { _ in lastAngle = nil }
                )
            }
            .frame(width: 35, height: 35)
            
            Text("TEMPO")
                .font(.system(size: 7, weight: .black))
                .foregroundColor(.green.opacity(0.7))
        }
        .onAppear(perform: updateRotationFromValue)
        .onChange(of: value) { _ in updateRotationFromValue() }
    }
    
    private func updateRotationFromValue() {
        let percent = (value - minValue) / (maxValue - minValue)
        rotation = percent * maxRotation - maxRotation/2
    }
    
    private func angleBetween(center: CGPoint, point: CGPoint) -> Double {
        let dx = Double(point.x - center.x)
        let dy = Double(point.y - center.y)
        return atan2(dy, dx) * 180.0 / Double.pi
    }
}
