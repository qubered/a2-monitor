import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var launcher: Process?
    private var statusMenuItem: NSMenuItem!
    private var startMenuItem: NSMenuItem!
    private var stopMenuItem: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "A2"
        statusItem.button?.toolTip = "A2 Monitor"

        let menu = NSMenu()
        statusMenuItem = menu.addItem(withTitle: "Server stopped", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(.separator())
        menu.addItem(withTitle: "Open Live", action: #selector(openLive), keyEquivalent: "l").target = self
        menu.addItem(withTitle: "Open Manager", action: #selector(openManager), keyEquivalent: "m").target = self
        menu.addItem(withTitle: "Show Log", action: #selector(showLog), keyEquivalent: "") .target = self
        menu.addItem(.separator())
        startMenuItem = menu.addItem(withTitle: "Start Server", action: #selector(startServer), keyEquivalent: "")
        startMenuItem.target = self
        stopMenuItem = menu.addItem(withTitle: "Stop Server", action: #selector(stopServer), keyEquivalent: "")
        stopMenuItem.target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit A2 Monitor", action: #selector(quit), keyEquivalent: "q").target = self
        statusItem.menu = menu
        updateMenu(running: false, status: "Server stopped")
        startServer()
    }

    @objc private func startServer() {
        guard launcher?.isRunning != true,
              let resources = Bundle.main.resourceURL else { return }
        let process = Process()
        process.executableURL = resources.appendingPathComponent("bin/node")
        process.arguments = [resources.appendingPathComponent("launcher.mjs").path]
        process.currentDirectoryURL = resources.appendingPathComponent("app")
        var environment = ProcessInfo.processInfo.environment
        environment["A2_APP_SHELL"] = "menu-bar"
        process.environment = environment
        process.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async {
                guard self?.launcher === finished else { return }
                self?.launcher = nil
                self?.updateMenu(running: false, status: finished.terminationStatus == 0 ? "Server stopped" : "Server exited — see log")
            }
        }
        do {
            try process.run()
            launcher = process
            updateMenu(running: true, status: "Server starting…")
        } catch {
            updateMenu(running: false, status: "Server could not start")
            NSAlert(error: error).runModal()
        }
    }

    @objc private func stopServer() {
        launcher?.terminate()
        updateMenu(running: false, status: "Server stopping…")
    }

    @objc private func openLive() {
        NSWorkspace.shared.open(URL(string: "http://127.0.0.1:4173/")!)
    }

    @objc private func openManager() {
        NSWorkspace.shared.open(URL(string: "http://127.0.0.1:4173/manager/")!)
    }

    @objc private func showLog() {
        let path = NSString(string: "~/Library/Logs/A2 Monitor/mvp.log").expandingTildeInPath
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    @objc private func quit() {
        launcher?.terminate()
        NSApplication.shared.terminate(nil)
    }

    private func updateMenu(running: Bool, status: String) {
        statusMenuItem.title = status
        startMenuItem.isEnabled = !running
        stopMenuItem.isEnabled = running
        statusItem.button?.title = running ? "A2 ●" : "A2"
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
