import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var launcher: Process?
    private var statusMenuItem: NSMenuItem!
    private var startMenuItem: NSMenuItem!
    private var stopMenuItem: NSMenuItem!
    private var restartAfterStop = false

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
        menu.addItem(withTitle: "Configure Shure Receiver…", action: #selector(configureShure), keyEquivalent: "").target = self
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
        let defaults = UserDefaults.standard
        if let shureHost = defaults.string(forKey: "shureHost"), !shureHost.isEmpty {
            environment["A2_SHURE_HOST"] = shureHost
            environment["A2_SHURE_CHANNELS"] = String(max(1, defaults.integer(forKey: "shureChannels")))
        }
        process.environment = environment
        process.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async {
                guard self?.launcher === finished else { return }
                self?.launcher = nil
                self?.updateMenu(running: false, status: finished.terminationStatus == 0 ? "Server stopped" : "Server exited — see log")
                if self?.restartAfterStop == true {
                    self?.restartAfterStop = false
                    self?.startServer()
                }
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

    @objc private func configureShure() {
        let defaults = UserDefaults.standard
        let host = NSTextField(string: defaults.string(forKey: "shureHost") ?? "")
        host.placeholderString = "Receiver control IP, or blank to disable"
        let channels = NSPopUpButton()
        channels.addItems(withTitles: ["1 channel", "2 channels", "4 channels", "8 channels", "16 channels", "24 channels"])
        let savedCount = max(1, defaults.integer(forKey: "shureChannels"))
        let counts = [1, 2, 4, 8, 16, 24]
        channels.selectItem(at: counts.firstIndex(of: savedCount) ?? 2)
        let stack = NSStackView(views: [host, channels])
        stack.orientation = .vertical
        stack.spacing = 8
        stack.frame = NSRect(x: 0, y: 0, width: 360, height: 60)

        let alert = NSAlert()
        alert.messageText = "Shure receiver"
        alert.informativeText = "A2 Monitor uses the read-only command-string connection on TCP 2202. Use the receiver’s isolated control-network IP."
        alert.accessoryView = stack
        alert.addButton(withTitle: "Save and Restart")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        defaults.set(host.stringValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "shureHost")
        defaults.set(counts[channels.indexOfSelectedItem], forKey: "shureChannels")
        if launcher?.isRunning == true {
            restartAfterStop = true
            stopServer()
        } else {
            startServer()
        }
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
