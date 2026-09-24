import AppKit

private let listenBase = "http://127.0.0.1:4173"
/// Reserved name pulse-device-capture serves with its built-in test signal.
private let simulatedDevice = "Pulse test signal"
private let deviceDefaultsKey = "PulseAudioDevice"
private let hostDefaultsKey = "PulseBindHost"
private let outputDefaultsKey = "PulseOutputDevice"
private let outputChannelsDefaultsKey = "PulseOutputChannels"
/// Host monitor output is off unless an output device is chosen (ADR 0031).
private let noOutput = "None (listen on each device only)"
/// Reserved name pulse-device-output accepts and discards without opening a device.
private let simulatedOutput = "Pulse simulated output"

private struct HostOption {
    let title: String
    let value: String
}

private let hostOptions = [
    HostOption(title: "This Mac only", value: "127.0.0.1"),
    HostOption(title: "Local network", value: "0.0.0.0"),
]

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var statusItem: NSStatusItem!
    private var launcher: Process?

    private var window: NSWindow!
    private var deviceButton: NSPopUpButton!
    private var hostButton: NSPopUpButton!
    private var outputButton: NSPopUpButton!
    private var outputChannelsField: NSTextField!
    private var statusLabel: NSTextField!
    private var startStopButton: NSButton!
    private var refreshButton: NSButton!

    private var showWindowMenuItem: NSMenuItem!
    private var startMenuItem: NSMenuItem!
    private var stopMenuItem: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildStatusItem()
        buildWindow()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refreshDevices()
    }

    // MARK: - Status item

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let iconURL = Bundle.main.resourceURL?.appendingPathComponent("MenuBarIcon.png"),
            let icon = NSImage(contentsOf: iconURL)
        {
            icon.size = NSSize(width: 18, height: 18)
            icon.isTemplate = true
            statusItem.button?.image = icon
            statusItem.button?.imagePosition = .imageLeft
        }
        statusItem.button?.toolTip = "Pulse"

        let menu = NSMenu()
        showWindowMenuItem = menu.addItem(
            withTitle: "Show Pulse", action: #selector(showWindow), keyEquivalent: "")
        showWindowMenuItem.target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Open Live", action: #selector(openLive), keyEquivalent: "l").target = self
        menu.addItem(withTitle: "Open Manager", action: #selector(openManager), keyEquivalent: "m").target = self
        menu.addItem(withTitle: "Show Log", action: #selector(showLog), keyEquivalent: "").target = self
        menu.addItem(.separator())
        startMenuItem = menu.addItem(withTitle: "Start Server", action: #selector(startServer), keyEquivalent: "")
        startMenuItem.target = self
        stopMenuItem = menu.addItem(withTitle: "Stop Server", action: #selector(stopServer), keyEquivalent: "")
        stopMenuItem.target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Pulse", action: #selector(quit), keyEquivalent: "q").target = self
        statusItem.menu = menu
    }

    // MARK: - Window

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 380),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false)
        window.title = "Pulse"
        window.delegate = self
        window.isReleasedWhenClosed = false

        let deviceLabel = NSTextField(labelWithString: "Audio input device")
        deviceButton = NSPopUpButton(frame: .zero, pullsDown: false)
        refreshButton = NSButton(title: "Refresh", target: self, action: #selector(refreshDevices))

        let deviceRow = NSStackView(views: [deviceButton, refreshButton])
        deviceRow.orientation = .horizontal
        deviceRow.spacing = 8
        deviceButton.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let hostLabel = NSTextField(labelWithString: "Who can open the listening page")
        hostButton = NSPopUpButton(frame: .zero, pullsDown: false)
        hostButton.addItems(withTitles: hostOptions.map(\.title))

        let outputLabel = NSTextField(labelWithString: "Host monitor output (shared, e.g. to comms)")
        outputButton = NSPopUpButton(frame: .zero, pullsDown: false)
        let channelsLabel = NSTextField(labelWithString: "Output channels")
        outputChannelsField = NSTextField(string: "1")
        outputChannelsField.placeholderString = "1 or 1,2"
        outputChannelsField.widthAnchor.constraint(equalToConstant: 80).isActive = true
        let outputRow = NSStackView(views: [outputButton, channelsLabel, outputChannelsField])
        outputRow.orientation = .horizontal
        outputRow.spacing = 8
        outputButton.setContentHuggingPriority(.defaultLow, for: .horizontal)

        statusLabel = NSTextField(labelWithString: "Server stopped")
        statusLabel.textColor = .secondaryLabelColor

        startStopButton = NSButton(title: "Start Server", target: self, action: #selector(toggleServer))
        startStopButton.bezelStyle = .rounded
        startStopButton.keyEquivalent = "\r"

        let openLiveButton = NSButton(title: "Open Live", target: self, action: #selector(openLive))
        let openManagerButton = NSButton(title: "Open Manager", target: self, action: #selector(openManager))
        let logButton = NSButton(title: "Show Log", target: self, action: #selector(showLog))
        let actionRow = NSStackView(views: [openLiveButton, openManagerButton, logButton])
        actionRow.orientation = .horizontal
        actionRow.spacing = 8

        let stack = NSStackView(views: [
            deviceLabel, deviceRow,
            hostLabel, hostButton,
            outputLabel, outputRow,
            statusLabel,
            startStopButton,
            actionRow,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        stack.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView(frame: window.contentLayoutRect)
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        window.contentView = content

        let defaults = UserDefaults.standard
        if let savedHost = defaults.string(forKey: hostDefaultsKey),
            let index = hostOptions.firstIndex(where: { $0.value == savedHost })
        {
            hostButton.selectItem(at: index)
        }
        if let savedChannels = defaults.string(forKey: outputChannelsDefaultsKey) {
            outputChannelsField.stringValue = savedChannels
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        window.orderOut(nil)
        return false
    }

    @objc private func showWindow() {
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Devices

    @objc private func refreshDevices() {
        guard let resources = Bundle.main.resourceURL else { return }
        let captureBinary = resources.appendingPathComponent("bin/pulse-device-capture")
        let outputBinary = resources.appendingPathComponent("bin/pulse-device-output")
        let savedDevice = UserDefaults.standard.string(forKey: deviceDefaultsKey)
        let savedOutput = UserDefaults.standard.string(forKey: outputDefaultsKey)
        deviceButton.isEnabled = false
        outputButton.isEnabled = false
        refreshButton.isEnabled = false
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let devices = Self.listDevices(binary: captureBinary)
            let outputs = Self.listDevices(binary: outputBinary)
            DispatchQueue.main.async {
                guard let self else { return }
                // No host output is the default; the simulated output is last.
                self.outputButton.removeAllItems()
                self.outputButton.addItems(withTitles: [noOutput] + outputs + [simulatedOutput])
                if let savedOutput, outputs.contains(savedOutput) || savedOutput == simulatedOutput {
                    self.outputButton.selectItem(withTitle: savedOutput)
                }
                self.outputButton.isEnabled = true
                self.deviceButton.removeAllItems()
                // Physical inputs first; the simulated source is always last so
                // it is never the accidental default for a real show.
                self.deviceButton.addItems(withTitles: devices + [simulatedDevice])
                if let savedDevice, devices.contains(savedDevice) || savedDevice == simulatedDevice {
                    self.deviceButton.selectItem(withTitle: savedDevice)
                }
                self.deviceButton.isEnabled = true
                self.refreshButton.isEnabled = true
                self.startStopButton.isEnabled = true
                if devices.isEmpty {
                    self.statusLabel.stringValue = "No 48 kHz input devices found. The simulated test signal is available."
                }
            }
        }
    }

    /// Lists the 48 kHz devices a bundled `--list` binary reports (inputs or outputs).
    private static func listDevices(binary: URL) -> [String] {
        let process = Process()
        process.executableURL = binary
        process.arguments = ["--list"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
        } catch {
            return []
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0,
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let devices = payload["devices"] as? [[String: Any]]
        else { return [] }
        return devices.compactMap { device -> String? in
            guard let name = device["deviceName"] as? String,
                let configs = device["configs"] as? [[String: Any]]
            else { return nil }
            let supports48k = configs.contains { config in
                guard let min = config["minSampleRateHz"] as? Int,
                    let max = config["maxSampleRateHz"] as? Int
                else { return false }
                return min <= 48_000 && max >= 48_000
            }
            return supports48k ? name : nil
        }
    }

    // MARK: - Server lifecycle

    @objc private func toggleServer() {
        if launcher == nil {
            startServer()
        } else {
            stopServer()
        }
    }

    @objc private func startServer() {
        let hostIndex = hostButton.indexOfSelectedItem
        guard launcher?.isRunning != true,
            let resources = Bundle.main.resourceURL,
            let device = deviceButton.titleOfSelectedItem,
            hostOptions.indices.contains(hostIndex)
        else { return }
        let host = hostOptions[hostIndex].value
        let output = outputButton.titleOfSelectedItem ?? noOutput
        let outputChannels = outputChannelsField.stringValue
            .replacingOccurrences(of: " ", with: "")
        if output != noOutput && !Self.validOutputChannels(outputChannels) {
            statusLabel.stringValue = "Output channels must be distinct numbers from 1 to 256, e.g. 1 or 1,2."
            return
        }

        let defaults = UserDefaults.standard
        defaults.set(device, forKey: deviceDefaultsKey)
        defaults.set(host, forKey: hostDefaultsKey)
        defaults.set(output, forKey: outputDefaultsKey)
        defaults.set(outputChannels, forKey: outputChannelsDefaultsKey)

        let process = Process()
        process.executableURL = resources.appendingPathComponent("bin/node")
        process.arguments = [resources.appendingPathComponent("launcher.mjs").path]
        process.currentDirectoryURL = resources.appendingPathComponent("app")
        var environment = ProcessInfo.processInfo.environment
        environment["A2_APP_SHELL"] = "app"
        environment["A2_AUDIO_DEVICE"] = device
        environment["A2_BIND_HOST"] = host
        if output == noOutput {
            environment.removeValue(forKey: "A2_OUTPUT_DEVICE")
        } else {
            environment["A2_OUTPUT_DEVICE"] = output
            environment["A2_OUTPUT_CHANNELS"] = outputChannels
        }
        process.environment = environment
        process.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async {
                guard self?.launcher === finished else { return }
                self?.launcher = nil
                self?.updateMenu(
                    running: false,
                    status: finished.terminationStatus == 0 ? "Server stopped" : "Server exited — see log")
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

    private static func validOutputChannels(_ value: String) -> Bool {
        let parts = value.split(separator: ",", omittingEmptySubsequences: false)
        let numbers = parts.compactMap { Int($0) }
        return !parts.isEmpty && parts.count <= 8 && numbers.count == parts.count
            && numbers.allSatisfy { (1...256).contains($0) } && Set(numbers).count == numbers.count
    }

    @objc private func stopServer() {
        launcher?.terminate()
        updateMenu(running: false, status: "Server stopping…")
    }

    @objc private func openLive() {
        NSWorkspace.shared.open(URL(string: "\(listenBase)/")!)
    }

    @objc private func openManager() {
        NSWorkspace.shared.open(URL(string: "\(listenBase)/manager/")!)
    }

    @objc private func showLog() {
        let path = NSString(string: "~/Library/Logs/Pulse/mvp.log").expandingTildeInPath
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    @objc private func quit() {
        launcher?.terminate()
        NSApplication.shared.terminate(nil)
    }

    private func updateMenu(running: Bool, status: String) {
        statusLabel.stringValue = status
        startMenuItem.isEnabled = !running
        stopMenuItem.isEnabled = running
        statusItem.button?.title = running ? " ●" : ""
        startStopButton.title = running ? "Stop Server" : "Start Server"
        deviceButton.isEnabled = !running
        hostButton.isEnabled = !running
        outputButton.isEnabled = !running
        outputChannelsField.isEnabled = !running
        refreshButton.isEnabled = !running
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
