import SwiftUI
import AVKit

struct PlayerView: NSViewRepresentable {
    
    let player: AVPlayer
    
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        view.wantsLayer = true
        
        let playerLayer = AVPlayerLayer(player: player)
        playerLayer.videoGravity = .resizeAspectFill
        playerLayer.frame = view.bounds
        
        view.layer = playerLayer
        return view
    }
    
    func updateNSView(_ nsView: NSView, context: Context) {
        if let layer = nsView.layer as? AVPlayerLayer {
            layer.player = player
            layer.frame = nsView.bounds
        }
    }
}
