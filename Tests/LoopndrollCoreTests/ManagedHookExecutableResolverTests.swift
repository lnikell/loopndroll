import Foundation
import XCTest
@testable import LoopndrollCore

final class ManagedHookExecutableResolverTests: XCTestCase {
    func testPrefersBundledHelperWhenPresent() throws {
        let bundleURL = try makeTemporaryDirectory().appendingPathComponent("Loopndroll.app", isDirectory: true)
        let helperURL = bundleURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Helpers", isDirectory: true)
            .appendingPathComponent("LoopndrollHook")

        try FileManager.default.createDirectory(at: helperURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("hook".utf8).write(to: helperURL)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: helperURL.path)

        let currentExecutableURL = URL(fileURLWithPath: "/tmp/Loopndroll")
        let resolvedURL = ManagedHookExecutableResolver.sourceExecutableURL(
            currentExecutableURL: currentExecutableURL,
            bundleURL: bundleURL
        )

        XCTAssertEqual(resolvedURL, helperURL)
    }

    func testFallsBackToCurrentExecutableWhenHelperMissing() {
        let currentExecutableURL = URL(fileURLWithPath: "/tmp/Loopndroll")
        let bundleURL = URL(fileURLWithPath: "/tmp/Loopndroll.app")

        let resolvedURL = ManagedHookExecutableResolver.sourceExecutableURL(
            currentExecutableURL: currentExecutableURL,
            bundleURL: bundleURL
        )

        XCTAssertEqual(resolvedURL, currentExecutableURL)
    }

    private func makeTemporaryDirectory() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }
}
