import { useState } from "react";
import type { Operator, OperatorRole } from "../operator";

type OperatorSheetProps = {
  operator: Operator;
  onSave: (operator: Operator) => void;
  onClose: () => void;
};

/** Who is holding this device. Acknowledgements and check sign-offs are attributed to this name. */
export function OperatorSheet({
  operator,
  onSave,
  onClose,
}: OperatorSheetProps) {
  const [name, setName] = useState(operator.name);
  const [role, setRole] = useState<OperatorRole>(operator.role);

  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="detail-panel operator-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operator-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="detail-overline">This device</span>
            <h2 id="operator-title">Who is operating</h2>
            <p>Acknowledgements and check sign-offs record this name.</p>
          </div>
          <button className="line-button" type="button" onClick={onClose}>
            Cancel
          </button>
        </header>
        <form
          className="operator-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ name: name.trim(), role });
          }}
        >
          <label>
            <span>Name</span>
            <input
              value={name}
              maxLength={60}
              autoFocus
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
            />
          </label>
          <fieldset>
            <legend>Role</legend>
            {(["A2", "A1"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="filter-button"
                aria-pressed={role === option}
                onClick={() => setRole(option)}
              >
                {option}
              </button>
            ))}
          </fieldset>
          <button type="submit" className="control-button primary-button">
            Save
          </button>
        </form>
      </section>
    </div>
  );
}
