import Foundation

public enum ManagedHookExecutableResolver {
    public static func sourceExecutableURL(
        currentExecutableURL: URL,
        bundleURL: URL?,
        fileManager: FileManager = .default
    ) -> URL {
        guard let bundleURL else {
            return currentExecutableURL
        }

        let bundledHelperURL = bundleURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Helpers", isDirectory: true)
            .appendingPathComponent("LoopndrollHook")

        guard fileManager.isExecutableFile(atPath: bundledHelperURL.path) else {
            return currentExecutableURL
        }

        return bundledHelperURL
    }
}
