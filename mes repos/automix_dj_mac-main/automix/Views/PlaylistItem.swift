import Foundation

struct PlaylistItem: Identifiable {
    let id = UUID()
    let url: URL
    
    var name: String {
        url.lastPathComponent
    }
}
