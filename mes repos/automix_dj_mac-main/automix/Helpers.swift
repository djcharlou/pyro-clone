import SwiftUI
import AppKit

func handleDrop(providers: [NSItemProvider], completion: @escaping (URL) -> Void) {
    for provider in providers {
        provider.loadItem(forTypeIdentifier: "public.file-url", options: nil) { data, _ in
            if let data = data as? Data,
               let url = NSURL(absoluteURLWithDataRepresentation: data, relativeTo: nil) as URL? {
                DispatchQueue.main.async {
                    completion(url)
                }
            }
        }
    }
}

func handleMultipleDrop(providers: [NSItemProvider], completion: @escaping ([URL]) -> Void) {
    var urls: [URL] = []
    let group = DispatchGroup()
    let lock = NSLock()

    for provider in providers {
        group.enter()
        provider.loadItem(forTypeIdentifier: "public.file-url", options: nil) { data, _ in
            if let data = data as? Data,
               let url = NSURL(absoluteURLWithDataRepresentation: data, relativeTo: nil) as URL? {
                lock.lock()
                urls.append(url)
                lock.unlock()
            }
            group.leave()
        }
    }

    group.notify(queue: .main) {
        completion(urls)
    }
}
