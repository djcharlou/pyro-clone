import Foundation
import AVFoundation

class BPMDetector {
    
    static func detectBPM(from url: URL,
                          completion: @escaping (Double) -> Void) {
        
        DispatchQueue.global(qos: .userInitiated).async {
            
            do {
                let file = try AVAudioFile(forReading: url)
                let format = file.processingFormat
                let frameCount = AVAudioFrameCount(file.length)
                
                guard let buffer = AVAudioPCMBuffer(
                    pcmFormat: format,
                    frameCapacity: frameCount
                ) else {
                    DispatchQueue.main.async { completion(0) }
                    return
                }
                
                try file.read(into: buffer)
                
                guard let channelData = buffer.floatChannelData?[0] else {
                    DispatchQueue.main.async { completion(0) }
                    return
                }
                
                let sampleRate = format.sampleRate
                let samples = Array(UnsafeBufferPointer(
                    start: channelData,
                    count: Int(buffer.frameLength)
                ))
                
                let energy = samples.map { abs($0) }
                
                var peaks = 0
                let threshold: Float = 0.6
                
                for i in stride(from: 1,
                                to: energy.count,
                                by: Int(sampleRate / 4)) {
                    if energy[i] > threshold {
                        peaks += 1
                    }
                }
                
                let duration = Double(buffer.frameLength) / sampleRate
                let bpm = Double(peaks) / duration * 60
                
                DispatchQueue.main.async {
                    completion(round(bpm))
                }
                
            } catch {
                print("BPM detection failed:", error)
                DispatchQueue.main.async { completion(0) }
            }
        }
    }
}
