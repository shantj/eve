import SwiftUI

final class ProductModel: ObservableObject {
    @Published private(set) var rounds: Int
    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        rounds = max(0, defaults.integer(forKey: "focus.rounds"))
    }
    func record() { guard rounds < Int.max else { return }; rounds += 1; defaults.set(rounds, forKey: "focus.rounds") }
    func undo() { guard rounds > 0 else { return }; rounds -= 1; defaults.set(rounds, forKey: "focus.rounds") }
}
