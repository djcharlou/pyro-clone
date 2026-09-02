import AVFoundation
import SwiftUI


final class DeckEngine: ObservableObject {
    let videoPlayer = AVPlayer()
    let playerNode = AVAudioPlayerNode()
    let timePitch = AVAudioUnitTimePitch()
    let eq = AVAudioUnitEQ(numberOfBands: 3)

    var currentLevel: Float = 0
    var startFrame: AVAudioFramePosition = 0
    var audioFile: AVAudioFile?
    @Published var currentFrame: AVAudioFramePosition = 0  // ← important
    @Published var isPlaying = false

    @Published var playlist: [PlaylistItem] = []
    
    
    init() {
        videoPlayer.isMuted = true
        
        eq.globalGain = 0

        // LOW
        eq.bands[0].filterType = .parametric
        eq.bands[0].frequency = 100
        eq.bands[0].bandwidth = 1.0
        eq.bands[0].gain = 0
        eq.bands[0].bypass = false

        // MID
        eq.bands[1].filterType = .parametric
        eq.bands[1].frequency = 1000
        eq.bands[1].bandwidth = 1.0
        eq.bands[1].gain = 0
        eq.bands[1].bypass = false

        // HIGH
        eq.bands[2].filterType = .parametric
        eq.bands[2].frequency = 8000
        eq.bands[2].bandwidth = 1.0
        eq.bands[2].gain = 0
        eq.bands[2].bypass = false
    }

    func add(urls: [URL]) {
        objectWillChange.send()
        for url in urls {
            playlist.append(PlaylistItem(url: url))
        }
    }

}
