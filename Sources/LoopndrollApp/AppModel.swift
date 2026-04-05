import AppKit
import Foundation
import LoopndrollCore
import Observation

@MainActor
@Observable
final class AppModel {
    var state: PersistedState = .defaultValue
    var installationSummary = "Checking installation..."
    var installationHealthy = false
    var busy = false
    var errorMessage: String?

    private let paths: LoopndrollPaths
    private let hookExecutableURL: URL
    private var hasStarted = false

    init(
        paths: LoopndrollPaths = .live(),
        executableURL: URL = Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0]),
        bundleURL: URL? = Bundle.main.bundleURL
    ) {
        self.paths = paths
        self.hookExecutableURL = ManagedHookExecutableResolver.sourceExecutableURL(
            currentExecutableURL: executableURL,
            bundleURL: bundleURL
        )
    }

    func startIfNeeded() {
        guard !hasStarted else { return }
        hasStarted = true

        Task {
            await refreshState()
            await repairInstallation()
        }
    }

    func setEnabled(_ enabled: Bool) {
        Task {
            await updateState { state in
                state.config.enabled = enabled
                state.startNewActivation()
            }
        }
    }

    func setMode(_ mode: LoopMode) {
        Task {
            await updateState { state in
                state.config.mode = mode
                state.startNewActivation()
            }
        }
    }

    func setMaxTurns(_ value: Int) {
        Task {
            await updateState { state in
                state.config.maxTurns = max(1, value)
                state.startNewActivation()
            }
        }
    }

    func setPromptTemplate(_ promptTemplate: String) {
        Task {
            await updateState { state in
                state.config.promptTemplate = promptTemplate
                state.touch()
            }
        }
    }

    func resetBudgets() {
        Task {
            await updateState { state in
                state.startNewActivation()
            }
        }
    }

    func repairNow() {
        Task {
            await repairInstallation()
        }
    }

    func openCodexFolder() {
        NSWorkspace.shared.open(paths.codexDirectoryURL)
    }

    func openAppSupportFolder() {
        NSWorkspace.shared.open(paths.appDirectoryURL)
    }

    func quit() {
        NSApplication.shared.terminate(nil)
    }

    private func refreshState() async {
        let stateStore = StateStore(stateURL: paths.stateURL, lockURL: paths.lockURL)

        do {
            let loadedState = try await runIO {
                try stateStore.load()
            }
            state = loadedState
            errorMessage = nil
        } catch {
            errorMessage = "Failed to load Loopndroll state: \(error.localizedDescription)"
        }
    }

    private func repairInstallation() async {
        busy = true
        defer { busy = false }

        do {
            let paths = self.paths
            let hookExecutableURL = self.hookExecutableURL
            let report = try await runIO {
                try InstallationManager(paths: paths).repair(using: hookExecutableURL)
            }

            installationHealthy = report.health.isHealthy
            if report.health.isHealthy {
                if report.didUpdateExecutable || report.didUpdateConfig || report.didUpdateHooks || report.didCreateState {
                    installationSummary = "Installed and repaired."
                } else {
                    installationSummary = "Installed and healthy."
                }
            } else {
                installationSummary = report.health.issues.joined(separator: " ")
            }

            if report.replacedMalformedHooks {
                errorMessage = "hooks.json was malformed and was replaced with a repaired file."
            } else {
                errorMessage = nil
            }

            await refreshState()
        } catch {
            installationHealthy = false
            installationSummary = "Installation needs repair."
            errorMessage = "Repair failed: \(error.localizedDescription)"
        }
    }

    private func updateState(_ mutate: @escaping @Sendable (inout PersistedState) -> Void) async {
        busy = true
        defer { busy = false }

        let stateStore = StateStore(stateURL: paths.stateURL, lockURL: paths.lockURL)

        do {
            let updatedState = try await runIO {
                let (state, _) = try stateStore.mutate { state in
                    mutate(&state)
                }
                return state
            }

            state = updatedState
            errorMessage = nil
        } catch {
            errorMessage = "Failed to save Loopndroll state: \(error.localizedDescription)"
        }
    }

    private func runIO<T: Sendable>(_ operation: @escaping @Sendable () throws -> T) async throws -> T {
        try await Task.detached(priority: .userInitiated, operation: operation).value
    }
}
