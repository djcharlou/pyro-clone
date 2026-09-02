import SwiftUI

struct HoverButton: View {
    let label: String
    let tooltip: String
    let action: () -> Void
    
    @State private var isHovering = false
    
    var body: some View {
        Button(label, action: action)
            .buttonStyle(.borderedProminent)
            .onHover { hovering in
                isHovering = hovering
            }
            .overlay(
                Group {
                    if isHovering {
                        Text(tooltip)
                            .font(.caption)
                            .padding(6)
                            .background(Color.black.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(5)
                            .offset(y: -40) // show above button
                            .transition(.opacity.combined(with: .scale))
                    }
                }
            )
            .animation(.easeInOut(duration: 0.2), value: isHovering)
    }
}
