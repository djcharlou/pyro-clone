import AVFoundation
import AVKit
import Combine
import Accelerate


enum LoopMode {
    case off, single, playlist
}

class HybridMediaPlayerManager: ObservableObject {
    @Published var loopModeA: LoopMode = .off
    @Published var loopModeB: LoopMode = .off
   
    let engine = AVAudioEngine()
    
    @Published var deckA = DeckEngine()
    @Published var deckB = DeckEngine()
    
    // MARK: - Active Deck Detection

    var isDeckAActive: Bool {
        crossfader <= 0.5
    }

    var isDeckBActive: Bool {
        crossfader > 0.5
    }
    private var cancellables = Set<AnyCancellable>()
    
    @Published var crossfader: Double = 0 { didSet { updateVolumes() } }
    @Published var volumeA: Double = 1.0 { didSet { updateVolumes() } }
    @Published var volumeB: Double = 1.0 { didSet { updateVolumes() } }
    
    @Published var speedA: Double = 1.0 {
        didSet {
            deckA.timePitch.rate = Float(speedA)
            if deckA.isPlaying {
                deckA.videoPlayer.rate = Float(speedA)
            }
        }
    }
    @Published var speedB: Double = 1.0 {
        didSet {
            deckB.timePitch.rate = Float(speedB)
            if deckB.isPlaying {
                deckB.videoPlayer.rate = Float(speedB)
            }
        }
    }

    @Published var currentSongNameA: String = ""
    @Published var currentSongNameB: String = ""
    @Published var lowGainA: Double = 0 {
        didSet { deckA.eq.bands[0].gain = Float(lowGainA) }
    }
    @Published var midGainA: Double = 0{
        didSet { deckA.eq.bands[1].gain = Float(midGainA)}
    }
    @Published var highGainA: Double = 0{
        didSet { deckA.eq.bands[2].gain = Float(highGainA)}
    }
    @Published var lowGainB: Double = 0{
        didSet { deckB.eq.bands[0].gain = Float(lowGainB)}
    }
    @Published var midGainB: Double = 0{
        didSet { deckB.eq.bands[1].gain = Float(midGainB)}
    }
    @Published var highGainB: Double = 0{
        didSet { deckB.eq.bands[2].gain = Float(highGainB)}
    }
    
    var shiftTimer: Timer?
    
    private var monitorTimer: Timer?
    
    init() {
        setupEngine()
        setupKeyboardMonitor()
        
        deckA.objectWillChange
                .sink { [weak self] _ in self?.objectWillChange.send() }
                .store(in: &cancellables) // Aapko 'private var cancellables = Set<AnyCancellable>()' declare karna hoga
                
            // Deck B ki playlist par nazar rakho
            deckB.objectWillChange
                .sink { [weak self] _ in self?.objectWillChange.send() }
                .store(in: &cancellables)
        
    }
 
    private func setupEngine() {
        for deck in [deckA, deckB] {
            engine.attach(deck.playerNode)
            engine.attach(deck.timePitch)
            engine.attach(deck.eq)
            
            engine.connect(deck.playerNode, to: deck.timePitch, format: nil)
            engine.connect(deck.timePitch, to: deck.eq, format: nil)
            engine.connect(deck.eq, to: engine.mainMixerNode, format: nil)
        }
        
        do {
            try engine.start()
        } catch {
            print("Engine start error:", error)
        }
    }

    
    private func checkTrackEnd(deck: DeckEngine) {
        guard deck.isPlaying,
              let file = deck.audioFile else { return }

        updateCurrentFrame(deck: deck)

        if deck.currentFrame >= file.length - 1000 {
            playNext(deck: deck)
        }
    }
    func loadFromPlaylist(url: URL, into deck: DeckEngine) {
        
        load(url: url, deck: deck)
        
        if deck === deckA {
            currentSongNameA = url.lastPathComponent
        } else {
            currentSongNameB = url.lastPathComponent
        }
    }
   
    func load(url: URL, deck: DeckEngine) {
        do {
//            deck.playerNode.removeTap(onBus: 0)
            
            deck.audioFile = try AVAudioFile(forReading: url)
            deck.videoPlayer.replaceCurrentItem(with: AVPlayerItem(url: url))
            deck.currentFrame = 0
            
        } catch {
            print("Load error:", error)
        }
        
    }
    
    
    private func toggle(deck: DeckEngine) {
        if deck.isPlaying {
            pause(deck: deck)
        } else {
            play(deck: deck)
        }
    }
    func moveItem(from source: IndexSet, to destination: Int, isDeckA: Bool) {
        if isDeckA {
            deckA.playlist.move(fromOffsets: source, toOffset: destination)
        } else {
            deckB.playlist.move(fromOffsets: source, toOffset: destination)
        }
    }

    // Right-click se remove karne ke liye
    func removeItem(at index: Int, isDeckA: Bool) {
        let deck = isDeckA ? deckA : deckB
        if index < deck.playlist.count {
            deck.playlist.remove(at: index)
        }
    }
    
    func play(deck: DeckEngine) {
        guard let file = deck.audioFile else { return }

        let startFrame = deck.currentFrame
        let remainingFrames = (file.length > startFrame) ? AVAudioFrameCount(file.length - startFrame) : 0
        
        
        if remainingFrames > 0 {
            deck.playerNode.scheduleSegment(file, startingFrame: startFrame, frameCount: remainingFrames, at: nil)
            deck.playerNode.play()
        } else
        {
            deck.currentFrame = 0
        }

        deck.startFrame = startFrame   // store schedule start

        deck.playerNode.stop()

        deck.playerNode.scheduleSegment(
            file,
            startingFrame: startFrame,
            frameCount: remainingFrames,
            at: nil
        )
        deck.playerNode.play()

        let seconds = Double(deck.currentFrame) / file.processingFormat.sampleRate
        deck.videoPlayer.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
        
        let currentRate = deck.timePitch.rate
        deck.videoPlayer.play()
        deck.videoPlayer.rate = currentRate

        deck.isPlaying = true
    }
    
    func pause(deck: DeckEngine) {
        updateCurrentFrame(deck: deck)
        deck.playerNode.pause()
        deck.videoPlayer.pause()
        deck.isPlaying = false
    }
    
    private func updateCurrentFrame(deck: DeckEngine) {
        guard let nodeTime = deck.playerNode.lastRenderTime,
              let playerTime = deck.playerNode.playerTime(forNodeTime: nodeTime)
        else { return }

        let playedFrames = AVAudioFramePosition(playerTime.sampleTime)

        deck.currentFrame = deck.startFrame + playedFrames
    }
   
    private func updateVolumes() {
        
        deckA.playerNode.volume = Float(volumeA * (1 - crossfader))
        deckB.playerNode.volume = Float(volumeB * crossfader)
  
        if crossfader <= 0.05 {
            if !deckA.isPlaying {
                play(deck: deckA)
            }
            if deckB.isPlaying {
                pause(deck: deckB)
            }
        }
        
        if crossfader >= 0.95 {
            if !deckB.isPlaying {
                play(deck: deckB)
            }
            if deckA.isPlaying {
                pause(deck: deckA)
            }
        }
    }
    private func setupKeyboardMonitor() {
            NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard let self = self else { return event }

                // Agar koi TextField open hai toh keyboard shortcuts kaam na karein
                if let focusView = NSApp.keyWindow?.firstResponder,
                   focusView is NSTextView || focusView is NSTextField {
                    return event
                }

                let activeDeck = self.crossfader <= 0.5 ? self.deckA : self.deckB
                
                switch event.keyCode {
                case 49: // Space
                    self.playPauseDeck(isDeckA: self.crossfader <= 0.5)
                    return nil // Event consume kar liya (system sound nahi aayega)
                    
                case 123: // Left Arrow
                    self.seekRelative(deck: activeDeck, offset: -10)
                    return nil
                    
                case 124: // Right Arrow
                    self.seekRelative(deck: activeDeck, offset: 5)
                    return nil
                    
                default:
                    return event
                }
            }
        }
        
        // Helper function for seeking
        func seekRelative(deck: DeckEngine, offset: Double) {
            guard let file = deck.audioFile else { return }
            let sampleRate = file.processingFormat.sampleRate
            let currentTime = Double(deck.currentFrame) / sampleRate
            let newTime = max(0, min(Double(file.length) / sampleRate, currentTime + offset))
            self.seekAbsolute(deck: deck, to: newTime)
        }

}
