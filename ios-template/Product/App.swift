import SwiftUI

@main
struct EveProduct: App {
    init() {
        #if targetEnvironment(simulator)
        if CommandLine.arguments.contains("-eve-reset"), let id = Bundle.main.bundleIdentifier {
            UserDefaults.standard.removePersistentDomain(forName: id)
        }
        #endif
    }
    var body: some Scene { WindowGroup { ProductView() } }
}
