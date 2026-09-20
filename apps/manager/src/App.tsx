import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
type Section = "overview" | "people" | "inventory" | "paths";

const sections: Array<{ id: Section; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "people", label: "People and roles" },
  { id: "inventory", label: "Microphone inventory" },
  { id: "paths", label: "Signal paths" },
];

const setupAreas = [
  {
    title: "People and roles",
    detail: "No people or roles are loaded.",
    status: "Unknown",
  },
  {
    title: "Microphone inventory",
    detail: "No elements, transmitters, or prepared spares are loaded.",
    status: "Unknown",
  },
  {
    title: "Signal paths",
    detail: "No receiver paths or captured inputs are loaded.",
    status: "Unknown",
  },
];

const sectionContent: Record<
  Exclude<Section, "overview">,
  { title: string; description: string; waitingFor: string }
> = {
  people: {
    title: "People and roles",
    description:
      "People, roles, cast alternatives, and assignments stay separate so changes do not rewrite history.",
    waitingFor:
      "Waiting for the management API before people or roles can be shown.",
  },
  inventory: {
    title: "Microphone inventory",
    description:
      "Elements, transmitters, prepared spares, and condition history belong to independent physical records.",
    waitingFor:
      "Waiting for the management API before microphone assets can be shown.",
  },
  paths: {
    title: "Signal paths",
    description:
      "Receiver channels and captured inputs remain explicit. Manager never connects to the device network.",
    waitingFor:
      "Waiting for the management API before receiver or audio paths can be shown.",
  },
};

function readTheme(): Theme {
  const saved = window.localStorage.getItem("a2-monitor-theme");
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [section, setSection] = useState<Section>("overview");
  const [validationRequested, setValidationRequested] = useState(false);

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      window.localStorage.removeItem("a2-monitor-theme");
    } else {
      document.documentElement.dataset.theme = theme;
      window.localStorage.setItem("a2-monitor-theme", theme);
    }
  }, [theme]);

  const selectedSection =
    section === "overview" ? null : sectionContent[section];

  return (
    <div className="manager-app">
      <header className="app-header">
        <div className="brand" aria-label="A2 Monitor Manager">
          <span aria-hidden="true">▲</span>
          <strong>A2</strong> <b>Monitor</b>
          <em>Manager</em>
        </div>
        <div className="draft-name">
          <span>Draft production</span>
          <strong>The Winter Circus</strong>
        </div>
        <span className="fabricated-badge">Fabricated local setup</span>
        <label className="theme-picker">
          <span>Theme</span>
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value as Theme)}
          >
            <option value="system">System</option>
            <option value="light">Paper</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </header>

      <section className="connection-notice" aria-live="polite">
        <div>
          <strong>Management backend unavailable.</strong>
          <span>
            This shell uses fabricated labels only. No show, inventory, or
            hardware state is loaded.
          </span>
        </div>
        <span className="unknown-badge">– Unknown</span>
      </section>

      <nav className="section-tabs" aria-label="Manager sections">
        {sections.map((item) => (
          <button
            type="button"
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => {
              setSection(item.id);
              setValidationRequested(false);
            }}
            key={item.id}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main>
        {selectedSection ? (
          <section className="empty-section" aria-labelledby="section-title">
            <span className="overline">Draft setup</span>
            <h1 id="section-title">{selectedSection.title}</h1>
            <p>{selectedSection.description}</p>
            <div className="empty-state">
              <strong>Nothing loaded</strong>
              <span>{selectedSection.waitingFor}</span>
            </div>
          </section>
        ) : (
          <>
            <section className="page-heading" aria-labelledby="overview-title">
              <div>
                <span className="overline">Draft setup</span>
                <h1 id="overview-title">Prepare a production</h1>
                <p>
                  Build identity and path intent here. Observed hardware state
                  will remain separate when the backend exists.
                </p>
              </div>
              <div className="revision-readout">
                <span>Revision</span>
                <strong>Unknown</strong>
              </div>
            </section>

            <section className="setup-grid" aria-label="Production setup areas">
              {setupAreas.map((area) => (
                <article className="setup-card" key={area.title}>
                  <div className="card-heading">
                    <h2>{area.title}</h2>
                    <span className="unknown-badge">– {area.status}</span>
                  </div>
                  <p>{area.detail}</p>
                  <button
                    type="button"
                    className="line-button"
                    onClick={() => {
                      const target = sections.find(
                        (item) => item.label === area.title,
                      );
                      if (target) setSection(target.id);
                    }}
                  >
                    Open {area.title.toLowerCase()}
                  </button>
                </article>
              ))}
            </section>

            <section
              className="activation-card"
              aria-labelledby="activation-title"
            >
              <div>
                <span className="overline">Activation</span>
                <h2 id="activation-title">No activation result</h2>
                <p>
                  Validation requires an observed node manifest and a saved
                  immutable revision. Neither is available in this shell.
                </p>
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={() => setValidationRequested(true)}
              >
                Check readiness
              </button>
            </section>

            {validationRequested ? (
              <section className="validation-result" role="status">
                <strong>Readiness could not be checked.</strong>
                <span>
                  Connect the management backend and audio node before
                  validating or activating a production.
                </span>
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
